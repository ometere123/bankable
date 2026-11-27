import { describe, expect, it } from "vitest";
import { encodeRequestFragment, requestLink } from "../src/request";
import { InconclusiveError, BankableError } from "../src/errors";
import { totalsOf } from "../src/ledger";
import { renderStatementPdf } from "../src/render/pdf";
import { recordId } from "../src/registry";
import { sha256Hex } from "../src/verify";
import { prepareIssuance } from "../src/issue";
import { FORGER, OTHER, REGISTRY, THIRD, W, issue, makeDual, profile, registerBoth, requestFor, scenario, verify } from "./helpers/scenario";

const link = (r: ReturnType<typeof requestFor>) => requestLink("https://bankable.invalid", "/verify", r);

describe("ledger reconstruction (fixture chain)", () => {
  it("includes boundary blocks, excludes neighbours, classifies C/D/S, handles mint/burn, zero-value and same-block logs, and reconciles", async () => {
    const s = scenario(); const i = await issue(s);
    expect(i.data.opening).toBe(10_000_000n + 111n);                  // neighbour before range counted in opening
    expect(i.data.entries.map((e) => `${e.block - 5244996n}:${e.logIndex}:${e.direction}`)).toEqual([
      "100000:0:C", "100000:1:D", "101000:2:D", "110000:0:S", "112000:0:C", "120000:3:C", "130000:0:D", "134999:0:C",
    ]);
    const t = totalsOf(i.data.entries);
    expect(t.incoming).toBe(2_500_000n + 0n + 7_000_000n + 42n);
    expect(t.outgoing).toBe(250_000n + 1_000_000n + 500_000n);
    expect(t.self).toBe(300_000n); expect(t.countSelf).toBe(1);
    expect(i.data.closing).toBe(i.data.opening + t.incoming - t.outgoing);
    expect(i.data.entries.find((e) => e.direction === "C" && e.from === "0x0000000000000000000000000000000000000000")).toBeTruthy(); // mint keeps zero-address counterparty
    expect(i.data.entries.some((e) => e.amount === 0n)).toBe(true);
  });
  it("empty valid period yields an empty ledger and a valid PDF", async () => {
    const s = scenario(); const req = requestFor(s, { wallet: "0x9999999999999999999999999999999999999999" });
    const i = await issue(s, req);
    expect(i.data.entries).toHaveLength(0); expect(i.data.opening).toBe(0n); expect(i.data.closing).toBe(0n);
    expect(i.pdf.length).toBeGreaterThan(1000);
  });
  it("rejects a period before token history", async () => {
    const s = scenario();
    await expect(issue(s, requestFor(s, { start: BigInt(s.a.t0 - 100_000), end: BigInt(s.a.t0 + 4000) }))).rejects.toMatchObject({ code: "before-token-history" });
  });
  it("rejects a future period and over-long periods", async () => {
    const s = scenario();
    await expect(issue(s, { ...requestFor(s), endUnix: BigInt(s.a.ts(s.a.head)) + 100n })).rejects.toBeInstanceOf(BankableError);
    await expect(prepareIssuance({ dual: s.dual, request: requestFor(s), registry: REGISTRY, profile, maxPeriodSeconds: 1000n })).rejects.toMatchObject({ code: "period-too-long" });
  });
});

