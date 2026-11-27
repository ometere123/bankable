"use client";
import { useEffect, useRef, useState } from "react";
import { MAX_PDF_BYTES, verifyStatement, type VerifyResult, ledgerToCsv, extractInWorker, lookupQieId, makeMcpCallTool, sha256Hex, type QieIdStatus } from "@bankable/core";
import { makeDual } from "../../lib/dual";
import { REGISTRY, registryConfigured, explorerAddress, explorerBlock } from "../../lib/config";
import { discoverQieWallet, ensureQieChain, requestAccount, sendRevoke, type Discovered } from "../../lib/wallet";
import { CheckRows, Guide, Verdict } from "../../components/CheckRows";
import { Entries, Summary } from "../../components/LedgerView";
import { NonClaims } from "../../components/NonClaims";
import { RegistryStatus } from "../../components/RegistryStatus";
import { HashRow, Plate, SkeletonRows, StatusIcon } from "../../components/ui";
import { utc } from "../../lib/format";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);

function QieIdLine({ address }: { address: string }) {
  const [st, setSt] = useState<QieIdStatus | "loading">("loading");
  useEffect(() => {
    let alive = true; let close: (() => Promise<void>) | undefined;
    (async () => {
      try { const m = await makeMcpCallTool(); close = m.close; const r = await lookupQieId(address, m.callTool); if (alive) setSt(r); }
      catch (e) { if (alive) setSt({ status: "unavailable", reason: (e as Error).message.slice(0, 120) }); }
    })();
    return () => { alive = false; void close?.().catch(() => {}); };
  }, [address]);
  return (
    <p className="muted" style={{ fontSize: 13 }}>
      QIE ID (current address context only; not historical identity, not KYC, not part of the verified data):{" "}
      {st === "loading" ? "looking up…" : st.status === "unavailable" ? <>lookup unavailable ({st.reason}). Financial verification is unaffected.</> : st.name ? <strong>{st.name}</strong> : "none set"}
    </p>
  );
}
function Explainer() {
  const items: [string, string][] = [
    ["Issued", "The wallet you name registered this exact file on QIE mainnet. Both RPC endpoints must agree on the record."],
    ["Content", "The registry's block range and dates are used to rebuild the QUSDC ledger from chain data, render the statement again, and compare it byte for byte with your file."],
    ["Status", "The record has not been revoked as of a recently confirmed block. A stale result is never shown as current."],
    ["Request", "If you give the link you created, its wallet, token, chain, registry, dates and secret must reproduce the record's request id. No link means this check is not run."],
  ];
  return (
    <Plate folio="Method" title="How a result is reached">
      <ol className="explain">{items.map(([h, p]) => <li key={h}><h4>{h}</h4><p>{p}</p></li>)}</ol>
      <div className="legend" aria-label="Possible outcomes">
        <div><StatusIcon tone="pass" /><span><strong>Verified</strong>: every required check passed.</span></div>
        <div><StatusIcon tone="fail" /><span><strong>Failed</strong>: a contradiction was established.</span></div>
        <div><StatusIcon tone="inconclusive" /><span><strong>Inconclusive</strong>: evidence unavailable. Never a pass.</span></div>
        <div><StatusIcon tone="not-checked" /><span><strong>Not checked</strong>: no file, or no link supplied.</span></div>
      </div>
    </Plate>
  );
}

