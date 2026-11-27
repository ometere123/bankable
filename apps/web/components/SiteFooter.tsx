import { REGISTRY, registryConfigured, explorerAddress } from "../lib/config";
import { Mark } from "./ui";

export function SiteFooter() {
  return (
    <footer className="foot">
      <div className="footgrid">
        <div>
          <a className="brand" href="/" aria-label="Bankable, home"><Mark size={22} />Bankable</a>
          <p className="muted">Owner-authorised, byte-reproducible QUSDC statements on QIE mainnet.</p>
        </div>
        <div><h4>Use</h4><a href="/request">Create a request</a><a href="/new">Issue a statement</a><a href="/verify">Verify a file</a></div>
        <div><h4>Learn</h4><a href="/how-it-works">How it works</a><a href="/security">Security &amp; privacy</a><a href="/limits">Scope &amp; limits</a></div>
        <div><h4>Build</h4><a href="/developers">Developers</a>{registryConfigured && <a href={explorerAddress(REGISTRY)}>Registry on the explorer</a>}</div>
      </div>
      <div className="footline"><span>Evidence derived from public chain data. Not a certified bank statement.</span><span>QIE mainnet · chain 1990 · QUSDC only</span></div>
    </footer>
  );
}
