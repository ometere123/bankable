import { BankableError, InconclusiveError } from "./errors";
import { isBytes32, isCanonicalAddress } from "./hex";
import { MAX_ENTRIES, QUSDC_ADDRESS, TRANSFER_TOPIC, ZERO_BYTES32 } from "./constants";

/** Raw eth_getLogs entry as returned by an endpoint (hex strings). */
export interface RawLog {
  address: string; topics: string[]; data: string;
  blockNumber: string; blockHash: string; transactionHash: string; logIndex: string; removed?: boolean;
  transactionIndex?: string;
}
export type Direction = "C" | "D" | "S";
export interface Entry {
  block: bigint; blockHash: string; logIndex: bigint; txHash: string;
  from: string; to: string; amount: bigint; timestamp: bigint; direction: Direction;
}
export interface BlockHeader { number: bigint; hash: string; timestamp: bigint }

const HEXQ = /^0x[0-9a-fA-F]+$/;
const quantity = (s: unknown, what: string): bigint => {
  if (typeof s !== "string" || !HEXQ.test(s) || (s.length > 3 && s[2] === "0")) throw new BankableError("bad-log", `${what} is not a canonical hex quantity`);
  return BigInt(s);
};
const topicAddr = (t: string): string => {
  if (typeof t !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/.test(t)) throw new BankableError("bad-log", "indexed address topic is malformed");
  return "0x" + t.slice(26).toLowerCase();
};

export interface ParsedLog { block: bigint; blockHash: string; logIndex: bigint; txHash: string; from: string; to: string; amount: bigint }

/** Strict validation of one Transfer log. Rejects removed, wrong token/topic/arity, malformed data. */
export function parseTransferLog(l: RawLog, token = QUSDC_ADDRESS): ParsedLog {
  if (l.removed === true) throw new BankableError("removed-log", "endpoint returned a removed (reorged) log");
  if (typeof l.address !== "string" || l.address.toLowerCase() !== token) throw new BankableError("bad-log", "log address is not the token contract");
  if (!Array.isArray(l.topics) || l.topics.length !== 3 || String(l.topics[0]).toLowerCase() !== TRANSFER_TOPIC)
    throw new BankableError("bad-log", "log is not an ERC-20 Transfer (3 topics)");
  if (typeof l.data !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(l.data)) throw new BankableError("bad-log", "log data is not exactly one uint256");
  const blockHash = String(l.blockHash).toLowerCase(), txHash = String(l.transactionHash).toLowerCase();
  if (!isBytes32(blockHash) || !isBytes32(txHash)) throw new BankableError("bad-log", "block or transaction hash malformed");
  return {
    block: quantity(l.blockNumber, "blockNumber"), blockHash, logIndex: quantity(l.logIndex, "logIndex"), txHash,
    from: topicAddr(l.topics[1]!), to: topicAddr(l.topics[2]!), amount: BigInt(l.data),
  };
}

const keyOf = (p: { blockHash: string; logIndex: bigint }) => `${p.blockHash}:${p.logIndex}`;
const sameParsed = (a: ParsedLog, b: ParsedLog) =>
  a.block === b.block && a.txHash === b.txHash && a.from === b.from && a.to === b.to && a.amount === b.amount;

/** Merge the sender-filter and recipient-filter results, de-duplicate by (blockHash, logIndex), fail on conflicts. */
export function mergeLogs(sets: RawLog[][], token = QUSDC_ADDRESS): ParsedLog[] {
  const m = new Map<string, ParsedLog>();
  for (const set of sets) for (const raw of set) {
    const p = parseTransferLog(raw, token); const k = keyOf(p); const prev = m.get(k);
    if (prev && !sameParsed(prev, p)) throw new BankableError("conflicting-logs", "two logs share a block hash and log index but differ");
    m.set(k, p);
  }
  return [...m.values()].sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : a.logIndex < b.logIndex ? -1 : a.logIndex > b.logIndex ? 1 : 0));
}

/** Logs from one endpoint must also be consistent with its own block headers: hash match and timestamp inside the range. */
export function attachHeaders(logs: ParsedLog[], headers: Map<bigint, BlockHeader>, range: { fromBlock: bigint; toBlock: bigint }): Entry[] {
  if (logs.length > MAX_ENTRIES) throw new InconclusiveError("too-many-entries", `statement exceeds the supported maximum of ${MAX_ENTRIES} entries`);
  return logs.map((l) => {
    if (l.block < range.fromBlock || l.block > range.toBlock) throw new BankableError("log-out-of-range", "log lies outside the requested block range");
    const h = headers.get(l.block);
    if (!h) throw new InconclusiveError("missing-header", `no header for block ${l.block}`);
    if (h.hash !== l.blockHash) throw new BankableError("header-mismatch", `log block hash does not match header for block ${l.block}`);
    return { ...l, timestamp: h.timestamp, direction: "C" as Direction };
  });
}

/** Direction relative to the owner. Self-transfers are their own class. Entries not touching the owner are rejected. */
export function classify(entries: Entry[], owner: string): Entry[] {
  return entries.map((e) => {
    const out = e.from === owner, inn = e.to === owner;
    if (!out && !inn) throw new BankableError("foreign-log", "log does not involve the owner");
    return { ...e, direction: (out && inn ? "S" : inn ? "C" : "D") as Direction };
  });
}

export interface Totals { incoming: bigint; outgoing: bigint; self: bigint; countIn: number; countOut: number; countSelf: number }
export function totalsOf(entries: Entry[]): Totals {
  const t: Totals = { incoming: 0n, outgoing: 0n, self: 0n, countIn: 0, countOut: 0, countSelf: 0 };
  for (const e of entries) {
    if (e.direction === "C") { t.incoming += e.amount; t.countIn++; }
    else if (e.direction === "D") { t.outgoing += e.amount; t.countOut++; }
    else { t.self += e.amount; t.countSelf++; } // self-transfer: excluded from incoming and outgoing totals, has its own
  }
  return t;
}

/** opening + credits - debits == closing, in bigint base units. A mismatch is a definite failure of the scan. */
export function reconcile(opening: bigint, closing: bigint, totals: Totals): { ok: boolean; expectedClosing: bigint } {
  const expectedClosing = opening + totals.incoming - totals.outgoing;
  return { ok: expectedClosing === closing, expectedClosing };
}

/** Two endpoints' normalised event sets must be identical before any arithmetic. */
export function compareEntrySets(a: Entry[], b: Entry[]): void {
  if (a.length !== b.length) throw new InconclusiveError("endpoint-disagreement", `endpoints returned ${a.length} vs ${b.length} entries`);
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    if (x.block !== y.block || x.blockHash !== y.blockHash || x.logIndex !== y.logIndex || x.txHash !== y.txHash || x.from !== y.from || x.to !== y.to || x.amount !== y.amount || x.timestamp !== y.timestamp)
      throw new InconclusiveError("endpoint-disagreement", `endpoints disagree on entry ${i}`);
  }
}
export { isCanonicalAddress, ZERO_BYTES32 };
