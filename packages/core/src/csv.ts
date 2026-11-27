import { formatUnits } from "./hex";
import type { StatementData } from "./canonical";

/** Tier 2 (spec 8.2): generic CSV generated ONLY from a verified canonical ledger. Not claimed compatible with Xero or QuickBooks. */
export const CSV_HEADERS = ["UTC timestamp", "wallet", "token", "transaction hash", "log index", "direction", "amount (QUSDC token units)", "counterparty"] as const;

/** Neutralise spreadsheet formula injection: a cell that could be read as a formula is prefixed with a single quote. */
export function neutralise(cell: string): string {
  return /^[=+\-@\t\r\n]/.test(cell) || /^[\s\u00a0\ufeff]+[=+\-@]/.test(cell) ? `'${cell}` : cell;
}
/** Consistent quoting: every field is double-quoted, embedded quotes doubled, CR/LF inside fields collapsed to a space. */
export function csvField(cell: string): string { return `"${neutralise(cell).replace(/[\r\n]+/g, " ").replace(/"/g, '""')}"`; }

export function utcIso(unix: bigint): string {
  const d = new Date(Number(unix) * 1000); const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}
/** Amounts are unsigned exact decimal strings; direction says in/out/self. A negative number is never emitted. */
export function ledgerToCsv(d: StatementData): string {
  const rows = d.entries.map((e) => [
    utcIso(e.timestamp), d.owner, d.token, e.txHash, e.logIndex.toString(), e.direction === "C" ? "in" : e.direction === "D" ? "out" : "self",
    formatUnits(e.amount, d.decimals), e.direction === "C" ? e.from : e.direction === "D" ? e.to : e.to,
  ]);
  return [CSV_HEADERS as readonly string[], ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n"; // UTF-8, CRLF per RFC 4180
}
