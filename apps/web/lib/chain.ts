import { ChainReader, JsonRpcClient, loadProfiles, PROFILE_MANIFESTS, type Dual } from "@bankable/core";
import { REGISTRY, RPC_A, RPC_B } from "./config";

/** Two distinct endpoints, read directly from the browser (G1: both send access-control-allow-origin: *). */
export function makeDual(registry = REGISTRY): Dual {
  const mk = (id: string, url: string) => new ChainReader(new JsonRpcClient({ id, url }, { timeoutMs: 30000, retries: 2, backoffMs: 700 }), registry);
  return { a: mk("rpc1", RPC_A), b: mk("rpc5", RPC_B) };
}
export const profiles = loadProfiles(PROFILE_MANIFESTS);
/** The profile this build issues with: the newest committed manifest. */
export const currentProfile = [...profiles.values()].at(-1)!;