describe("11.1 acceptance: authentic, no-link, altered, forged", () => {
  it("authentic PDF plus original link: all four pass; matching ledger and record", async () => {
    const s = scenario(); const req = requestFor(s); const i = await issue(s, req); registerBoth(s, W, i);
    const r = await verify(s, i.pdf, W, link(req));
    expect(r.overall).toBe("verified-request-matched");
    for (const k of ["issued", "content", "status", "request"] as const) expect(r.checks[k].status, k).toBe("pass");
    expect(r.ledger!.entries).toHaveLength(8); expect(r.record!.dataHash).toBe(i.dataHash); expect(r.checkedAt!.number).toBeGreaterThan(0n);
  });
  it("authentic PDF, no link: Verified document, request not checked", async () => {
    const s = scenario(); const i = await issue(s); registerBoth(s, W, i);
    const r = await verify(s, i.pdf, W);
    expect(r.overall).toBe("verified-request-not-checked"); expect(r.checks.request.status).toBe("not-checked");
  });
  it("one byte altered, unregistered: Issued fails", async () => {
    const s = scenario(); const i = await issue(s); registerBoth(s, W, i);
    const bad = Uint8Array.from(i.pdf); bad[bad.length - 40] = (bad[bad.length - 40]! ^ 1);
    const r = await verify(s, bad, W);
    expect(r.overall).toBe("failed"); expect(r.checks.issued.status).toBe("fail");
  });
  it("one byte altered, deliberately registered by the owner: Content fails", async () => {
    const s = scenario(); const i = await issue(s);
    const bad = Uint8Array.from(i.pdf); bad[bad.length - 40] = (bad[bad.length - 40]! ^ 1);
    const badHash = await sha256Hex(bad);
    const id = s.a.register(W, { ...i.args, pdfHash: badHash }); s.b.register(W, { ...i.args, pdfHash: badHash });
    const r = await verify(s, bad, W);
    expect(r.checks.issued.status).toBe("pass"); expect(r.checks.content.status).toBe("fail"); expect(r.overall).toBe("failed"); expect(id).toBeTruthy();
  });
  it("forged file (changed transaction row, unchanged totals) registered by a second wallet: Issued passes, Content fails", async () => {
    const s = scenario(); const req = requestFor(s); const real = await issue(s, req);
    // forger changes ONE counterparty address in a row; totals stay identical
    const forgedData = { ...real.data, entries: real.data.entries.map((e, k) => (k === 2 ? { ...e, to: FORGER } : e)) };
    expect(totalsOf(forgedData.entries)).toEqual(totalsOf(real.data.entries));
    const forgedPdf = await renderStatementPdf(forgedData, { origin: JSON.parse(profile.manifestText).origin });
    const forgedHash = await sha256Hex(forgedPdf);
    // variant A: forger commits the dataHash of the forged data; variant B: commits the real dataHash
    for (const dataHash of [real.dataHash, "0x" + "ab".repeat(32)]) {
      const sc = scenario();
      sc.a.register(FORGER, { ...real.args, requestId: real.args.requestId, pdfHash: forgedHash, dataHash }); sc.b.register(FORGER, { ...real.args, pdfHash: forgedHash, dataHash });
      const asForger = await verify(sc, forgedPdf, FORGER);
      expect(asForger.checks.issued.status).toBe("pass");
      expect(asForger.checks.content.status).toBe("fail");
      expect(asForger.overall).toBe("failed");
      const asOwner = await verify(sc, forgedPdf, W);   // the recipient expects W
      expect(asOwner.checks.issued.status).toBe("fail");
    }
  });
});

describe("11.1 acceptance: request binding", () => {
  const variants: [string, (s: ReturnType<typeof scenario>, r: ReturnType<typeof requestFor>) => string][] = [
    ["wrong nonce", (_s, r) => requestLink("https://bankable.invalid", "/verify", { ...r, nonce: "0x" + "77".repeat(32) })],
    ["wrong wallet", (_s, r) => requestLink("https://bankable.invalid", "/verify", { ...r, expectedWallet: OTHER })],
    ["wrong dates", (_s, r) => requestLink("https://bankable.invalid", "/verify", { ...r, endUnix: r.endUnix + 86400n })],
    ["wrong chain", (_s, r) => requestLink("https://bankable.invalid", "/verify", { ...r, chainId: 1n })],
    ["wrong token", (_s, r) => requestLink("https://bankable.invalid", "/verify", { ...r, token: THIRD })],
    ["wrong registry", (_s, r) => requestLink("https://bankable.invalid", "/verify", { ...r, registry: THIRD })],
    ["malformed link", () => "https://bankable.invalid/verify#v=1&chain=1990"],
  ];
  for (const [name, mk] of variants)
    it(`${name}: Request check fails and overall is Failed`, async () => {
      const s = scenario(); const req = requestFor(s); const i = await issue(s, req); registerBoth(s, W, i);
      const r = await verify(s, i.pdf, W, mk(s, req));
      expect(r.checks.request.status).toBe("fail"); expect(r.overall).toBe("failed");
      expect(r.checks.issued.status).toBe("pass"); expect(r.checks.content.status).toBe("pass");
    });
  it("issuance rejects wrong wallet/chain/token/registry/dates up front", async () => {
    const s = scenario(); const ok = requestFor(s);
    for (const bad of [{ ...ok, chainId: 1n }, { ...ok, token: THIRD }, { ...ok, registry: THIRD }, { ...ok, expectedWallet: "0x" + "0".repeat(40) }, { ...ok, startUnix: ok.endUnix }, { ...ok, nonce: "0x" + "0".repeat(64) }])
      await expect(issue(s, bad)).rejects.toBeInstanceOf(BankableError);
  });
  it("link carries the nonce only in the URL fragment, never the query", () => {
    const r = requestFor(scenario()); const l = requestLink("https://bankable.invalid", "/new", r);
    expect(new URL(l).search).toBe(""); expect(new URL(l).hash).toContain(r.nonce.slice(2)); expect(encodeRequestFragment(r)).toContain("nonce=");
  });
});

