/** Tier 2: report the explorer's source-verification status for a contract accurately (never claim more than the explorer says). */
export const EXPLORER_API = "https://mainnet.qie.digital/api/v2";
export type ExplorerStatus =
  | { status: "verified"; fullyVerified: boolean; compiler: string; name: string; verifiedAt: string | null }
  | { status: "not-verified" } | { status: "unknown"; reason: string };

export async function explorerVerification(address: string, fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): Promise<ExplorerStatus> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { status: "unknown", reason: "bad address" };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`${EXPLORER_API}/addresses/${address}`, { signal: ctl.signal, referrerPolicy: "no-referrer", cache: "no-store" });
    if (r.status === 404) return { status: "unknown", reason: "explorer does not know this address yet" };
    if (!r.ok) return { status: "unknown", reason: `explorer HTTP ${r.status}` };
    const a: any = await r.json();
    if (!a?.is_contract) return { status: "unknown", reason: "address is not a contract on the explorer" };
    if (a.is_verified !== true) return { status: "not-verified" };
    const s = await fetchImpl(`${EXPLORER_API}/smart-contracts/${address}`, { signal: ctl.signal, referrerPolicy: "no-referrer", cache: "no-store" });
    const c: any = s.ok ? await s.json() : {};
    return { status: "verified", fullyVerified: c.is_fully_verified === true, compiler: String(c.compiler_version ?? "unknown"), name: String(c.name ?? "unknown"), verifiedAt: c.verified_at ?? null };
  } catch (e) { return { status: "unknown", reason: (e as Error).name === "AbortError" ? "timeout" : String((e as Error).message).slice(0, 120) }; }
  finally { clearTimeout(t); }
}
