// Issues and registers ONE real statement on QIE mainnet from wallet A (key read from a local 0600 file; never printed), saves the PDF
// and its request link, for end-to-end verification on the deployed site. Spends a little gas.
//   NODE_USE_ENV_PROXY=1 npx tsx scripts/mainnet-demo-statement.mts <startUnix> <endUnix> <outDir>
import fs from "node:fs";
import path from "node:path";
import { Wallet } from "ethers";
import { FetchProvider } from "./lib/proxy-provider.mts";
import { ChainReader, JsonRpcClient, PROFILE_MANIFESTS, confirmRegistration, createRequest, loadProfiles, prepareIssuance, registryInterface, requestLink, resolveReference, type Dual } from "@bankable/core";

const [startArg, endArg, outDir] = process.argv.slice(2);
if (!startArg || !endArg || !outDir) { console.error("usage: <startUnix> <endUnix> <outDir>"); process.exit(2); }
const REGISTRY = (process.env.STATEMENT_REGISTRY_ADDRESS ?? "0x1E9FC096bebe1f142AeeD317d0054583E9227804").toLowerCase();
const keys = JSON.parse(fs.readFileSync(process.env.BANKABLE_KEYS ?? "/root/.bankable-keys/keys.json", "utf8"));
const provider = new FetchProvider("https://rpc1mainnet.qie.digital");
const wallet = new Wallet(keys.A.privateKey, provider);
const mk = (id: string, url: string) => new ChainReader(new JsonRpcClient({ id, url }, { timeoutMs: 40000, retries: 3, backoffMs: 800 }), REGISTRY);
const dual: Dual = { a: mk("rpc1", "https://rpc1mainnet.qie.digital"), b: mk("rpc5", "https://rpc5mainnet.qie.digital") };
const profile = [...loadProfiles(PROFILE_MANIFESTS).values()].at(-1)!;
const origin = JSON.parse(profile.manifestText).origin as string;

const ref = await resolveReference(dual);
const req = createRequest({ registry: REGISTRY, expectedWallet: wallet.address, startUnix: BigInt(startArg), endUnix: BigInt(endArg), nowUnix: ref.timestamp });
const iss = await prepareIssuance({ dual, request: req, registry: REGISTRY, profile, scan: { concurrency: 6 } });
console.log(`ledger: ${iss.summary.entries} entries; opening ${iss.summary.opening}; closing ${iss.summary.closing}; origin ${origin}`);
const data = registryInterface.encodeFunctionData("register", Object.values(iss.args) as any);
const tx = await wallet.sendTransaction({ to: REGISTRY, data, nonce: await provider.getTransactionCount(wallet.address, "latest") });
const rc = await tx.wait(); if (!rc || rc.status !== 1) throw new Error("registration failed");
const conf = await confirmRegistration({ dual, owner: wallet.address, issuance: iss, receiptBlock: BigInt(rc.blockNumber) });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "statement.pdf"), iss.pdf);
fs.writeFileSync(path.join(outDir, "request-link.txt"), requestLink(origin, "/verify", req) + "\n");
fs.writeFileSync(path.join(outDir, "record.json"), JSON.stringify({ network: "QIE mainnet (1990)", registry: REGISTRY, owner: wallet.address, recordId: conf.id, tx: tx.hash, block: String(rc.blockNumber), pdfSha256: iss.pdfHash, dataHash: iss.dataHash, startUnix: startArg, endUnix: endArg }, null, 2) + "\n");
console.log("registered", tx.hash, "record", conf.id, "pdf", iss.pdf.length, "bytes");