export default function VerifyPage() {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array; hash?: string } | null>(null); const [over, setOver] = useState(false);
  const [owner, setOwner] = useState(""); const [ownerTouched, setOwnerTouched] = useState(false); const [link, setLink] = useState(""); const [qrInfo, setQrInfo] = useState("");
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [res, setRes] = useState<VerifyResult | null>(null); const [err, setErr] = useState("");
  const [wallet, setWallet] = useState<Discovered | null>(null); const [account, setAccount] = useState(""); const [revMsg, setRevMsg] = useState("");
  const input = useRef<HTMLInputElement>(null); const resultRef = useRef<HTMLDivElement>(null);
  const ownerValid = ADDRESS.test(owner.trim());

  // QR locator or original request link in the fragment: prefill; the document's own registry/RPC claims are never trusted.
  useEffect(() => {
    const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (p.get("owner")) { setOwner(p.get("owner")!); if (p.get("registry") && p.get("registry")!.toLowerCase() !== REGISTRY) setQrInfo("The QR names a different registry than this verifier's configured one. It is ignored."); }
    if (p.get("nonce")) setLink(window.location.href);
  }, []);
  // Move focus to the result when it arrives so keyboard and screen-reader users land on the verdict.
  useEffect(() => { if (res) resultRef.current?.focus(); }, [res]);

  async function load(f: File | undefined) {
    setRes(null); setErr("");
    if (!f) return;
    if (f.size > MAX_PDF_BYTES) { setFile(null); setErr(`File is ${f.size} bytes; the supported maximum is ${MAX_PDF_BYTES}.`); return; }
    const bytes = new Uint8Array(await f.arrayBuffer()); setFile({ name: f.name, bytes });
    void sha256Hex(bytes).then((hash) => setFile((cur) => (cur && cur.bytes === bytes ? { ...cur, hash } : cur)));
    // Tier 2: pre-fill the owner from the PDF's metadata locator, in an isolated worker with a hard timeout. Unauthenticated: only a hint.
    if (!owner) {
      const loc = await extractInWorker(() => new Worker(new URL("../../workers/locator.worker.ts", import.meta.url), { type: "module" }) as any, bytes, 2000);
      // Functional update: never overwrite an owner the user typed while the worker was running (that race hid a forged file's real owner).
      if (loc) setOwner((cur) => { if (cur) return cur; setQrInfo("Owner pre-filled from the file's metadata locator. This is an unauthenticated hint: the checks below decide."); return loc.owner; });
    }
  }
  async function run() {
    setBusy(true); setErr(""); setRes(null); setRevMsg(""); setProgress([0, 0]);
    try {
      const { profiles } = await import("../../lib/chain"); // the PDF renderer loads only when a check actually runs
      const r = await verifyStatement({ file: file?.bytes, owner, requestLink: link.trim() || undefined, dual: makeDual(), profiles, registry: REGISTRY, scan: { concurrency: 6, onProgress: (d, t) => setProgress([d, t]) } });
      setRes(r);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function connect() { try { const w = wallet ?? (await discoverQieWallet()); if (!w) { setErr("QIE Wallet not found."); return; } setWallet(w); setAccount(await requestAccount(w.provider)); } catch (e) { setErr((e as Error).message); } }
  async function revoke() {
    if (!res?.record || !wallet) return; setRevMsg("");
    try {
      await ensureQieChain(wallet.provider);
      const hash = await sendRevoke(wallet.provider, account, res.recordId!); setRevMsg(`Revocation sent: ${hash}. Waiting for the receipt…`);
      const dual = makeDual(); let rc: any = null; const t0 = Date.now();
      while (!rc && Date.now() - t0 < 5 * 60_000) { rc = await dual.a.receipt(hash).catch(() => null); if (!rc) await new Promise((r) => setTimeout(r, 3000)); }
      if (!rc || rc.status !== "0x1") throw new Error("Revocation did not succeed on-chain.");
      setRevMsg(`Revoked at block ${parseInt(rc.blockNumber, 16)} (tx ${hash}). Status shows it after the confirmation buffer (about a minute); run the check again.`);
    } catch (e) { setRevMsg(`Revocation failed: ${(e as Error).message}`); }
  }

  if (!registryConfigured) return <><h1>Verify</h1><p className="err">This deployment has no registry address configured.</p></>;
  const canRevoke = !!res?.record && res.record.revokedBlock === 0n && account !== "" && account === res.record.owner;
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">03 · Anyone, no wallet needed</div>
        <h1>Verify a <em>statement</em></h1>
        <p className="lede">The file is hashed in your browser. It is never uploaded and never parsed. Your request link stays here too; only chain reads leave the page.</p>
      </div>

      <div className="split">
        <div className="side">
          <Plate folio="Exhibit" title="What to check">
            <div className={`drop${over ? " over" : ""}`} role="button" tabIndex={0} aria-label="Choose the PDF statement to verify"
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]); }}
              onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}>
              {file ? <strong>Drop a different PDF to replace it</strong> : <><strong>Drop the PDF here</strong>, or click to choose<small>PDF only, up to {size(MAX_PDF_BYTES)}</small></>}
              <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => load(e.target.files?.[0])} />
            </div>
            {file && (
              <div className="filecard" aria-live="polite">
                <div className="ic" aria-hidden="true">PDF</div>
                <div><div className="nm">{file.name}</div><div className="meta">{size(file.bytes.length)} · SHA-256 {file.hash ? `${file.hash.slice(0, 18)}…${file.hash.slice(-6)}` : "hashing…"}</div></div>
                <button type="button" className="secondary" onClick={() => { setFile(null); setRes(null); }} aria-label="Remove the selected file">Remove</button>
              </div>
            )}
            <div className="field">
              <label htmlFor="o">Owner</label>
              <input id="o" type="text" value={owner} onChange={(e) => setOwner(e.target.value)} onBlur={() => setOwnerTouched(true)} placeholder="0x…" spellCheck={false} autoComplete="off"
                aria-invalid={ownerTouched && owner !== "" && !ownerValid} aria-describedby="o-help" />
              <div id="o-help" className={ownerTouched && owner !== "" && !ownerValid ? "bad" : "hint"} role={ownerTouched && owner !== "" && !ownerValid ? "alert" : undefined}>
                {ownerTouched && owner !== "" && !ownerValid ? "Enter a full 42-character 0x address." : "The wallet address on page one of the PDF, or from its QR link."}
              </div>
              {qrInfo && <p className="hint" role="status">{qrInfo}</p>}
            </div>
            <div className="field">
              <label htmlFor="r">Original request link <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
              <textarea id="r" rows={3} value={link} onChange={(e) => setLink(e.target.value)} placeholder="Your private request link. Without it, the Request check is 'Not checked'." spellCheck={false} />
              <div className="hint">Needed to show the file answers your specific request. It never leaves this browser.</div>
            </div>
            <div className="actions">
              <button className="primary" onClick={run} disabled={busy || !ownerValid}>{busy ? "Checking…" : file ? "Verify" : "Look up locator (no file)"}</button>
            </div>
            {err && <p className="err" role="alert" style={{ marginTop: 12 }}>{err}</p>}
          </Plate>
          <RegistryStatus compact />
        </div>

        <div className="main" aria-busy={busy}>
          {busy && (
            <Plate folio="In progress" title="Reading the chain">
              <SkeletonRows rows={4} />
              <p className="progress-line" role="status">{progress[1] ? `Ledger queries ${progress[0]} of ${progress[1]}, on both endpoints` : "Resolving a confirmed block and the registry record…"}</p>
              <progress value={progress[0]} max={progress[1] || 1} aria-label="Ledger query progress" />
            </Plate>
          )}

          {!busy && !res && <Explainer />}

          {!busy && res && (
            <div className="result" ref={resultRef} tabIndex={-1} aria-label={`Verification result: ${res.overall}`}>
              <Verdict overall={res.overall} />
              <Guide overall={res.overall} onRetry={run} />
              {res.overall === "not-checked-qr-only" ? (
                <p>Locator for owner <span className="mono">{res.owner}</span>. Supply the PDF file to check it.</p>
              ) : (
                <>
                  <CheckRows checks={res.checks} />
                  {res.checkedAt && <p className="mono muted" style={{ marginTop: 12 }}>Checked at confirmed block <a href={explorerBlock(res.checkedAt.number)}>{String(res.checkedAt.number)}</a> ({utc(res.checkedAt.timestamp)}) on both endpoints. Valid as of this block, not a promise of future validity.</p>}
                  <details className="evidence">
                    <summary>Evidence</summary>
                    <div className="body">
                      {res.pdfHash && <HashRow label="File SHA-256" value={res.pdfHash} />}
                      {res.recordId && <HashRow label="Record id" value={res.recordId} />}
                      {res.record && <HashRow label="Registered by" value={res.record.owner} href={explorerAddress(res.record.owner)} />}
                      {res.record && <div className="hashrow"><span className="k">Registered at</span><span className="v mono"><a href={explorerBlock(res.record.registeredBlock)}>block {String(res.record.registeredBlock)}</a>{res.record.revokedBlock !== 0n && <> · <span className="fail">revoked at block {String(res.record.revokedBlock)}</span></>}</span><span /></div>}
                      {res.record && <HashRow label="Data hash" value={res.record.dataHash} />}
                    </div>
                  </details>
                  {res.owner && <QieIdLine address={res.owner} />}
                  {res.ledger && (
                    <Plate folio="Chain-derived ledger" title="Statement" aside={<>{utc(res.ledger.data.startUnix)}<br />to {utc(res.ledger.data.endUnix)}</>}>
                      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Shown whenever the reconstruction itself succeeded, whatever the other checks say. It comes from QIE RPC data, never from the uploaded file's text.</p>
                      <Summary d={res.ledger.data} /><Entries d={res.ledger.data} />
                      {res.checks.content.status === "pass" ? (
                        <div className="actions"><button className="secondary" onClick={() => {
                          const blob = new Blob([ledgerToCsv(res.ledger!.data)], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a");
                          a.href = URL.createObjectURL(blob); a.download = `bankable-ledger-${res.owner.slice(2, 10)}-${res.ledger!.data.startUnix}-${res.ledger!.data.endUnix}.csv`; a.click(); URL.revokeObjectURL(a.href);
                        }}>Download ledger as CSV (QUSDC token units)</button></div>
                      ) : <p className="muted" style={{ fontSize: 13 }}>CSV export is offered only when the Content check passes.</p>}
                    </Plate>
                  )}
                  {res.record && (
                    <div className="callout">
                      <h3>Manage this record</h3>
                      {!account ? <button className="secondary" onClick={connect}>Connect wallet to manage this record</button> : <p className="mono">Connected: {account}</p>}
                      {canRevoke && <button onClick={revoke}>Revoke this record</button>}
                      {account && !canRevoke && <p className="muted" style={{ fontSize: 13 }}>Only the record owner can revoke, and only while it is active.</p>}
                      {revMsg && <p className="mono" role="status">{revMsg}</p>}
                      <p className="muted" style={{ fontSize: 13 }}>To replace a statement for the same request, the original controller issues again from the same link: a fresh salt gives a fresh record. The old record stays valid until it is revoked explicitly.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <NonClaims />
    </>
  );
}
