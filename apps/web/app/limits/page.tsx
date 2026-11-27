import type { Metadata } from "next";
import { NonClaims } from "../../components/NonClaims";

export const metadata: Metadata = { title: "Scope & limits · Bankable", description: "What Bankable covers, what it does not, and the measured limits." };

const FAQ: [string, string][] = [
  ["Is this a bank statement?", "No. It is evidence derived from public chain data about one QIE address and one token over one completed period. It is not certified, and it is not a bank deposit record."],
  ["Does a positive result prove the owner’s income or funds?", "No. It does not prove income, source of funds, the owner’s total finances, earlier control of the address, recipient identity or institutional acceptance. A transfer from another wallet of the same owner is a valid entry, and the statement makes no income claim."],
  ["Why can’t I choose a period before 21 January 2026?", "QUSDC was deployed on QIE mainnet at block 5,244,996 on 2026-01-21 12:11:20 UTC. A period that starts before the token’s history is rejected, because the opening balance cannot be established."],
  ["What happens if an RPC endpoint is down or disagrees?", "The result is Inconclusive, with the reason. The checks never fall back to a single endpoint and never show a pass on unresolved evidence. You can try again, or verify with the command-line tool and your own endpoints."],
  ["Can a statement be withdrawn?", "Yes. The wallet that registered it can revoke the record. Verifying the old file then fails the Status check. Revocation withdraws an attestation; it does not make past transfers untrue."],
  ["Does the recipient need an account or a wallet?", "No. Creating a request and verifying a file need neither. Only the wallet controller needs QIE Wallet."],
  ["What does it cost?", "Registering is one transaction on QIE mainnet and costs gas in QIE. Requesting and verifying cost nothing. For scale: the whole mainnet acceptance run (a deployment, three transfers, four registrations and one revocation) cost about 0.002 QIE in total."],
];

export default function Limits() {
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Scope &amp; limits</div>
        <h1>One address, one token, <em>one completed period</em></h1>
        <p className="lede">Narrow on purpose. The product makes one claim and makes it checkable. Here are its boundaries, including the limits we measured on the live network.</p>
      </div>

      <div className="two">
        <div className="plate"><header className="plate-head"><div><span className="folio">Covered</span><h3>What it does</h3></div></header>
          <ul className="plain"><li>One QIE mainnet address.</li><li>One token: QUSDC.</li><li>One completed UTC period, chosen by the recipient.</li><li>Owner-authorised registration, revocation and reissue.</li><li>Verification without a wallet or an account.</li></ul></div>
        <div className="plate"><header className="plate-head"><div><span className="folio">Not covered</span><h3>What it does not do</h3></div></header>
          <ul className="plain"><li>Custody, bank accounts, credit scoring, KYC or legal identity.</li><li>Income classification or fiat valuation.</li><li>Other tokens or chains, or aggregating several wallets.</li><li>ISO 20022 export. Exported CSV is generic and is not claimed to import into any accounting product.</li></ul></div>
      </div>

      <h2>Measured <em>limits</em></h2>
      <div className="tablewrap"><table className="facts"><tbody>
        <tr><th>Period length</th><td>At most 31 days.</td></tr>
        <tr><th>Transfers per statement</th><td>At most 2,000. More is refused or inconclusive; nothing is silently truncated.</td></tr>
        <tr><th>File size</th><td>At most 2 MiB.</td></tr>
        <tr><th>Time for a month</th><td>About two to two and a half minutes, because the endpoints allow 10,000 blocks per log query and blocks are about 3.6 seconds apart.</td></tr>
        <tr><th>Token history</th><td>From block 5,244,996 (2026-01-21 12:11:20 UTC).</td></tr>
        <tr><th>Confirmation</th><td>Results are valid as of a confirmed block (twelve blocks behind the head), shown on every result.</td></tr>
      </tbody></table></div>

      <h2>Questions, <em>answered plainly</em></h2>
      <div className="faq">{FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
      <div className="actions"><a className="btn" href="/verify">Verify a file →</a><a className="btn secondary" href="/how-it-works">How it works</a></div>
      <NonClaims />
    </>
  );
}
