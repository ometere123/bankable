import { AbiCoder, keccak256 } from "ethers";
import { BankableError } from "./errors";
import { parseAddress, parseBytes32, parseUint, randomBytes32 } from "./hex";
import { QIE_MAINNET_CHAIN_ID, QUSDC_ADDRESS } from "./constants";

/** Section 5.1. All wallets/hashes lowercase; times are UTC Unix seconds; the period is [startUnix, endUnix). */
export interface TypedRequest {
  chainId: bigint;
  registry: string;
  token: string;
  expectedWallet: string;
  startUnix: bigint;
  endUnix: bigint;
  nonce: string; // 32 bytes, secret; only ever in the URL fragment
}

export function computeRequestId(r: TypedRequest): string {
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ["string", "uint256", "address", "address", "address", "uint64", "uint64", "bytes32"],
    ["bankable-request", r.chainId, r.registry, r.token, r.expectedWallet, r.startUnix, r.endUnix, r.nonce],
  ));
}

/** Validation used at creation and at link parse. `nowUnix` is supplied by the caller (never read from a hidden clock). */
export function validateRequest(r: TypedRequest, cfg: { registry: string; nowUnix: bigint }): void {
  if (r.chainId !== QIE_MAINNET_CHAIN_ID) throw new BankableError("wrong-chain", "request is not for QIE mainnet (1990)");
  if (r.registry !== cfg.registry.toLowerCase()) throw new BankableError("wrong-registry", "request names a different registry than this deployment");
  if (r.token !== QUSDC_ADDRESS) throw new BankableError("wrong-token", "request names a token other than QUSDC");
  if (/^0x0{40}$/.test(r.expectedWallet)) throw new BankableError("zero-wallet", "expected wallet must not be the zero address");
  if (/^0x0{64}$/.test(r.nonce)) throw new BankableError("zero-nonce", "nonce must not be zero");
  if (r.startUnix >= r.endUnix) throw new BankableError("bad-period", "period start must be before end");
  if (r.endUnix > cfg.nowUnix) throw new BankableError("future-period", "the period must be completed (end is in the future)");
}

export function dayStartUnix(y: number, m: number, d: number): bigint {
  const t = Date.UTC(y, m - 1, d);
  const chk = new Date(t);
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== m - 1 || chk.getUTCDate() !== d) throw new BankableError("bad-date", "invalid calendar date");
  return BigInt(t / 1000);
}
/** Inclusive calendar days -> [start, nextMidnight). */
export function inclusiveDaysToPeriod(first: string, last: string): { startUnix: bigint; endUnix: bigint } {
  const p = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) throw new BankableError("bad-date", "dates must be YYYY-MM-DD"); return dayStartUnix(+m[1]!, +m[2]!, +m[3]!); };
  return { startUnix: p(first), endUnix: p(last) + 86400n };
}

export function createRequest(args: { registry: string; expectedWallet: string; startUnix: bigint; endUnix: bigint; nowUnix: bigint; nonce?: string }): TypedRequest {
  const r: TypedRequest = {
    chainId: QIE_MAINNET_CHAIN_ID,
    registry: parseAddress(args.registry, "registry"),
    token: QUSDC_ADDRESS,
    expectedWallet: parseAddress(args.expectedWallet, "expected wallet"),
    startUnix: args.startUnix, endUnix: args.endUnix,
    nonce: args.nonce ? parseBytes32(args.nonce, "nonce") : randomBytes32(),
  };
  validateRequest(r, { registry: r.registry, nowUnix: args.nowUnix });
  return r;
}

// ---- link encoding: the secret nonce travels only in the URL fragment (never a query parameter) ----
export function encodeRequestFragment(r: TypedRequest): string {
  const p = new URLSearchParams({
    v: "1", chain: r.chainId.toString(), registry: r.registry, token: r.token, wallet: r.expectedWallet,
    start: r.startUnix.toString(), end: r.endUnix.toString(), nonce: r.nonce,
  });
  return p.toString();
}
export function requestLink(origin: string, path: "/new" | "/verify", r: TypedRequest): string {
  return `${origin.replace(/\/$/, "")}${path}#${encodeRequestFragment(r)}`;
}
const FIELDS = ["v", "chain", "registry", "token", "wallet", "start", "end", "nonce"] as const;
/** Strict parse: exact field set, no duplicates, no extras, canonical values. Accepts a full URL or a bare fragment. */
export function parseRequestLink(input: string): TypedRequest {
  const i = input.indexOf("#");
  const frag = i >= 0 ? input.slice(i + 1) : input;
  const params = new URLSearchParams(frag);
  const keys = [...params.keys()];
  if (keys.length !== FIELDS.length || new Set(keys).size !== FIELDS.length || !FIELDS.every((f) => params.has(f)))
    throw new BankableError("bad-link", "request link has missing, duplicate or unexpected fields");
  const g = (k: string) => params.get(k)!;
  if (g("v") !== "1") throw new BankableError("bad-link", "unsupported request link version");
  return {
    chainId: parseUint(g("chain"), "chain", (1n << 256n) - 1n),
    registry: parseAddress(g("registry"), "registry"),
    token: parseAddress(g("token"), "token"),
    expectedWallet: parseAddress(g("wallet"), "wallet"),
    startUnix: parseUint(g("start"), "start"),
    endUnix: parseUint(g("end"), "end"),
    nonce: parseBytes32(g("nonce"), "nonce"),
  };
}
