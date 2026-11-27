import { registryInterface, QIE_MAINNET_CHAIN_ID } from "@bankable/core";
import { CHAIN_ID_HEX, EXPLORER, RPC_A, REGISTRY } from "./config";

export interface Eip1193 { request(a: { method: string; params?: unknown[] }): Promise<any>; on?(ev: string, fn: (...a: any[]) => void): void; removeListener?(ev: string, fn: (...a: any[]) => void): void }
export interface Discovered { info: { uuid: string; name: string; rdns: string; icon: string }; provider: Eip1193 }

/** EIP-6963 discovery. Never detect by isMetaMask (spec 4.2). QIE Wallet announces rdns "me.qiewallet"; window.qie is the documented fallback. */
export function discoverQieWallet(timeoutMs = 1000): Promise<Discovered | null> {
  return new Promise((resolve) => {
    const found: Discovered[] = [];
    const onAnnounce = (e: Event) => { const d = (e as CustomEvent).detail as Discovered; if (d?.info?.rdns === "me.qiewallet") found.push(d); };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      const fallback = (window as any).qie as Eip1193 | undefined;
      resolve(found[0] ?? (fallback ? { info: { uuid: "window.qie", name: "QIE Wallet (window.qie)", rdns: "me.qiewallet", icon: "" }, provider: fallback } : null));
    }, timeoutMs);
  });
}

/** User-initiated only: calling this is the "connect" action. */
export async function requestAccount(p: Eip1193): Promise<string> {
  const accts: string[] = await p.request({ method: "eth_requestAccounts" });
  if (!accts?.length) throw new Error("wallet returned no account");
  return accts[0]!.toLowerCase();
}
export async function walletChainId(p: Eip1193): Promise<bigint> { return BigInt(await p.request({ method: "eth_chainId" })); }
export async function ensureQieChain(p: Eip1193): Promise<void> {
  if ((await walletChainId(p)) === QIE_MAINNET_CHAIN_ID) return;
  try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] }); }
  catch (e: any) {
    if (e?.code !== 4902) throw e;
    await p.request({ method: "wallet_addEthereumChain", params: [{ chainId: CHAIN_ID_HEX, chainName: "QIE Mainnet", nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 }, rpcUrls: [RPC_A], blockExplorerUrls: [EXPLORER] }] });
  }
  if ((await walletChainId(p)) !== QIE_MAINNET_CHAIN_ID) throw new Error("wallet is not on QIE mainnet (1990)");
}
export async function sendRegister(p: Eip1193, from: string, args: Record<string, any>): Promise<string> {
  const data = registryInterface.encodeFunctionData("register", [args.startUnix, args.endUnix, args.fromBlock, args.toBlock, args.requestId, args.issuanceSalt, args.dataHash, args.pdfHash, args.rendererId]);
  return p.request({ method: "eth_sendTransaction", params: [{ from, to: REGISTRY, data }] });
}
export async function sendRevoke(p: Eip1193, from: string, id: string): Promise<string> {
  return p.request({ method: "eth_sendTransaction", params: [{ from, to: REGISTRY, data: registryInterface.encodeFunctionData("revoke", [id]) }] });
}
