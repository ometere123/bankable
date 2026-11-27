import { amountLabel } from "../lib/format";
import { explorerAddress, explorerBlock, explorerTx } from "../lib/config";
import { totalsOf, type StatementData } from "@bankable/core";

export function Summary({ d }: { d: StatementData }) {
  const t = totalsOf(d.entries); const expected = d.opening + t.incoming - t.outgoing; const ok = expected === d.closing;
  const cell = (k: string, v: bigint, sub?: string) => <div><div className="k">{k}</div><div className="v">{amountLabel(v, d.decimals)}</div><div className="u">{sub ?? "QUSDC"}</div></div>;
  return (
    <>
      <div className="band" role="group" aria-label="Balances">
        {cell("Opening", d.opening)}{cell(`Incoming · ${t.countIn}`, t.incoming)}{cell(`Outgoing · ${t.countOut}`, t.outgoing)}{cell("Closing", d.closing)}
      </div>
      <p className="recon">
        {amountLabel(d.opening, d.decimals)} + {amountLabel(t.incoming, d.decimals)} − {amountLabel(t.outgoing, d.decimals)} = {amountLabel(expected, d.decimals)}{" "}
        {ok ? <b>= closing (matches pinned balance reads on both endpoints)</b> : <span className="bad">DOES NOT MATCH closing</span>}
        {t.countSelf > 0 && <> · {t.countSelf} self-transfer{t.countSelf > 1 ? "s" : ""} ({amountLabel(t.self, d.decimals)}) excluded above</>}
      </p>
      <div className="tablewrap">
        <table className="facts">
          <tbody>
            <tr><th>Wallet</th><td className="mono"><a href={explorerAddress(d.owner)}>{d.owner}</a></td></tr>
            <tr><th>Period (UTC)</th><td>{new Date(Number(d.startUnix) * 1000).toISOString()} to {new Date(Number(d.endUnix) * 1000).toISOString()} (end exclusive)</td></tr>
            <tr><th>Blocks</th><td className="mono"><a href={explorerBlock(d.fromBlock)}>{String(d.fromBlock)}</a> to <a href={explorerBlock(d.toBlock)}>{String(d.toBlock)}</a></td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
export function Entries({ d }: { d: StatementData }) {
  if (d.entries.length === 0) return <p className="muted">No QUSDC transfers involved this wallet in the period.</p>;
  return (
    <div className="tablewrap">
      <table className="entries">
        <thead><tr><th>#</th><th>Dir</th><th>UTC time</th><th className="n">Block/log</th><th className="n">Amount</th><th>Counterparty</th><th>Tx</th></tr></thead>
        <tbody>
          {d.entries.map((e, i) => {
            const dir = e.direction === "C" ? "IN" : e.direction === "D" ? "OUT" : "SELF";
            return (
              <tr key={`${e.blockHash}:${e.logIndex}`}>
                <td>{i + 1}</td><td><span className={`dir ${dir.toLowerCase()}`}>{dir}</span></td>
                <td className="mono">{new Date(Number(e.timestamp) * 1000).toISOString().replace(".000Z", "Z")}</td>
                <td className="n">{String(e.block)}/{String(e.logIndex)}</td><td className="n">{amountLabel(e.amount, d.decimals)}</td>
                <td className="mono">{e.direction === "C" ? e.from : e.to}</td>
                <td className="mono"><a href={explorerTx(e.txHash)}>{e.txHash.slice(0, 12)}…</a></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
