import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { renderStatementPdf } from "../src/render/pdf";
import { entry, manyEntries, statement } from "./fixtures";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const profile = { origin: "https://bankable.invalid" };
afterEach(() => vi.restoreAllMocks());

describe("renderer is independent of engine-specific floating point and randomness (G2 root cause regression)", () => {
  const d = statement(manyEntries(600));
  it("does not change when Math.sin is perturbed by 1 ulp-scale noise (simulates another JS engine)", async () => {
    const base = sha(await renderStatementPdf(d, profile));
    const realSin = Math.sin; vi.spyOn(Math, "sin").mockImplementation((x: number) => realSin(x) * (1 + 2.2e-16));
    expect(sha(await renderStatementPdf(d, profile))).toBe(base);
  });
  it("does not change when Math.random is replaced", async () => {
    const base = sha(await renderStatementPdf(d, profile));
    let s = 12345; vi.spyOn(Math, "random").mockImplementation(() => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648));
    expect(sha(await renderStatementPdf(d, profile))).toBe(base);
  });
  it("does not change with a different system clock or timezone", async () => {
    const base = sha(await renderStatementPdf(statement([entry(1, "C", 5n)]), profile));
    vi.useFakeTimers(); vi.setSystemTime(new Date("2031-05-05T05:05:05Z"));
    const prevTZ = process.env.TZ; process.env.TZ = "Pacific/Kiritimati";
    try { expect(sha(await renderStatementPdf(statement([entry(1, "C", 5n)]), profile))).toBe(base); }
    finally { vi.useRealTimers(); if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ; }
  });
  it("emits only the fixed metadata dates, no trailer /ID and no XMP packet", async () => {
    const s = Buffer.from(await renderStatementPdf(statement([entry(1, "C", 5n)]), profile)).toString("latin1");
    expect(s).toContain("/CreationDate (D:20000101000000Z)"); expect(s).toContain("/ModDate (D:20000101000000Z)");
    expect(/\/ID\s*\[/.test(s)).toBe(false); expect(s.includes("xpacket")).toBe(false);
  });
});
