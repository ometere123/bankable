// LIVE end-to-end on the deployed site: real browser, real registry, real RPC endpoints, real mainnet statement. No fixtures, no mocks.
//   LIVE_URL=https://bankable-qie.vercel.app DEMO_DIR=... npx tsx e2e/live.mts
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE ?? "/opt/node-tools/node_modules/playwright");
const BASE = process.env.LIVE_URL ?? "https://bankable-qie.vercel.app"; const DIR = process.env.DEMO_DIR!;
const pdf = fs.readFileSync(path.join(DIR, "statement.pdf")); const link = fs.readFileSync(path.join(DIR, "request-link.txt"), "utf8").trim();
const rec = JSON.parse(fs.readFileSync(path.join(DIR, "record.json"), "utf8"));
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
let bad = 0; const log = (ok: boolean, m: string) => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}  ${m}`); };
for (const [name, type] of [["chromium", pw.chromium], ["firefox", pw.firefox]] as const) {
  let ctx: any, br: any;
  if (name === "firefox" && process.env.FIREFOX_NSS_PROFILE) { ctx = await type.launchPersistentContext(process.env.FIREFOX_NSS_PROFILE, { proxy }); br = ctx; }
  else { br = await type.launch({ proxy }); ctx = await br.newContext({ viewport: { width: 1280, height: 900 } }); }
  const page = await ctx.newPage(); page.setDefaultTimeout(240000);
  const errors: string[] = []; page.on("pageerror", (e: Error) => errors.push(e.message));
  try {
    await page.goto(BASE + "/verify"); await page.locator("input[type=file]").setInputFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.getByText(/pre-filled from the file's metadata locator/).waitFor({ timeout: 30000 });
    log((await page.locator("#o").inputValue()).toLowerCase() === rec.owner.toLowerCase(), `[${name}] owner pre-filled from the PDF metadata by the worker on the live site`);
    await page.locator("#r").fill(link); await page.getByRole("button", { name: /^Verify$/ }).click();
    await page.locator(".verdict").waitFor(); const v = (await page.locator(".verdict").innerText()).replace(/\s+/g, " ");
    log(/Verified, request matched/.test(v), `[${name}] real statement, real registry, real endpoints => "${v}"`);
    const rows = await page.locator(".row").allInnerTexts(); log(rows.length === 4 && rows.every((r: string) => /PASS/.test(r)), `[${name}] all four checks PASS`);
    if (name === "chromium") await page.screenshot({ path: path.join(DIR, "live-verified.png"), fullPage: true });
    const body = await page.locator("main").innerText();
    log(/Registry 0x1E9FC096bebe1f142AeeD317d0054583E9227804/i.test(body) && /verified \(full match/.test(body), `[${name}] explorer reports the registry source verified (full match), read live`);
    // one byte altered
    const bad1 = Buffer.from(pdf); bad1[bad1.length - 40] = (bad1[bad1.length - 40] ?? 0) ^ 1;
    await page.locator("input[type=file]").setInputFiles({ name: "altered.pdf", mimeType: "application/pdf", buffer: bad1 });
    await page.getByRole("button", { name: /^Verify$/ }).click(); await page.getByText("Do not rely on this file.").waitFor();
    const v2 = (await page.locator(".verdict").innerText()).replace(/\s+/g, " "); log(/Verification failed/.test(v2), `[${name}] one byte altered => "${v2}"`);
    // wrong request link
    await page.locator("input[type=file]").setInputFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.locator("#r").fill(link.replace(/nonce=0x[0-9a-f]{8}/, "nonce=0x00000000")); await page.getByRole("button", { name: /^Verify$/ }).click();
    await page.getByText("Do not rely on this file.").waitFor(); const v3 = (await page.locator(".verdict").innerText()).replace(/\s+/g, " ");
    const reqRow = (await page.locator(".row").allInnerTexts())[3] ?? ""; log(/Verification failed/.test(v3) && /FAIL/.test(reqRow), `[${name}] wrong request link => Request check fails`);
    log(errors.length === 0, `[${name}] no page errors${errors.length ? ": " + errors[0] : ""}`);
  } catch (e) { log(false, `[${name}] ${(e as Error).message.split("\n")[0]}`); } finally { await br.close(); }
}
console.log(bad ? `\n${bad} failure(s)` : "\nlive site verified end to end"); process.exit(bad ? 1 : 0);
