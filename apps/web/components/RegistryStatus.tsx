"use client";
import { useEffect, useState } from "react";
import { explorerVerification, type ExplorerStatus } from "@bankable/core";
import { REGISTRY, registryConfigured, explorerAddress } from "../lib/config";

/** Reads the explorer's own source-verification status live and reports exactly what it says. */
export function RegistryStatus({ compact = false }: { compact?: boolean }) {
  const [st, setSt] = useState<ExplorerStatus | null>(null);
  useEffect(() => { if (registryConfigured) explorerVerification(REGISTRY).then(setSt); }, []);
  if (!registryConfigured) return null;
  const text = !st ? "checking…" : st.status === "verified" ? `verified (${st.fullyVerified ? "full" : "partial"} match, ${st.compiler})` : st.status === "not-verified" ? "NOT verified on the explorer" : `unknown (${st.reason})`;
  return (
    <p className={compact ? "muted mono" : "mono"} style={{ fontSize: 12 }}>
      Registry <a href={explorerAddress(REGISTRY)}>{REGISTRY}</a>. Explorer source verification: {text}
    </p>
  );
}
