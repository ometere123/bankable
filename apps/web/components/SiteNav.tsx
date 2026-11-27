"use client";
import { usePathname } from "next/navigation";

const LINKS: [string, string][] = [["/how-it-works", "How it works"], ["/security", "Security"], ["/limits", "Scope & limits"], ["/developers", "Developers"]];
export function SiteNav() {
  const path = (usePathname() ?? "/").replace(/\/$/, "") || "/";
  return (
    <nav aria-label="Primary">
      {LINKS.map(([href, label], i) => (
        <a key={href} href={href} aria-current={path === href ? "page" : undefined}>{label}<sup>{String(i + 1).padStart(2, "0")}</sup></a>
      ))}
      <a className="btn nav-cta" href="/verify" aria-current={path === "/verify" ? "page" : undefined}>Verify a file</a>
    </nav>
  );
}
