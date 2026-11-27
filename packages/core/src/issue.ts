import { BankableError, InconclusiveError } from "./errors";
import { MAX_PDF_BYTES, QIE_MAINNET_CHAIN_ID, QUSDC_ADDRESS, QUSDC_DECIMALS } from "./constants";
import { randomBytes32 } from "./hex";
import { computeRequestId, validateRequest, type TypedRequest } from "./request";
import { dataHashOf, type StatementData } from "./canonical";
import { sha256Hex } from "./verify";
import type { Profile } from "./profile";
import { buildLedger, deriveRange, resolveReference, verifyTokenHistory, type Dual, type LedgerResult, type Reference, type ScanOptions } from "./rpc/dual";

/** G1-measured: endpoint throughput is ~1.6 getLogs/s; 31 days ~ 150 requests per endpoint ~ 95 s (see IMPLEMENTATION_PROGRESS.md). */
export const MAX_PERIOD_SECONDS = 31n * 86400n;

export interface RegisterArgs {
  startUnix: bigint; endUnix: bigint; fromBlock: bigint; toBlock: bigint;
  requestId: string; issuanceSalt: string; dataHash: string; pdfHash: string; rendererId: string;
}
export interface Issuance {
  data: StatementData; dataHash: string; pdf: Uint8Array; pdfHash: string; args: RegisterArgs;
  reference: Reference; ledger: LedgerResult;
  summary: { entries: number; opening: bigint; closing: bigint; incoming: bigint; outgoing: bigint; self: bigint };
}

/** Builds the exact PDF bytes to register. The caller must freeze and keep `pdf`: those same bytes are registered and later downloaded. */
export async function prepareIssuance(a: {
  dual: Dual; request: TypedRequest; registry: string; profile: Profile; scan?: ScanOptions;
  salt?: string; maxPeriodSeconds?: bigint; confirmations?: bigint;
}): Promise<Issuance> {
  const reg = a.registry.toLowerCase();
  const maxP = a.maxPeriodSeconds ?? MAX_PERIOD_SECONDS;
  const ref = await resolveReference(a.dual, a.confirmations);
  validateRequest(a.request, { registry: reg, nowUnix: ref.timestamp });
  if (a.request.endUnix - a.request.startUnix > maxP) throw new BankableError("period-too-long", `period exceeds the supported maximum of ${maxP / 86400n} days`);
  await verifyTokenHistory(a.dual);
  const range = await deriveRange(a.dual, a.request.startUnix, a.request.endUnix, ref);
  const ledger = await buildLedger(a.dual, a.request.expectedWallet, range, ref, a.scan);
  const data: StatementData = {
    rendererId: a.profile.rendererId, chainId: QIE_MAINNET_CHAIN_ID, registry: reg, token: QUSDC_ADDRESS, decimals: QUSDC_DECIMALS,
    owner: a.request.expectedWallet, requestId: computeRequestId(a.request), issuanceSalt: a.salt ?? randomBytes32(),
    startUnix: a.request.startUnix, endUnix: a.request.endUnix, fromBlock: range.fromBlock, toBlock: range.toBlock,
    fromBlockHash: range.fromHeader.hash, toBlockHash: range.toHeader.hash, opening: ledger.opening, closing: ledger.closing, entries: ledger.entries,
  };
  const dataHash = dataHashOf(data);
  const pdf = await a.profile.render(data);
  if (pdf.length > MAX_PDF_BYTES) throw new BankableError("pdf-too-large", `rendered statement is ${pdf.length} bytes, above the supported ${MAX_PDF_BYTES}`);
  const pdfHash = await sha256Hex(pdf);
  let incoming = 0n, outgoing = 0n, self = 0n;
  for (const e of ledger.entries) { if (e.direction === "C") incoming += e.amount; else if (e.direction === "D") outgoing += e.amount; else self += e.amount; }
  return {
    data, dataHash, pdf, pdfHash, reference: ref, ledger,
    args: { startUnix: data.startUnix, endUnix: data.endUnix, fromBlock: data.fromBlock, toBlock: data.toBlock, requestId: data.requestId, issuanceSalt: data.issuanceSalt, dataHash, pdfHash, rendererId: data.rendererId },
    summary: { entries: ledger.entries.length, opening: ledger.opening, closing: ledger.closing, incoming, outgoing, self },
  };
}

/**
 * After the registration receipt: wait until both endpoints agree on a confirmed reference block at or after the receipt block,
 * then read the full record back from both endpoints and compare EVERY submitted field (spec 3.2 / 7). Download is released only on success.
 */
export async function confirmRegistration(a: {
  dual: Dual; owner: string; issuance: Issuance; receiptBlock: bigint; pollMs?: number; timeoutMs?: number;
  now?: () => number; sleep?: (ms: number) => Promise<void>;
}): Promise<{ id: string; record: import("./registry").RegistryRecord; reference: Reference }> {
  const { recordId } = await import("./registry");
  const now = a.now ?? Date.now; const sleep = a.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + (a.timeoutMs ?? 5 * 60_000);
  const id = recordId(a.owner, a.issuance.pdfHash);
  for (;;) {
    let ref: Reference | undefined;
    try { ref = await resolveReference(a.dual); } catch { /* transient: retry until deadline */ }
    if (ref && ref.number >= a.receiptBlock) {
      const [ra, rb] = await Promise.all([a.dual.a.getRecord(id, ref.number), a.dual.b.getRecord(id, ref.number)]);
      if (ra && rb) {
        const want = a.issuance.args;
        for (const r of [ra, rb]) {
          const bad: string[] = [];
          if (r.owner !== a.owner.toLowerCase()) bad.push("owner");
          for (const k of ["startUnix", "endUnix", "fromBlock", "toBlock"] as const) if (r[k] !== want[k]) bad.push(k);
          for (const k of ["requestId", "issuanceSalt", "dataHash", "pdfHash", "rendererId"] as const) if (r[k] !== want[k]) bad.push(k);
          if (r.revokedBlock !== 0n) bad.push("revokedBlock");
          if (bad.length) throw new BankableError("readback-mismatch", `registry read-back differs from what was submitted: ${bad.join(", ")}`);
        }
        return { id, record: ra, reference: ref };
      }
    }
    if (now() > deadline) throw new InconclusiveError("confirmation-timeout", "the registration was not visible on both endpoints at a confirmed block in time; do not release the file yet");
    await sleep(a.pollMs ?? 4000);
  }
}
