// G1 scan: concurrency/rate-limit behaviour and full-history scan with 10k-block chunks.
import fs from "node:fs";
const EPS = ["https://rpc1mainnet.qie.digital", "https://rpc5mainnet.qie.digital"];
const QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const DEPLOY = 5244996, SPAN = 10000;
let id = 1; const hex = (n) => "0x" + n.toString(16);
async function rpc(ep, method, params, timeoutMs = 20000) {
  const t0 = Date.now(); const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(ep, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }), signal: ctl.signal });
    const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = { error: { message: `HTTP ${r.status}: ${txt.slice(0, 100)}` } }; }
    return { ms: Date.now() - t0, status: r.status, ...j };
  } catch (e) { return { ms: Date.now() - t0, error: { message: String(e) } }; } finally { clearTimeout(to); }
}
async function pool(tasks, conc) { const res = new Array(tasks.length); let i = 0; await Promise.all(Array.from({ length: conc }, async () => { while (i < tasks.length) { const k = i++; res[k] = await tasks[k](); } })); return res; }
const head = parseInt((await rpc(EPS[0], "eth_blockNumber", [])).result, 16);
const R = head - 20;
const out = { head, R, concurrency: {} };
const chunks = []; for (let f = DEPLOY; f <= R; f += SPAN) chunks.push([f, Math.min(f + SPAN - 1, R)]);
out.totalChunks = chunks.length;
// concurrency test on the last 48 chunks
const sample = chunks.slice(-48);
for (const ep of EPS) for (const c of [1, 4, 8, 16, 32]) {
  const t0 = Date.now();
  const res = await pool(sample.map(([f, t]) => () => rpc(ep, "eth_getLogs", [{ address: QUSDC, fromBlock: hex(f), toBlock: hex(t), topics: [TRANSFER] }])), c);
  const errs = res.filter((r) => r.error).map((r) => r.error.message.slice(0, 100));
  (out.concurrency[ep] ??= {})[c] = { wallMs: Date.now() - t0, ok: res.length - errs.length, errs: [...new Set(errs)].slice(0, 3), p50: res.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(res.length / 2)] };
  console.error(ep, c, out.concurrency[ep][c]);
}
// pick best concurrency (default 8) and scan full history on endpoint A and B
const conc = Number(process.env.CONC || 8);
for (const [name, ep] of [["A", EPS[0]], ["B", EPS[1]]]) {
  const t0 = Date.now(); let failed = 0;
  const res = await pool(chunks.map(([f, t]) => async () => { for (let a = 0; a < 3; a++) { const r = await rpc(ep, "eth_getLogs", [{ address: QUSDC, fromBlock: hex(f), toBlock: hex(t), topics: [TRANSFER] }]); if (!r.error) return r.result; await new Promise((s) => setTimeout(s, 500 * (a + 1))); } failed++; return null; }), conc);
  const logs = res.flat().filter(Boolean);
  out["scan" + name] = { wallMs: Date.now() - t0, failedChunks: failed, logs: logs.length };
  fs.writeFileSync(`${process.env.OUTDIR}/logs${name}.json`, JSON.stringify(logs));
  console.error("scan", name, out["scan" + name]);
}
console.log(JSON.stringify(out, null, 2));
