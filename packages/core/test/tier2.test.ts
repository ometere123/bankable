import { describe, expect, it } from "vitest";
import { CSV_HEADERS, csvField, ledgerToCsv, neutralise } from "../src/csv";
import { extractInWorker, extractLocator, parseLocatorString, LOCATOR_SCAN_BYTES, type WorkerLike } from "../src/locator";
import { lookupQieId, parseReverseLookup } from "../src/qie-id";
import { explorerVerification } from "../src/explorer";
import { renderStatementPdf, metadataLocator } from "../src/render/pdf";
import { dataHashOf } from "../src/canonical";
import { entry, statement, OWNER, OTHER, REGISTRY } from "./fixtures";

// minimal strict RFC 4180 reader used to prove the CSV round-trips
function parseCsv(s: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], f = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\r" && s[i + 1] === "\n") { row.push(f); rows.push(row); row = []; f = ""; i++; } else f += c;
  }
  return rows;
}

describe("Tier 2: CSV from the verified canonical ledger", () => {
  const d = statement([entry(1, "C", 1n), entry(2, "D", 123_456_789_012_345_678n), entry(3, "S", 1_000_000n), entry(4, "C", 0n)]);
  const csv = ledgerToCsv(d); const rows = parseCsv(csv);
  it("has the fixed headers, UTF-8 CRLF, a trailing newline and consistent quoting", () => {
    expect(rows[0]).toEqual([...CSV_HEADERS]); expect(rows).toHaveLength(1 + d.entries.length); expect(csv.endsWith("\r\n")).toBe(true);
    for (const r of rows) expect(r).toHaveLength(8);
  });
  it("writes exact decimal strings (no rounding, no exponent, no locale) and never a negative number", () => {
    expect(rows.slice(1).map((r) => r[6])).toEqual(["0.000001", "123456789012.345678", "1.000000", "0.000000"]);
    for (const r of rows.slice(1)) expect(r[6]).toMatch(/^\d+\.\d{6}$/);
    expect(rows.slice(1).map((r) => r[5])).toEqual(["in", "out", "self", "in"]);
  });
  it("labels the unit as QUSDC token units, never USD", () => { expect(rows[0]![6]).toBe("amount (QUSDC token units)"); expect(csv).not.toMatch(/USD cash|\$/); });
  it("neutralises formula-like cells, including after leading whitespace, and escapes quotes and line breaks", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1", " =1", " @x"]) expect(neutralise(evil)).toBe(`'${evil}`);
    expect(neutralise("0xabc")).toBe("0xabc");
    expect(csvField('a"b\nc')).toBe('"a""b c"');
    const hostile = { ...d, entries: [{ ...entry(1, "D", 5n), to: "=cmd|' /C calc'!A0" }] };
    const r = parseCsv(ledgerToCsv(hostile as any))[1]!; expect(r[7]!.startsWith("'=")).toBe(true);
    for (const cell of r) expect(/^[=+\-@]/.test(cell)).toBe(false);
  });
});

describe("Tier 2: owner locator from PDF metadata", () => {
  const profile = { origin: "https://bankable.invalid" };
  it("extracts exactly the locator the renderer embedded", async () => {
    const d = statement([entry(1, "C", 5n)]); const pdf = await renderStatementPdf(d, profile);
    expect(extractLocator(pdf)).toEqual({ chainId: 1990n, registry: REGISTRY, owner: OWNER, profile: d.rendererId, dataHash: dataHashOf(d) });
  });
  it("round-trips the string form and rejects any deviation from the strict schema", () => {
    const good = metadataLocator("x", statement([]));
    expect(parseLocatorString(good)).not.toBeNull();
    for (const bad of [good.replace("v1", "v2"), good + ";x=1", good.toUpperCase(), good.replace("chain=1990", "chain=0x7c6"), good.replace(/owner=0x[0-9a-f]{40}/, "owner=0x12"), good + "\n", "owner=" + OWNER, ""]) expect(parseLocatorString(bad)).toBeNull();
  });
  it("hostile inputs return null quickly and never throw: random 8 MB, truncated, empty, fake and ambiguous keywords", async () => {
    const d = statement([entry(1, "C", 5n)]); const pdf = await renderStatementPdf(d, profile);
    const rnd = new Uint8Array(8 * 1024 * 1024); for (let i = 0; i < rnd.length; i += 65536) crypto.getRandomValues(rnd.subarray(i, Math.min(i + 65536, rnd.length)));
    const t0 = Date.now();
    expect(extractLocator(rnd)).toBeNull(); expect(extractLocator(new Uint8Array(0))).toBeNull(); expect(extractLocator(pdf.subarray(0, 40))).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2000);
    const other = await renderStatementPdf(statement([entry(2, "D", 9n)], { owner: OTHER }), profile);
    const keywordsOf = (b: Uint8Array) => /\/Keywords\s*<[0-9A-F]+>/.exec(Buffer.from(b).toString("latin1"))![0];
    const two = Buffer.from(Buffer.from(pdf).toString("latin1") + "\n" + keywordsOf(other), "latin1");
    expect(extractLocator(new Uint8Array(two))).toBeNull(); // two different locators: refused, not guessed
    expect(extractLocator(new Uint8Array(Buffer.from("/Keywords <" + "AA".repeat(5000) + ">", "latin1")))).toBeNull();
    expect(LOCATOR_SCAN_BYTES).toBeLessThan(8 * 1024 * 1024);
  });
  const stub = (behaviour: "silent" | "good" | "garbage" | "throws" | "errors") => { const state = { terminated: false }; const make = (): WorkerLike => {
    if (behaviour === "throws") throw new Error("no worker");
    const w: WorkerLike = { onmessage: null, onerror: null, terminate: () => { state.terminated = true; },
      postMessage: () => { if (behaviour === "good") setTimeout(() => w.onmessage?.({ data: { chainId: "1990", registry: REGISTRY, owner: OWNER, profile: "0x" + "ab".repeat(32), dataHash: "0x" + "cd".repeat(32) } })); else if (behaviour === "garbage") setTimeout(() => w.onmessage?.({ data: "pwned" })); else if (behaviour === "errors") setTimeout(() => w.onerror?.(new Error("boom"))); } };
    return w; }; return { make, state }; };
  it("worker wrapper: valid reply is parsed; silent worker is terminated at the timeout; garbage/errors/failed construction give null", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const ok = stub("good"); expect(await extractInWorker(ok.make, bytes, 500)).toMatchObject({ owner: OWNER }); expect(ok.state.terminated).toBe(true);
    const silent = stub("silent"); const t0 = Date.now(); expect(await extractInWorker(silent.make, bytes, 150)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000); expect(silent.state.terminated).toBe(true);
    for (const b of ["garbage", "errors", "throws"] as const) { const s = stub(b); expect(await extractInWorker(s.make, bytes, 300)).toBeNull(); }
  });
});

