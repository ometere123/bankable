"use client";
import { useState } from "react";
import { createRequest, inclusiveDaysToPeriod, requestLink, resolveReference, MAX_PERIOD_SECONDS } from "@bankable/core";
import { makeDual } from "../../lib/dual";
import { REGISTRY, registryConfigured } from "../../lib/config";
import { CopyButton, Plate } from "../../components/ui";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Presets are whole UTC days ending yesterday; the chain, not this device's clock, still decides whether the period is completed. */
function preset(days: number): [string, string] { const y = new Date(Date.now() - 86400_000); const f = new Date(y.getTime() - (days - 1) * 86400_000); return [iso(f), iso(y)]; }

export default function RequestPage() {
  const [wallet, setWallet] = useState(""); const [touched, setTouched] = useState(false); const [first, setFirst] = useState(""); const [last, setLast] = useState("");
  const [link, setLink] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const valid = ADDRESS.test(wallet.trim());

  async function create() {
    setErr(""); setLink(""); setBusy(true);
    try {
      if (!registryConfigured) throw new Error("This deployment has no registry address configured.");
      const { startUnix, endUnix } = inclusiveDaysToPeriod(first, last);
      if (endUnix - startUnix > MAX_PERIOD_SECONDS) throw new Error(`Period too long: at most ${MAX_PERIOD_SECONDS / 86400n} days.`);
      // "completed period" is judged against chain time (a confirmed reference block), not this device's clock.
      const ref = await resolveReference(makeDual());
      const req = createRequest({ registry: REGISTRY, expectedWallet: wallet, startUnix, endUnix, nowUnix: ref.timestamp });
      setLink(requestLink(window.location.origin, "/new", req));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">01 · Recipient</div>
        <h1>Create a <em>request</em></h1>
        <p className="lede">No account needed. The link fixes the expected wallet, the period and a secret that lives only in the URL fragment: it is never sent to a server and never appears in the PDF or on-chain.</p>
      </div>
      <div className="split">
        <div className="side">
          <Plate folio="Request" title="Expected wallet and period">
            <div className="field">
              <label htmlFor="w">Expected wallet (QIE address)</label>
              <input id="w" type="text" value={wallet} onChange={(e) => setWallet(e.target.value)} onBlur={() => setTouched(true)} placeholder="0x…" autoComplete="off" spellCheck={false} aria-invalid={touched && wallet !== "" && !valid} aria-describedby="w-help" />
              <div id="w-help" className={touched && wallet !== "" && !valid ? "bad" : "hint"} role={touched && wallet !== "" && !valid ? "alert" : undefined}>{touched && wallet !== "" && !valid ? "Enter a full 42-character 0x address." : "The wallet whose QUSDC history you need."}</div>
            </div>
            <div className="field">
              <label htmlFor="f">First day (UTC, inclusive)</label>
              <input id="f" type="date" value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="l">Last day (UTC, inclusive)</label>
              <input id="l" type="date" value={last} onChange={(e) => setLast(e.target.value)} />
              <div className="chips" role="group" aria-label="Quick periods, ending yesterday (UTC)">
                {([["Yesterday", 1], ["Last 7 days", 7], ["Last 30 days", 30]] as const).map(([l, n]) => <button type="button" key={l} onClick={() => { const [f, t] = preset(n); setFirst(f); setLast(t); }}>{l}</button>)}
              </div>
              <div className="hint">The period ends at the next UTC midnight after the last day. It must be completed and at most {String(MAX_PERIOD_SECONDS / 86400n)} days.</div>
            </div>
            <div className="actions"><button className="primary" onClick={create} disabled={busy || !valid || !first || !last}>{busy ? "Checking chain time…" : "Create private link"}</button></div>
            {err && <p className="err" role="alert" style={{ marginTop: 12 }}>{err}</p>}
          </Plate>
        </div>
        <div className="main">
          {link ? (
            <div className="callout done reveal" role="status">
              <h3>Your private link</h3>
              <p>Send this to the wallet controller. <strong>Keep your own copy.</strong></p>
              <div className="copyline"><span className="mono">{link}</span><CopyButton value={link} label="request link" /></div>
              <p className="muted" style={{ fontSize: 13.5, marginTop: 12 }}>You will need this same link later on the Verify page to prove the statement answers this request. A leaked link lets another party answer it; it does not identify you.</p>
            </div>
          ) : (
            <Plate folio="What happens next" title="Three steps">
              <ol className="explain">
                <li><h4>You send the link</h4><p>To the person who controls the wallet. They need nothing but QIE Wallet.</p></li>
                <li><h4>They review and register</h4><p>They see the reconciled ledger for exactly this period, approve one transaction, and download the file.</p></li>
                <li><h4>You verify</h4><p>Drop the file on the Verify page with this link. Four checks decide the result.</p></li>
              </ol>
            </Plate>
          )}
        </div>
      </div>
    </>
  );
}
