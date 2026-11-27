// Browser E2E for the Tier 1 journeys. FIXTURE-BASED: RPC is served by the in-memory fake chain used by the core tests and the
// wallet is a mock that announces itself over EIP-6963 (rdns me.qiewallet). The app itself is the real static export.
// Real-mainnet verification requires the deployed registry and a funded wallet (see IMPLEMENTATION_PROGRESS.md).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { keccak256, toUtf8Bytes } from "ethers";
import { requestLink } from "../../../packages/core/src/request";
import { recordId } from "../../../packages/core/src/registry";
import { FORGER, REGISTRY, W, issue, registerBoth, requestFor, scenario, type Scenario } from "../../../packages/core/test/helpers/scenario";
import { renderStatementPdf } from "../../../packages/core/src/render/pdf";
import { sha256Hex } from "../../../packages/core/src/verify";

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE ?? "/opt/node-tools/node_modules/playwright");
const here = path.dirname(new URL(import.meta.url).pathname); const web = path.resolve(here, "..");

if (!process.env.SKIP_BUILD) {
  execFileSync("npx", ["next", "build"], { cwd: web, stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_REGISTRY_ADDRESS: REGISTRY, NEXT_PUBLIC_QIE_RPC_A: "https://fake.rpc/a", NEXT_PUBLIC_QIE_RPC_B: "https://fake.rpc/b" } });
}
const out = path.join(web, "out");
const server = http.createServer((q, r) => {
  let p = decodeURIComponent((q.url ?? "/").split("?")[0]!); if (p === "/") p = "/index.html";
  const cands = [path.join(out, p), path.join(out, p + ".html")];
  const f = cands.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  if (!f) { r.statusCode = 404; r.end("not found"); return; }
  const ext = path.extname(f); r.setHeader("content-type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain" } as any)[ext] ?? "application/octet-stream");
  r.end(fs.readFileSync(f));
}).listen(0);
const BASE = `http://localhost:${(server.address() as any).port}`;

const MOCK = `(() => {
  const M = window.__MOCK; const L = {};
  const provider = { async request({ method, params }) {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [M.account];
    if (method === 'eth_chainId') return M.chainId;
    if (method === 'wallet_switchEthereumChain') { M.chainId = '0x7c6'; return null; }
    if (method === 'eth_sendTransaction') { if (M.rejectSend) throw Object.assign(new Error('User rejected the request.'), { code: 4001 }); return await window.__nodeSend(params[0].from, params[0].data); }
    throw new Error('mock wallet: unsupported ' + method); },
    on(e, f) { (L[e] ||= []).push(f); }, removeListener(e, f) { L[e] = (L[e] || []).filter((x) => x !== f); } };
  window.__mockEmit = (e, v) => (L[e] || []).forEach((f) => f(v));
  const info = { uuid: 'mock-qie', name: 'QIE Wallet (test mock)', icon: '', rdns: 'me.qiewallet' };
  window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) })));
})();`;

let failures = 0; const results: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push(`PASS  ${name}`); } catch (e) { failures++; results.push(`FAIL  ${name}\n      ${(e as Error).message.split("\n")[0]}`); }
}
let txCounter = 0;
async function open(browserType: any, s: Scenario, o: { account?: string; rejectSend?: boolean; qieId?: "alice" | "none" | "down" } = {}) {
  const browser = await browserType.launch(); const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.route("https://fake.rpc/**", async (route: any) => {
    const req = route.request(); const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const chain = req.url().endsWith("/a") ? s.a : s.b;
    const res = await chain.fetchImpl("x", { body: req.postData(), signal: new AbortController().signal } as any);
    await route.fulfill({ status: res.status, headers: { ...cors, "content-type": "application/json" }, body: await res.text() });
  });
  // Labelled stubs for the two external read-only services (the real ones were exercised live: docs/gates). CORS-open like the real ones.
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-expose-headers": "mcp-session-id" };
  await ctx.route("https://mcp.qie.digital/**", async (route: any) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (o.qieId === "down") return route.fulfill({ status: 503, headers: cors, body: "unavailable" });
    if (req.method() !== "POST") return route.fulfill({ status: 405, headers: cors });
    const m = JSON.parse(req.postData() ?? "{}"); const h = { ...cors, "content-type": "application/json", "mcp-session-id": "stub" };
    if (m.method === "initialize") return route.fulfill({ status: 200, headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "stub", version: "1" } } }) });
    if (m.method === "tools/call") { const sc = { network: "mainnet", chainId: 1990, status: "ok", address: m.params.arguments.address, name: o.qieId === "none" ? null : "alice.qie", registry: null, reason: "stub" }; return route.fulfill({ status: 200, headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: JSON.stringify(sc) }], structuredContent: sc } }) }); }
    return route.fulfill({ status: 202, headers: cors });
  });
  await ctx.route("https://mainnet.qie.digital/api/v2/**", (route: any) => route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ is_contract: true, is_verified: false }) }));
  await ctx.exposeFunction("__nodeSend", (from: string, data: string) => {
    const hash = keccak256(toUtf8Bytes(`e2e-tx-${++txCounter}`)); s.a.sendTx(from, data, hash); s.b.sendTx(from, data, hash); return hash;
  });
  await ctx.addInitScript(`window.__MOCK = ${JSON.stringify({ account: o.account ?? W, chainId: "0x7c6", rejectSend: !!o.rejectSend })};`);
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage(); page.setDefaultTimeout(60000);
  return { browser, ctx, page };
}
const frag = (l: string) => l.slice(l.indexOf("#"));
const txt = async (page: any) => (await page.locator("main").innerText());

