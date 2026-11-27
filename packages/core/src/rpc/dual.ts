import { BankableError, InconclusiveError } from "../errors";
import { MAX_LOG_SPAN, QUSDC_ADDRESS, QUSDC_DEPLOYMENT_BLOCK } from "../constants";
import { attachHeaders, classify, compareEntrySets, mergeLogs, reconcile, totalsOf, type BlockHeader, type Entry, type RawLog } from "../ledger";
import type { ChainReader, Header } from "./reader";

export interface Dual { a: ChainReader; b: ChainReader }
export interface Reference { number: bigint; hash: string; timestamp: bigint }
export interface Range { fromBlock: bigint; toBlock: bigint; fromHeader: Header; toHeader: Header }
export interface ScanOptions { concurrency?: number; deadlineMs?: number; onProgress?: (done: number, total: number) => void; now?: () => number }
export interface LedgerResult { entries: Entry[]; opening: bigint; closing: bigint; fromHeader: Header; toHeader: Header; reconciled: true }

export const DEFAULT_CONFIRMATIONS = 12n; // conservative buffer on top of QIE's documented fast finality [S5]

async function pool<T>(items: (() => Promise<T>)[], conc: number, deadline: number | undefined, now: () => number, onDone?: () => void): Promise<T[]> {
  const out = new Array<T>(items.length); let i = 0; let failure: unknown;
  await Promise.all(Array.from({ length: Math.max(1, conc) }, async () => {
    while (!failure && i < items.length) {
      const k = i++;
      if (deadline !== undefined && now() > deadline) { failure = new InconclusiveError("budget-exceeded", "time budget exceeded before the scan completed"); break; }
      try { out[k] = await items[k]!(); onDone?.(); } catch (e) { failure = e; }
    }
  }));
  if (failure) throw failure;
  return out;
}

/** A common, sufficiently confirmed block both endpoints agree on, including hash and timestamp. */
export async function resolveReference(d: Dual, confirmations = DEFAULT_CONFIRMATIONS): Promise<Reference> {
  const [ha, hb] = await Promise.all([d.a.head(), d.b.head()]);
  const n = (ha < hb ? ha : hb) - confirmations;
  if (n < 1n) throw new InconclusiveError("no-reference", "chain head too low for a confirmed reference block");
  const [ba, bb] = await Promise.all([d.a.block(n), d.b.block(n)]);
  if (ba.hash !== bb.hash || ba.timestamp !== bb.timestamp) throw new InconclusiveError("reference-disagreement", "endpoints disagree on the reference block");
  return { number: n, hash: ba.hash, timestamp: ba.timestamp };
}

async function rangeOn(r: ChainReader, startUnix: bigint, endUnix: bigint, ref: Reference): Promise<Range> {
  const cache = new Map<bigint, Header>();
  const blk = async (n: bigint) => { let h = cache.get(n); if (!h) { h = await r.block(n); cache.set(n, h); } return h; };
  const refB = await blk(ref.number);
  if (refB.hash !== ref.hash) throw new InconclusiveError("reference-disagreement", `${r.id} disagrees on the reference block`);
  if (refB.timestamp < endUnix) throw new BankableError("period-not-covered", "the reference block does not yet cover the end of the period");
  // smallest block number whose timestamp >= t (timestamps are non-decreasing; verified by neighbour checks below)
  const firstAtOrAfter = async (t: bigint): Promise<bigint> => {
    let lo = 1n, hi = ref.number;
    while (lo < hi) { const mid = (lo + hi) / 2n; if ((await blk(mid)).timestamp >= t) hi = mid; else lo = mid + 1n; }
    return lo;
  };
  const from = await firstAtOrAfter(startUnix);
  const afterEnd = await firstAtOrAfter(endUnix); // first block at/after end
  const to = afterEnd - 1n;
  if (to < from) throw new BankableError("empty-block-range", "no block has a timestamp inside the period");
  const [bFrom, bTo, bAfter] = [await blk(from), await blk(to), await blk(afterEnd)];
  if (!(bFrom.timestamp >= startUnix) || !(bTo.timestamp < endUnix) || !(bAfter.timestamp >= endUnix) || bFrom.timestamp > bTo.timestamp)
    throw new InconclusiveError("non-monotonic", `${r.id}: boundary blocks inconsistent with ordered timestamps`);
  if (from > 1n) {
    const bBefore = await blk(from - 1n);
    if (!(bBefore.timestamp < startUnix)) throw new InconclusiveError("non-monotonic", `${r.id}: block before range is not before period start`);
    if (bFrom.parentHash !== bBefore.hash) throw new InconclusiveError("chain-link", `${r.id}: parentHash chain broken at range start`);
  }
  if (bAfter.parentHash !== bTo.hash) throw new InconclusiveError("chain-link", `${r.id}: parentHash chain broken at range end`);
  return { fromBlock: from, toBlock: to, fromHeader: bFrom, toHeader: bTo };
}

