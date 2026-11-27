// G1 on REAL QIE mainnet using the actual Bankable core: dual-endpoint reconstruction, reconciliation and timing.
// Usage: NODE_USE_ENV_PROXY=1 tsx scripts/gates/g1-real.mts [walletAddress] [days]
import { JsonRpcClient, ChainReader, resolveReference, deriveRange, buildLedger, verifyTokenHistory, TRANSFER_TOPIC, QUSDC_ADDRESS, totalsOf, formatUnits, MAX_LOG_SPAN } from "@bankable/core";

const REGISTRY = "0x5555555555555555555555555555555555555555"; // placeholder: registry is not read in this gate
const mk = (id: string, url: string) => new ChainReader(new JsonRpcClient({ id, url }, { timeoutMs: 40000, retries: 3, backoffMs: 800 }), REGISTRY);
const dual = { a: mk("rpc1", "https://rpc1mainnet.qie.digital"), b: mk("rpc5", "https://rpc5mainnet.qie.digital") };
const t0 = Date.now(); const lap = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

const ref = await resolveReference(dual); lap(`reference block ${ref.number} ts ${ref.timestamp} hash ${ref.hash.slice(0, 12)}`);
await verifyTokenHistory(dual); lap("token deployment block verified on both endpoints");

const days = BigInt(process.argv[3] ?? "7");
const endUnix = process.argv[4] ? BigInt(process.argv[4]) : (ref.timestamp / 86400n) * 86400n; // default: most recent completed UTC midnight
const startUnix = endUnix - days * 86400n;
let wallet = process.argv[2]?.toLowerCase();
if (!wallet) {
  // find an active wallet in the window using unfiltered logs over the last ~day of the window
  const range0 = await deriveRange(dual, endUnix - 86400n, endUnix, ref); lap(`range of last UTC day: ${range0.fromBlock}-${range0.toBlock}`);
  const counts = new Map<string, number>();
  for (let f = range0.fromBlock; f <= range0.toBlock; f += BigInt(MAX_LOG_SPAN)) {
    const to = f + BigInt(MAX_LOG_SPAN) - 1n > range0.toBlock ? range0.toBlock : f + BigInt(MAX_LOG_SPAN) - 1n;
    const logs = await dual.a.client.call<any[]>("eth_getLogs", [{ address: QUSDC_ADDRESS, fromBlock: "0x" + f.toString(16), toBlock: "0x" + to.toString(16), topics: [TRANSFER_TOPIC] }]);
    for (const l of logs) for (const t of [l.topics[1], l.topics[2]]) { const a = "0x" + t.slice(26); if (!/^0x0{40}$/.test(a)) counts.set(a, (counts.get(a) ?? 0) + 1); }
  }
  const top = [...counts.entries()].sort((x, y) => y[1] - x[1]); lap(`active addresses in last day: ${top.length}; top: ${JSON.stringify(top.slice(0, 3))}`);
  wallet = top.find(([, n]) => n >= 2 && n <= 40)?.[0] ?? top[0]?.[0];
  if (!wallet) throw new Error("no active wallet found in the last day");
}
lap(`wallet ${wallet}; period ${startUnix}..${endUnix} (${days} days)`);
const range = await deriveRange(dual, startUnix, endUnix, ref);
lap(`range ${range.fromBlock}-${range.toBlock} (${range.toBlock - range.fromBlock + 1n} blocks, ${(range.toBlock - range.fromBlock) / BigInt(MAX_LOG_SPAN) + 1n} chunks x2 filters x2 endpoints)`);
let last = 0;
const ledger = await buildLedger(dual, wallet, range, ref, { concurrency: 6, onProgress: (d, t) => { if (d - last >= 20 || d === t) { last = d; lap(`scan ${d}/${t}`); } } });
const t = totalsOf(ledger.entries);
lap("DONE");
console.log(JSON.stringify({
  wallet, startUnix: String(startUnix), endUnix: String(endUnix), fromBlock: String(range.fromBlock), toBlock: String(range.toBlock),
  entries: ledger.entries.length, opening: formatUnits(ledger.opening, 6), closing: formatUnits(ledger.closing, 6),
  incoming: formatUnits(t.incoming, 6), outgoing: formatUnits(t.outgoing, 6), self: formatUnits(t.self, 6), reconciled: ledger.reconciled,
  totalSeconds: (Date.now() - t0) / 1000, rpc: { a: dual.a.client.stats, b: dual.b.client.stats },
}, null, 2));
