import type { Metadata } from "next";
import { NonClaims } from "../../components/NonClaims";

export const metadata: Metadata = { title: "Security & privacy · Bankable", description: "What Bankable publishes, what it never sees, what it checks, and what you still have to trust." };

const CONTROLS: [string, string][] = [
  ["A malicious PDF", "The file’s hash is computed first, under a measured size limit. It is never rendered, executed or parsed as authority. The optional metadata hint is read by a bounded, schema-strict scan in an isolated worker that is terminated on timeout."],
  ["A visually convincing forgery", "Exact regeneration from chain data. A forged or edited file cannot be byte-identical to the canonical rendering. Text extraction is never proof."],
  ["Registry abuse", "Records are keyed by wallet and file hash, so no one can take over another wallet’s id. There is no whitelist and no enumeration. Only the owner can revoke, once. The verifier reads the registry configured in the build, never one named by a document."],
  ["RPC abuse or disagreement", "Two distinct endpoints are compared before any arithmetic; allowlisted read-only methods only; bounded retries and ranges; opening plus credits minus debits must equal closing. Disagreement, truncation or a timeout is inconclusive, never green."],
  ["Request leakage", "The secret nonce lives in the URL fragment, never in a query, the QR, the PDF, the registry or telemetry. No analytics and no third-party scripts. A referrer-less policy and a strict content security policy apply."],
  ["A stale interface", "Changing the wallet account or network discards the preview. The download is released only after a successful receipt and a matching read-back of every submitted field from both endpoints."],
  ["Spreadsheet injection", "Exported CSV cells are neutralised if they could be read as formulas, amounts are exact decimal strings, and the export is offered only when the Content check passes."],
];

export default function Security() {
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Security &amp; privacy</div>
        <h1>What is <em>published</em>, and what is not</h1>
        <p className="lede">Bankable claims one thing: a statement that is independently reproducible from public RPC data, with the wallet’s authorisation. It does not claim “trustless”. This page says exactly what you rely on.</p>
      </div>

      <div className="two">
        <div className="plate"><header className="plate-head"><div><span className="folio">On-chain</span><h3>Public after registration</h3></div></header>
          <ul className="plain"><li>The wallet address and the reporting period.</li><li>The block range, the commitments (hashes), the issuance salt and the renderer profile.</li><li>The registration block and, if it happens, the revocation block.</li></ul>
          <p className="muted" style={{ fontSize: 14 }}>The app warns before approval that public records reveal that this address was reported on for this period.</p></div>
        <div className="plate"><header className="plate-head"><div><span className="folio">Never published</span><h3>Not on-chain, not sent anywhere</h3></div></header>
          <ul className="plain"><li>Balances, and the document itself.</li><li>The recipient’s identity.</li><li>The secret request nonce.</li><li>The file you verify: it is hashed in your browser and never uploaded.</li></ul></div>
      </div>

      <h2>Controls, by <em>risk</em></h2>
      <div className="tablewrap"><table><thead><tr><th style={{ width: "28%" }}>Risk</th><th>Control</th></tr></thead>
        <tbody>{CONTROLS.map(([r, c]) => <tr key={r}><td><strong>{r}</strong></td><td>{c}</td></tr>)}</tbody></table></div>

      <h2>What you still <em>trust</em></h2>
      <ul className="plain prose">
        <li>The registry contract’s code. It is non-upgradeable, has no admin, holds no funds and has no payable function.</li>
        <li>The supported renderer profile and the verifier. Source code and lockfiles make them inspectable, not inherently trustworthy: a recipient who does not rebuild the verifier from source trusts the code this site serves. The command-line verifier takes only the endpoints you give it.</li>
        <li>The wallet’s authorisation: a registration shows control of the key at that moment, not ownership or earlier control.</li>
        <li>The observed RPC data. Two endpoints agreeing plus a reconciled balance does not prove every transfer was returned, and the two endpoints may share infrastructure.</li>
        <li>QUSDC itself. It is a bridged token, not Circle-issued native USDC, and its issuer role can mint and burn; such events appear in statements as transfers to or from the zero address.</li>
      </ul>
      <div className="actions"><a className="btn" href="/limits">Scope &amp; limits →</a><a className="btn secondary" href="/developers">Contract and verifier details</a></div>
      <NonClaims />
    </>
  );
}
