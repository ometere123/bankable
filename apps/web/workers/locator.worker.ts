/// <reference lib="webworker" />
// Isolated worker (spec 8/10): bounded, schema-strict locator extraction from PDF metadata. Never executes or renders the PDF.
import { extractLocator } from "@bankable/core";
self.onmessage = (e: MessageEvent<Uint8Array>) => {
  const l = extractLocator(e.data);
  (self as unknown as Worker).postMessage(l ? { chainId: l.chainId.toString(), registry: l.registry, owner: l.owner, profile: l.profile, dataHash: l.dataHash } : null);
};