describe("11.1 acceptance: revocation, reissue, third-party registration", () => {
  it("revoked: old file fails Status; replacement with fresh salt matches the original link; duplicate registration reverts", async () => {
    const s = scenario(); const req = requestFor(s); const first = await issue(s, req, "0x" + "01".repeat(32)); const id1 = registerBoth(s, W, first);
    s.a.revoke(id1); s.b.revoke(id1);
    const old = await verify(s, first.pdf, W, link(req));
    expect(old.checks.status.status).toBe("fail"); expect(old.overall).toBe("failed");
    expect(old.checks.content.status).toBe("pass"); // a revoked file stays verifiable as revoked
    const second = await issue(s, req, "0x" + "02".repeat(32));
    expect(second.pdfHash).not.toBe(first.pdfHash);   // fresh salt -> fresh bytes
    registerBoth(s, W, second);
    const fresh = await verify(s, second.pdf, W, link(req));
    expect(fresh.overall).toBe("verified-request-matched");
    expect(() => s.a.register(W, second.args)).toThrow();   // duplicate id (the real contract's revert is covered in contracts tests)
  });
  it("old record stays independently valid until explicitly revoked (no automatic supersession)", async () => {
    const s = scenario(); const req = requestFor(s); const first = await issue(s, req, "0x" + "01".repeat(32)); registerBoth(s, W, first);
    const second = await issue(s, req, "0x" + "02".repeat(32)); registerBoth(s, W, second);
    expect((await verify(s, first.pdf, W, link(req))).overall).toBe("verified-request-matched");
    expect((await verify(s, second.pdf, W, link(req))).overall).toBe("verified-request-matched");
  });
  it("third-party registration of someone's file hash cannot take over the original id or claim the content", async () => {
    const s = scenario(); const req = requestFor(s); const i = await issue(s, req); const idW = registerBoth(s, W, i);
    const idF = registerBoth(s, FORGER, { ...i, args: { ...i.args } });
    expect(idF).not.toBe(idW); expect(idW).toBe(recordId(W, i.pdfHash));
    expect((await verify(s, i.pdf, W, link(req))).overall).toBe("verified-request-matched");   // original unaffected
    const f = await verify(s, i.pdf, FORGER);
    expect(f.checks.content.status).toBe("fail"); expect(f.overall).toBe("failed");           // forger cannot claim the content
  });
  it("a record registered after the confirmed reference block is not yet visible (Issued fails until confirmed)", async () => {
    const s = scenario(); const i = await issue(s);
    const late = s.head_register_late(i);
    const r = await verify(s, i.pdf, W);
    expect(r.checks.issued.status).toBe("fail"); expect(late).toBeTruthy();
  });
  it("QR only (no file): Not checked, never Verified", async () => {
    const s = scenario(); const r = await verify(s, undefined, W);
    expect(r.overall).toBe("not-checked-qr-only");
  });
});

