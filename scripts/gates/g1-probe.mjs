// G1 probe: raw JSON-RPC against the two documented QIE mainnet endpoints. No dependencies.
const EPS = ["https://rpc1mainnet.qie.digital", "https://rpc5mainnet.qie.digital"];
const QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
let id = 1;
async function rpc(ep, method, params, timeoutMs = 30000) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(ep, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }), signal: ctl.signal });
    const j = await r.json();
    return { ms: Date.now() - t0, ...j };
  } catch (e) { return { ms: Date.now() - t0, error: { message: String(e) } }; } finally { clearTimeout(to); }
}
const out = {};
for (const ep of EPS) {
  const o = (out[ep] = {});
  o.chainId = (await rpc(ep, "eth_chainId", [])).result;
  const bn = await rpc(ep, "eth_blockNumber", []);
  o.head = parseInt(bn.result, 16);
  const code = await rpc(ep, "eth_getCode", [QUSDC, "latest"]);
  o.codeBytes = code.result ? (code.result.length - 2) / 2 : null;
  o.codeHead = code.result?.slice(0, 80);
  o.decimals = (await rpc(ep, "eth_call", [{ to: QUSDC, data: "0x313ce567" }, "latest"])).result;
  o.symbol = (await rpc(ep, "eth_call", [{ to: QUSDC, data: "0x95d89b41" }, "latest"])).result;
  o.name = (await rpc(ep, "eth_call", [{ to: QUSDC, data: "0x06fdde03" }, "latest"])).result;
  o.totalSupply = (await rpc(ep, "eth_call", [{ to: QUSDC, data: "0x18160ddd" }, "latest"])).result;
  // EIP-1967 implementation / admin slots
  o.implSlot = (await rpc(ep, "eth_getStorageAt", [QUSDC, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", "latest"])).result;
  o.adminSlot = (await rpc(ep, "eth_getStorageAt", [QUSDC, "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103", "latest"])).result;
  const hb = await rpc(ep, "eth_getBlockByNumber", ["0x1", false]);
  o.block1 = hb.result ? { ts: parseInt(hb.result.timestamp, 16), hash: hb.result.hash } : hb.error;
  const hh = await rpc(ep, "eth_getBlockByNumber", [bn.result, false]);
  o.headBlock = hh.result ? { ts: parseInt(hh.result.timestamp, 16), hash: hh.result.hash } : hh.error;
  // historical state at block 1000 and head-1000
  for (const b of [1, 1000, o.head - 1000000, o.head - 1000]) {
    const r = await rpc(ep, "eth_call", [{ to: QUSDC, data: "0x70a08231" + "0".repeat(64) }, "0x" + b.toString(16)]);
    (o.histCall ??= {})[b] = r.result ?? r.error?.message;
  }
  console.error("done", ep);
}
console.log(JSON.stringify(out, null, 2));
