import { describe, expect, it } from "vitest";
import { keccak256, toUtf8Bytes } from "ethers";
import { canonicalJson, dataHashOf, parseCanonical, STATEMENT_TAG } from "../src/canonical";
import { BankableError, InconclusiveError } from "../src/errors";
import { computeRequestId, createRequest, dayStartUnix, encodeRequestFragment, inclusiveDaysToPeriod, parseRequestLink, requestLink, validateRequest } from "../src/request";
import { attachHeaders, classify, mergeLogs, parseTransferLog, type RawLog } from "../src/ledger";
import { overallOf, pass, fail, inconclusive, notChecked, type CheckResult, type Checks } from "../src/verdict";
import { confirmRegistration } from "../src/issue";
import { recordId } from "../src/registry";
import { QUSDC_ADDRESS, TRANSFER_TOPIC } from "../src/constants";
import { statement, manyEntries, OWNER, OTHER, REGISTRY } from "./fixtures";
import { W, issue, registerBoth, requestFor, scenario, REGISTRY as SCEN_REGISTRY } from "./helpers/scenario";

const word = (hex: string) => hex.replace("0x", "").padStart(64, "0");
describe("request id is the specified ABI commitment (independent hand encoding)", () => {
  it("matches keccak256(abi.encode(string,uint256,address,address,address,uint64,uint64,bytes32)) built by hand", () => {
    const r = { chainId: 1990n, registry: REGISTRY, token: QUSDC_ADDRESS, expectedWallet: OWNER, startUnix: 1_760_000_000n, endUnix: 1_760_086_400n, nonce: "0x" + "ab".repeat(32) };
    const str = "bankable-request";
    const enc = "0x" + word((8 * 32).toString(16)) /* head offset of the string (8 slots) */ + word("7c6") + word(r.registry) + word(r.token) + word(r.expectedWallet) + word(r.startUnix.toString(16)) + word(r.endUnix.toString(16)) + word(r.nonce)
      + word(str.length.toString(16)) + Buffer.from(str).toString("hex").padEnd(64, "0");
    expect(computeRequestId(r)).toBe(keccak256(enc));
  });
});
describe("request links", () => {
  const ok = () => requestFor(scenario());
  it("round-trips and keeps the nonce out of the query string", () => {
    const r = ok(); const l = requestLink("https://x.example", "/new", r);
    expect(parseRequestLink(l)).toEqual(r); expect(l.split("#")[0]).not.toContain("nonce");
  });
  for (const [name, mut] of [["missing field", (f: string) => f.replace(/&nonce=[^&]+/, "")], ["duplicate field", (f: string) => f + "&wallet=" + OTHER], ["extra field", (f: string) => f + "&x=1"], ["bad version", (f: string) => f.replace("v=1", "v=2")], ["non-numeric start", (f: string) => f.replace(/start=\d+/, "start=1e9")], ["leading zero", (f: string) => f.replace(/end=(\d+)/, "end=0$1")], ["short nonce", (f: string) => f.replace(/nonce=0x[0-9a-f]+/, "nonce=0x12")], ["bad address", (f: string) => f.replace(/wallet=0x[0-9a-f]{40}/, "wallet=0x12")]] as const)
    it(`rejects ${name}`, () => { expect(() => parseRequestLink(mut(encodeRequestFragment(ok())))).toThrow(BankableError); });
  it("calendar math: inclusive days to [start, next midnight), leap day, invalid dates", () => {
    expect(inclusiveDaysToPeriod("2028-02-29", "2028-02-29")).toEqual({ startUnix: dayStartUnix(2028, 2, 29), endUnix: dayStartUnix(2028, 3, 1) });
    expect(inclusiveDaysToPeriod("2026-11-01", "2026-11-30").endUnix - inclusiveDaysToPeriod("2026-11-01", "2026-11-30").startUnix).toBe(30n * 86400n);
    expect(() => inclusiveDaysToPeriod("2026-02-30", "2026-03-01")).toThrow(BankableError);
    expect(() => inclusiveDaysToPeriod("26-1-1", "2026-03-01")).toThrow(BankableError);
  });
  it("validateRequest rejects future periods and zero values", () => {
    const r = ok(); const cfg = { registry: SCEN_REGISTRY, nowUnix: r.endUnix - 1n };
    expect(() => validateRequest(r, cfg)).toThrow(/completed/);
    expect(() => createRequest({ registry: REGISTRY, expectedWallet: "0x" + "0".repeat(40), startUnix: 1n, endUnix: 2n, nowUnix: 10n })).toThrow(BankableError);
  });
});

describe("canonical statement", () => {
  const d = statement(manyEntries(5));
  it("serialises with no whitespace and the data hash is keccak256 of the exact UTF-8", () => {
    const j = canonicalJson(d); expect(j).not.toMatch(/\s/); expect(j.startsWith(`["${STATEMENT_TAG}"`)).toBe(true);
    expect(dataHashOf(d)).toBe(keccak256(toUtf8Bytes(j)));
  });
  it("round-trips through the strict parser", () => { expect(parseCanonical(canonicalJson(d))).toEqual(d); });
  const j = canonicalJson(d);
  for (const [name, bad] of [
    ["whitespace", j.replace('","', '", "')], ["uppercase hex", j.replace("abc", "ABC")], ["numeric instead of string", j.replace('"1990"', "1990")],
    ["leading zero", j.replace('"1990"', '"01990"')], ["trailing garbage", j + " "], ["object instead of array", "{}"], ["short array", JSON.stringify(JSON.parse(j).slice(0, 10))],
    ["bad direction", j.replace('"C"]', '"X"]')], ["float amount", j.replace('"1000000"', '"1000000.5"')],
  ] as const) it(`rejects ${name}`, () => { expect(bad, "mutation must actually change the input").not.toBe(j); expect(() => parseCanonical(bad)).toThrow(BankableError); });
});

