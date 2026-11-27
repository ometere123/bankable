import type { Metadata } from "next";
import { NonClaims } from "../../components/NonClaims";
import { Plate } from "../../components/ui";

export const metadata: Metadata = { title: "How it works · Bankable", description: "How a QUSDC statement is requested, authorised, rendered and verified byte for byte." };

export default function HowItWorks() {
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">The method</div>
        <h1>How a statement <em>proves itself</em></h1>
        <p className="lede">A bank statement is a claim you have to trust. A Bankable statement is a file you can recompute: it is a pure function of public chain data, so anyone can regenerate it and compare every byte.</p>
      </div>

      <h2>Three <em>journeys</em></h2>
      <div className="cards">
        <div className="card"><span className="n">01 · Recipient</span><h3>Request</h3><p>An accountant, agency or grant administrator names the wallet and a completed UTC period. The app creates a private link that fixes the wallet, the period and a secret nonce. The nonce lives only in the link’s fragment, so it is never sent to any server.</p><a className="go" href="/request">Create a request →</a></div>
        <div className="card"><span className="n">02 · Wallet controller</span><h3>Issue</h3><p>The controller opens the link, connects QIE Wallet, and reviews the reconciled ledger and the exact period. After one approved transaction on QIE mainnet and a read-back from two endpoints, the very bytes that were registered are released for download.</p><a className="go" href="/new">Open an issue link →</a></div>
        <div className="card"><span className="n">03 · Anyone</span><h3>Verify</h3><p>Drop the file, name the owner, optionally add the original link. The page runs four independent checks against the chain and gives one of five outcomes. No wallet and no account are needed.</p><a className="go" href="/verify">Verify a file →</a></div>
      </div>

      <h2>What is inside <em>the file</em></h2>
      <div className="two">
        <div>
          <ul className="plain">
            <li>The wallet, the chain (QIE mainnet, 1990), and the QUSDC contract with its decimals.</li>
            <li>The UTC period and the exact block range it covers, with the first and last block hashes.</li>
            <li>Opening and closing balances, and incoming, outgoing and self-transfer totals, in exact token units.</li>
            <li>Every transfer: time, block and log index, direction, amount, counterparty and transaction hash. Mints and burns use their real zero-address counterparty.</li>
            <li>A QR code that is a locator only, and the fixed statement of what the file does not prove.</li>
          </ul>
        </div>
        <Plate folio="Why the bytes matter" title="Re-render, don’t trust">
          <p>The PDF is rendered by a pinned, published renderer profile. The verifier rebuilds the ledger from chain data, renders the statement again with the same profile, and compares the SHA-256 of its output with your file.</p>
          <p>A forged or edited PDF cannot match, whoever produced it. Text extraction is never used as proof.</p>
        </Plate>
      </div>

      <h2>The four checks</h2>
      <ol className="explain">
        <li><h4>Issued</h4><p>The expected wallet registered this exact file on the registry contract. Both RPC endpoints must return the same record at a common confirmed block. A missing record after successful reads is a failure; unavailable reads are inconclusive.</p></li>
        <li><h4>Content</h4><p>The registry record fixes the dates and block range. The ledger and canonical data are rebuilt from the chain, the data hash is compared with the record, and the regenerated PDF is compared byte for byte with your file.</p></li>
        <li><h4>Status</h4><p>The record has not been revoked as of a recently confirmed block, read from both endpoints. A cached or stale result is never shown as current.</p></li>
        <li><h4>Request</h4><p>If you supply your original link, its wallet, token, chain, registry, dates and secret must reproduce the request id stored in the record. No link means this check is “not checked”, not a failure.</p></li>
      </ol>

      <h2>Five <em>outcomes</em></h2>
      <div className="tablewrap"><table>
        <thead><tr><th>Outcome</th><th>When</th></tr></thead>
        <tbody>
          <tr><td><strong>Verified, request matched</strong></td><td>Issued, Content, Status and Request all pass.</td></tr>
          <tr><td><strong>Verified document, request not checked</strong></td><td>Issued, Content and Status pass and no link was supplied. No claim that the file answers the intended request.</td></tr>
          <tr><td><strong>Verification failed</strong></td><td>Any established failure: an unregistered or altered file, wrong content, a revoked record, or a request mismatch. A failure always dominates.</td></tr>
          <tr><td><strong>Inconclusive</strong></td><td>Required evidence is unavailable: a timeout, endpoint disagreement, an unknown profile, or an unresolvable locator. Never shown as a pass.</td></tr>
          <tr><td><strong>Not checked (QR only)</strong></td><td>No file was supplied. A QR only says where to look.</td></tr>
        </tbody>
      </table></div>

      <h2>Authorisation, <em>revocation</em> and reissue</h2>
      <p className="prose">The registry stores the wallet’s own assertion, keyed by the wallet and the file hash, so nobody else can occupy a wallet’s record. Registration is the wallet’s consent to this exact file, with a block timestamp. The owner can revoke a record, once and permanently. A replacement for the same request uses a fresh issuance salt and produces a new record; the old record stays valid until it is revoked. The same file bytes can never be registered again after revocation.</p>
      <div className="actions"><a className="btn" href="/request">Create a request →</a><a className="btn secondary" href="/security">Read the security model</a></div>
      <NonClaims />
    </>
  );
}
