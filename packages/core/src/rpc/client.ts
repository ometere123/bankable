import { InconclusiveError } from "../errors";

/** Section 10: allowlisted read-only methods only. Nothing here can sign, send or write. */
export const ALLOWED_METHODS = new Set(["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getLogs", "eth_call", "eth_getCode", "eth_getTransactionReceipt"]);

export interface Endpoint { id: string; url: string }
export interface ClientOptions {
  timeoutMs?: number; retries?: number; backoffMs?: number;
  fetchImpl?: typeof fetch;
  /** shared budget: calls fail with Inconclusive after this many total attempts (bounded retries, section 6.4) */
  maxAttempts?: number;
}
export interface RpcStats { calls: number; retries: number; failures: number }

export class JsonRpcClient {
  readonly stats: RpcStats = { calls: 0, retries: 0, failures: 0 };
  private nextId = 1;
  constructor(readonly endpoint: Endpoint, private opts: ClientOptions = {}) {}

  async call<T = unknown>(method: string, params: unknown[]): Promise<T> {
    if (!ALLOWED_METHODS.has(method)) throw new InconclusiveError("method-not-allowed", `RPC method ${method} is not allowlisted`);
    const { timeoutMs = 30_000, retries = 2, backoffMs = 400, fetchImpl = fetch } = this.opts;
    let lastErr = "";
    for (let attempt = 0; attempt <= retries; attempt++) {
      this.stats.calls++;
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(this.endpoint.url, {
          method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", referrerPolicy: "no-referrer",
          body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }), signal: ctl.signal,
        });
        if (res.status === 429 || res.status >= 500) { lastErr = `HTTP ${res.status}`; }
        else if (!res.ok) { this.stats.failures++; throw new InconclusiveError("rpc-http", `${this.endpoint.id}: HTTP ${res.status}`); }
        else {
          let j: any; try { j = await res.json(); } catch { throw new InconclusiveError("rpc-bad-json", `${this.endpoint.id}: response is not JSON`); }
          if (j?.error) {
            // A JSON-RPC error (range limit, pruned state, ...) is deterministic: do not retry, never treat as data.
            this.stats.failures++;
            throw new InconclusiveError("rpc-error", `${this.endpoint.id}: ${method}: ${String(j.error.message ?? "error").slice(0, 200)}`);
          }
          if (!("result" in j)) throw new InconclusiveError("rpc-bad-json", `${this.endpoint.id}: no result field`);
          return j.result as T;
        }
      } catch (e) {
        if (e instanceof InconclusiveError) throw e;
        lastErr = (e as Error)?.name === "AbortError" ? "timeout" : String((e as Error)?.message ?? e);
      } finally { clearTimeout(timer); }
      if (attempt < retries) { this.stats.retries++; await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1))); }
    }
    this.stats.failures++;
    throw new InconclusiveError("rpc-unavailable", `${this.endpoint.id}: ${method} failed after ${retries + 1} attempts (${lastErr})`);
  }
}
