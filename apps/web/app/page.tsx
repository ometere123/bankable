import { NonClaims } from "../components/NonClaims";
export default function Home() {
  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">QUSDC statements on QIE</div>
          <h1>A statement anyone can check, <em>byte for byte.</em></h1>
          <p className="lede">
            A recipient asks for the QUSDC history of one address over a fixed UTC period. The address owner registers the file on QIE mainnet.
            Drop it on the Verify page and learn whether it is the exact canonical rendering of on-chain data, whether that wallet authorised it
            for that request, and whether it is still valid.
          </p>
          <p><a className="btn" href="/request">Create a request →</a><a className="btn secondary" href="/verify">Verify a file</a></p>
        </div>
        <aside className="card specimen" aria-label="Illustrative specimen">
          <header><div><span className="folio">Specimen · illustrative data</span><h3>Statement checks</h3></div><div className="period">UTC period<br />fixed in the request</div></header>
          <div className="line"><span>Issued · registered by the expected wallet</span><b>PASS</b></div>
          <div className="line"><span>Content · bytes equal the chain-derived file</span><b>PASS</b></div>
          <div className="line"><span>Status · not revoked at a confirmed block</span><b>PASS</b></div>
          <div className="line"><span>Request · answers the original link</span><b>PASS</b></div>
          <div className="foot"><div><span className="folio">Opening + in − out</span><div className="cap">= closing, on two endpoints</div></div><span className="stamp">Specimen<br />Not a record</span></div>
        </aside>
      </section>
      <div className="cards">
        <div className="card"><span className="n">01 · Recipient</span><h3>Request</h3><p>Enter the expected wallet and a completed UTC period. You get a private link; its secret stays in the URL fragment.</p><a className="go" href="/request">Create a request →</a></div>
        <div className="card"><span className="n">02 · Wallet controller</span><h3>Issue</h3><p>Open the link, connect QIE Wallet, review the reconciled ledger, register once, download the exact file.</p><a className="go" href="/new">Open an issue link →</a></div>
        <div className="card"><span className="n">03 · Anyone</span><h3>Verify</h3><p>Drop the file, name the owner, optionally add your request link. Four checks, one verdict, no wallet needed.</p><a className="go" href="/verify">Verify a file →</a></div>
      </div>
      <h2>Scope and <em>limits</em></h2>
      <p style={{ fontSize: 14 }}>One QIE address, one QUSDC token, one completed UTC interval of at most 31 days and 2,000 transfers. No custody, no bank account, no credit scoring, no income classification, no fiat valuation, no KYC.</p>
      <NonClaims />
    </>
  );
}
