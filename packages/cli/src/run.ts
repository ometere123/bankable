import fs from "node:fs";
import { ChainReader, JsonRpcClient, MAX_PDF_BYTES, OVERALL_LABEL, PROFILE_MANIFESTS, loadProfiles, verifyStatement, formatUnits, totalsOf, type VerifyResult } from "@bankable/core";

/** Exit codes: 0 verified, 1 failed, 2 inconclusive, 64 usage error (never 0 for anything unresolved). */
export const EXIT = { verified: 0, failed: 1, inconclusive: 2, usage: 64 } as const;
export interface Io { out(s: string): void; err(s: string): void; env: Record<string, string | undefined>; fetchImpl?: typeof fetch }

const USAGE = `bankable-verify <file.pdf> --owner <0xaddress> --registry <0xaddress> --rpc-a <url> --rpc-b <url> [--request <link>] [--json] [--retries N] [--timeout-ms N]
  Verifies a Bankable QUSDC statement with the same pinned core as the website, using ONLY the two RPC endpoints you give it.
  --registry may also come from STATEMENT_REGISTRY_ADDRESS. Exit status: 0 verified, 1 failed, 2 inconclusive, 64 usage error.`;

function parseArgs(argv: string[]): { pos: string[]; flags: Record<string, string | true> } {
  const pos: string[] = [], flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) { const k = a.slice(2); if (k === "json" || k === "help") flags[k] = true; else { const v = argv[++i]; if (v === undefined) throw new Error(`--${k} needs a value`); flags[k] = v; } } else pos.push(a);
  }
  return { pos, flags };
}
const bigintJson = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export async function runCli(argv: string[], io: Io): Promise<number> {
  let parsed; try { parsed = parseArgs(argv); } catch (e) { io.err(`${(e as Error).message}\n${USAGE}`); return EXIT.usage; }
  const { pos, flags } = parsed;
  if (flags.help) { io.out(USAGE); return EXIT.verified; }
  const registry = (flags.registry as string | undefined) ?? io.env.STATEMENT_REGISTRY_ADDRESS;
  const need = { file: pos[0], owner: flags.owner as string | undefined, registry, a: flags["rpc-a"] as string | undefined, b: flags["rpc-b"] as string | undefined };
  if (pos.length !== 1 || !need.owner || !need.registry || !need.a || !need.b) { io.err(USAGE); return EXIT.usage; }
  if (!/^0x[0-9a-fA-F]{40}$/.test(need.registry)) { io.err("--registry is not a 20-byte address"); return EXIT.usage; }
  try { for (const u of [need.a, need.b]) { const p = new URL(u); if (p.protocol !== "https:" && p.protocol !== "http:") throw new Error(); } } catch { io.err("--rpc-a/--rpc-b must be http(s) URLs"); return EXIT.usage; }
  if (need.a === need.b) { io.err("Two distinct RPC endpoints are required: comparing an endpoint with itself proves nothing."); return EXIT.usage; }
  let bytes: Uint8Array;
  try { const st = fs.statSync(need.file!); if (st.size > MAX_PDF_BYTES || st.size === 0) { io.err(`file is ${st.size} bytes; supported range is 1..${MAX_PDF_BYTES}`); return EXIT.failed; } bytes = new Uint8Array(fs.readFileSync(need.file!)); }
  catch (e) { io.err(`cannot read ${need.file}: ${(e as Error).message}`); return EXIT.usage; }

  const num = (v: string | true | undefined, d: number, lo: number, hi: number) => { if (v === undefined) return d; const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`value ${v} out of range ${lo}..${hi}`); return n; };
  let retries: number, timeoutMs: number;
  try { retries = num(flags.retries, 3, 0, 8); timeoutMs = num(flags["timeout-ms"], 40_000, 100, 120_000); } catch (e) { io.err((e as Error).message); return EXIT.usage; }
  const mk = (id: string, url: string) => new ChainReader(new JsonRpcClient({ id, url }, { timeoutMs, retries, backoffMs: 800, fetchImpl: io.fetchImpl }), need.registry!.toLowerCase());
  let res: VerifyResult;
  try {
    res = await verifyStatement({ file: bytes, owner: need.owner, requestLink: flags.request as string | undefined, dual: { a: mk("rpc-a", need.a), b: mk("rpc-b", need.b) },
      profiles: loadProfiles(PROFILE_MANIFESTS), registry: need.registry.toLowerCase(), scan: { concurrency: 6 } });
  } catch (e) { io.err(`input error: ${(e as Error).message}`); return EXIT.usage; }

  if (flags.json) {
    io.out(JSON.stringify({ overall: res.overall, label: OVERALL_LABEL[res.overall], checks: res.checks, checkedAt: res.checkedAt, owner: res.owner, pdfHash: res.pdfHash, recordId: res.recordId, record: res.record,
      ledger: res.ledger ? { opening: res.ledger.opening, closing: res.ledger.closing, entries: res.ledger.entries.length } : null }, bigintJson, 2));
  } else {
    io.out(`File ${need.file} sha256 ${res.pdfHash}\nOwner ${res.owner}\nRecord id ${res.recordId}`);
    for (const k of ["issued", "content", "status", "request"] as const) io.out(`${k.padEnd(8)} ${res.checks[k].status.toUpperCase().padEnd(12)} ${res.checks[k].reasons.join("; ")}`);
    if (res.checkedAt) io.out(`Checked at confirmed block ${res.checkedAt.number} (timestamp ${res.checkedAt.timestamp}) on both endpoints. Valid as of this block only.`);
    if (res.ledger) { const t = totalsOf(res.ledger.entries); io.out(`Chain-derived ledger: opening ${formatUnits(res.ledger.opening, 6)}, in ${formatUnits(t.incoming, 6)}, out ${formatUnits(t.outgoing, 6)}, closing ${formatUnits(res.ledger.closing, 6)} QUSDC (${res.ledger.entries.length} entries)`); }
    io.out(`RESULT: ${OVERALL_LABEL[res.overall]}`);
    io.out("This does not prove completeness of RPC history, earlier control, income, source of funds, recipient identity or institutional acceptance.");
  }
  return res.overall.startsWith("verified") ? EXIT.verified : res.overall === "failed" ? EXIT.failed : EXIT.inconclusive;
}
