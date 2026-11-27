import { OVERALL_LABEL, type Checks, type Overall } from "@bankable/core";

const NAMES: Record<string, string> = { issued: "Issued", content: "Content", status: "Status", request: "Request" };
const SYMBOL: Record<string, string> = { pass: "PASS", fail: "FAIL", inconclusive: "INCONCLUSIVE", "not-checked": "NOT CHECKED" };

export function Verdict({ overall }: { overall: Overall }) {
  const tone = overall.startsWith("verified") ? "pass" : overall === "failed" ? "fail" : overall === "inconclusive" ? "inconclusive" : "not-checked";
  return (
    <div className="verdict" role="status">
      <span className={tone}>{OVERALL_LABEL[overall]}</span>
      {overall === "verified-request-not-checked" && <span className="tag">No claim that the file answers the intended request.</span>}
      {overall === "not-checked-qr-only" && <span className="tag">A QR is a locator only. Supply the file to check it.</span>}
    </div>
  );
}
export function CheckRows({ checks }: { checks: Checks }) {
  return (
    <div>
      {(["issued", "content", "status", "request"] as const).map((k) => (
        <div className="row" key={k}>
          <strong>{NAMES[k]}</strong>
          {/* word + icon text, never colour alone (spec 12) */}
          <span className={checks[k].status}>{SYMBOL[checks[k].status]}</span>
          <span style={{ fontSize: 14 }}>{checks[k].reasons.length ? checks[k].reasons.map((r, i) => <div key={i}>{r}</div>) : <span className="muted">no detail</span>}</span>
        </div>
      ))}
    </div>
  );
}
