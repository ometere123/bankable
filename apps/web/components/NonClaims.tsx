/** Fixed on every result (spec 12): what a positive result does not prove. */
export function NonClaims() {
  return (
    <div className="box notice" role="note" aria-label="What this does not prove">
      <strong>What this does not prove.</strong>
      <p style={{ margin: "6px 0 0", fontSize: 14 }}>
        Not a bank statement and not a certified record. A positive result does not prove cryptographic completeness of the RPC history,
        earlier control of the address, genuine income, source of funds, the owner's total finances, recipient identity, or institutional
        acceptance. QUSDC is a bridged token, not Circle-issued native USDC. Amounts are token units with no fiat valuation. A transfer from
        another wallet the owner controls is a valid entry; the statement makes no income claim. Agreement of two endpoints plus
        reconciliation does not prove every transfer was returned. Revocation withdraws an attestation; it does not make past transfers untrue.
      </p>
    </div>
  );
}
