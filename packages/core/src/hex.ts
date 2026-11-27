import { BankableError } from "./errors";

const ADDR = /^0x[0-9a-f]{40}$/;
const B32 = /^0x[0-9a-f]{64}$/;
const DEC = /^(0|[1-9][0-9]*)$/;

export const isCanonicalAddress = (s: unknown): s is string => typeof s === "string" && ADDR.test(s);
export const isBytes32 = (s: unknown): s is string => typeof s === "string" && B32.test(s);
export const isCanonicalDecimal = (s: unknown): s is string => typeof s === "string" && DEC.test(s);

/** Accepts mixed-case input from a user, rejects anything that is not exactly 20 hex bytes, returns lowercase. */
export function parseAddress(input: string, what = "address"): string {
  const t = input.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(t)) throw new BankableError("bad-address", `${what} is not a 20-byte 0x address`);
  return t.toLowerCase();
}
export function parseBytes32(input: string, what = "value"): string {
  const t = input.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(t)) throw new BankableError("bad-bytes32", `${what} is not 32 bytes of 0x hex`);
  return t.toLowerCase();
}
export function parseUint(input: string | number | bigint, what: string, max: bigint = (1n << 64n) - 1n): bigint {
  const s = typeof input === "string" ? input : String(input);
  if (!isCanonicalDecimal(s)) throw new BankableError("bad-uint", `${what} is not a canonical unsigned integer`);
  const v = BigInt(s);
  if (v > max) throw new BankableError("bad-uint", `${what} exceeds its maximum`);
  return v;
}
export function bytesToHex(b: Uint8Array): string { let s = "0x"; for (const x of b) s += x.toString(16).padStart(2, "0"); return s; }
export function hexToBytes(h: string): Uint8Array {
  if (!/^0x([0-9a-f]{2})*$/i.test(h)) throw new BankableError("bad-hex", "invalid hex");
  const out = new Uint8Array((h.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 + 2 * i, 4 + 2 * i), 16);
  return out;
}
export function randomBytes32(): string {
  const b = new Uint8Array(32); crypto.getRandomValues(b); return bytesToHex(b);
}
/** Exact fixed-point formatting using the verified decimals. No rounding, no locale. */
export function formatUnits(v: bigint, decimals: number): string {
  const neg = v < 0n; const a = neg ? -v : v; const base = 10n ** BigInt(decimals);
  const whole = a / base; const frac = (a % base).toString().padStart(decimals, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}
