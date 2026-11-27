// Live Tier 2 evidence using the REAL code paths: Wallet MCP lookup, explorer verification status, and a CSV built from a real mainnet ledger.
// Usage: NODE_USE_ENV_PROXY=1 tsx scripts/tier2-live.mts [wallet] [days] [endUnix]   -> writes the CSV to $CSV_OUT (default: stdout summary only)
import fs from "node:fs";
import { ChainReader, JsonRpcClient, buildLedger, deriveRange, explorerVerification, ledgerToCsv, lookupQieId, makeMcpCallTool, resolveReference, verifyTokenHistory, totalsOf, QUSDC_ADDRESS, QUSDC_DECIMALS, type StatementData } from "../src/index";

const out: any = { date: new Date().toISOString() };
const mcp = await makeMcpCallTool();
out.qieId = { qusdcContract: await lookupQieId(QUSDC_ADDRESS, mcp.callTool), zeroAddress: await lookupQieId("0x0000000000000000000000000000000000000000", mcp.callTool) };
await mcp.close();
out.explorer = { qusdc: await explorerVerification(QUSDC_ADDRESS), activeContractWallet: await explorerVerification("0x73a3ccf7da7e473ed2e9994ae764f0e30f4e4dfe"), unknownAddress: await explorerVerification("0x00000000000000000000000000000000000b4a11") };

const wallet = (process.argv[2] ?? "0x73a3ccf7da7e473ed2e9994ae764f0e30f4e4dfe").toLowerCase(); const days = BigInt(process.argv[3] ?? "14"); const end = BigInt(process.argv[4] ?? "1770249600");
const REG = "0x5555555555555555555555555555555555555555";
const mk = (id: string, url: string) => new ChainReader(new JsonRpcClient({ id, url }, { timeoutMs: 40000, retries: 3, backoffMs: 800 }), REG);
const dual = { a: mk("rpc1", "https://rpc1mainnet.qie.digital"), b: mk("rpc5", "https://rpc5mainnet.qie.digital") };
const ref = await resolveReference(dual); await verifyTokenHistory(dual);
const range = await deriveRange(dual, end - days * 86400n, end, ref); const led = await buildLedger(dual, wallet, range, ref, { concurrency: 6 });
const data: StatementData = { rendererId: "0x" + "0".repeat(64), chainId: 1990n, registry: REG, token: QUSDC_ADDRESS, decimals: QUSDC_DECIMALS, owner: wallet, requestId: "0x" + "0".repeat(64), issuanceSalt: "0x" + "0".repeat(64), startUnix: end - days * 86400n, endUnix: end, fromBlock: range.fromBlock, toBlock: range.toBlock, fromBlockHash: range.fromHeader.hash, toBlockHash: range.toHeader.hash, opening: led.opening, closing: led.closing, entries: led.entries };
const csv = ledgerToCsv(data); const t = totalsOf(led.entries);
out.realLedgerCsv = { wallet: "(public mainnet wallet; address omitted from repo evidence)", entries: led.entries.length, rows: csv.trim().split("\r\n").length - 1, incoming: t.incoming.toString(), outgoing: t.outgoing.toString(), opening: led.opening.toString(), closing: led.closing.toString() };
if (process.env.CSV_OUT) fs.writeFileSync(process.env.CSV_OUT, csv);
console.log(JSON.stringify(out, null, 2));
