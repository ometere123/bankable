// Locale-independent formatting. Nothing here reads the host clock, locale or timezone.
export function utcStamp(unix: bigint): string {
  const d = new Date(Number(unix) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}
/** Exact decimal string with thousands grouping disabled (grouping is locale-dependent), full precision. */
export function amountStr(v: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  return `${v / base}.${(v % base).toString().padStart(decimals, "0")}`;
}
/** Break a long unbroken string (hash, address) into fixed-width lines. */
export function chunkString(s: string, width: number): string[] {
  const out: string[] = []; for (let i = 0; i < s.length; i += width) out.push(s.slice(i, i + width)); return out;
}
