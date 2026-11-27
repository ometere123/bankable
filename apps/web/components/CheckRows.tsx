import { OVERALL_LABEL, type Checks, type Overall } from "@bankable/core";
import { StatusIcon, type Tone } from "./ui";

const NAMES: Record<string, string> = { issued: "Issued", content: "Content", status: "Status", request: "Request" };
const WORD: Record<string, string> = { pass: "PASS", fail: "FAIL", inconclusive: "INCONCLUSIVE", "not-checked": "NOT CHECKED" };
export const toneOf = (o: Overall): Tone => (o.startsWith("verified") ? "pass" : o === "failed" ? "fail" : o === "inconclusive" ? "inconclusive" : "not-checked");

export function Verdict({ overall }: { overall: Overall }) {
  const tone = toneOf(overall);
  return (
    <div className={`verdict t-${tone} reveal`} role="status">
      <span className="badge"><StatusIcon tone={tone} /></span>
      <span className={`lbl ${tone}`}>{OVERALL_LABEL[overall]}</span>
      {overall === "verified-request-not-checked" && <span className="tag">No claim that the file answers the intended request.</span>}
      {overall === "not-checked-qr-only" && <span className="tag">A QR is a locator only. Supply the file to check it.</span>}
    </div>
  );
}

/** Plain-language meaning and next step for each outcome. Never softens a failure and never presents inconclusive as a pass. */
export function Guide({ overall, onRetry }: { overall: Overall; onRetry?: () => void }) {
  const tone = toneOf(overall);
  const copy: Record<Overall, { h: string; p: string }> = {
    "verified-request-matched": { h: "All four checks passed.", p: "The file is byte-identical to the canonical rendering of on-chain QUSDC data for this wallet and period, it was registered by that wallet, it has not been revoked, and it answers your original request." },
    "verified-request-not-checked": { h: "The document is genuine, but it is not tied to your request yet.", p: "Add the original request link you created to also check that this file answers it. Without it, nothing is claimed about who the file was prepared for." },
    failed: { h: "Do not rely on this file.", p: "At least one check established a contradiction. The reasons are listed below. A failure is never overridden by a passing check elsewhere." },
    inconclusive: { h: "This is not a pass.", p: "The evidence could not be established, for example because an endpoint was unreachable, the two endpoints disagreed, or the renderer profile is not supported here. Nothing was assumed. Try again in a minute; if it persists, verify with the command-line tool and your own endpoints." },
    "not-checked-qr-only": { h: "Nothing has been verified yet.", p: "A QR code or locator only says where to look. Drop the PDF file to run the checks." },
  };
  const c = copy[overall];
  return (
    <div className={`guide t-${tone} reveal`} style={{ ["--i" as string]: 1 }}>
      <strong>{c.h}</strong> {c.p}
      {overall === "inconclusive" && onRetry && <div className="actions"><button type="button" onClick={onRetry}>Try again</button></div>}
    </div>
  );
}

export function CheckRows({ checks }: { checks: Checks }) {
  return (
    <ol className="checks" aria-label="The four checks">
      {(["issued", "content", "status", "request"] as const).map((k, i) => (
        <li className="row reveal" key={k} style={{ ["--i" as string]: i + 2 }}>
          <strong>{NAMES[k]}</strong>
          {/* the word always carries the meaning; the icon and colour only reinforce it (spec 12) */}
          <span className={`st ${checks[k].status}`}><StatusIcon tone={checks[k].status} />{WORD[checks[k].status]}</span>
          <span className="why">{checks[k].reasons.length ? checks[k].reasons.map((r, j) => <div key={j}>{r}</div>) : <span className="muted">No detail.</span>}</span>
        </li>
      ))}
    </ol>
  );
}
