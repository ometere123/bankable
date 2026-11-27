import { AbiCoder } from "ethers";
import { BankableError, InconclusiveError } from "../errors";
import { QIE_MAINNET_CHAIN_ID, QUSDC_ADDRESS, QUSDC_DECIMALS, TRANSFER_TOPIC, MAX_LOG_SPAN } from "../constants";
import { JsonRpcClient } from "./client";
import type { BlockHeader, RawLog } from "../ledger";
import { decodeRecord, encodeGetRecord, type RegistryRecord } from "../registry";

const hex = (n: bigint) => "0x" + n.toString(16);
const topicOf = (a: string) => "0x" + "0".repeat(24) + a.slice(2);

function parseHeader(b: any, expectNumber?: bigint): BlockHeader {
  if (!b || typeof b.hash !== "string" || typeof b.timestamp !== "string" || typeof b.number !== "string")
    throw new InconclusiveError("bad-block", "endpoint returned no such block or a malformed header");
  if (!/^0x[0-9a-f]{64}$/.test(b.hash)) throw new InconclusiveError("bad-block", "block hash malformed");
  const h = { number: BigInt(b.number), hash: b.hash as string, timestamp: BigInt(b.timestamp), parentHash: String(b.parentHash ?? "") };
  if (expectNumber !== undefined && h.number !== expectNumber) throw new InconclusiveError("bad-block", "endpoint returned a different block than requested");
  return h as BlockHeader & { parentHash: string };
}
export type Header = BlockHeader & { parentHash: string };

/** Typed, single-endpoint reads. Every state read uses an explicit pinned block number; never `latest` for evidence. */
export class ChainReader {
  constructor(readonly client: JsonRpcClient, readonly registry: string) {}
  get id() { return this.client.endpoint.id; }

  async chainId(): Promise<bigint> { return BigInt(await this.client.call<string>("eth_chainId", [])); }
  async head(): Promise<bigint> { return BigInt(await this.client.call<string>("eth_blockNumber", [])); }
  async block(n: bigint): Promise<Header> { return parseHeader(await this.client.call("eth_getBlockByNumber", [hex(n), false]), n) as Header; }
  /** Receipt of a transaction, or null while it is not yet mined. */
  async receipt(txHash: string): Promise<any | null> { return this.client.call("eth_getTransactionReceipt", [txHash]); }
  async code(addr: string, at: bigint): Promise<string> { return this.client.call<string>("eth_getCode", [addr, hex(at)]); }

  async balanceOf(owner: string, at: bigint): Promise<bigint> {
    const data = "0x70a08231" + "0".repeat(24) + owner.slice(2);
    const r = await this.client.call<string>("eth_call", [{ to: QUSDC_ADDRESS, data }, hex(at)]);
    if (!/^0x[0-9a-fA-F]{64}$/.test(r)) throw new InconclusiveError("bad-balance", `${this.id}: balanceOf did not return a uint256 at block ${at}`);
    return BigInt(r);
  }
  async decimals(at: bigint): Promise<number> {
    const r = await this.client.call<string>("eth_call", [{ to: QUSDC_ADDRESS, data: "0x313ce567" }, hex(at)]);
    if (!/^0x[0-9a-fA-F]{64}$/.test(r)) throw new InconclusiveError("bad-decimals", `${this.id}: decimals() malformed`);
    return Number(BigInt(r));
  }
  /** Token is the expected QUSDC: code present at the pinned block, 6 decimals. */
  async verifyToken(at: bigint): Promise<void> {
    if ((await this.chainId()) !== QIE_MAINNET_CHAIN_ID) throw new BankableError("wrong-chain", `${this.id} is not chain 1990`);
    const code = await this.code(QUSDC_ADDRESS, at);
    if (code === "0x") throw new BankableError("no-token", "QUSDC has no code at the pinned block");
    if ((await this.decimals(at)) !== QUSDC_DECIMALS) throw new BankableError("bad-decimals", "QUSDC decimals differ from the verified 6");
  }
  async getRecord(id: string, at: bigint): Promise<RegistryRecord | null> {
    const r = await this.client.call<string>("eth_call", [{ to: this.registry, data: encodeGetRecord(id) }, hex(at)]);
    return decodeRecord(r);
  }
  /** Both indexed filters over one span (<= MAX_LOG_SPAN). */
  async transferLogs(owner: string, from: bigint, to: bigint, role: "sender" | "recipient"): Promise<RawLog[]> {
    if (to - from + 1n > BigInt(MAX_LOG_SPAN)) throw new InconclusiveError("span-too-large", "internal: log span above the endpoint limit");
    const topics = role === "sender" ? [TRANSFER_TOPIC, topicOf(owner)] : [TRANSFER_TOPIC, null, topicOf(owner)];
    const r = await this.client.call<RawLog[]>("eth_getLogs", [{ address: QUSDC_ADDRESS, fromBlock: hex(from), toBlock: hex(to), topics }]);
    if (!Array.isArray(r)) throw new InconclusiveError("bad-logs", `${this.id}: eth_getLogs did not return an array`);
    return r;
  }
  static encodeUint = (v: bigint) => AbiCoder.defaultAbiCoder().encode(["uint256"], [v]);
}
