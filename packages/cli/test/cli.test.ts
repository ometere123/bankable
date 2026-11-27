import { afterAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { requestLink, renderStatementPdf, sha256Hex, recordId } from "@bankable/core";
import { FakeChain } from "../../core/test/helpers/fakechain";
import { FORGER, REGISTRY, W, issue, registerBoth, requestFor, scenario, profile, verify, type Scenario } from "../../core/test/helpers/scenario";
import { EXIT, runCli, type Io } from "../src/run";

const sh = promisify(execFile);
const servers: http.Server[] = [];
function serve(chain: FakeChain): Promise<string> {
  return new Promise((resolve) => {
    const s = http.createServer(async (q, r) => {
      const chunks: Buffer[] = []; for await (const c of q) chunks.push(c as Buffer);
      const res = await chain.fetchImpl("x", { body: Buffer.concat(chunks).toString(), signal: new AbortController().signal } as any);
      r.statusCode = res.status; r.setHeader("content-type", "application/json"); r.end(await res.text());
    }).listen(0, "127.0.0.1", () => { servers.push(s); resolve(`http://127.0.0.1:${(s.address() as any).port}`); });
  });
}
afterAll(() => servers.forEach((s) => s.close()));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bankable-cli-"));
const file = (name: string, b: Uint8Array) => { const p = path.join(tmp, name); fs.writeFileSync(p, b); return p; };
const capture = () => { const out: string[] = [], err: string[] = []; const io: Io = { out: (s) => out.push(s), err: (s) => err.push(s), env: {} }; return { io, out, err }; };
async function run(s: Scenario, args: string[], env: Record<string, string> = {}) {
  const [ua, ub] = [await serve(s.a), await serve(s.b)]; const c = capture(); c.io.env = env;
  const code = await runCli([...args, "--rpc-a", ua, "--rpc-b", ub], c.io); return { code, text: c.out.join("\n"), err: c.err.join("\n"), ua, ub };
}
const base = (f: string, owner = W) => [f, "--owner", owner, "--registry", REGISTRY, "--retries", "0"];
const flip = (b: Uint8Array) => { const c = Uint8Array.from(b); c[c.length - 40] = (c[c.length - 40] ?? 0) ^ 1; return c; };
const authentic = async (s: Scenario) => { const req = requestFor(s); const i = await issue(s, req); registerBoth(s, W, i); return { i, req, link: requestLink("https://bankable.invalid", "/verify", req), f: file(`a-${Math.random()}.pdf`, i.pdf) }; };

describe("CLI mirrors the web verifier (same pinned core), user-chosen endpoints only", () => {
  it("authentic + link => exit 0 and 'Verified, request matched'; prints each check and the checked-at block", async () => {
    const s = scenario(); const a = await authentic(s); const r = await run(s, [...base(a.f), "--request", a.link]);
    expect(r.code).toBe(EXIT.verified); expect(r.text).toContain("RESULT: Verified, request matched");
    for (const k of ["issued", "content", "status", "request"]) expect(r.text).toMatch(new RegExp(`${k}\\s+PASS`));
    expect(r.text).toMatch(/Checked at confirmed block \d+/); expect(r.text).toContain("does not prove completeness");
  });
  it("authentic, no link => exit 0 and the labelled weaker result", async () => {
    const s = scenario(); const a = await authentic(s); const r = await run(s, base(a.f));
    expect(r.code).toBe(EXIT.verified); expect(r.text).toContain("RESULT: Verified document, request not checked"); expect(r.text).toMatch(/request\s+NOT-CHECKED/);
  });
  it("altered byte => exit 1; wrong link => exit 1; revoked => exit 1", async () => {
    const s = scenario(); const a = await authentic(s); const bad = flip(a.i.pdf);
    expect((await run(s, [...base(file("alt.pdf", bad)), "--request", a.link])).code).toBe(EXIT.failed);
    expect((await run(s, [...base(a.f), "--request", requestLink("https://x", "/verify", { ...a.req, nonce: "0x" + "77".repeat(32) })])).code).toBe(EXIT.failed);
    const id = recordId(W, a.i.pdfHash); s.a.revoke(id); s.b.revoke(id);
    const r = await run(s, [...base(a.f), "--request", a.link]); expect(r.code).toBe(EXIT.failed); expect(r.text).toMatch(/status\s+FAIL/);
  });
  it("forged row registered by a second wallet => Issued PASS, Content FAIL, exit 1", async () => {
    const s = scenario(); const real = await issue(s); const forged = { ...real.data, entries: real.data.entries.map((e, k) => (k === 2 ? { ...e, to: FORGER } : e)) };
    const pdf = await renderStatementPdf(forged, { origin: JSON.parse(profile.manifestText).origin }); const h = await sha256Hex(pdf);
    s.a.register(FORGER, { ...real.args, pdfHash: h }); s.b.register(FORGER, { ...real.args, pdfHash: h });
    const r = await run(s, base(file("forged.pdf", pdf), FORGER)); expect(r.code).toBe(EXIT.failed); expect(r.text).toMatch(/issued\s+PASS/); expect(r.text).toMatch(/content\s+FAIL/);
  });
  it("endpoint disagreement => exit 2; one endpoint unreachable => exit 2; never 0", async () => {
    const s = scenario(); const a = await authentic(s); s.b.dropLogs = (t) => t.amount === 1_000_000n;
    expect((await run(s, base(a.f))).code).toBe(EXIT.inconclusive);
    const s2 = scenario(); const a2 = await authentic(s2); s2.b.failMethods.add("eth_call");
    const r = await run(s2, base(a2.f)); expect(r.code).toBe(EXIT.inconclusive); expect(r.text).toContain("RESULT: Inconclusive");
  });
  it("CLI verdicts equal the library (web) verdicts across the matrix", async () => {
    const s = scenario(); const a = await authentic(s);
    const cli = await run(s, [...base(a.f), "--request", a.link, "--json"]); const web = await verify(s, a.i.pdf, W, a.link);
    expect(JSON.parse(cli.text).overall).toBe(web.overall); expect(JSON.parse(cli.text).checks.content.status).toBe(web.checks.content.status);
  });
  it("usage and input errors: same endpoint twice, bad registry, missing/empty/oversized file, no args", async () => {
    const s = scenario(); const a = await authentic(s); const [u] = [await serve(s.a)];
    const c1 = capture(); expect(await runCli([...base(a.f), "--rpc-a", u, "--rpc-b", u], c1.io)).toBe(EXIT.usage); expect(c1.err.join()).toContain("distinct");
    const c2 = capture(); expect(await runCli([a.f, "--owner", W, "--registry", "0x12", "--rpc-a", u, "--rpc-b", u + "/b"], c2.io)).toBe(EXIT.usage);
    const c3 = capture(); expect(await runCli([path.join(tmp, "nope.pdf"), "--owner", W, "--registry", REGISTRY, "--rpc-a", u, "--rpc-b", u + "/b"], c3.io)).toBe(EXIT.usage);
    expect((await run(s, base(file("empty.pdf", new Uint8Array(0))))).code).toBe(EXIT.failed);
    expect((await run(s, base(file("big.pdf", new Uint8Array(3 * 1024 * 1024))))).code).toBe(EXIT.failed);
    const c4 = capture(); expect(await runCli([], c4.io)).toBe(EXIT.usage);
    const c5 = capture(); c5.io.env = { STATEMENT_REGISTRY_ADDRESS: REGISTRY }; expect(await runCli([a.f, "--owner", W, "--rpc-a", u, "--rpc-b", u + "/b"], c5.io)).not.toBe(EXIT.usage); // registry from env
  });
  it("runs as a real child process (independent of the web app) and exits with the verdict code", async () => {
    const s = scenario(); const a = await authentic(s); const [ua, ub] = [await serve(s.a), await serve(s.b)];
    const { stdout } = await sh("npx", ["tsx", "src/bin.ts", ...base(a.f), "--request", a.link, "--rpc-a", ua, "--rpc-b", ub], { cwd: path.resolve(__dirname, "..") });
    expect(stdout).toContain("RESULT: Verified, request matched");
    const bad = flip(a.i.pdf);
    await expect(sh("npx", ["tsx", "src/bin.ts", ...base(file("alt2.pdf", bad)), "--rpc-a", ua, "--rpc-b", ub], { cwd: path.resolve(__dirname, "..") })).rejects.toMatchObject({ code: EXIT.failed });
  }, 120000);
});
