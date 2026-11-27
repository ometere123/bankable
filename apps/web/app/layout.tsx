import type { Metadata } from "next";
import "./globals.css";
import { RPC_A, RPC_B } from "../lib/config";

export const metadata: Metadata = {
  title: "Bankable: verifiable QUSDC statements on QIE",
  description: "Owner-authorised, byte-reproducible QUSDC statements on QIE mainnet.",
  referrer: "no-referrer",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* No third-party scripts or analytics; chain reads only to the two QIE RPC endpoints (spec section 10). */}
        <meta httpEquiv="Content-Security-Policy" content={`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${RPC_A} ${RPC_B} https://mcp.qie.digital https://mainnet.qie.digital; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'`} />
      </head>
      <body>
        <a className="skip" href="#content">Skip to content</a>
        <main id="content">
          <header className="top">
            <a className="brand" href="/">BANKABLE</a>
            <nav aria-label="Primary"><a href="/request">Create request</a><a href="/new">Issue</a><a href="/verify">Verify</a></nav>
          </header>
          {children}
          <footer className="foot">Evidence derived from public chain data. Not a certified bank statement. QIE mainnet (chain 1990), QUSDC only.</footer>
        </main>
      </body>
    </html>
  );
}
