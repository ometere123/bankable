/** Section 9: four checks, five overall states, fail-closed. Pure; the only place overall states are decided. */
export type CheckStatus = "pass" | "fail" | "inconclusive" | "not-checked";
export interface CheckResult { status: CheckStatus; reasons: string[] }
export type CheckName = "issued" | "content" | "status" | "request";
export type Checks = Record<CheckName, CheckResult>;
export type Overall = "verified-request-matched" | "verified-request-not-checked" | "failed" | "inconclusive" | "not-checked-qr-only";

export const OVERALL_LABEL: Record<Overall, string> = {
  "verified-request-matched": "Verified, request matched",
  "verified-request-not-checked": "Verified document, request not checked",
  "failed": "Verification failed",
  "inconclusive": "Inconclusive",
  "not-checked-qr-only": "Not checked (QR only)",
};
export const pass = (...reasons: string[]): CheckResult => ({ status: "pass", reasons });
export const fail = (...reasons: string[]): CheckResult => ({ status: "fail", reasons });
export const inconclusive = (...reasons: string[]): CheckResult => ({ status: "inconclusive", reasons });
export const notChecked = (...reasons: string[]): CheckResult => ({ status: "not-checked", reasons });

export function overallOf(checks: Checks, opts: { fileSupplied: boolean }): Overall {
  if (!opts.fileSupplied) return "not-checked-qr-only";
  const all = Object.values(checks);
  if (all.some((c) => c.status === "fail")) return "failed"; // an established failure always wins
  const core = [checks.issued, checks.content, checks.status];
  if (core.every((c) => c.status === "pass")) {
    if (checks.request.status === "pass") return "verified-request-matched";
    if (checks.request.status === "not-checked") return "verified-request-not-checked";
  }
  return "inconclusive"; // anything unresolved is never green
}
