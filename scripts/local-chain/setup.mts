// Prepares a LOCAL Hardhat node (chain id 1990) as a stand-in for QIE mainnet for end-to-end tests of the live runner.
// Start the node first:  HARDHAT_CHAIN_ID=1990 HARDHAT_INITIAL_DATE=2025-12-01T00:00:00Z npx hardhat node --port 8545  (in contracts/)
// Everything here is a LOCAL FIXTURE: a mock QUSDC injected at the real QUSDC address, at the real pinned deployment block.
import fs from "node:fs";
import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";

const URL = process.env.LOCAL_RPC ?? "http://127.0.0.1:8545";
const QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const DEPLOY_BLOCK = 5_244_996;
const KEYS = ["0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdd8d4d3"]; // PUBLIC Hardhat dev keys
const provider = new JsonRpcProvider(URL, 1990, { staticNetwork: true, cacheTimeout: -1 });
const [w0, w1, w2] = KEYS.map((k) => new Wallet(k, provider));
const raw = (m: string, p: unknown[]) => provider.send(m, p);
const mine = (n: number, interval = 4) => raw("hardhat_mine", ["0x" + n.toString(16), "0x" + interval.toString(16)]);
const head = async () => Number(BigInt(await raw("eth_blockNumber", [])));
const art = (n: string, f = n) => JSON.parse(fs.readFileSync(`contracts/artifacts/contracts/${f}.sol/${n}.json`, "utf8"));

if (BigInt(await raw("eth_chainId", [])) !== 1990n) throw new Error("local node must run with HARDHAT_CHAIN_ID=1990");
const mock = art("MockQUSDC", "probe/MockQUSDC");
const m = await new ContractFactory(mock.abi, mock.bytecode, w0).deploy(); await m.waitForDeployment();
await raw("hardhat_setCode", [QUSDC, mock.deployedBytecode]);                // injected NOW; the first block mined after this is the "deployment block"
const cur = await head(); if (cur >= DEPLOY_BLOCK - 1) throw new Error("node already past the deployment block; restart it");
// hardhat_setCode rewrites the LATEST block's state view, so: mine up to exactly the deployment block with empty code, then inject.
// Code is then absent at N-1 and present at N, matching the real chain's pinned deployment block.
await raw("hardhat_setCode", [QUSDC, "0x"]);
await mine(DEPLOY_BLOCK - cur);
if ((await head()) !== DEPLOY_BLOCK) throw new Error("fixture arithmetic: expected head == deployment block");
await raw("hardhat_setCode", [QUSDC, mock.deployedBytecode]);
// explicit 'latest' nonces: after bulk hardhat_mine, ethers' 'pending' lookup on a Hardhat node can be stale
// NOTE: hardhat_mine's bulk fast path emits blocks with a zeroed parentHash. Bankable (rightly) checks parentHash links at range boundaries and the
// real chain passes, so boundaries here are crossed with normally mined (linked) blocks via evm_mine with explicit timestamps.
const ts = async () => Number(BigInt((await raw("eth_getBlockByNumber", ["latest", false])).timestamp));
async function fastForwardTo(unix: number) { const t = await ts(); if (unix > t + 4) await mine(Math.floor((unix - t) / 4), 4); }
async function crossBoundary(unix: number) { await fastForwardTo(unix - 400); let t = (await ts()) + 4; while (t < unix + 400) { await raw("evm_mine", [t]); t += 4; } }
const iso = (s: string) => Math.floor(Date.parse(s) / 1000);
const tx = async (fn: (o: { nonce: number }) => Promise<any>, w: Wallet = w0) => (await fn({ nonce: await provider.getTransactionCount(w.address, "latest") })).wait();
const q: any = new (await import("ethers")).Contract(QUSDC, mock.abi, w0);

await tx((o) => q.mint(w0.address, 25_000_000n, o));                       // 2026-07-31: opening balance before the period
await tx((o) => q.mint(w1.address, 100_000_000n, o));
await crossBoundary(iso("2026-08-02T00:00:00Z"));                           // START boundary of the test period, linked blocks
await fastForwardTo(iso("2026-08-03T01:00:00Z"));
await tx((o) => q.move(w1.address, w0.address, 12_500_000n, o)); await mine(2000);
await tx((o) => q.move(w0.address, w2.address, 4_000_000n, o)); await mine(2000);
await tx((o) => q.move(w0.address, w0.address, 300_000n, o)); await mine(2000);   // self-transfer
await tx((o) => q.mint(w0.address, 7_000_000n, o)); await mine(2000);              // in-period mint
await tx((o) => q.burn(w0.address, 500_000n, o)); await mine(2000);                // burn
await crossBoundary(iso("2026-08-06T00:00:00Z"));                           // END boundary, linked blocks
await fastForwardTo(iso("2026-08-06T12:00:00Z"));
const b = await raw("eth_getBlockByNumber", ["latest", false]);
console.log(JSON.stringify({ head: await head(), headTimestamp: Number(BigInt(b.timestamp)), headIso: new Date(Number(BigInt(b.timestamp)) * 1000).toISOString(), owner: w0.address, second: w1.address, suggestedPeriod: ["2026-08-02", "2026-08-05"] }, null, 2));
