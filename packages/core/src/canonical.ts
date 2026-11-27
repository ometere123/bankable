import { keccak256, toUtf8Bytes } from "ethers";
import { BankableError } from "./errors";
import { isBytes32, isCanonicalAddress, isCanonicalDecimal } from "./hex";
import type { Direction, Entry } from "./ledger";

export interface StatementData {
  rendererId: string; chainId: bigint; registry: string; token: string; decimals: number; owner: string;
  requestId: string; issuanceSalt: string; startUnix: bigint; endUnix: bigint;
  fromBlock: bigint; toBlock: bigint; fromBlockHash: string; toBlockHash: string;
  opening: bigint; closing: bigint; entries: Entry[];
}
export const STATEMENT_TAG = "bankable-statement";

type Row = string[];
/** Section 5.3: a JSON array of strings and nested arrays of strings; no objects, floats or whitespace. */
export function toCanonicalArray(s: StatementData): (string | Row[])[] {
  return [
    STATEMENT_TAG, s.rendererId, s.chainId.toString(), s.registry, s.token, s.decimals.toString(), s.owner,
    s.requestId, s.issuanceSalt, s.startUnix.toString(), s.endUnix.toString(),
    s.fromBlock.toString(), s.toBlock.toString(), s.fromBlockHash, s.toBlockHash, s.opening.toString(), s.closing.toString(),
    s.entries.map((e) => [e.block.toString(), e.blockHash, e.logIndex.toString(), e.txHash, e.from, e.to, e.amount.toString(), e.timestamp.toString(), e.direction]),
  ];
}
export function canonicalJson(s: StatementData): string { return JSON.stringify(toCanonicalArray(s)); }
export function dataHashOf(s: StatementData): string { return keccak256(toUtf8Bytes(canonicalJson(s))); }

/** Strict parser. Re-serialising must reproduce the input byte-for-byte; anything else is rejected. */
export function parseCanonical(json: string): StatementData {
  let v: unknown;
  try { v = JSON.parse(json); } catch { throw new BankableError("non-canonical", "not valid JSON"); }
  if (!Array.isArray(v) || v.length !== 18 || v[0] !== STATEMENT_TAG) throw new BankableError("non-canonical", "wrong top-level shape");
  const f = v as unknown[];
  const str = (i: number) => { if (typeof f[i] !== "string") throw new BankableError("non-canonical", `field ${i} is not a string`); return f[i] as string; };
  const dec = (i: number) => { const s = str(i); if (!isCanonicalDecimal(s)) throw new BankableError("non-canonical", `field ${i} not canonical decimal`); return BigInt(s); };
  const addr = (i: number) => { const s = str(i); if (!isCanonicalAddress(s)) throw new BankableError("non-canonical", `field ${i} not canonical address`); return s; };
  const b32 = (i: number) => { const s = str(i); if (!isBytes32(s)) throw new BankableError("non-canonical", `field ${i} not canonical bytes32`); return s; };
  const rows = f[17];
  if (!Array.isArray(rows)) throw new BankableError("non-canonical", "entries is not an array");
  const entries: Entry[] = rows.map((r, n) => {
    if (!Array.isArray(r) || r.length !== 9 || r.some((c) => typeof c !== "string")) throw new BankableError("non-canonical", `entry ${n} malformed`);
    const c = r as string[];
    const d = (k: number) => { if (!isCanonicalDecimal(c[k])) throw new BankableError("non-canonical", `entry ${n} field ${k}`); return BigInt(c[k]!); };
    if (!isBytes32(c[1]) || !isBytes32(c[3]) || !isCanonicalAddress(c[4]) || !isCanonicalAddress(c[5])) throw new BankableError("non-canonical", `entry ${n} hex field`);
    if (c[8] !== "C" && c[8] !== "D" && c[8] !== "S") throw new BankableError("non-canonical", `entry ${n} direction`);
    return { block: d(0), blockHash: c[1]!, logIndex: d(2), txHash: c[3]!, from: c[4]!, to: c[5]!, amount: d(6), timestamp: d(7), direction: c[8] as Direction };
  });
  const data: StatementData = {
    rendererId: b32(1), chainId: dec(2), registry: addr(3), token: addr(4), decimals: Number(dec(5)), owner: addr(6),
    requestId: b32(7), issuanceSalt: b32(8), startUnix: dec(9), endUnix: dec(10), fromBlock: dec(11), toBlock: dec(12),
    fromBlockHash: b32(13), toBlockHash: b32(14), opening: dec(15), closing: dec(16), entries,
  };
  if (canonicalJson(data) !== json) throw new BankableError("non-canonical", "input is not the canonical serialisation");
  return data;
}
