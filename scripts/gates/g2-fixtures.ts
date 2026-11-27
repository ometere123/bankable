// Synthetic, clearly-labelled fixtures for the renderer gate. NOT chain data.
import type { StatementData } from "../../packages/core/src/canonical";
import type { Entry } from "../../packages/core/src/ledger";
const h = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const OWNER = "0x1111111111111111111111111111111111111111", OTHER = "0x2222222222222222222222222222222222222222";
const entry = (i: number, dir: "C" | "D" | "S", amount: bigint): Entry => ({ block: BigInt(5_300_000 + i * 3), blockHash: h(5000 + i), logIndex: BigInt(i % 4), txHash: h(0x9000 + i * 7), from: dir === "C" ? OTHER : OWNER, to: dir === "D" ? OTHER : OWNER, amount, timestamp: BigInt(1_769_000_000 + i * 17), direction: dir });
export function statement(entries: Entry[]): StatementData {
  let bal = 5_000_000n; const opening = bal; for (const e of entries) { if (e.direction === "C") bal += e.amount; else if (e.direction === "D") bal -= e.amount; }
  return { rendererId: h(0xabc), chainId: 1990n, registry: "0x3333333333333333333333333333333333333333", token: "0x3f43da82ec9a4f5285f10faf1f26eca7319e5da5", decimals: 6, owner: OWNER, requestId: h(0x111), issuanceSalt: h(0x222), startUnix: 1_768_780_800n, endUnix: 1_769_040_000n, fromBlock: 5_299_990n, toBlock: BigInt(5_300_100 + entries.length * 3), fromBlockHash: h(4990), toBlockHash: h(5100), opening, closing: bal, entries };
}
const many = (n: number) => Array.from({ length: n }, (_, i) => entry(i, i % 7 === 0 ? "D" : i % 11 === 0 ? "S" : "C", BigInt(1_000_000 + i * 12_345) * (i % 13 === 0 ? 1_000_000_000n : 1n)));
export const FIXTURE_NAMES = ["no-activity", "single-entry", "multi-page-120", "multi-page-600", "exact-page-boundary"] as const;
export function fixtureByName(name: string): StatementData {
  switch (name) {
    case "no-activity": return statement([]);
    case "single-entry": return statement([entry(1, "C", 2_500_000n)]);
    case "multi-page-120": return statement(many(120));
    case "multi-page-600": return statement(many(600));
    case "exact-page-boundary": return statement(many(11)); // fills the first table page exactly (see rowH in the renderer)
  }
  throw new Error("unknown fixture " + name);
}
