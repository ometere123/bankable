// G3 (no funds needed): execute on QIE mainnet's real EVM via eth_call. No transaction is sent.
import fs from "node:fs";
import { Interface } from "ethers";
const EP = process.env.QIE_RPC_A ?? "https://rpc1mainnet.qie.digital";
let id = 1;
async function rpc(method: string, params: unknown[]) {
  const r = await fetch(EP, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }) });
  const j: any = await r.json(); return j.error ? { error: j.error.message as string } : { result: j.result };
}
const art = JSON.parse(fs.readFileSync("contracts/artifacts/contracts/StatementRegistry.sol/StatementRegistry.json", "utf8"));
const iface = new Interface(art.abi);
const out: any = { endpoint: EP, date: new Date().toISOString() };
out.clientVersion = (await rpc("web3_clientVersion", [])).result ?? "(not exposed)";
const head = await rpc("eth_getBlockByNumber", ["latest", false]);
out.latestBlock = { number: parseInt(head.result.number, 16), hasBaseFee: "baseFeePerGas" in head.result, baseFeePerGas: head.result.baseFeePerGas, gasLimit: parseInt(head.result.gasLimit, 16) };
out.gasPrice = (await rpc("eth_gasPrice", [])).result;
// 1. PUSH0 (0x5f) support: initcode "PUSH0 PUSH0 RETURN" vs control "PUSH1 0 PUSH1 0 RETURN"
out.push0 = { control_push1: await rpc("eth_call", [{ data: "0x60006000f3" }, "latest"]), push0: await rpc("eth_call", [{ data: "0x5f5ff3" }, "latest"]) };
// 2. creation bytecode executes on QIE and returns the expected runtime code
const creation: string = art.bytecode;
const created = await rpc("eth_call", [{ data: creation }, "latest"]);
out.creationCall = created.error ? created : { returnsRuntimeCode: created.result === art.deployedBytecode, runtimeBytes: (created.result.length - 2) / 2, localDeployedBytes: (art.deployedBytecode.length - 2) / 2 };
out.deploymentGasEstimate = await rpc("eth_estimateGas", [{ data: creation }]);
// 3. State overrides are NOT honoured by this node: a call to an address that only has overridden code returns "0x" (no code).
const REG = "0x00000000000000000000000000000000000b4a11";
const probe = await rpc("eth_call", [{ from: "0x1111111111111111111111111111111111111111", to: REG, data: iface.encodeFunctionData("getRecord", ["0x" + "0".repeat(63) + "1"]) }, "latest", { [REG]: { code: art.deployedBytecode } }]);
out.stateOverrideHonoured = probe.result !== undefined && probe.result !== "0x";
// 4. Full register/getRecord/revoke/revert scenario executed inside ONE eth_call on the real EVM (constructor returns observations).
const h = JSON.parse(fs.readFileSync("contracts/artifacts/contracts/probe/G3Harness.sol/G3Harness.json", "utf8"));
const hr = await rpc("eth_call", [{ from: "0x1111111111111111111111111111111111111111", data: h.bytecode }, "latest"]);
const names = ["idIsOwnerScoped", "ownerIsMsgSender", "registeredBlockIsExecutingBlock", "activeAfterRegister", "zeroCommitmentReverts", "toBlockAtExecutingBlockReverts", "futureEndReverts", "duplicateReverts", "revokeRecordsBlock", "recordSurvivesRevocation", "doubleRevokeReverts", "revokeUnknownReverts", "unknownReadsZeroOwner"];
if (hr.error) out.harness = hr; else { const vals = new (await import("ethers")).AbiCoder().decode(["bool[13]"], hr.result)[0]; out.harness = Object.fromEntries(names.map((n, i) => [n, vals[i]])); out.harnessAllTrue = vals.every(Boolean); }
fs.mkdirSync("docs/gates", { recursive: true });
fs.writeFileSync("docs/gates/g3-evm-probe.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
