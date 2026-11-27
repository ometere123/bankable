import { InconclusiveError } from "./errors";
import { QIE_MAINNET_CHAIN_ID } from "./constants";

/** Tier 2 (spec 8.3). Current QIE ID beside an address via the read-only Wallet MCP tool qie_reverse_lookup (mainnet only).
 *  Shown as current address context OUTSIDE the canonical data; never historical identity, never KYC. */
export const WALLET_MCP_URL = "https://mcp.qie.digital/mcp";
export type QieIdStatus = { status: "ok"; name: string | null; reason?: string } | { status: "unavailable"; reason: string };
export type CallTool = (name: string, args: Record<string, unknown>) => Promise<unknown>;

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}.\-_]{0,126}$/u;
export function parseReverseLookup(address: string, result: any): QieIdStatus {
  const s = result?.structuredContent ?? (() => { try { return JSON.parse(result?.content?.[0]?.text ?? ""); } catch { return null; } })();
  if (!s || s.status !== "ok" || BigInt(s.chainId ?? -1) !== QIE_MAINNET_CHAIN_ID || String(s.address ?? "").toLowerCase() !== address.toLowerCase())
    return { status: "unavailable", reason: "unexpected response from the Wallet MCP" };
  if (s.name === null || s.name === undefined) return { status: "ok", name: null, reason: typeof s.reason === "string" ? s.reason.slice(0, 200) : undefined };
  if (typeof s.name !== "string" || !NAME_RE.test(s.name)) return { status: "unavailable", reason: "returned name failed validation" };
  return { status: "ok", name: s.name };
}
/** Never throws: a down service yields {status:"unavailable"}; financial verification is unaffected. */
export async function lookupQieId(address: string, callTool: CallTool, timeoutMs = 10_000): Promise<QieIdStatus> {
  try {
    const r = await Promise.race([
      callTool("qie_reverse_lookup", { address, network: "mainnet" }),
      new Promise((_, rej) => setTimeout(() => rej(new InconclusiveError("timeout", "lookup timed out")), timeoutMs)),
    ]);
    return parseReverseLookup(address, r);
  } catch (e) { return { status: "unavailable", reason: (e as Error).message.slice(0, 200) }; }
}
/** Real transport via the official MCP TypeScript SDK (Streamable HTTP). Works in Node and, because the endpoint answers CORS, in browsers. */
export async function makeMcpCallTool(url = WALLET_MCP_URL): Promise<{ callTool: CallTool; close: () => Promise<void> }> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const client = new Client({ name: "bankable", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return { callTool: (name, args) => client.callTool({ name, arguments: args }), close: () => client.close() };
}
