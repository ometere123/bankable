// G1 deep probe: getLogs limits, deployment block, mint/burn, Plan A reconciliation, concurrency, block time.
const EPS = ["https://rpc1mainnet.qie.digital", "https://rpc5mainnet.qie.digital"];
const QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO32 = "0x" + "0".repeat(64);
let id = 1;
const hex = (n) => "0x" + n.toString(16);
async function rpc(ep, method, params, timeoutMs = 60000) {
  const t0 = Date.now(); const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(ep, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }), signal: ctl.signal });
    const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = { error: { message: `HTTP ${r.status} non-json: ${txt.slice(0, 120)}` } }; }
    return { ms: Date.now() - t0, status: r.status, ...j };
  } catch (e) { return { ms: Date.now() - t0, error: { message: String(e) } }; } finally { clearTimeout(to); }
}
const A = EPS[0];
const out = {};
const head = parseInt((await rpc(A, "eth_blockNumber", [])).result, 16);
out.head = head;

// block time over recent windows
const bt = async (ep, n) => { const a = await rpc(ep, "eth_getBlockByNumber", [hex(head - n), false]); const b = await rpc(ep, "eth_getBlockByNumber", [hex(head - 5), false]); return (parseInt(b.result.timestamp, 16) - parseInt(a.result.timestamp, 16)) / (n - 5); };
out.blockTimeSec = { last1k: await bt(A, 1000), last100k: await bt(A, 100000), last1M: await bt(A, 1000000) };

// deployment block via binary search on eth_getCode
async function hasCode(b) { const r = await rpc(A, "eth_getCode", [QUSDC, hex(b)]); if (r.error) throw new Error(r.error.message); return r.result !== "0x"; }
let lo = 1, hi = head;
while (lo < hi) { const m = Math.floor((lo + hi) / 2); if (await hasCode(m)) hi = m; else lo = m + 1; }
out.deploymentBlock = lo;
out.deploymentBlockHeader = (await rpc(A, "eth_getBlockByNumber", [hex(lo), false])).result?.timestamp;

// getLogs limits: widening ranges ending at head-20, both endpoints
out.logLimits = {};
for (const ep of EPS) {
  const rows = []; 
  for (const span of [1000, 10000, 50000, 100000, 500000, 1000000, 5000000]) {
    const to = head - 20, from = to - span + 1;
    const r = await rpc(ep, "eth_getLogs", [{ address: QUSDC, fromBlock: hex(from), toBlock: hex(to), topics: [TRANSFER] }]);
    rows.push({ span, ms: r.ms, n: Array.isArray(r.result) ? r.result.length : null, err: r.error?.message?.slice(0, 160) });
    if (r.error) break;
  }
  out.logLimits[ep] = rows;
}
// full-history log count from deployment (chunked, endpoint A), also collect transfers
const all = []; const chunk = 500000; let from = out.deploymentBlock; const t0 = Date.now(); const chunkLog = [];
const R = head - 20;
while (from <= R) {
  const to = Math.min(from + chunk - 1, R);
  const r = await rpc(A, "eth_getLogs", [{ address: QUSDC, fromBlock: hex(from), toBlock: hex(to), topics: [TRANSFER] }]);
  if (r.error) { chunkLog.push({ from, to, err: r.error.message.slice(0, 200) }); break; }
  chunkLog.push({ from, to, n: r.result.length, ms: r.ms }); all.push(...r.result); from = to + 1;
}
out.fullHistory = { totalMs: Date.now() - t0, logs: all.length, chunks: chunkLog };
// shape stats
const stats = { topics3: 0, topics4: 0, other: 0, removedTrue: 0, mints: 0, burns: 0, zeroValue: 0, selfTransfers: 0, dataLenBad: 0 };
const perAddr = new Map();
for (const l of all) {
  if (l.removed) stats.removedTrue++;
  if (l.topics.length === 3) stats.topics3++; else if (l.topics.length === 4) stats.topics4++; else stats.other++;
  if (l.data.length !== 66) stats.dataLenBad++;
  const from = l.topics[1], to = l.topics[2];
  if (from === ZERO32) stats.mints++; if (to === ZERO32) stats.burns++;
  if (BigInt(l.data) === 0n) stats.zeroValue++;
  if (from === to) stats.selfTransfers++;
  for (const a of [from, to]) if (a !== ZERO32) perAddr.set(a, (perAddr.get(a) || 0) + 1);
}
out.logStats = stats;
const top = [...perAddr.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
out.topAddrs = top;
// block span of activity
out.firstLogBlock = all.length ? parseInt(all[0].blockNumber, 16) : null;
out.lastLogBlock = all.length ? parseInt(all[all.length - 1].blockNumber, 16) : null;
// pick a mid-activity wallet: moderate count with both directions
const cand = [...perAddr.entries()].filter(([, n]) => n >= 4 && n <= 60).slice(0, 200);
let pick = null;
for (const [a] of cand) {
  const ins = all.filter((l) => l.topics[2] === a), outs = all.filter((l) => l.topics[1] === a);
  if (ins.length && outs.length) { pick = a; break; }
}
out.pickedWallet = pick;
import("node:fs").then((fs) => fs.writeFileSync(process.env.OUT || "/tmp/g1deep-logs.json", JSON.stringify(all)));
console.log(JSON.stringify(out, null, 2));
