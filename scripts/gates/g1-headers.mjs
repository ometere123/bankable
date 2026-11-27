// G1: header-fetch throughput and JSON-RPC batch support on both endpoints.
const EPS = ["https://rpc1mainnet.qie.digital", "https://rpc5mainnet.qie.digital"];
let id = 1; const hex = (n) => "0x" + n.toString(16);
async function post(ep, body, timeout = 30000) { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout); const t0 = Date.now(); try { const r = await fetch(ep, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal }); const j = await r.json(); return { ms: Date.now() - t0, j, status: r.status }; } catch (e) { return { ms: Date.now() - t0, err: String(e) }; } finally { clearTimeout(t); } }
const out = {};
for (const ep of EPS) {
  const head = parseInt((await post(ep, { jsonrpc: "2.0", id: id++, method: "eth_blockNumber", params: [] })).j.result, 16);
  const o = (out[ep] = {});
  // sequential and concurrent single-header throughput
  for (const conc of [1, 8, 16]) {
    const N = 64; let i = 0; const t0 = Date.now(); let errs = 0;
    await Promise.all(Array.from({ length: conc }, async () => { while (i < N) { const k = i++; const r = await post(ep, { jsonrpc: "2.0", id: id++, method: "eth_getBlockByNumber", params: [hex(head - 100 - k * 1000), false] }); if (r.err || r.j?.error) errs++; } }));
    o["hdr_conc" + conc] = { calls: N, wallMs: Date.now() - t0, perSec: +(N / ((Date.now() - t0) / 1000)).toFixed(1), errs };
  }
  // batch support
  const batch = Array.from({ length: 50 }, (_, k) => ({ jsonrpc: "2.0", id: id++, method: "eth_getBlockByNumber", params: [hex(head - 100 - k * 1000), false] }));
  const b = await post(ep, batch);
  o.batch50 = b.err ? { err: b.err } : { ms: b.ms, status: b.status, isArray: Array.isArray(b.j), n: Array.isArray(b.j) ? b.j.length : null, firstOk: Array.isArray(b.j) ? !!b.j[0]?.result?.hash : null, errMsg: !Array.isArray(b.j) ? JSON.stringify(b.j).slice(0, 200) : undefined };
  // CORS: preflight and simple POST from an arbitrary origin
  const pre = await fetch(ep, { method: "OPTIONS", headers: { Origin: "https://example.com", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
  o.corsPreflight = { status: pre.status, allowOrigin: pre.headers.get("access-control-allow-origin"), allowMethods: pre.headers.get("access-control-allow-methods"), allowHeaders: pre.headers.get("access-control-allow-headers") };
  const sim = await fetch(ep, { method: "POST", headers: { Origin: "https://example.com", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: id++, method: "eth_chainId", params: [] }) });
  o.corsPost = { status: sim.status, allowOrigin: sim.headers.get("access-control-allow-origin") };
}
console.log(JSON.stringify(out, null, 2));
