// ethers v6's JsonRpcProvider uses Node's http module, which ignores HTTPS_PROXY. This subclass sends via global fetch instead
// (with NODE_USE_ENV_PROXY=1 that honours the proxy). Only needed inside restricted-egress sandboxes; harmless elsewhere.
import { JsonRpcProvider, type JsonRpcPayload, type JsonRpcResult, type JsonRpcError } from "ethers";
export class FetchProvider extends JsonRpcProvider {
  constructor(private url: string, chainId = 1990) { super(url, chainId, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 }); }
  async _send(payload: JsonRpcPayload | JsonRpcPayload[]): Promise<(JsonRpcResult | JsonRpcError)[]> {
    const r = await fetch(this.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const j = await r.json(); return Array.isArray(j) ? j : [j];
  }
}