describe("Tier 2: QIE ID is current address context only and never blocks verification", () => {
  const ADDR = "0x1111111111111111111111111111111111111111";
  const ok = (over: any = {}) => ({ structuredContent: { network: "mainnet", chainId: 1990, status: "ok", address: ADDR, name: "alice.qie", registry: "0xabc", ...over } });
  it("returns the name for a valid response", () => { expect(parseReverseLookup(ADDR, ok())).toEqual({ status: "ok", name: "alice.qie" }); });
  it("null name is ok-with-no-name", () => { expect(parseReverseLookup(ADDR, ok({ name: null, reason: "No QIE ID is set" }))).toMatchObject({ status: "ok", name: null }); });
  for (const [n, r] of [["wrong chain", ok({ chainId: 1983 })], ["address mismatch", ok({ address: "0x2222222222222222222222222222222222222222" })], ["markup in name", ok({ name: "<img src=x onerror=1>.qie" })], ["error status", ok({ status: "error" })], ["empty", {}], ["non-string name", ok({ name: 5 })]] as const)
    it(`rejects ${n}`, () => { expect(parseReverseLookup(ADDR, r).status).toBe("unavailable"); });
  it("service down, timeout, or throw => unavailable, never an exception", async () => {
    expect((await lookupQieId(ADDR, async () => { throw new Error("503"); })).status).toBe("unavailable");
    expect((await lookupQieId(ADDR, () => new Promise(() => {}), 50)).status).toBe("unavailable");
    expect(await lookupQieId(ADDR, async () => ok())).toEqual({ status: "ok", name: "alice.qie" });
  });
});

describe("Tier 2: explorer source-verification status is reported exactly", () => {
  const j = (o: any, status = 200) => new Response(JSON.stringify(o), { status });
  const mk = (routes: Record<string, () => Response>): typeof fetch => (async (u: any) => { const k = Object.keys(routes).find((p) => String(u).includes(p)); if (!k) throw new Error("unrouted " + u); return routes[k]!(); }) as any;
  it("verified (partial), verified (full), not verified, not a contract, unknown 404/500/timeout", async () => {
    const A = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
    expect(await explorerVerification(A, mk({ "/addresses/": () => j({ is_contract: true, is_verified: true }), "/smart-contracts/": () => j({ is_fully_verified: false, compiler_version: "v0.8.20+commit.a1b79de6", name: "QUSDC", verified_at: "2026-01-21T12:11:49Z" }) })))
      .toMatchObject({ status: "verified", fullyVerified: false, name: "QUSDC" });
    expect(await explorerVerification(A, mk({ "/addresses/": () => j({ is_contract: true, is_verified: true }), "/smart-contracts/": () => j({ is_fully_verified: true, compiler_version: "v0.8.20", name: "R" }) }))).toMatchObject({ fullyVerified: true });
    expect(await explorerVerification(A, mk({ "/addresses/": () => j({ is_contract: true, is_verified: false }) }))).toEqual({ status: "not-verified" });
    expect((await explorerVerification(A, mk({ "/addresses/": () => j({ is_contract: false }) }))).status).toBe("unknown");
    expect((await explorerVerification(A, mk({ "/addresses/": () => j({}, 404) }))).status).toBe("unknown");
    expect((await explorerVerification(A, mk({ "/addresses/": () => j({}, 500) }))).status).toBe("unknown");
    expect((await explorerVerification(A, ((_u: any, init: any) => new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))))) as any, 30)).status).toBe("unknown");
    expect((await explorerVerification("0x12")).status).toBe("unknown");
  });
});
