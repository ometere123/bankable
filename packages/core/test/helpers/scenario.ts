import { JsonRpcClient } from "../../src/rpc/client";
import { ChainReader } from "../../src/rpc/reader";
import type { Dual } from "../../src/rpc/dual";
import { loadProfiles } from "../../src/profile";
import { PROFILE_MANIFESTS } from "../../src/profiles.generated";
import { createRequest } from "../../src/request";
import { prepareIssuance, type Issuance } from "../../src/issue";
import { verifyStatement, type VerifyResult } from "../../src/verify";
import { FakeChain } from "./fakechain";

export const W = "0x1111111111111111111111111111111111111111";      // the statement owner / expected wallet
export const OTHER = "0x2222222222222222222222222222222222222222";
export const THIRD = "0x3333333333333333333333333333333333333333";
export const FORGER = "0x4444444444444444444444444444444444444444";
export const REGISTRY = "0x5555555555555555555555555555555555555555";
export const profiles = loadProfiles(PROFILE_MANIFESTS);
export const profile = [...profiles.values()][0]!;
const D = 5_244_996;

export interface Scenario { a: FakeChain; b: FakeChain; dual: Dual; startUnix: bigint; endUnix: bigint; nowHead: number; head_register_late(i: Issuance): string }
export function makeDual(a: FakeChain, b: FakeChain, o: { timeoutMs?: number } = {}): Dual {
  const mk = (id: string, c: FakeChain) => new ChainReader(new JsonRpcClient({ id, url: `https://fake/${id}` }, { fetchImpl: c.fetchImpl, retries: 0, backoffMs: 1, timeoutMs: o.timeoutMs ?? 5000 }), REGISTRY);
  return { a: mk("A", a), b: mk("B", b) };
}
/** Synthetic ledger covering boundaries, self-transfer, zero-value, mint, burn, same-block logs and foreign traffic. */
export function populate(c: FakeChain) {
  c.mint(W, 10_000_000n, D + 50_000);                           // before the period: opening balance 10.000000
  c.addTransfer({ block: D + 99_999, logIndex: 0, from: OTHER, to: W, amount: 111n });   // boundary neighbour BEFORE range (counts to opening)
  c.addTransfer({ block: D + 100_000, logIndex: 0, from: OTHER, to: W, amount: 2_500_000n }); // first block in range
  c.addTransfer({ block: D + 100_000, logIndex: 1, from: W, to: THIRD, amount: 250_000n });   // same block, second log
  c.addTransfer({ block: D + 101_000, logIndex: 2, from: W, to: OTHER, amount: 1_000_000n });
  c.addTransfer({ block: D + 105_000, logIndex: 0, from: OTHER, to: THIRD, amount: 9_999_999n }); // foreign traffic: ignored
  c.addTransfer({ block: D + 110_000, logIndex: 0, from: W, to: W, amount: 300_000n });       // self-transfer
  c.addTransfer({ block: D + 112_000, logIndex: 0, from: OTHER, to: W, amount: 0n });         // zero-value
  c.mint(W, 7_000_000n, D + 120_000, 3);                                                      // in-period mint (from zero address)
  c.addTransfer({ block: D + 130_000, logIndex: 0, from: W, to: "0x0000000000000000000000000000000000000000", amount: 500_000n }); // burn
  c.addTransfer({ block: D + 134_999, logIndex: 0, from: THIRD, to: W, amount: 42n });        // last block in range
  c.addTransfer({ block: D + 135_000, logIndex: 0, from: OTHER, to: W, amount: 222n });       // boundary neighbour AFTER range (excluded)
}
export function scenario(): Scenario {
  const a = new FakeChain(); populate(a); const b = a.clone();
  const ts = (n: number) => a.ts(n);
  const sc: Scenario = { a, b, dual: makeDual(a, b), startUnix: BigInt(ts(D + 100_000) - 2), endUnix: BigInt(ts(D + 135_000) - 2), nowHead: a.head,
    head_register_late(i) { const id = a.register(W, i.args); b.register(W, i.args); a.records.get(id)!.registeredBlock = BigInt(a.head - 5); b.records.get(id)!.registeredBlock = BigInt(a.head - 5); return id; } };
  return sc;
}
export const requestFor = (s: Scenario, o: Partial<{ wallet: string; start: bigint; end: bigint; nonce: string }> = {}) =>
  createRequest({ registry: REGISTRY, expectedWallet: o.wallet ?? W, startUnix: o.start ?? s.startUnix, endUnix: o.end ?? s.endUnix, nowUnix: BigInt(s.a.ts(s.a.head)), nonce: o.nonce });
export async function issue(s: Scenario, req = requestFor(s), salt?: string): Promise<Issuance> {
  return prepareIssuance({ dual: s.dual, request: req, registry: REGISTRY, profile, salt, scan: { concurrency: 4 } });
}
export function registerBoth(s: Scenario, owner: string, i: Issuance): string {
  const id = s.a.register(owner, i.args); s.b.register(owner, i.args); return id;
}
export const verify = (s: Scenario, file: Uint8Array | undefined, owner: string, link?: string, dual = s.dual): Promise<VerifyResult> =>
  verifyStatement({ file, owner, requestLink: link, dual, profiles, registry: REGISTRY, scan: { concurrency: 4 } });
