// TEST FIXTURE ONLY: a deterministic in-memory fake of the QIE JSON-RPC surface Bankable uses.
// It exercises the real JsonRpcClient/ChainReader/dual-endpoint code. It is never used outside automated tests.
import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
import { QUSDC_ADDRESS, QUSDC_DEPLOYMENT_BLOCK, TRANSFER_TOPIC, ZERO_ADDRESS } from "../../src/constants";
import { recordId, registryInterface, type RegistryRecord } from "../../src/registry";

export interface FakeTransfer { block: number; logIndex: number; txHash: string; from: string; to: string; amount: bigint }
const hx = (n: number | bigint) => "0x" + BigInt(n).toString(16);
const pad32 = (a: string) => "0x" + "0".repeat(24) + a.slice(2).toLowerCase();

export class FakeChain {
  chainId = 1990n;
  deployment = QUSDC_DEPLOYMENT_BLOCK;
  t0 = 1_768_669_800;      // timestamp of the deployment block
  blockTime = 4;
  head: number;
  seed = "fake";
  transfers: FakeTransfer[] = [];
  records = new Map<string, RegistryRecord>();
  decimals = 6n;
  // failure / divergence injection
  failMethods = new Set<string>();      // method name -> always HTTP 503
  hangMethods = new Set<string>();      // method name -> never resolves until aborted
  dropLogs = (_l: FakeTransfer) => false;
  balanceSkew = 0n;
  removedLogs = false;
  jsonRpcError: { method: string; message: string } | null = null;
  calls: Record<string, number> = {};
  receipts = new Map<string, any>();
  registryAddress = "0x5555555555555555555555555555555555555555";

  constructor(headOffset = 300_000) { this.head = this.deployment + headOffset; }
  clone(): FakeChain { const c = new FakeChain(); Object.assign(c, this); c.transfers = [...this.transfers]; c.records = new Map(this.records); c.failMethods = new Set(this.failMethods); c.hangMethods = new Set(this.hangMethods); c.calls = {}; c.receipts = new Map(this.receipts); c.serve = c.serveFactory(); return c; }

  ts(n: number) { return this.t0 + (n - this.deployment) * this.blockTime; }
  hash(n: number) { return keccak256(toUtf8Bytes(`${this.seed}:block:${n}`)); }
  blockAtTime(unix: number) { return this.deployment + Math.ceil((unix - this.t0) / this.blockTime); }

