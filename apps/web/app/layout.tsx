import type { Metadata } from "next";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "./globals.css";
import { RPC_A, RPC_B } from "../lib/config";
import { Mark } from "../components/ui";
import { SiteNav } from "../components/SiteNav";
import { SiteFooter } from "../components/SiteFooter";

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
            <a className="brand" href="/" aria-label="Bankable, home"><Mark />Bankable</a>
            <div className="headright"><span className="chip"><i aria-hidden="true" />QIE mainnet · chain 1990</span><SiteNav /></div>
          </header>
          {children}
          <SiteFooter />
        </main>
      </body>
    </html>
  );
}
