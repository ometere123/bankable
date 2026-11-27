import { isBytes32, isCanonicalAddress } from "./hex";

/** Tier 2 (spec 9, owner locator): bounded extraction of the strict locator from PDF metadata.
 *  This is NOT a PDF parser. It scans a bounded prefix/suffix for one /Keywords string, decodes it, and accepts only the exact schema.
 *  The result only pre-fills the owner field; the verifier re-derives everything from the file hash and chain. */
export interface Locator { chainId: bigint; registry: string; owner: string; profile: string; dataHash: string }
export const LOCATOR_SCAN_BYTES = 256 * 1024;
const LOC_RE = /^bankable:v1;chain=(\d{1,10});registry=(0x[0-9a-f]{40});owner=(0x[0-9a-f]{40});profile=(0x[0-9a-f]{64});data=(0x[0-9a-f]{64})$/;

export function parseLocatorString(s: string): Locator | null {
  const m = LOC_RE.exec(s); if (!m) return null;
  const l = { chainId: BigInt(m[1]!), registry: m[2]!, owner: m[3]!, profile: m[4]!, dataHash: m[5]! };
  return isCanonicalAddress(l.registry) && isCanonicalAddress(l.owner) && isBytes32(l.profile) && isBytes32(l.dataHash) ? l : null;
}
function decodePdfString(hex: string): string | null {
  if (!/^(?:[0-9A-Fa-f]{2})+$/.test(hex) || hex.length > 2048) return null;
  const b = Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) { let s = ""; for (let i = 2; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i]! << 8) | b[i + 1]!); return s; }
  return String.fromCharCode(...b);
}
/** Exactly one well-formed locator, or null. Never throws on hostile input. */
export function extractLocator(pdf: Uint8Array): Locator | null {
  try {
    const head = pdf.subarray(0, Math.min(pdf.length, LOCATOR_SCAN_BYTES)); const tail = pdf.length > LOCATOR_SCAN_BYTES ? pdf.subarray(pdf.length - LOCATOR_SCAN_BYTES) : head;
    const found = new Set<string>();
    for (const part of [head, tail]) {
      const text = new TextDecoder("latin1").decode(part);
      for (const m of text.matchAll(/\/Keywords\s*<([0-9A-Fa-f]{2,2048})>/g)) { const s = decodePdfString(m[1]!); if (s && parseLocatorString(s)) found.add(s); }
    }
    return found.size === 1 ? parseLocatorString([...found][0]!) : null; // ambiguity (two different locators) is refused
  } catch { return null; }
}

/** Runs `extractLocator` in an isolated Web Worker with a hard timeout; the worker is terminated if it does not answer. */
export interface WorkerLike { postMessage(m: unknown): void; terminate(): void; onmessage: ((e: { data: any }) => void) | null; onerror: ((e: unknown) => void) | null }
export function extractInWorker(make: () => WorkerLike, pdf: Uint8Array, timeoutMs = 2000): Promise<Locator | null> {
  return new Promise((resolve) => {
    let w: WorkerLike; let done = false;
    const finish = (v: Locator | null) => { if (done) return; done = true; clearTimeout(timer); try { w?.terminate(); } catch { /* ignore */ } resolve(v); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      w = make();
      w.onmessage = (e) => { const d = e.data; finish(d && typeof d.owner === "string" ? parseLocatorString(`bankable:v1;chain=${d.chainId};registry=${d.registry};owner=${d.owner};profile=${d.profile};data=${d.dataHash}`) : null); };
      w.onerror = () => finish(null);
      const copy = pdf.slice(); (w as any).postMessage(copy, [copy.buffer]);
    } catch { finish(null); }
  });
}