describe("log parsing is strict", () => {
  const T = (a: string) => "0x" + "0".repeat(24) + a.slice(2);
  const good: RawLog = { address: QUSDC_ADDRESS, topics: [TRANSFER_TOPIC, T(OTHER), T(OWNER)], data: "0x" + "0".repeat(63) + "5", blockNumber: "0x10", blockHash: "0x" + "1".repeat(64), transactionHash: "0x" + "2".repeat(64), logIndex: "0x1", removed: false };
  it("accepts a well-formed Transfer", () => { expect(parseTransferLog(good)).toMatchObject({ block: 16n, amount: 5n, from: OTHER, to: OWNER }); });
  for (const [name, mut] of [
    ["removed", { removed: true }], ["wrong contract", { address: OTHER }], ["ERC-721 style (4 topics)", { topics: [...good.topics, T(OWNER)] }], ["wrong event", { topics: ["0x" + "9".repeat(64), good.topics[1]!, good.topics[2]!] }],
    ["short data", { data: "0x01" }], ["long data", { data: "0x" + "0".repeat(66) }], ["dirty address topic", { topics: [TRANSFER_TOPIC, "0x" + "f".repeat(64), good.topics[2]!] }], ["non-canonical quantity", { blockNumber: "0x010" }], ["bad block hash", { blockHash: "0x12" }],
  ] as const) it(`rejects ${name}`, () => { expect(() => parseTransferLog({ ...good, ...(mut as any) })).toThrow(BankableError); });
  it("merges the two filters, de-duplicates a self-transfer, and fails on conflicting duplicates", () => {
    const self: RawLog = { ...good, topics: [TRANSFER_TOPIC, T(OWNER), T(OWNER)] };
    expect(mergeLogs([[self], [self]])).toHaveLength(1);
    expect(() => mergeLogs([[good], [{ ...good, data: "0x" + "0".repeat(63) + "6" }]])).toThrow(/share a block hash/);
  });
  it("classify rejects logs that do not involve the owner; attachHeaders rejects hash mismatches and missing headers", () => {
    const p = mergeLogs([[good]]); const rng = { fromBlock: 1n, toBlock: 100n };
    expect(() => attachHeaders(p, new Map(), rng)).toThrow(InconclusiveError);
    expect(() => attachHeaders(p, new Map([[16n, { number: 16n, hash: "0x" + "3".repeat(64), timestamp: 1n }]]), rng)).toThrow(/does not match header/);
    const entries = attachHeaders(p, new Map([[16n, { number: 16n, hash: good.blockHash, timestamp: 1n }]]), rng);
    expect(() => classify(entries, THIRD_ADDR)).toThrow(BankableError);
    expect(classify(entries, OWNER)[0]!.direction).toBe("C");
  });
});
const THIRD_ADDR = "0x7777777777777777777777777777777777777777";

describe("verdict state machine (exhaustive)", () => {
  const S: CheckResult[] = [pass(), fail("x"), inconclusive("x"), notChecked()];
  it("never produces a verified state unless issued, content, status all pass and request is pass or not-checked; any fail dominates", () => {
    for (const i of S) for (const c of S) for (const s of S) for (const r of S) {
      const checks: Checks = { issued: i, content: c, status: s, request: r }; const o = overallOf(checks, { fileSupplied: true });
      const corePass = [i, c, s].every((x) => x.status === "pass");
      const anyFail = [i, c, s, r].some((x) => x.status === "fail");
      if (anyFail) expect(o).toBe("failed");
      else if (corePass && r.status === "pass") expect(o).toBe("verified-request-matched");
      else if (corePass && r.status === "not-checked") expect(o).toBe("verified-request-not-checked");
      else expect(o).toBe("inconclusive");
    }
    expect(overallOf({ issued: pass(), content: pass(), status: pass(), request: pass() }, { fileSupplied: false })).toBe("not-checked-qr-only");
  });
});

describe("confirmRegistration (read-back)", () => {
  it("returns the record once both endpoints show it at a confirmed block and every field matches", async () => {
    const s = scenario(); const i = await issue(s); registerBoth(s, W, i);
    const r = await confirmRegistration({ dual: s.dual, owner: W, issuance: i, receiptBlock: BigInt(s.a.head - 30), sleep: async () => {} });
    expect(r.id).toBe(recordId(W, i.pdfHash)); expect(r.record.dataHash).toBe(i.dataHash);
  });
  it("fails loudly if any field differs from what was submitted", async () => {
    const s = scenario(); const i = await issue(s); registerBoth(s, W, i); s.b.records.get(recordId(W, i.pdfHash))!.fromBlock += 1n;
    await expect(confirmRegistration({ dual: s.dual, owner: W, issuance: i, receiptBlock: BigInt(s.a.head - 30), sleep: async () => {} })).rejects.toMatchObject({ code: "readback-mismatch" });
  });
  it("times out as Inconclusive if the record never becomes visible (no early release)", async () => {
    const s = scenario(); const i = await issue(s); let t = 0;
    await expect(confirmRegistration({ dual: s.dual, owner: W, issuance: i, receiptBlock: 1n, timeoutMs: 1000, now: () => (t += 600), sleep: async () => {} })).rejects.toBeInstanceOf(InconclusiveError);
  });
});
