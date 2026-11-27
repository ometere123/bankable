// Owner-run setup on QIE mainnet using keys from a local 0600 file (never printed, never committed).
//   NODE_USE_ENV_PROXY=1 npx tsx scripts/mainnet-setup.mts check|deploy|transfers
import fs from "node:fs";
import { Contract, ContractFactory, Wallet, formatEther, formatUnits, parseUnits } from "ethers";
import { FetchProvider } from "./lib/proxy-provider.mts";

const KEYS = process.env.BANKABLE_KEYS ?? "/root/.bankable-keys/keys.json";
const k = JSON.parse(fs.readFileSync(KEYS, "utf8"));
const provider = new FetchProvider(process.env.QIE_RPC_A ?? "https://rpc1mainnet.qie.digital");
const A = new Wallet(k.A.privateKey, provider), B = new Wallet(k.B.privateKey, provider);
const QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const erc20 = ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"];
const q = new Contract(QUSDC, erc20, provider);
const nonce = (w: Wallet) => provider.getTransactionCount(w.address, "latest");

async function show() {
  for (const [n, w] of [["A", A], ["B", B]] as const) console.log(n, w.address, "QIE", formatEther(await provider.getBalance(w.address)), "QUSDC", formatUnits(await q.balanceOf!(w.address), 6));
}
const cmd = process.argv[2];
if ((await provider.getNetwork()).chainId !== 1990n) throw new Error("not chain 1990");
await show();
if (cmd === "deploy") {
  const art = JSON.parse(fs.readFileSync("contracts/artifacts/contracts/StatementRegistry.sol/StatementRegistry.json", "utf8"));
  const f = new ContractFactory(art.abi, art.bytecode, A);
  const c = await f.deploy({ nonce: await nonce(A) }); const tx = c.deploymentTransaction()!; console.log("deploy tx", tx.hash);
  const rc = await tx.wait(); if (!rc || rc.status !== 1) throw new Error("deploy failed");
  const addr = await c.getAddress(); const code = await provider.getCode(addr);
  if (code.toLowerCase() !== art.deployedBytecode.toLowerCase()) throw new Error("on-chain bytecode differs from local build");
  const rec = { network: "QIE mainnet", chainId: 1990, address: addr, deployTx: tx.hash, deployBlock: rc.blockNumber, deployer: A.address, compiler: { version: "0.8.20+commit.a1b79de6", evmVersion: "paris", optimizer: { enabled: true, runs: 200 } }, runtimeBytes: (code.length - 2) / 2, explorer: `https://mainnet.qie.digital/address/${addr}`, deployedAt: new Date().toISOString() };
  fs.mkdirSync("contracts/deployments", { recursive: true }); fs.writeFileSync("contracts/deployments/mainnet.json", JSON.stringify(rec, null, 2) + "\n"); console.log(JSON.stringify(rec, null, 2));
} else if (cmd === "transfers") {
  const steps: [string, Wallet, Wallet, string][] = [["A->B 0.30", A, B, "0.30"], ["B->A 0.10", B, A, "0.10"], ["A->B 0.05", A, B, "0.05"]];
  for (const [label, from, to, amt] of steps) {
    const tx = await (q.connect(from) as any).transfer(to.address, parseUnits(amt, 6), { nonce: await nonce(from) }); const rc = await tx.wait();
    console.log(label, rc.status === 1 ? "ok" : "FAILED", tx.hash, "block", rc.blockNumber); if (rc.status !== 1) throw new Error("transfer failed");
  }
  await show();
} else if (cmd !== "check") { console.error("usage: check|deploy|transfers"); process.exit(2); }