const ENGINES = process.env.ONLY_CHROMIUM ? [["chromium", pw.chromium]] : [["chromium", pw.chromium], ["firefox", pw.firefox]];
for (const [engine, type] of ENGINES as any) {
  // ---------- A: full journey in the browser: request link -> issue (wallet, preview, register, read-back, download) -> verify ----------
  await check(`[${engine}] request -> issue -> download -> verify (matched), end to end in the browser`, async () => {
    const s = scenario(); const req = requestFor(s); const link = requestLink(BASE, "/new", req);
    const { browser, page } = await open(type, s);
    try {
      await page.goto(BASE + "/new" + frag(link));
      await page.getByRole("button", { name: /Connect/ }).click();
      await page.getByRole("button", { name: /Scan period/ }).click();
      await page.getByText("Preview").first().waitFor();
      const body = await txt(page);
      if (!/= closing \(matches pinned balance reads on both endpoints\)/.test(body)) throw new Error("reconciliation line missing");
      if (!/IN/.test(body) || !/OUT/.test(body) || !/SELF/.test(body)) throw new Error("directions missing");
      if (await page.getByRole("button", { name: /Download/ }).count()) throw new Error("download visible before registration");
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: /Register on QIE mainnet/ }).click();
      const dl = page.waitForEvent("download", { timeout: 1 }).catch(() => null);
      await page.getByRole("button", { name: /Download the exact file/ }).waitFor({ timeout: 90000 });
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download the exact file/ }).click()]);
      const bytes = fs.readFileSync(await download.path());
      const id = recordId(W, "0x" + createHash("sha256").update(bytes).digest("hex"));
      const rec = s.a.records.get(id); if (!rec) throw new Error("downloaded bytes do not match any registered record");
      if (rec.pdfHash !== "0x" + createHash("sha256").update(bytes).digest("hex")) throw new Error("pdf hash mismatch");
      void dl;
      // now verify those exact bytes in the same browser engine, with the original link
      await page.goto(BASE + "/verify");
      await page.locator("input[type=file]").setInputFiles({ name: "stmt.pdf", mimeType: "application/pdf", buffer: bytes });
      await page.locator("#o").fill(W); await page.locator("#r").fill(link);
      await page.getByRole("button", { name: /^Verify$/ }).click();
      await page.getByText("Verified, request matched").waitFor({ timeout: 120000 });
    } finally { await browser.close(); }
  });

  // ---------- B: verify-page matrix ----------
  const verifyCase = async (name: string, expected: RegExp, prep: (s: Scenario) => Promise<{ file?: Buffer; owner: string; link?: string }>, extra?: (page: any, s: Scenario) => Promise<void>) =>
    check(`[${engine}] verify: ${name}`, async () => {
      const s = scenario(); const { file, owner, link } = await prep(s);
      const { browser, page } = await open(type, s);
      try {
        await page.goto(BASE + "/verify");
        if (file) await page.locator("input[type=file]").setInputFiles({ name: "stmt.pdf", mimeType: "application/pdf", buffer: file });
        await page.locator("#o").fill(owner); if (link) await page.locator("#r").fill(link);
        await page.getByRole("button", { name: file ? /^Verify$/ : /Look up locator/ }).click();
        await page.locator(".verdict").waitFor({ timeout: 120000 });
        const v = await page.locator(".verdict").innerText();
        if (!expected.test(v)) throw new Error(`verdict was "${v.replace(/\n/g, " ")}"`);
        if (!/What this does not prove/.test(await txt(page))) throw new Error("non-claims box missing");
        await extra?.(page, s);
      } finally { await browser.close(); }
    });
  const authentic = async (s: Scenario) => { if (process.env.NEGATIVE_CONTROL) s.b.balanceSkew = 1n; /* control: matched cases MUST then fail */ const req = requestFor(s); const i = await issue(s, req); registerBoth(s, W, i); return { i, req, link: requestLink(BASE, "/verify", req) }; };

  await verifyCase("authentic PDF plus original link => Verified, request matched (browser regenerated bytes identical)", /Verified, request matched/, async (s) => { const a = await authentic(s); return { file: Buffer.from(a.i.pdf), owner: W, link: a.link }; },
    async (page) => { const t = await txt(page); if (!/Chain-derived ledger/.test(t) || !/PASS/.test(t)) throw new Error("ledger/checks not shown"); });
  await verifyCase("authentic PDF, no link => Verified document, request not checked", /Verified document, request not checked/, async (s) => { const a = await authentic(s); return { file: Buffer.from(a.i.pdf), owner: W }; });
  await verifyCase("one byte altered => Verification failed (Issued)", /Verification failed/, async (s) => { const a = await authentic(s); const b = Buffer.from(a.i.pdf); b[b.length - 40]! ^= 1; return { file: b, owner: W, link: a.link }; });
  await verifyCase("wrong request link => Verification failed (Request)", /Verification failed/, async (s) => { const a = await authentic(s); return { file: Buffer.from(a.i.pdf), owner: W, link: requestLink(BASE, "/verify", { ...a.req, nonce: "0x" + "77".repeat(32) }) }; });
  await verifyCase("forged row registered by a second wallet => Issued passes, Content fails", /Verification failed/, async (s) => {
    const real = await issue(s); const forged = { ...real.data, entries: real.data.entries.map((e, k) => (k === 2 ? { ...e, to: FORGER } : e)) };
    const pdf = await renderStatementPdf(forged, { origin: JSON.parse((await import("../../../packages/core/test/helpers/scenario")).profile.manifestText).origin });
    const h = await sha256Hex(pdf); s.a.register(FORGER, { ...real.args, pdfHash: h }); s.b.register(FORGER, { ...real.args, pdfHash: h });
    return { file: Buffer.from(pdf), owner: FORGER };
  }, async (page) => { const rows = await page.locator(".row").allInnerTexts(); if (!/Issued\s+PASS/.test(rows[0]) || !/Content\s+FAIL/.test(rows[1])) throw new Error("expected Issued PASS / Content FAIL: " + rows.join("|").replace(/\n/g, " ")); });
  await verifyCase("QR only (no file) => Not checked, never Verified", /Not checked \(QR only\)/, async () => ({ owner: W }));
  await verifyCase("endpoint disagreement => Inconclusive", /Inconclusive/, async (s) => { const a = await authentic(s); s.b.dropLogs = (t) => t.amount === 1_000_000n; return { file: Buffer.from(a.i.pdf), owner: W }; });
  await verifyCase("RPC unavailable on one endpoint => Inconclusive", /Inconclusive/, async (s) => { const a = await authentic(s); s.b.failMethods.add("eth_call"); return { file: Buffer.from(a.i.pdf), owner: W }; });

  // ---------- C: issuing safety ----------
  await check(`[${engine}] wrong wallet account is refused; account/chain change discards the preview; rejected tx releases no download`, async () => {
    const s = scenario(); const req = requestFor(s); const link = requestLink(BASE, "/new", req);
    const wrong = await open(type, s, { account: "0x9999999999999999999999999999999999999999" });
    try {
      await wrong.page.goto(BASE + "/new" + frag(link)); await wrong.page.getByRole("button", { name: /Connect/ }).click();
      await wrong.page.getByText(/not the expected wallet/).waitFor();
      if (await wrong.page.getByRole("button", { name: /Scan period/ }).count()) throw new Error("scan offered for the wrong account");
    } finally { await wrong.browser.close(); }
    const ok = await open(type, s, { rejectSend: true });
    try {
      await ok.page.goto(BASE + "/new" + frag(link)); await ok.page.getByRole("button", { name: /Connect/ }).click();
      await ok.page.getByRole("button", { name: /Scan period/ }).click(); await ok.page.getByText("Preview").first().waitFor();
      await ok.page.getByRole("checkbox").check(); await ok.page.getByRole("button", { name: /Register on QIE mainnet/ }).click();
      await ok.page.getByText(/User rejected/).waitFor();
      if (await ok.page.getByRole("button", { name: /Download/ }).count()) throw new Error("download released after a rejected transaction");
      // account change discards the preview
      await ok.page.evaluate(() => (window as any).__mockEmit("accountsChanged", ["0x9999999999999999999999999999999999999999"]));
      await ok.page.getByText(/Account changed: preview discarded/).waitFor();
      if (await ok.page.getByRole("button", { name: /Register on QIE mainnet/ }).count()) throw new Error("stale preview still registrable");
    } finally { await ok.browser.close(); }
  });
  await check(`[${engine}] on-chain failure (duplicate registration) releases no download`, async () => {
    const s = scenario(); const req = requestFor(s); const link = requestLink(BASE, "/new", req);
    const { browser, page } = await open(type, s);
    try {
      await page.goto(BASE + "/new" + frag(link)); await page.getByRole("button", { name: /Connect/ }).click();
      await page.getByRole("button", { name: /Scan period/ }).click(); await page.getByText("Preview").first().waitFor();
      // someone registers the identical file hash first, from the same account: the wallet tx will fail on-chain
      const pdfHashText = (await page.locator(".mono.muted").filter({ hasText: "File hash" }).first().innerText()); const m = /SHA-256\) (0x[0-9a-f]{64})/.exec(pdfHashText); if (!m) throw new Error("no hash shown");
      const a = (await issue(s, req)).args; s.a.register(W, { ...a, pdfHash: m[1]! }); s.b.register(W, { ...a, pdfHash: m[1]! });
      await page.getByRole("checkbox").check(); await page.getByRole("button", { name: /Register on QIE mainnet/ }).click();
      await page.getByText(/failed on-chain/).waitFor({ timeout: 90000 });
      if (await page.getByRole("button", { name: /Download/ }).count()) throw new Error("download released after failed tx");
    } finally { await browser.close(); }
  });

  // ---------- E: Tier 2 ----------
  const parseCsv = (t: string) => { const rows: string[][] = []; let row: string[] = [], f = "", q = false; for (let i = 0; i < t.length; i++) { const c = t[i]!; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\r" && t[i + 1] === "\n") { row.push(f); rows.push(row); row = []; f = ""; i++; } else f += c; } return rows; };
  await check(`[${engine}] Tier 2: verified result offers CSV with exact amounts; owner pre-filled by the isolated worker; QIE ID and explorer status shown as context`, async () => {
    const s = scenario(); const a = await authentic(s); const { browser, page } = await open(type, s, { qieId: "alice" });
    try {
      await page.goto(BASE + "/verify");
      await page.locator("input[type=file]").setInputFiles({ name: "stmt.pdf", mimeType: "application/pdf", buffer: Buffer.from(a.i.pdf) });
      await page.getByText(/pre-filled from the file's metadata locator/).waitFor({ timeout: 15000 });
      if ((await page.locator("#o").inputValue()).toLowerCase() !== W) throw new Error("worker did not pre-fill the owner");
      await page.getByRole("button", { name: /^Verify$/ }).click(); await page.getByText("Verified document, request not checked").waitFor({ timeout: 120000 });
      await page.getByText("alice.qie").waitFor({ timeout: 15000 });
      if (!/NOT verified on the explorer/.test(await txt(page))) throw new Error("explorer status not shown accurately");
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download ledger as CSV/ }).click()]);
      const rows = parseCsv(fs.readFileSync(await dl.path(), "utf8"));
      if (rows[0]!.join("|") !== "UTC timestamp|wallet|token|transaction hash|log index|direction|amount (QUSDC token units)|counterparty") throw new Error("bad headers");
      if (rows.length !== 1 + 8) throw new Error(`expected 8 data rows, got ${rows.length - 1}`);
      const amounts = rows.slice(1).map((r) => r[6]!); if (!amounts.includes("2.500000") || !amounts.includes("0.000042") || amounts.some((x) => !/^\d+\.\d{6}$/.test(x))) throw new Error("amounts not exact: " + amounts.join(","));
    } finally { await browser.close(); }
  });
  await check(`[${engine}] Tier 2: QIE ID service down does not affect the verdict`, async () => {
    const s = scenario(); const a = await authentic(s); const { browser, page } = await open(type, s, { qieId: "down" });
    try {
      await page.goto(BASE + "/verify");
      await page.locator("input[type=file]").setInputFiles({ name: "stmt.pdf", mimeType: "application/pdf", buffer: Buffer.from(a.i.pdf) });
      await page.locator("#o").fill(W); await page.getByRole("button", { name: /^Verify$/ }).click();
      await page.getByText("Verified document, request not checked").waitFor({ timeout: 120000 });
      await page.getByText(/lookup unavailable/).waitFor({ timeout: 30000 });
      if (!/Financial verification is unaffected/.test(await txt(page))) throw new Error("missing unaffected note");
    } finally { await browser.close(); }
  });
  await check(`[${engine}] Tier 2: no CSV when Content fails; malformed and oversized files are handled safely`, async () => {
    const s = scenario(); await authentic(s); const { browser, page } = await open(type, s);
    try {
      await page.goto(BASE + "/verify");
      // garbage bytes: worker finds no locator, owner stays empty, typed owner => Issued fails
      const garbage = Buffer.alloc(200_000); for (let i = 0; i < garbage.length; i++) garbage[i] = (i * 31 + 7) & 255;
      await page.locator("input[type=file]").setInputFiles({ name: "junk.pdf", mimeType: "application/pdf", buffer: garbage });
      await page.waitForTimeout(2500); if ((await page.locator("#o").inputValue()) !== "") throw new Error("owner pre-filled from garbage");
      await page.locator("#o").fill(W); await page.getByRole("button", { name: /^Verify$/ }).click();
      await page.getByText("Verification failed").waitFor({ timeout: 120000 });
      if (await page.getByRole("button", { name: /Download ledger as CSV/ }).count()) throw new Error("CSV offered for a failed verification");
      // oversized: rejected before reading further
      await page.locator("input[type=file]").setInputFiles({ name: "big.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(3 * 1024 * 1024) });
      await page.getByText(/supported maximum/).waitFor();
    } finally { await browser.close(); }
  });

  // ---------- D: revoke from the verify page, then re-verify ----------
  await check(`[${engine}] owner revokes in the browser; the old file then fails Status`, async () => {
    const s = scenario(); const a = await authentic(s);
    const { browser, page } = await open(type, s);
    try {
      await page.goto(BASE + "/verify");
      await page.locator("input[type=file]").setInputFiles({ name: "stmt.pdf", mimeType: "application/pdf", buffer: Buffer.from(a.i.pdf) });
      await page.locator("#o").fill(W); await page.getByRole("button", { name: /^Verify$/ }).click();
      await page.getByText("Verified document, request not checked").waitFor({ timeout: 120000 });
      await page.getByRole("button", { name: /Connect wallet to manage/ }).click();
      await page.getByRole("button", { name: /Revoke this record/ }).click();
      await page.getByText(/Revoked at block/).waitFor({ timeout: 90000 });
      await page.getByRole("button", { name: /^Verify$/ }).click();
      await page.getByText("Verification failed").waitFor({ timeout: 120000 });
      const rows = await page.locator(".row").allInnerTexts(); if (!/Status\s+FAIL/.test(rows[2]!)) throw new Error("Status did not fail: " + rows.join("|").replace(/\n/g, " "));
    } finally { await browser.close(); }
  });
}
server.close();
console.log("\n" + results.join("\n") + `\n\n${results.length - failures}/${results.length} passed`);
if (!process.env.NEGATIVE_CONTROL) fs.writeFileSync(path.join(here, "last-result.txt"), results.join("\n") + `\n${results.length - failures}/${results.length} passed\n`);
process.exit(failures ? 1 : 0);
