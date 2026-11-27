import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { renderStatementPdf } from "../src/render/pdf";
import { entry, manyEntries, statement } from "./fixtures";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const profile = { origin: "https://bankable.invalid" };
describe("render determinism (Node)", () => {
  for (const [name, d] of [["no-activity", statement([])], ["single", statement([entry(1, "C", 2_500_000n)])], ["multi-page", statement(manyEntries(120))]] as const) {
    it(`${name}: repeated renders are byte-identical`, async () => {
      const hs = new Set<string>();
      for (let i = 0; i < 5; i++) hs.add(sha(await renderStatementPdf(d, profile)));
      expect(hs.size).toBe(1);
      console.log(name, [...hs][0]);
    });
  }
});
