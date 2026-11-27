import { AbiCoder, Interface, keccak256 } from "ethers";
import { BankableError } from "./errors";

export const REGISTRY_ABI = [
  "function register(uint64 startUnix, uint64 endUnix, uint64 fromBlock, uint64 toBlock, bytes32 requestId, bytes32 issuanceSalt, bytes32 dataHash, bytes32 pdfHash, bytes32 rendererId) returns (bytes32 id)",
  "function revoke(bytes32 id)",
  "function getRecord(bytes32 id) view returns (tuple(address owner, uint64 startUnix, uint64 endUnix, uint64 fromBlock, uint64 toBlock, uint64 registeredBlock, uint64 revokedBlock, bytes32 requestId, bytes32 issuanceSalt, bytes32 dataHash, bytes32 pdfHash, bytes32 rendererId))",
  "event StatementRegistered(bytes32 indexed id, address indexed owner, bytes32 indexed requestId, bytes32 dataHash, bytes32 pdfHash, uint64 fromBlock, uint64 toBlock)",
  "event StatementRevoked(bytes32 indexed id, address indexed owner, uint64 revokedBlock)",
] as const;
export const registryInterface = new Interface(REGISTRY_ABI as unknown as string[]);

export interface RegistryRecord {
  owner: string; startUnix: bigint; endUnix: bigint; fromBlock: bigint; toBlock: bigint;
  registeredBlock: bigint; revokedBlock: bigint; requestId: string; issuanceSalt: string;
  dataHash: string; pdfHash: string; rendererId: string;
}

/** id = keccak256(abi.encode(owner, pdfHash)) -- owner-scoped, so another wallet cannot occupy someone's id. */
export function recordId(owner: string, pdfHash: string): string {
  return keccak256(AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [owner, pdfHash]));
}
export function encodeGetRecord(id: string): string { return registryInterface.encodeFunctionData("getRecord", [id]); }

/** Returns null when the record does not exist (owner == 0). Throws on a malformed return. */
export function decodeRecord(returnData: string): RegistryRecord | null {
  let r: any;
  try { r = registryInterface.decodeFunctionResult("getRecord", returnData)[0]; }
  catch { throw new BankableError("bad-record-return", "registry returned data that does not decode as a Record"); }
  if (/^0x0{40}$/i.test(r.owner)) return null;
  return {
    owner: String(r.owner).toLowerCase(), startUnix: r.startUnix, endUnix: r.endUnix, fromBlock: r.fromBlock, toBlock: r.toBlock,
    registeredBlock: r.registeredBlock, revokedBlock: r.revokedBlock, requestId: String(r.requestId).toLowerCase(),
    issuanceSalt: String(r.issuanceSalt).toLowerCase(), dataHash: String(r.dataHash).toLowerCase(),
    pdfHash: String(r.pdfHash).toLowerCase(), rendererId: String(r.rendererId).toLowerCase(),
  };
}
