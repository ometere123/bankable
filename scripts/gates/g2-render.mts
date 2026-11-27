// G2: byte-identical PDF hashes across repeated runs in Node, Chromium and Firefox, with varied locale/timezone.
// Usage: NODE_NO_WARNINGS=1 tsx scripts/gates/g2-render.mts   (PLAYWRIGHT_MODULE overrides the playwright path)
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import { FIXTURE_NAMES, fixtureByName } from "./g2-fixtures.ts";
import { renderStatementPdf } from "../../packages/core/src/render/pdf.ts";

const origin = "https://bankable.invalid";
const sha = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");
const REPEATS = 5;
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE ?? "/opt/node-tools/node_modules/playwright");

const bundle = await build({ entryPoints: ["scripts/gates/g2-entry.ts"], bundle: true, format: "iife", platform: "browser", write: false, target: "es2022", minify: false });
const script = bundle.outputFiles[0]!.text;

const results: Record<string, Record<string, string[]>> = {};
const record = (engine: string, fixture: string, hash: string) => { ((results[fixture] ??= {})[engine] ??= []).push(hash); };

for (const f of FIXTURE_NAMES) for (let i = 0; i < REPEATS; i++) record("node", f, sha(await renderStatementPdf(fixtureByName(f), { origin })));
const contexts = [
  { name: "default", opts: {} },
  { name: "tr-TR/Pacific-Kiritimati", opts: { locale: "tr-TR", timezoneId: "Pacific/Kiritimati" } },
  { name: "ar-EG/America-Los_Angeles", opts: { locale: "ar-EG", timezoneId: "America/Los_Angeles" } },
];
const versions: Record<string, string> = {};
for (const [engineName, type] of [["chromium", pw.chromium], ["firefox", pw.firefox]] as const) {
  const browser = await type.launch(); versions[engineName] = browser.version();
  for (const c of contexts) {
    const ctx = await browser.newContext(c.opts);
    for (const f of FIXTURE_NAMES) for (let i = 0; i < REPEATS; i++) {
      const page = await ctx.newPage(); // fresh page each time (fresh realm) as well as repeated calls
      await page.setContent("<!doctype html><html><body></body></html>");
      await page.addScriptTag({ content: script });
      const b64: string = await page.evaluate(([n, o]) => (window as any).renderFixture(n, o), [f, origin]);
      record(`${engineName} [${c.name}]`, f, sha(Buffer.from(b64, "base64")));
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
}
let allEqual = true; const table: any[] = [];
for (const f of FIXTURE_NAMES) {
  const all = Object.values(results[f]!).flat(); const uniq = new Set(all);
  const perEngine = Object.fromEntries(Object.entries(results[f]!).map(([k, v]) => [k, [...new Set(v)].length === 1 ? v[0]!.slice(0, 16) : "MISMATCH within engine"]));
  if (uniq.size !== 1) allEqual = false;
  table.push({ fixture: f, runs: all.length, distinctHashes: uniq.size, sha256: [...uniq][0], perEngine });
}
const out = { gate: "G2", date: new Date().toISOString(), repeatsPerCell: REPEATS, browserVersions: versions, node: process.version, pass: allEqual, table };
fs.writeFileSync("docs/gates/g2-result.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
process.exit(allEqual ? 0 : 1);
