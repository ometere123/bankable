import { amountLabel } from "../lib/format";
import { explorerAddress, explorerBlock, explorerTx } from "../lib/config";
import { totalsOf, type StatementData } from "@bankable/core";

export function Summary({ d }: { d: StatementData }) {
  const t = totalsOf(d.entries);
  return (
    <table>
      <tbody>
        <tr><th>Wallet</th><td className="mono"><a href={explorerAddress(d.owner)}>{d.owner}</a></td></tr>
        <tr><th>Period (UTC)</th><td>{new Date(Number(d.startUnix) * 1000).toISOString()} to {new Date(Number(d.endUnix) * 1000).toISOString()} (end exclusive)</td></tr>
        <tr><th>Blocks</th><td className="mono"><a href={explorerBlock(d.fromBlock)}>{String(d.fromBlock)}</a> to <a href={explorerBlock(d.toBlock)}>{String(d.toBlock)}</a></td></tr>
        <tr><th>Opening</th><td className="mono">{amountLabel(d.opening, d.decimals)} QUSDC</td></tr>
        <tr><th>Incoming ({t.countIn})</th><td className="mono">{amountLabel(t.incoming, d.decimals)} QUSDC</td></tr>
        <tr><th>Outgoing ({t.countOut})</th><td className="mono">{amountLabel(t.outgoing, d.decimals)} QUSDC</td></tr>
        <tr><th>Self-transfers ({t.countSelf})</th><td className="mono">{amountLabel(t.self, d.decimals)} QUSDC (excluded above)</td></tr>
        <tr><th>Closing</th><td className="mono">{amountLabel(d.closing, d.decimals)} QUSDC</td></tr>
        <tr><th>Reconciliation</th><td className="mono">{amountLabel(d.opening, d.decimals)} + {amountLabel(t.incoming, d.decimals)} - {amountLabel(t.outgoing, d.decimals)} = {amountLabel(d.opening + t.incoming - t.outgoing, d.decimals)} {d.opening + t.incoming - t.outgoing === d.closing ? "= closing (matches pinned balance reads on both endpoints)" : "DOES NOT MATCH closing"}</td></tr>
      </tbody>
    </table>
  );
}
export function Entries({ d }: { d: StatementData }) {
  if (d.entries.length === 0) return <p className="muted">No QUSDC transfers involved this wallet in the period.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <thead><tr><th>#</th><th>Dir</th><th>UTC time</th><th className="n">Block/log</th><th className="n">Amount</th><th>Counterparty</th><th>Tx</th></tr></thead>
        <tbody>
          {d.entries.map((e, i) => (
            <tr key={`${e.blockHash}:${e.logIndex}`}>
              <td>{i + 1}</td><td>{e.direction === "C" ? "IN" : e.direction === "D" ? "OUT" : "SELF"}</td>
              <td className="mono">{new Date(Number(e.timestamp) * 1000).toISOString().replace(".000Z", "Z")}</td>
              <td className="n">{String(e.block)}/{String(e.logIndex)}</td><td className="n">{amountLabel(e.amount, d.decimals)}</td>
              <td className="mono">{e.direction === "C" ? e.from : e.to}</td>
              <td className="mono"><a href={explorerTx(e.txHash)}>{e.txHash.slice(0, 12)}…</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