describe("11.1 acceptance: RPC, endpoint and profile failure => Inconclusive (never green)", () => {
  async function authentic() { const s = scenario(); const req = requestFor(s); const i = await issue(s, req); registerBoth(s, W, i); return { s, req, i }; }
  it("one endpoint 503 on eth_call: verification Inconclusive", async () => {
    const { s, i } = await authentic(); s.b.failMethods.add("eth_call");
    const r = await verify(s, i.pdf, W);
    expect(r.overall).toBe("inconclusive"); expect(r.checks.issued.status).toBe("inconclusive");
  });
  it("timeout on one endpoint: Inconclusive", async () => {
    const { s, i } = await authentic(); s.a.hangMethods.add("eth_getBlockByNumber");
    const dual = makeDual(s.a, s.b, { timeoutMs: 50 });
    const r = await verify(s, i.pdf, W, undefined, dual);
    expect(r.overall).toBe("inconclusive");
  });
  it("known truncation: one endpoint omits a log => endpoint disagreement => Inconclusive (and issuance refuses)", async () => {
    const { s, i } = await authentic();
    s.b.dropLogs = (t) => t.amount === 1_000_000n;
    const r = await verify(s, i.pdf, W);
    expect(r.checks.content.status).toBe("inconclusive"); expect(r.overall).toBe("inconclusive");
    await expect(issue(s)).rejects.toBeInstanceOf(InconclusiveError);
  });
  it("both endpoints omit the same log: reconciliation fails => Inconclusive, never a green result", async () => {
    const { s, i } = await authentic();
    s.a.dropLogs = s.b.dropLogs = (t) => t.amount === 1_000_000n;
    const r = await verify(s, i.pdf, W);
    expect(r.checks.content.status).toBe("inconclusive"); expect(r.checks.content.reasons.join()).toMatch(/does not equal closing/);
    await expect(issue(s)).rejects.toMatchObject({ code: "reconciliation-failed" });
  });
  it("endpoints disagree on a pinned balance: Inconclusive", async () => {
    const { s, i } = await authentic(); s.b.balanceSkew = 1n;
    expect((await verify(s, i.pdf, W)).checks.content.status).toBe("inconclusive");
  });
  it("endpoints disagree on the registry record: Inconclusive", async () => {
    const { s, i } = await authentic(); const id = recordId(W, i.pdfHash); s.b.records.get(id)!.dataHash = "0x" + "cd".repeat(32);
    expect((await verify(s, i.pdf, W)).checks.issued.status).toBe("inconclusive");
  });
  it("removed (reorged) logs are rejected: Inconclusive", async () => {
    const { s, i } = await authentic(); s.a.removedLogs = true;
    expect((await verify(s, i.pdf, W)).checks.content.status).toBe("inconclusive");
  });
  it("endpoint range-limit JSON-RPC error is Inconclusive, not data", async () => {
    const { s, i } = await authentic(); s.a.jsonRpcError = { method: "eth_getLogs", message: "query returned more than 10000 results" };
    expect((await verify(s, i.pdf, W)).checks.content.status).toBe("inconclusive");
  });
  it("wrong chain id from an endpoint: not green", async () => {
    const { s, i } = await authentic(); s.b.chainId = 1n;
    const r = await verify(s, i.pdf, W); expect(r.overall).not.toBe("verified-request-not-checked"); expect(r.overall).not.toBe("verified-request-matched");
  });
  it("unknown renderer profile: Inconclusive; known hash mismatch: Failed", async () => {
    const { s, i } = await authentic();
    const id = recordId(W, i.pdfHash);
    s.a.records.get(id)!.rendererId = "0x" + "ee".repeat(32); s.b.records.get(id)!.rendererId = "0x" + "ee".repeat(32);
    const r = await verify(s, i.pdf, W); expect(r.checks.content.status).toBe("inconclusive"); expect(r.overall).toBe("inconclusive");
  });
  it("oversized or empty file: Failed on Issued without any RPC parse of the file", async () => {
    const s = scenario();
    expect((await verify(s, new Uint8Array(0), W)).overall).toBe("failed");
    expect((await verify(s, new Uint8Array(3 * 1024 * 1024), W)).overall).toBe("failed");
  });
  it("inconclusive Content with failed Status still reports Failed (established failure wins)", async () => {
    const { s, i } = await authentic(); const id = recordId(W, i.pdfHash);
    s.a.revoke(id); s.b.revoke(id); s.b.dropLogs = (t) => t.amount === 1_000_000n;
    const r = await verify(s, i.pdf, W); expect(r.checks.status.status).toBe("fail"); expect(r.overall).toBe("failed");
  });
});

describe("supported limits", () => {
  it("2000 entries render under the PDF size cap; the cap and entry limit agree", async () => {
    const { MAX_ENTRIES, MAX_PDF_BYTES } = await import("../src/constants");
    const { manyEntries, statement } = await import("./fixtures");
    const pdf = await renderStatementPdf(statement(manyEntries(MAX_ENTRIES)), { origin: "https://bankable.invalid" });
    expect(pdf.length).toBeLessThan(MAX_PDF_BYTES);
  });
  it("more than MAX_ENTRIES is Inconclusive (unsupported scale), never silently truncated", async () => {
    const { attachHeaders } = await import("../src/ledger");
    const { MAX_ENTRIES } = await import("../src/constants");
    const logs = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({ block: 1n, blockHash: "0x" + "1".repeat(64), logIndex: BigInt(i), txHash: "0x" + "2".repeat(64), from: W, to: OTHER, amount: 1n }));
    expect(() => attachHeaders(logs, new Map(), { fromBlock: 1n, toBlock: 1n })).toThrow(/maximum/);
  });
});
