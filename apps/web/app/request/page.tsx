"use client";
import { useState } from "react";
import { createRequest, inclusiveDaysToPeriod, requestLink, resolveReference, MAX_PERIOD_SECONDS } from "@bankable/core";
import { makeDual } from "../../lib/chain";
import { REGISTRY, registryConfigured } from "../../lib/config";

export default function RequestPage() {
  const [wallet, setWallet] = useState(""); const [first, setFirst] = useState(""); const [last, setLast] = useState("");
  const [link, setLink] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [copied, setCopied] = useState(false);

  async function create() {
    setErr(""); setLink(""); setCopied(false); setBusy(true);
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
      <h1>Create a request</h1>
      <p className="muted">No account needed. The link fixes the expected wallet, the period and a secret nonce. The nonce lives only in the URL fragment: it is never sent to a server and never appears in the PDF or on-chain. A self-request is possible but is not evidence of third-party involvement.</p>
      <label htmlFor="w">Expected wallet (QIE address)</label>
      <input id="w" type="text" value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
      <label htmlFor="f">First day (UTC, inclusive)</label>
      <input id="f" type="date" value={first} onChange={(e) => setFirst(e.target.value)} />
      <label htmlFor="l">Last day (UTC, inclusive)</label>
      <input id="l" type="date" value={last} onChange={(e) => setLast(e.target.value)} />
      <p className="muted" style={{ fontSize: 13 }}>The period ends at the next UTC midnight after the last day. It must be completed and at most {String(MAX_PERIOD_SECONDS / 86400n)} days.</p>
      <button onClick={create} disabled={busy || !wallet || !first || !last}>{busy ? "Checking chain time…" : "Create private link"}</button>
      {err && <p className="err" role="alert">{err}</p>}
      {link && (
        <div className="box">
          <strong>Send this link to the wallet controller. Keep your own copy.</strong>
          <p className="mono">{link}</p>
          <button onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</button>
          <p className="muted" style={{ fontSize: 13 }}>You will need this same link later on the Verify page to prove the statement answers this request. A leaked link lets another party answer it; it does not identify the recipient.</p>
        </div>
      )}
    </>
  );
}
