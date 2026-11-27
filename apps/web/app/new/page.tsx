"use client";
import { useEffect, useRef, useState } from "react";
import { confirmRegistration, parseRequestLink, prepareIssuance, registryInterface, type Issuance, type TypedRequest, QIE_MAINNET_CHAIN_ID } from "@bankable/core";
import { makeDual } from "../../lib/dual";
import { REGISTRY, registryConfigured, explorerTx } from "../../lib/config";
import { discoverQieWallet, ensureQieChain, requestAccount, sendRegister, walletChainId, type Discovered } from "../../lib/wallet";
import { Entries, Summary } from "../../components/LedgerView";
import { NonClaims } from "../../components/NonClaims";
import { CopyButton, HashRow, Plate } from "../../components/ui";
import { utc } from "../../lib/format";

type Phase = "idle" | "scanning" | "preview" | "registering" | "confirming" | "done";

export default function NewPage() {
  const [req, setReq] = useState<TypedRequest | null>(null); const [linkErr, setLinkErr] = useState("");
  const [wallet, setWallet] = useState<Discovered | null | undefined>(undefined);
  const [account, setAccount] = useState(""); const [chainOk, setChainOk] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle"); const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [issuance, setIssuance] = useState<Issuance | null>(null); const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const [tx, setTx] = useState(""); const [ack, setAck] = useState(false); const [recordId, setRecordId] = useState("");
  const frozen = useRef<Uint8Array | null>(null); const gen = useRef(0);

  // Parse the private link from the URL fragment (never sent to any server).
  useEffect(() => { try { setReq(parseRequestLink(window.location.hash)); } catch (e) { setLinkErr((e as Error).message); } }, []);
  useEffect(() => { discoverQieWallet().then(setWallet); }, []);

  // Any account or chain change invalidates the preview and any pending issuance (spec 10: stale UI).
  const invalidate = (why: string) => { gen.current++; frozen.current = null; setIssuance(null); setAck(false); setPhase((p) => (p === "done" ? p : "idle")); setMsg(why); };
  useEffect(() => {
    const p = wallet?.provider; if (!p?.on) return;
    const onAcc = (a: string[]) => { setAccount((a?.[0] ?? "").toLowerCase()); invalidate("Account changed: preview discarded."); };
    const onChain = (c: string) => { setChainOk(BigInt(c) === QIE_MAINNET_CHAIN_ID); invalidate("Network changed: preview discarded."); };
    p.on("accountsChanged", onAcc); p.on("chainChanged", onChain);
    return () => { p.removeListener?.("accountsChanged", onAcc); p.removeListener?.("chainChanged", onChain); };
  }, [wallet]);

  async function connect() {
    setErr("");
    try {
      const p = wallet!.provider; const a = await requestAccount(p); setAccount(a);
      await ensureQieChain(p); setChainOk((await walletChainId(p)) === QIE_MAINNET_CHAIN_ID);
    } catch (e) { setErr((e as Error).message); }
  }
  const accountMatches = !!req && account === req.expectedWallet;

  async function scan() {
    if (!req) return; const my = ++gen.current; setErr(""); setMsg(""); setPhase("scanning"); setProgress([0, 0]);
    try {
      const { currentProfile } = await import("../../lib/chain"); // the PDF renderer loads only when a scan starts
      const i = await prepareIssuance({ dual: makeDual(), request: req, registry: REGISTRY, profile: currentProfile, scan: { concurrency: 6, onProgress: (d, t) => my === gen.current && setProgress([d, t]) } });
      if (my !== gen.current) return; // state changed while scanning
      frozen.current = i.pdf; setIssuance(i); setPhase("preview");
    } catch (e) { if (my === gen.current) { setErr((e as Error).message); setPhase("idle"); } }
  }

  async function register() {
    if (!issuance || !req || !wallet) return; const my = gen.current; setErr("");
    try {
      // Re-check wallet state at the moment of approval; stale previews are never submitted.
      const p = wallet.provider; const cur = (await requestAccount(p));
      if (cur !== req.expectedWallet || (await walletChainId(p)) !== QIE_MAINNET_CHAIN_ID) { invalidate("Wallet account or network no longer matches. Please start again."); return; }
      setPhase("registering");
      const hash = await sendRegister(p, cur, issuance.args); setTx(hash);
      setPhase("confirming"); setMsg("Waiting for the receipt…");
      const dual = makeDual(); let receipt: any = null; const t0 = Date.now();
      while (!receipt && Date.now() - t0 < 5 * 60_000) { receipt = await dual.a.receipt(hash).catch(() => null); if (!receipt) await new Promise((r) => setTimeout(r, 3000)); }
      if (!receipt) throw new Error("No receipt after 5 minutes. The transaction may still land; do not release the file yet.");
      if (receipt.status !== "0x1") throw new Error("The registration transaction failed on-chain. No file is released.");
      if (receipt.to?.toLowerCase() !== REGISTRY) throw new Error("Receipt is for a different contract. No file is released.");
      const evt = receipt.logs.map((l: any) => { try { return registryInterface.parseLog(l); } catch { return null; } }).find((l: any) => l?.name === "StatementRegistered");
      if (!evt) throw new Error("Receipt has no StatementRegistered event. No file is released.");
      setMsg("Receipt confirmed. Waiting for a confirmed block, then reading the record back from both endpoints…");
      const res = await confirmRegistration({ dual, owner: cur, issuance, receiptBlock: BigInt(receipt.blockNumber) });
      if (my !== gen.current) { /* wallet changed after sending: the registration still stands; keep the file */ }
      setRecordId(res.id); setPhase("done"); setMsg(`Registered at block ${res.record.registeredBlock}. Read-back matched every submitted field on both endpoints.`);
    } catch (e) { setErr((e as Error).message); setPhase(issuance ? "preview" : "idle"); }
  }
  function download() {
    const bytes = frozen.current!; const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `bankable-${req!.expectedWallet.slice(2, 10)}-${req!.startUnix}-${req!.endUnix}.pdf`; a.click(); URL.revokeObjectURL(a.href);
  }

  if (!registryConfigured) return <><h1>Issue a statement</h1><p className="err">This deployment has no registry address configured.</p></>;
  const stepsDone: [string, boolean][] = [["Link", !!req], ["Connect", !!account && accountMatches && chainOk], ["Scan", !!issuance], ["Register", phase === "confirming" || phase === "done"], ["Download", phase === "done"]];
  const firstOpen = stepsDone.findIndex((x) => !x[1]);
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">02 · Wallet controller</div>
        <h1>Issue a <em>statement</em></h1>
        <p className="lede">Review exactly what will be published, register it once, and download the very bytes you registered.</p>
      </div>
      <ol className="steps" aria-label="Progress">
        {stepsDone.map(([label, done], i) => (
          <li key={label} className={done ? "done" : i === firstOpen ? "on" : ""} aria-current={i === firstOpen ? "step" : undefined}>{label}{done ? " ✓" : ""}</li>
        ))}
      </ol>

      {!req && !linkErr && <Plate folio="Waiting" title="No request link"><p>Open the private link the recipient sent you. It carries the wallet, the period and a secret that stays in your browser.</p><p className="muted">Have no link? <a href="/request">Create a request</a> (a self-request is possible but is not evidence of third-party involvement).</p></Plate>}
      {linkErr && <div className="callout warn" role="alert"><h3>This link can’t be used</h3><p>{`Request link problem: ${linkErr}. Ask the recipient for the original link.`}</p></div>}

      {req && (
        <Plate folio="The request" title="What was asked for" aside={<>UTC period<br />end exclusive</>}>
          <div className="tablewrap"><table className="facts"><tbody>
            <tr><th>Wallet</th><td className="mono">{req.expectedWallet}</td></tr>
            <tr><th>Period</th><td>{utc(req.startUnix)} to {utc(req.endUnix)}</td></tr>
            <tr><th>Token</th><td className="mono">QUSDC {req.token}</td></tr>
            <tr><th>Registry</th><td className="mono">{req.registry}</td></tr>
          </tbody></table></div>
        </Plate>
      )}

      {req && wallet === undefined && <p className="muted" role="status">Looking for QIE Wallet…</p>}
      {req && wallet === null && <div className="callout warn" role="alert"><h3>QIE Wallet not found</h3><p>Install or unlock QIE Wallet, then reload this page. Nothing is sent until you approve a transaction in the wallet.</p></div>}
      {req && wallet && !account && <div className="actions"><button className="primary" onClick={connect}>Connect {wallet.info.name}</button></div>}
      {account && <p className="mono muted">Connected: {account}</p>}
      {account && !accountMatches && req && <div className="callout warn" role="alert"><h3>Wrong account</h3><p>This wallet account is not the expected wallet. Switch to <span className="mono">{req.expectedWallet}</span> in QIE Wallet.</p></div>}
      {account && !chainOk && <div className="callout warn"><h3>Wrong network</h3><p>The wallet is not on QIE mainnet (1990).</p><button onClick={connect}>Switch network</button></div>}
      {accountMatches && chainOk && phase === "idle" && <div className="actions"><button className="primary" onClick={scan}>Scan period and preview ledger</button></div>}

      {phase === "scanning" && (
        <Plate folio="In progress" title="Reading both endpoints">
          <div aria-live="polite"><p className="progress-line">{progress[1] ? `${progress[0]}/${progress[1]} log queries` : "deriving block range"}</p><progress value={progress[0]} max={progress[1] || 1} aria-label="Scan progress" /></div>
          <p className="muted" style={{ fontSize: 13 }}>Both endpoints are queried independently and compared before anything is shown. A month takes about two minutes.</p>
        </Plate>
      )}
      {msg && <p className="muted" role="status">{msg}</p>}
      {err && <div className="callout warn" role="alert"><h3>Something stopped this</h3><p className="err">{err}</p></div>}

      {issuance && (phase === "preview" || phase === "registering" || phase === "confirming" || phase === "done") && (
        <>
          <h2>Preview</h2>
          <Plate folio="Statement preview" title="This is what the PDF will contain" aside={<>{utc(issuance.data.startUnix)}<br />to {utc(issuance.data.endUnix)}</>}>
            <Summary d={issuance.data} /><Entries d={issuance.data} />
          </Plate>
          <p className="mono muted">Confirmed reference block {String(issuance.reference.number)} ({utc(issuance.reference.timestamp)}). File hash (SHA-256) {issuance.pdfHash} <CopyButton value={issuance.pdfHash} label="file hash" /></p>
          {phase === "preview" && (
            <div className="callout">
              <h3>Before you register</h3>
              <p style={{ fontSize: 14.5 }}>Registering publishes on QIE mainnet: your address, the period, the block range, the commitments, the issuance salt and the renderer profile, and the registration and any revocation block. It does <em>not</em> publish balances, the document, the recipient's identity or the secret nonce. Public records reveal that this address was reported on for this period. Revocation withdraws an attestation; it does not make past transfers untrue.</p>
              <label style={{ fontWeight: "normal", textTransform: "none", letterSpacing: 0, fontSize: 15, color: "var(--ink)", display: "flex", gap: 10, alignItems: "flex-start" }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 4 }} /> <span>I understand and approve one registration transaction for this exact file.</span></label>
              <div className="actions"><button className="primary" disabled={!ack} onClick={register}>Register on QIE mainnet</button></div>
            </div>
          )}
          {(phase === "registering" || phase === "confirming") && <p className="muted" role="status">{phase === "registering" ? "Confirm the transaction in your wallet…" : "Registered. Waiting for confirmation on both endpoints before the file is released."}</p>}
          {tx && <p className="mono">Transaction <a href={explorerTx(tx)}>{tx}</a></p>}
          {phase === "done" && (
            <div className="callout done" role="status">
              <h3>Registered and read back</h3>
              <p className="okmsg">Registered and read back. The download is released.</p>
              <HashRow label="Record id" value={recordId} />
              <div className="actions"><button className="primary" onClick={download}>Download the exact file</button></div>
              <ol>
                <li>Send the PDF to the recipient. These are the very bytes that were registered: do not re-save or print-to-PDF, because any change breaks verification.</li>
                <li>They verify it on the Verify page with their original request link.</li>
                <li>If you ever need to withdraw it, open the file on the Verify page and revoke the record from this wallet.</li>
              </ol>
            </div>
          )}
        </>
      )}
      <NonClaims />
    </>
  );
}