  addTransfer(t: Omit<FakeTransfer, "txHash"> & { txHash?: string }) { this.transfers.push({ txHash: t.txHash ?? keccak256(toUtf8Bytes(`tx:${t.block}:${t.logIndex}:${t.amount}`)), ...t }); this.transfers.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex); }
  mint(to: string, amount: bigint, block: number, logIndex = 0) { this.addTransfer({ block, logIndex, from: ZERO_ADDRESS, to, amount }); }
  balance(addr: string, atBlock: number): bigint {
    let b = 0n; for (const t of this.transfers) { if (t.block > atBlock) break; if (t.to === addr) b += t.amount; if (t.from === addr) b -= t.amount; } return b;
  }
  register(owner: string, a: { startUnix: bigint; endUnix: bigint; fromBlock: bigint; toBlock: bigint; requestId: string; issuanceSalt: string; dataHash: string; pdfHash: string; rendererId: string }) {
    const id = recordId(owner, a.pdfHash);
    if (this.records.has(id)) throw new Error("duplicate");
    this.records.set(id, { owner, ...a, registeredBlock: BigInt(this.head - 30), revokedBlock: 0n });
    return id;
  }
  revoke(id: string, atBlock = this.head - 20) { const r = this.records.get(id)!; r.revokedBlock = BigInt(atBlock); }

  /** Executes a registry transaction (register/revoke) as a wallet would, producing a receipt. `ok:false` models an on-chain failure. */
  sendTx(from: string, data: string, txHash: string, registerAtBlock = this.head - 30) {
    const parsed = registryInterface.parseTransaction({ data })!;
    let status = "0x1"; const logs: any[] = [];
    try {
      if (parsed.name === "register") {
        const a = parsed.args;
        const id = this.register(from, { startUnix: a[0], endUnix: a[1], fromBlock: a[2], toBlock: a[3], requestId: a[4], issuanceSalt: a[5], dataHash: a[6], pdfHash: a[7], rendererId: a[8] });
        this.records.get(id)!.registeredBlock = BigInt(registerAtBlock);
        const enc = registryInterface.encodeEventLog(registryInterface.getEvent("StatementRegistered")!, [id, from, a[4], a[6], a[7], a[2], a[3]]);
        logs.push({ address: this.registryAddress, topics: enc.topics, data: enc.data, blockNumber: hx(registerAtBlock), transactionHash: txHash, logIndex: "0x0", blockHash: this.hash(registerAtBlock), transactionIndex: "0x0", removed: false });
      } else if (parsed.name === "revoke") {
        const r = this.records.get(parsed.args[0]); if (!r || r.owner !== from.toLowerCase() || r.revokedBlock !== 0n) throw new Error("revert");
        this.revoke(parsed.args[0], registerAtBlock);
      }
    } catch { status = "0x0"; }
    this.receipts.set(txHash, { transactionHash: txHash, status, blockNumber: hx(registerAtBlock), to: this.registryAddress, from, logs: status === "0x1" ? logs : [] });
  }
  private logObj(t: FakeTransfer) {
    return { address: QUSDC_ADDRESS, topics: [TRANSFER_TOPIC, pad32(t.from), pad32(t.to)], data: AbiCoder.defaultAbiCoder().encode(["uint256"], [t.amount]),
      blockNumber: hx(t.block), blockHash: this.hash(t.block), transactionHash: t.txHash, transactionIndex: "0x0", logIndex: hx(t.logIndex), removed: this.removedLogs };
  }
  private handle(method: string, params: any[]): any {
    this.calls[method] = (this.calls[method] ?? 0) + 1;
    if (this.jsonRpcError && this.jsonRpcError.method === method) throw { rpc: this.jsonRpcError.message };
    const num = (v: string) => Number(BigInt(v));
    switch (method) {
      case "eth_chainId": return hx(this.chainId);
      case "eth_blockNumber": return hx(this.head);
      case "eth_getBlockByNumber": {
        const n = num(params[0]); if (n > this.head || n < 0) return null;
        return { number: hx(n), hash: this.hash(n), parentHash: n > 0 ? this.hash(n - 1) : "0x" + "0".repeat(64), timestamp: hx(n < this.deployment ? this.t0 - (this.deployment - n) * this.blockTime : this.ts(n)) };
      }
      case "eth_getTransactionReceipt": return this.receipts.get(params[0]) ?? null;
      case "eth_getCode": {
        const to = String(params[0]).toLowerCase(); const at = num(params[1]);
        if (to === QUSDC_ADDRESS) return at >= this.deployment ? "0x6080604052" : "0x";
        return "0x6080";
      }
      case "eth_getLogs": {
        const f = params[0]; const from = num(f.fromBlock), to = num(f.toBlock);
        if (to - from + 1 > 10000) throw { rpc: "maximum [from, to] blocks distance: 10000" };
        if (String(f.address).toLowerCase() !== QUSDC_ADDRESS) return [];
        const [t0, t1, t2] = f.topics;
        return this.transfers.filter((t) => t.block >= from && t.block <= to && !this.dropLogs(t) && (!t0 || t0 === TRANSFER_TOPIC) && (!t1 || t1 === pad32(t.from)) && (!t2 || t2 === pad32(t.to))).map((t) => this.logObj(t));
      }
      case "eth_call": {
        const { to, data } = params[0]; const at = num(params[1]); const sel = String(data).slice(0, 10);
        if (String(to).toLowerCase() === QUSDC_ADDRESS) {
          if (sel === "0x313ce567") return AbiCoder.defaultAbiCoder().encode(["uint256"], [this.decimals]);
          if (sel === "0x70a08231") { const who = "0x" + String(data).slice(34, 74).toLowerCase(); return AbiCoder.defaultAbiCoder().encode(["uint256"], [this.balance(who, at) + this.balanceSkew]); }
        } else if (sel === registryInterface.getFunction("getRecord")!.selector) {
          const id = "0x" + String(data).slice(10, 74); const r = this.records.get(id);
          const rec = r ?? { owner: ZERO_ADDRESS, startUnix: 0n, endUnix: 0n, fromBlock: 0n, toBlock: 0n, registeredBlock: 0n, revokedBlock: 0n, requestId: "0x" + "0".repeat(64), issuanceSalt: "0x" + "0".repeat(64), dataHash: "0x" + "0".repeat(64), pdfHash: "0x" + "0".repeat(64), rendererId: "0x" + "0".repeat(64) };
          const zero = { ...rec, owner: ZERO_ADDRESS, startUnix: 0n, endUnix: 0n, fromBlock: 0n, toBlock: 0n, registeredBlock: 0n, revokedBlock: 0n, requestId: '0x'+'0'.repeat(64), issuanceSalt: '0x'+'0'.repeat(64), dataHash: '0x'+'0'.repeat(64), pdfHash: '0x'+'0'.repeat(64), rendererId: '0x'+'0'.repeat(64) };
          // faithful historical semantics: state at block N reflects only what happened at or before N
          const visible = !r || BigInt(at) < r.registeredBlock ? zero : (r.revokedBlock !== 0n && BigInt(at) < r.revokedBlock ? { ...rec, revokedBlock: 0n } : rec);
          return registryInterface.encodeFunctionResult("getRecord", [visible]);
        }
        throw { rpc: "execution reverted" };
      }
    }
    throw { rpc: `method ${method} not found` };
  }
  get fetchImpl(): typeof fetch { return (async (_url: any, init: any) => this.serve(init)) as typeof fetch; }
  private serveFactory(): (init: any) => Promise<Response> { return async (init: any): Promise<Response> => {
    const body = JSON.parse(String(init.body)); const method = body.method as string;
    if (this.hangMethods.has(method)) return new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    if (this.failMethods.has(method)) return new Response("unavailable", { status: 503 });
    try { const result = this.handle(method, body.params); return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 }); }
    catch (e: any) { if (e?.rpc) return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: e.rpc } }), { status: 200 }); throw e; }
  }; }
  private serve: (init: any) => Promise<Response> = this.serveFactory();
}
