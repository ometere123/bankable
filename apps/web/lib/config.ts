import { QIE_MAINNET_CHAIN_ID } from "@bankable/core";

/** Public, non-secret configuration baked in at build time. */
export const REGISTRY = (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? "").toLowerCase();
export const RPC_A = process.env.NEXT_PUBLIC_QIE_RPC_A ?? "https://rpc1mainnet.qie.digital";
export const RPC_B = process.env.NEXT_PUBLIC_QIE_RPC_B ?? "https://rpc5mainnet.qie.digital";
export const EXPLORER = "https://mainnet.qie.digital";
export const CHAIN_ID_HEX = "0x" + QIE_MAINNET_CHAIN_ID.toString(16);
export const registryConfigured = /^0x[0-9a-f]{40}$/.test(REGISTRY);
export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;
export const explorerTx = (h: string) => `${EXPLORER}/tx/${h}`;
export const explorerBlock = (n: bigint | string) => `${EXPLORER}/block/${n}`;
