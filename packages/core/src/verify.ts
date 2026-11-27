import { BankableError, InconclusiveError } from "./errors";
import { MAX_PDF_BYTES, QIE_MAINNET_CHAIN_ID, QUSDC_ADDRESS, QUSDC_DECIMALS } from "./constants";
import { parseAddress, bytesToHex } from "./hex";
import { computeRequestId, parseRequestLink } from "./request";
import { recordId, type RegistryRecord } from "./registry";
import { dataHashOf, type StatementData } from "./canonical";
import type { Profile } from "./profile";
import { buildLedger, deriveRange, resolveReference, verifyTokenHistory, type Dual, type LedgerResult, type Range, type Reference, type ScanOptions } from "./rpc/dual";
import { fail, inconclusive, notChecked, overallOf, pass, type CheckResult, type Checks, type Overall } from "./verdict";


export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return bytesToHex(new Uint8Array(d));
}
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

export interface VerifyInput {
  file?: Uint8Array;
  owner: string;
  requestLink?: string;
  dual: Dual;
  profiles: Map<string, Profile>;
  registry: string;
  scan?: ScanOptions;
  confirmations?: bigint;
}
export interface VerifyResult {
  overall: Overall;
  checks: Checks;
  owner: string;
  pdfHash?: string;
  recordId?: string;
  record?: RegistryRecord;
  checkedAt?: Reference;
  ledger?: LedgerResult & { data: StatementData };
}

const asReason = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Maps a thrown error to a check result: definite errors fail, availability/disagreement errors are inconclusive. */
function fromError(e: unknown, definite: (e: BankableError) => boolean = () => false): CheckResult {
  if (e instanceof BankableError && definite(e)) return fail(asReason(e));
  return inconclusive(asReason(e));
}

