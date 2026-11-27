import type { StatementData } from "../src/canonical";
import type { Entry } from "../src/ledger";
import { QUSDC_ADDRESS } from "../src/constants";

// Clearly synthetic fixture data for automated tests. NOT chain data.
export const OWNER = "0x1111111111111111111111111111111111111111";
export const OTHER = "0x2222222222222222222222222222222222222222";
export const REGISTRY = "0x3333333333333333333333333333333333333333";
const h = (n: number) => "0x" + n.toString(16).padStart(64, "0");

export function entry(i: number, dir: "C" | "D" | "S", amount: bigint): Entry {
  const from = dir === "C" ? OTHER : OWNER, to = dir === "D" ? OTHER : OWNER;
  return { block: BigInt(1000 + i), blockHash: h(5000 + i), logIndex: BigInt(i % 3), txHash: h(9000 + i), from, to, amount, timestamp: BigInt(1_760_000_000 + i * 17), direction: dir };
}
export function statement(entries: Entry[], over: Partial<StatementData> = {}): StatementData {
  let bal = 5_000_000n; const opening = bal;
  for (const e of entries) { if (e.direction === "C") bal += e.amount; else if (e.direction === "D") bal -= e.amount; }
  return {
    rendererId: h(0xabc), chainId: 1990n, registry: REGISTRY, token: QUSDC_ADDRESS, decimals: 6, owner: OWNER,
    requestId: h(0x111), issuanceSalt: h(0x222), startUnix: 1_759_968_000n, endUnix: 1_760_054_400n,
    fromBlock: 990n, toBlock: BigInt(1100 + entries.length), fromBlockHash: h(4990), toBlockHash: h(5100), opening, closing: bal, entries, ...over,
  };
}
export const manyEntries = (n: number): Entry[] => Array.from({ length: n }, (_, i) => entry(i, i % 7 === 0 ? "D" : i % 11 === 0 ? "S" : "C", BigInt(1_000_000 + i * 12_345)));
