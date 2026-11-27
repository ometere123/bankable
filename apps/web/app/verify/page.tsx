"use client";
import { useEffect, useRef, useState } from "react";
import { MAX_PDF_BYTES, verifyStatement, type VerifyResult, ledgerToCsv, extractInWorker, lookupQieId, makeMcpCallTool, explorerVerification, type QieIdStatus, type ExplorerStatus } from "@bankable/core";
import { makeDual, profiles } from "../../lib/chain";
import { REGISTRY, registryConfigured, explorerAddress, explorerBlock } from "../../lib/config";
import { discoverQieWallet, ensureQieChain, requestAccount, sendRevoke, type Discovered } from "../../lib/wallet";
import { CheckRows, Verdict } from "../../components/CheckRows";
import { Entries, Summary } from "../../components/LedgerView";
import { NonClaims } from "../../components/NonClaims";
import { utc } from "../../lib/format";

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
function RegistryStatus() {
  const [st, setSt] = useState<ExplorerStatus | null>(null);
  useEffect(() => { if (registryConfigured) explorerVerification(REGISTRY).then(setSt); }, []);
  if (!registryConfigured) return null;
  return (
    <p className="muted mono" style={{ fontSize: 12 }}>
      Registry <a href={explorerAddress(REGISTRY)}>{REGISTRY}</a>. Explorer source verification:{" "}
      {!st ? "checking…" : st.status === "verified" ? `verified (${st.fullyVerified ? "full" : "partial"} match, ${st.compiler})` : st.status === "not-verified" ? "NOT verified on the explorer" : `unknown (${st.reason})`}
    </p>
  );
}

export default function VerifyPage() {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null); const [over, setOver] = useState(false);
  const [owner, setOwner] = useState(""); const [link, setLink] = useState(""); const [qrInfo, setQrInfo] = useState("");
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [res, setRes] = useState<VerifyResult | null>(null); const [err, setErr] = useState("");
  const [wallet, setWallet] = useState<Discovered | null>(null); const [account, setAccount] = useState(""); const [revMsg, setRevMsg] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // QR locator or original request link in the fragment: prefill; the document's own registry/RPC claims are never trusted.
  useEffect(() => {
    const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (p.get("owner")) { setOwner(p.get("owner")!); if (p.get("registry") && p.get("registry")!.toLowerCase() !== REGISTRY) setQrInfo("The QR names a different registry than this verifier's configured one. It is ignored."); }
    if (p.get("nonce")) setLink(window.location.href);
  }, []);

  async function load(f: File | undefined) {
    setRes(null); setErr("");
    if (!f) return;
    if (f.size > MAX_PDF_BYTES) { setFile(null); setErr(`File is ${f.size} bytes; the supported maximum is ${MAX_PDF_BYTES}.`); return; }
    const bytes = new Uint8Array(await f.arrayBuffer()); setFile({ name: f.name, bytes });
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
      <h1>Verify a statement</h1>
      <p className="muted">The file is hashed in your browser; it is never uploaded and never parsed. The request link stays in your browser; only chain reads go to the QIE endpoints.</p>
      <div className={`drop${over ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]); }} onClick={() => input.current?.click()}>
        {file ? <span className="mono">{file.name} ({file.bytes.length} bytes)</span> : "Drop the PDF here, or click to choose"}
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => load(e.target.files?.[0])} />
      </div>
      <label htmlFor="o">Owner (wallet address on page one of the PDF, or from the QR link)</label>
      <input id="o" type="text" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" />
      {qrInfo && <p className="muted">{qrInfo}</p>}
      <label htmlFor="r">Original request link (optional)</label>
      <textarea id="r" rows={2} value={link} onChange={(e) => setLink(e.target.value)} placeholder="Your private request link. Without it, the Request check is 'Not checked'." spellCheck={false} />
      <button onClick={run} disabled={busy || !owner}>{busy ? "Checking…" : file ? "Verify" : "Look up locator (no file)"}</button>
      {busy && <div><p className="muted">{progress[1] ? `Rebuilding ledger from both endpoints: ${progress[0]}/${progress[1]}` : "Reading the registry and chain…"}</p><progress value={progress[0]} max={progress[1] || 1} /></div>}
      {err && <p className="err" role="alert">{err}</p>}

      {res && (
        <>
          <Verdict overall={res.overall} />
          {res.overall === "not-checked-qr-only" ? (
            <p>Locator for owner <span className="mono">{res.owner}</span>. Supply the PDF file to check it.</p>
          ) : (
            <>
              <CheckRows checks={res.checks} />
              {res.checkedAt && <p className="mono muted">Checked at confirmed block <a href={explorerBlock(res.checkedAt.number)}>{String(res.checkedAt.number)}</a> ({utc(res.checkedAt.timestamp)}) on both endpoints. Valid as of this block, not a promise of future validity.</p>}
              {res.pdfHash && <p className="mono muted">File SHA-256 {res.pdfHash}<br />Record id {res.recordId}</p>}
              {res.record && (
                <p className="mono muted">Registered by <a href={explorerAddress(res.record.owner)}>{res.record.owner}</a> at block <a href={explorerBlock(res.record.registeredBlock)}>{String(res.record.registeredBlock)}</a>
                  {res.record.revokedBlock !== 0n && <> · <span className="fail">revoked at block {String(res.record.revokedBlock)}</span></>}</p>
              )}
              {res.owner && <QieIdLine address={res.owner} />}
              {res.ledger && (
                <>
                  <h2>Chain-derived ledger</h2>
                  <p className="muted" style={{ fontSize: 13 }}>Shown whenever the reconstruction itself succeeded, whatever the other checks say. It comes from QIE RPC data, never from the uploaded file's text.</p>
                  <Summary d={res.ledger.data} /><Entries d={res.ledger.data} />
                  {res.checks.content.status === "pass" ? (
                    <button className="secondary" onClick={() => {
                      const blob = new Blob([ledgerToCsv(res.ledger!.data)], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob); a.download = `bankable-ledger-${res.owner.slice(2, 10)}-${res.ledger!.data.startUnix}-${res.ledger!.data.endUnix}.csv`; a.click(); URL.revokeObjectURL(a.href);
                    }}>Download ledger as CSV (QUSDC token units)</button>
                  ) : <p className="muted" style={{ fontSize: 13 }}>CSV export is offered only when the Content check passes.</p>}
                </>
              )}
              {res.record && (
                <div className="box">
                  {!account ? <button className="secondary" onClick={connect}>Connect wallet to manage this record</button> : <p className="mono">Connected: {account}</p>}
                  {canRevoke && <button onClick={revoke}>Revoke this record</button>}
                  {account && !canRevoke && <p className="muted" style={{ fontSize: 13 }}>Only the record owner can revoke, and only while it is active.</p>}
                  {revMsg && <p className="mono">{revMsg}</p>}
                  <p className="muted" style={{ fontSize: 13 }}>To replace a statement for the same request, the original controller issues again from the same link: a fresh salt gives a fresh record. The old record stays valid until it is revoked explicitly.</p>
                </div>
              )}
            </>
          )}
        </>
      )}
      <RegistryStatus />
      <NonClaims />
    </>
  );
}