export async function verifyStatement(inp: VerifyInput): Promise<VerifyResult> {
  const owner = parseAddress(inp.owner, "owner");
  const checks: Checks = { issued: notChecked(), content: notChecked(), status: notChecked(), request: notChecked("no request link supplied") };
  const res: VerifyResult = { overall: "inconclusive", checks, owner };
  if (!inp.file) { res.overall = "not-checked-qr-only"; return res; }

  // ---- hash bytes first; bounded size; never parse or execute the file ----
  if (inp.file.length === 0 || inp.file.length > MAX_PDF_BYTES) {
    checks.issued = fail(`file size ${inp.file.length} bytes is outside the supported range (1..${MAX_PDF_BYTES})`);
    res.overall = overallOf(checks, { fileSupplied: true }); return res;
  }
  const pdfHash = await sha256Hex(inp.file); res.pdfHash = pdfHash;
  const id = recordId(owner, pdfHash); res.recordId = id;

  // ---- common confirmed reference block ----
  let ref: Reference;
  try { ref = await resolveReference(inp.dual, inp.confirmations); res.checkedAt = ref; }
  catch (e) {
    const r = fromError(e);
    checks.issued = r; checks.status = r; checks.content = inconclusive("no confirmed reference block");
    if (inp.requestLink) checks.request = inconclusive("no confirmed reference block");
    res.overall = overallOf(checks, { fileSupplied: true }); return res;
  }

  // ---- Issued (+ Status): owner-scoped record from both endpoints at the same pinned block ----
  let record: RegistryRecord | null | undefined;
  try {
    const [ra, rb] = await Promise.all([inp.dual.a.getRecord(id, ref.number), inp.dual.b.getRecord(id, ref.number)]);
    if (JSON.stringify(ra, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) !== JSON.stringify(rb, (_k, v) => (typeof v === "bigint" ? v.toString() : v)))
      throw new InconclusiveError("endpoint-disagreement", "endpoints disagree on the registry record");
    record = ra;
  } catch (e) {
    const r = fromError(e); checks.issued = r; checks.status = r; record = undefined;
  }
  if (record === null) {
    checks.issued = fail("no registry record exists for this owner and file hash (never registered by this owner, or the file was altered)");
    checks.status = notChecked("no record");
    checks.content = notChecked("no record to rebuild from");
  } else if (record) {
    res.record = record;
    if (record.owner !== owner || record.pdfHash !== pdfHash) checks.issued = fail("record owner or file hash does not match");
    else checks.issued = pass(`registered by ${owner} at block ${record.registeredBlock}`);
    checks.status = record.revokedBlock !== 0n ? fail(`revoked at block ${record.revokedBlock}`) : pass(`not revoked as of block ${ref.number}`);
  }

  // ---- Content: rebuild the ledger and canonical data, compare dataHash, regenerate the PDF and compare bytes ----
  let range: Range | undefined;
  if (record) {
    try {
      const profile = inp.profiles.get(record.rendererId);
      if (!profile) throw new InconclusiveError("unknown-profile", `renderer profile ${record.rendererId} is not supported by this verifier`);
      if (record.startUnix >= record.endUnix) throw new BankableError("bad-record", "record has an invalid period");
      await verifyTokenHistory(inp.dual);
      range = await deriveRange(inp.dual, record.startUnix, record.endUnix, ref);
      if (range.fromBlock !== record.fromBlock || range.toBlock !== record.toBlock)
        throw new BankableError("range-mismatch", `record block range ${record.fromBlock}-${record.toBlock} does not match the period's blocks ${range.fromBlock}-${range.toBlock}`);
      let ledger: LedgerResult;
      try { ledger = await buildLedger(inp.dual, record.owner, range, ref, inp.scan); }
      catch (e) { if (e instanceof BankableError && ["reconciliation-failed", "removed-log", "bad-log", "conflicting-logs", "header-mismatch", "log-out-of-range", "foreign-log"].includes(e.code)) throw new InconclusiveError(e.code, asReason(e)); throw e; }
      const data: StatementData = {
        rendererId: record.rendererId, chainId: QIE_MAINNET_CHAIN_ID, registry: inp.registry.toLowerCase(), token: QUSDC_ADDRESS, decimals: QUSDC_DECIMALS,
        owner: record.owner, requestId: record.requestId, issuanceSalt: record.issuanceSalt, startUnix: record.startUnix, endUnix: record.endUnix,
        fromBlock: record.fromBlock, toBlock: record.toBlock, fromBlockHash: ledger.fromHeader.hash, toBlockHash: ledger.toHeader.hash,
        opening: ledger.opening, closing: ledger.closing, entries: ledger.entries,
      };
      res.ledger = { ...ledger, data };
      const reasons: string[] = [];
      const dh = dataHashOf(data);
      let ok = true;
      if (dh !== record.dataHash) { ok = false; reasons.push("the registered data commitment differs from the canonical data rebuilt from chain"); }
      const regenerated = await profile.render(data);
      if (!equalBytes(regenerated, inp.file)) { ok = false; reasons.push("the file is not byte-identical to the canonical rendering of the chain data"); }
      checks.content = ok ? pass("byte-identical to the canonical rendering of chain-derived data", `dataHash ${dh}`) : fail(...reasons);
    } catch (e) { checks.content = fromError(e, () => true); }
  }

  // ---- Request binding ----
  if (inp.requestLink && inp.requestLink.trim() !== "") {
    if (!record) {
      checks.request = record === null ? notChecked("no record to compare against") : inconclusive("record unavailable");
    } else {
      try {
        const req = parseRequestLink(inp.requestLink);
        const bad: string[] = [];
        if (computeRequestId(req) !== record.requestId) bad.push("link does not reproduce the record's request id");
        if (req.expectedWallet !== record.owner) bad.push("expected wallet differs from the record owner");
        if (req.token !== QUSDC_ADDRESS) bad.push("token differs");
        if (req.chainId !== QIE_MAINNET_CHAIN_ID) bad.push("chain differs");
        if (req.registry !== inp.registry.toLowerCase()) bad.push("registry differs");
        if (req.startUnix !== record.startUnix || req.endUnix !== record.endUnix) bad.push("dates differ from the record");
        if (range && (range.fromBlock !== record.fromBlock || range.toBlock !== record.toBlock)) bad.push("derived blocks differ from the record");
        checks.request = bad.length ? fail(...bad) : pass("request link reproduces the record's request id; wallet, token, chain, registry and dates match");
      } catch (e) { checks.request = e instanceof BankableError ? fail(asReason(e)) : inconclusive(asReason(e)); }
    }
  }

  res.overall = overallOf(checks, { fileSupplied: true });
  return res;
}
