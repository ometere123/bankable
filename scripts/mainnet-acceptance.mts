// LIVE MAINNET ACCEPTANCE (spec 11.1). Run by the project owner with their own funded key(s); keys are read from the environment only.
//   STATEMENT_REGISTRY_ADDRESS=0x... DEPLOYER_PRIVATE_KEY=0x... ACCEPT_SECOND_PRIVATE_KEY=0x... \
//   ACCEPT_FIRST_DAY=2026-11-01 ACCEPT_LAST_DAY=2026-11-14 (or ACCEPT_START_UNIX/ACCEPT_END_UNIX) NODE_USE_ENV_PROXY=1 npx tsx scripts/mainnet-acceptance.mts
// DEPLOYER_PRIVATE_KEY is the wallet being reported on (its own QUSDC history). The second key plays the forger / unauthorised party.
import { Wallet } from "ethers";
import { FetchProvider } from "./lib/proxy-provider.mts";
import fs from "node:fs";
import {
  ChainReader, JsonRpcClient, createRequest, inclusiveDaysToPeriod, requestLink, resolveReference, prepareIssuance, confirmRegistration, verifyStatement,
  loadProfiles, PROFILE_MANIFESTS, registryInterface, recordId, renderStatementPdf, sha256Hex, MAX_PERIOD_SECONDS, type Dual, type Issuance, type VerifyResult,
} from "@bankable/core";

