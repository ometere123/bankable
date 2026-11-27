import { NonClaims } from "../components/NonClaims";
export default function Home() {
  return (
    <>
      <h1>Bankable</h1>
      <p className="lede">
        A recipient requests a statement of one QIE address's QUSDC history for a fixed UTC period. The address owner registers it on QIE
        mainnet. Anyone can drop the file on the Verify page and learn whether it is the canonical rendering of on-chain QUSDC data for the
        expected wallet, whether that wallet authorised it for that request, and whether it is still valid.
      </p>
      <div className="cards">
        <div className="card"><span className="n">1 · Recipient</span><h3>Request</h3><p className="muted">Enter the expected wallet and a completed UTC period. You get a private link; its secret stays in the URL fragment.</p><a className="go" href="/request">Create a request →</a></div>
        <div className="card"><span className="n">2 · Wallet controller</span><h3>Issue</h3><p className="muted">Open the link, connect QIE Wallet, review the reconciled ledger, register once, download the exact file.</p><a className="go" href="/new">Open an issue link →</a></div>
        <div className="card"><span className="n">3 · Anyone</span><h3>Verify</h3><p className="muted">Drop the file, name the owner, optionally add your request link. Four checks, one verdict, no wallet needed.</p><a className="go" href="/verify">Verify a file →</a></div>
      </div>
      <h2>Limits</h2>
      <p style={{ fontSize: 14 }}>One QIE address, one QUSDC token, one completed UTC interval of at most 31 days and 2,000 transfers. No custody, no bank account, no credit scoring, no income classification, no fiat valuation, no KYC.</p>
      <NonClaims />
    </>
  );
}