export async function deriveRange(d: Dual, startUnix: bigint, endUnix: bigint, ref: Reference): Promise<Range> {
  const [ra, rb] = await Promise.all([rangeOn(d.a, startUnix, endUnix, ref), rangeOn(d.b, startUnix, endUnix, ref)]);
  if (ra.fromBlock !== rb.fromBlock || ra.toBlock !== rb.toBlock || ra.fromHeader.hash !== rb.fromHeader.hash || ra.toHeader.hash !== rb.toHeader.hash ||
      ra.fromHeader.timestamp !== rb.fromHeader.timestamp || ra.toHeader.timestamp !== rb.toHeader.timestamp)
    throw new InconclusiveError("endpoint-disagreement", "endpoints disagree on the block range for the period");
  if (ra.fromBlock - 1n < BigInt(QUSDC_DEPLOYMENT_BLOCK)) throw new BankableError("before-token-history", "the period begins before the QUSDC contract history on this chain");
  return ra;
}

/** Confirms the pinned deployment block: code absent at N-1, present at N, on both endpoints. */
export async function verifyTokenHistory(d: Dual): Promise<void> {
  const N = BigInt(QUSDC_DEPLOYMENT_BLOCK);
  for (const r of [d.a, d.b]) {
    const [before, at] = await Promise.all([r.code(QUSDC_ADDRESS, N - 1n), r.code(QUSDC_ADDRESS, N)]);
    if (before !== "0x" || at === "0x") throw new InconclusiveError("deployment-mismatch", `${r.id}: pinned QUSDC deployment block does not match chain`);
  }
}

async function ledgerOn(r: ChainReader, owner: string, range: Range, ref: Reference, opt: ScanOptions) {
  const now = opt.now ?? Date.now; const deadline = opt.deadlineMs !== undefined ? now() + opt.deadlineMs : undefined;
  await r.verifyToken(ref.number);
  const span = BigInt(MAX_LOG_SPAN);
  const chunks: [bigint, bigint][] = [];
  for (let f = range.fromBlock; f <= range.toBlock; f += span) chunks.push([f, f + span - 1n > range.toBlock ? range.toBlock : f + span - 1n]);
  const tasks: (() => Promise<RawLog[]>)[] = [];
  for (const [f, t] of chunks) { tasks.push(() => r.transferLogs(owner, f, t, "sender")); tasks.push(() => r.transferLogs(owner, f, t, "recipient")); }
  let done = 0;
  const [opening, closing, sets] = await Promise.all([
    r.balanceOf(owner, range.fromBlock - 1n), r.balanceOf(owner, range.toBlock),
    pool(tasks, opt.concurrency ?? 6, deadline, now, () => opt.onProgress?.(++done, tasks.length)),
  ]);
  const parsed = mergeLogs(sets);
  const blocks = [...new Set(parsed.map((p) => p.block))];
  const headers = new Map<bigint, BlockHeader>();
  const hs = await pool(blocks.map((b) => () => r.block(b)), opt.concurrency ?? 6, deadline, now);
  hs.forEach((h) => headers.set(h.number, h));
  const entries = classify(attachHeaders(parsed, headers, range), owner);
  return { entries, opening, closing };
}

/** Full dual-endpoint reconstruction. Fails closed: disagreement or reconciliation failure never yields data. */
export async function buildLedger(d: Dual, owner: string, range: Range, ref: Reference, opt: ScanOptions = {}): Promise<LedgerResult> {
  const [la, lb] = await Promise.all([ledgerOn(d.a, owner, range, ref, opt), ledgerOn(d.b, owner, range, ref, opt)]);
  compareEntrySets(la.entries, lb.entries);
  if (la.opening !== lb.opening || la.closing !== lb.closing) throw new InconclusiveError("endpoint-disagreement", "endpoints disagree on pinned opening or closing balance");
  const rec = reconcile(la.opening, la.closing, totalsOf(la.entries));
  if (!rec.ok) throw new BankableError("reconciliation-failed", `opening + credits - debits (${rec.expectedClosing}) does not equal closing (${la.closing}); the log set is not trustworthy`);
  return { entries: la.entries, opening: la.opening, closing: la.closing, fromHeader: range.fromHeader, toHeader: range.toHeader, reconciled: true };
}
