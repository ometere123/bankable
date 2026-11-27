// G1: real-browser CORS check. A page on an unrelated origin POSTs JSON-RPC to both QIE endpoints.
import { createRequire } from "node:module";
import http from "node:http";
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE ?? "/opt/node-tools/node_modules/playwright");
const server = http.createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end("<!doctype html><title>origin test</title>"); }).listen(0);
const port = (server.address() as any).port;
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const res: any = {};
for (const [name, type] of [["chromium", pw.chromium], ["firefox", pw.firefox]] as const) {
  // Firefox keeps its own certificate store; in the sandbox the egress proxy re-signs TLS, so FIREFOX_NSS_PROFILE points at a
  // throwaway profile that trusts only the sandbox proxy CA (verification stays ON). Not needed on a normal network.
  let b: any, ctx: any;
  if (name === "firefox" && process.env.FIREFOX_NSS_PROFILE) { ctx = await type.launchPersistentContext(process.env.FIREFOX_NSS_PROFILE, { proxy: proxy as any }); b = ctx; }
  else { b = await type.launch({ proxy: proxy as any }); ctx = await b.newContext(); }
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/`);
  res[name] = await page.evaluate(async () => {
    const out: any = {};
    for (const ep of ["https://rpc1mainnet.qie.digital", "https://rpc5mainnet.qie.digital"]) {
      try {
        const r = await fetch(ep, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
        out[ep] = { status: r.status, body: await r.json() };
      } catch (e) { out[ep] = { error: String(e) }; }
    }
    return out;
  });
  await b.close();
}
server.close(); console.log(JSON.stringify(res, null, 2));
