// Layout check on the exported app: no horizontal page scroll at phone/desktop widths in light and dark; writes screenshots to $SHOTS.
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE ?? "/opt/node-tools/node_modules/playwright");
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../out");
const server = http.createServer((q, r) => { let p = (q.url ?? "/").split("?")[0]!; if (p === "/") p = "/index.html"; const f = [path.join(out, p), path.join(out, p + ".html")].find((c) => fs.existsSync(c) && fs.statSync(c).isFile()); if (!f) { r.statusCode = 404; r.end(); return; } r.setHeader("content-type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" } as any)[path.extname(f)] ?? "application/octet-stream"); r.end(fs.readFileSync(f)); }).listen(0);
const BASE = `http://localhost:${(server.address() as any).port}`;
const b = await pw.chromium.launch(); let bad = 0;
for (const [w, h] of [[390, 844], [768, 1024], [1280, 800]]) for (const scheme of ["light", "dark"]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 }); const page = await ctx.newPage();
  for (const route of ["/", "/request", "/new", "/verify"]) {
    await page.goto(BASE + route); await page.waitForTimeout(300);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    const ok = m.sw <= m.iw; if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${w}px ${scheme.padEnd(5)} ${route.padEnd(9)} scrollWidth ${m.sw} / ${m.iw}`);
    if (process.env.SHOTS && scheme === "light" || process.env.SHOTS && w === 390) await page.screenshot({ path: path.join(process.env.SHOTS!, `${route === "/" ? "home" : route.slice(1)}-${w}-${scheme}.png`) });
  }
  await ctx.close();
}
await b.close(); server.close(); process.exit(bad ? 1 : 0);
