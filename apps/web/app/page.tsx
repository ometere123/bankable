import { NonClaims } from "../components/NonClaims";
export default function Home() {
  return (
    <>
      <h1>Bankable</h1>
      <p>
        A recipient requests a statement of one QIE address's QUSDC history for a fixed UTC period. The address owner registers it on QIE
        mainnet. Anyone can drop the file on the Verify page and learn whether it is the canonical rendering of on-chain QUSDC data for the
        expected wallet, whether that wallet authorised it for that request, and whether it is still valid.
      </p>
      <h2>Journeys</h2>
      <ol>
        <li><a href="/request">Request</a>: enter the expected wallet and a completed UTC period; get a private link (the secret stays in the URL fragment).</li>
        <li><a href="/new">Issue</a>: the wallet controller opens the link, connects QIE Wallet, previews the reconciled ledger, registers once, downloads the exact file.</li>
        <li><a href="/verify">Verify</a>: drop the file, give the owner, optionally the request link. Four checks, one verdict.</li>
      </ol>
      <h2>Limits</h2>
      <p style={{ fontSize: 14 }}>One QIE address, one QUSDC token, one completed UTC interval of at most 31 days and 2,000 transfers. No custody, no bank account, no credit scoring, no income classification, no fiat valuation, no KYC.</p>
      <NonClaims />
    </>
  );
}