const need = (k: string) => { const v = process.env[k]; if (!v) { console.error(`Missing ${k}. See the header of this script.`); process.exit(2); } return v; };
const REGISTRY = need("STATEMENT_REGISTRY_ADDRESS").toLowerCase();
const owner = new Wallet(need("DEPLOYER_PRIVATE_KEY"));
const second = process.env.ACCEPT_SECOND_PRIVATE_KEY ? new Wallet(process.env.ACCEPT_SECOND_PRIVATE_KEY) : null;
const RPC_A = process.env.QIE_RPC_A ?? "https://rpc1mainnet.qie.digital", RPC_B = process.env.QIE_RPC_B ?? "https://rpc5mainnet.qie.digital";
const provider = new FetchProvider(RPC_A); // fetch-based (proxy-capable); cacheTimeout -1 because ethers caches identical calls for 250 ms and returned stale nonces
const mk = (id: string, url: string) => new ChainReader(new JsonRpcClient({ id, url }, { timeoutMs: 40000, retries: 3, backoffMs: 800 }), REGISTRY);
const dual: Dual = { a: mk("rpc1", RPC_A), b: mk("rpc5", RPC_B) };
const profiles = loadProfiles(PROFILE_MANIFESTS); const profile = [...profiles.values()].at(-1)!;
const T: any[] = []; let fails = 0;
const log = (name: string, ok: boolean, detail: unknown) => { if (!ok) fails++; T.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`); };
const verify = (file: Uint8Array | undefined, who: string, link?: string): Promise<VerifyResult> => verifyStatement({ file, owner: who, requestLink: link, dual, profiles, registry: REGISTRY, scan: { concurrency: 6 } });
const LOCAL = process.env.ACCEPT_LOCAL_MINE === "1"; // local fixture node only: mine confirmation blocks instead of waiting
// normal evm_mine blocks (not hardhat_mine's fast path, whose blocks have no queryable historical state or parent links)
const mineLocal = async () => { if (LOCAL) for (let i = 0; i < 24; i++) await provider.send("evm_mine", []); };
async function send(w: Wallet, data: string) {
  const c = w.connect(provider); // explicit 'latest' nonce: every tx below waits for its receipt first
  const tx = await c.sendTransaction({ to: REGISTRY, data, nonce: await provider.getTransactionCount(w.address, "latest") });
  const rc = await tx.wait(); await mineLocal(); return { hash: tx.hash, rc };
}
async function expectRevert(w: Wallet, data: string) { try { await w.connect(provider).estimateGas({ to: REGISTRY, data }); return false; } catch { return true; } }

// Either whole UTC days (ACCEPT_FIRST_DAY/ACCEPT_LAST_DAY) or an exact completed range in Unix seconds (ACCEPT_START_UNIX/ACCEPT_END_UNIX).
const { startUnix, endUnix } = process.env.ACCEPT_START_UNIX && process.env.ACCEPT_END_UNIX
  ? { startUnix: BigInt(process.env.ACCEPT_START_UNIX), endUnix: BigInt(process.env.ACCEPT_END_UNIX) }
  : inclusiveDaysToPeriod(need("ACCEPT_FIRST_DAY"), need("ACCEPT_LAST_DAY"));
if (endUnix - startUnix > MAX_PERIOD_SECONDS) throw new Error("period too long");
const ref0 = await resolveReference(dual);
const req = createRequest({ registry: REGISTRY, expectedWallet: owner.address, startUnix, endUnix, nowUnix: ref0.timestamp });
const ORIGIN = JSON.parse(profile.manifestText).origin;
const link = requestLink(ORIGIN, "/verify", req);
console.log(`owner ${owner.address}; period ${startUnix}..${endUnix}; registry ${REGISTRY}`);

const issue1: Issuance = await prepareIssuance({ dual, request: req, registry: REGISTRY, profile, scan: { concurrency: 6, onProgress: (d, t) => d === t && console.log(`scan ${d}/${t}`) } });
console.log(`ledger: ${issue1.summary.entries} entries; opening ${issue1.summary.opening}; closing ${issue1.summary.closing}`);
const r1 = await send(owner, registryInterface.encodeFunctionData("register", Object.values(issue1.args) as any));
log("register authentic statement", r1.rc?.status === 1, { tx: r1.hash });
const conf = await confirmRegistration({ dual, owner: owner.address, issuance: issue1, receiptBlock: BigInt(r1.rc!.blockNumber) });
log("read-back matches every submitted field on both endpoints", true, { id: conf.id, block: String(conf.record.registeredBlock) });

let v = await verify(issue1.pdf, owner.address, link); log("authentic PDF + original link => Verified, request matched", v.overall === "verified-request-matched", v.checks);
v = await verify(issue1.pdf, owner.address); log("authentic PDF, no link => Verified document, request not checked", v.overall === "verified-request-not-checked", v.checks);
const altered = Uint8Array.from(issue1.pdf); altered[altered.length - 40] ^= 1;
v = await verify(altered, owner.address, link); log("one byte altered (unregistered) => Issued fails", v.checks.issued.status === "fail" && v.overall === "failed", v.checks);
v = await verify(issue1.pdf, owner.address, requestLink(ORIGIN, "/verify", { ...req, nonce: "0x" + "77".repeat(32) })); log("wrong request link => Request fails", v.checks.request.status === "fail" && v.overall === "failed", v.checks);
v = await verify(undefined, owner.address); log("QR only => Not checked, never Verified", v.overall === "not-checked-qr-only", v.overall);
log("duplicate registration of the same file reverts", await expectRevert(owner, registryInterface.encodeFunctionData("register", Object.values(issue1.args) as any)), null);

if (second) {
  const forgedData = { ...issue1.data, entries: issue1.data.entries.length ? issue1.data.entries.map((e, k) => (k === 0 ? { ...e, to: second.address.toLowerCase() } : e)) : [{ block: issue1.data.fromBlock, blockHash: issue1.data.fromBlockHash, logIndex: 0n, txHash: "0x" + "ab".repeat(32), from: owner.address.toLowerCase(), to: second.address.toLowerCase(), amount: 1n, timestamp: issue1.data.startUnix, direction: "D" as const }] };
  const forged = await renderStatementPdf(forgedData, { origin: JSON.parse(profile.manifestText).origin }); const fh = await sha256Hex(forged);
  const rf = await send(second, registryInterface.encodeFunctionData("register", [issue1.args.startUnix, issue1.args.endUnix, issue1.args.fromBlock, issue1.args.toBlock, issue1.args.requestId, issue1.args.issuanceSalt, issue1.args.dataHash, fh, issue1.args.rendererId]));
  await confirmRegistration({ dual, owner: second.address, issuance: { ...issue1, pdfHash: fh, args: { ...issue1.args, pdfHash: fh } }, receiptBlock: BigInt(rf.rc!.blockNumber) });
  v = await verify(forged, second.address); log("forged PDF registered by a second wallet => Issued passes, Content fails", v.checks.issued.status === "pass" && v.checks.content.status === "fail" && v.overall === "failed", v.checks);
  v = await verify(forged, owner.address); log("same forged PDF as the expected owner => Issued fails", v.checks.issued.status === "fail", v.checks);
  const rf2 = await send(second, registryInterface.encodeFunctionData("register", Object.values(issue1.args) as any));
  v = await verify(issue1.pdf, owner.address, link); log("third-party registration of the owner's file hash cannot take over the original", v.overall === "verified-request-matched" && recordId(second.address, issue1.pdfHash) !== conf.id, { tx: rf2.hash });
  log("unauthorised revoke reverts", await expectRevert(second, registryInterface.encodeFunctionData("revoke", [conf.id])), null);
} else console.log("SKIPPED forged/third-party/unauthorised-revoke cases: set ACCEPT_SECOND_PRIVATE_KEY");

const rv = await send(owner, registryInterface.encodeFunctionData("revoke", [conf.id]));
log("owner revokes", rv.rc?.status === 1, { tx: rv.hash });
if (!LOCAL) await new Promise((r) => setTimeout(r, 60_000)); // let the revocation fall inside the confirmed window
v = await verify(issue1.pdf, owner.address, link); log("revoked: old file fails Status", v.checks.status.status === "fail" && v.overall === "failed", v.checks);
log("double revoke reverts", await expectRevert(owner, registryInterface.encodeFunctionData("revoke", [conf.id])), null);
const issue2 = await prepareIssuance({ dual, request: req, registry: REGISTRY, profile });
const r2 = await send(owner, registryInterface.encodeFunctionData("register", Object.values(issue2.args) as any));
await confirmRegistration({ dual, owner: owner.address, issuance: issue2, receiptBlock: BigInt(r2.rc!.blockNumber) });
v = await verify(issue2.pdf, owner.address, link); log("reissue with a fresh salt => new record matches the ORIGINAL link", v.overall === "verified-request-matched" && issue2.pdfHash !== issue1.pdfHash, { tx: r2.hash });

fs.writeFileSync(`docs/acceptance/${LOCAL ? "LOCAL-FIXTURE" : "mainnet"}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ network: LOCAL ? "LOCAL FIXTURE (chain 1990 stand-in, mock QUSDC), NOT MAINNET" : "QIE mainnet (1990)", registry: REGISTRY, owner: owner.address, secondWallet: second?.address ?? null, startUnix: String(startUnix), endUnix: String(endUnix), results: T }, null, 2) + "\n");
console.log(`\n${T.length - fails}/${T.length} passed`); process.exit(fails ? 1 : 0);
