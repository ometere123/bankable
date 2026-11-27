import type { Metadata } from "next";
import { PROFILE_MANIFESTS, REGISTRY_ABI, rendererIdOf, QUSDC_ADDRESS, QIE_MAINNET_CHAIN_ID, MAX_LOG_SPAN } from "@bankable/core";
import { REGISTRY, RPC_A, RPC_B, EXPLORER, explorerAddress, registryConfigured } from "../../lib/config";
import { RegistryStatus } from "../../components/RegistryStatus";
import { HashRow } from "../../components/ui";

export const metadata: Metadata = { title: "Developers · Bankable", description: "The registry contract, renderer profile, verification protocol and the command-line verifier." };

export default function Developers() {
  const manifest = JSON.parse(PROFILE_MANIFESTS.at(-1)!) as { profile: string; origin: string };
  const rid = rendererIdOf(PROFILE_MANIFESTS.at(-1)!);
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Developers</div>
        <h1>Everything needed to <em>check it yourself</em></h1>
        <p className="lede">The contract, the renderer profile and the verifier are inspectable, and the verifier runs outside this site with endpoints you choose.</p>
      </div>

      <h2>Registry <em>contract</em></h2>
      {registryConfigured ? (
        <>
          <div className="plate">
            <HashRow label="Address" value={REGISTRY} href={explorerAddress(REGISTRY)} />
            <HashRow label="Chain" value={`QIE mainnet · ${QIE_MAINNET_CHAIN_ID}`} />
            <HashRow label="Token" value={QUSDC_ADDRESS} href={explorerAddress(QUSDC_ADDRESS)} />
            <RegistryStatus />
          </div>
          <p className="prose">Solidity 0.8.20 compiled for <code>paris</code>. Non-upgradeable, no admin, no custody, no payable functions. The record id is <code>keccak256(abi.encode(owner, pdfHash))</code>, so records are owner-scoped.</p>
        </>
      ) : <p className="err">This build has no registry address configured.</p>}
      <div className="codeblock" aria-label="Contract interface"><pre>{REGISTRY_ABI.map((l) => l.replace(/^(function|event) /, "$1 ")).join("\n")}</pre></div>

      <h2>Renderer <em>profile</em></h2>
      <div className="plate">
        <HashRow label="Profile" value={manifest.profile} />
        <HashRow label="Origin" value={manifest.origin} />
        <HashRow label="Renderer id" value={rid} />
      </div>
      <p className="prose"><code>rendererId = keccak256(manifest bytes)</code>. The manifest commits to the renderer source hashes, the locked dependency integrity, the fonts, the QR parameters and the verifier origin. The registry does not whitelist profiles: the verifier decides which it supports, and reissued records keep the profile they were registered with.</p>

      <h2>Verify from the <em>command line</em></h2>
      <p className="prose">The Node verifier uses the same pinned core as this site. It takes a PDF path, an owner, an optional request link and two RPC endpoints you choose, and it never contacts this site or a proxy.</p>
      <div className="codeblock"><pre>{`bankable-verify statement.pdf \\
  --owner 0x… --registry ${registryConfigured ? REGISTRY : "0x…"} \\
  --rpc-a ${RPC_A} \\
  --rpc-b ${RPC_B} \\
  [--request "<link>"] [--json]

# exit status: 0 verified · 1 failed · 2 inconclusive · 64 usage error`}</pre></div>

      <h2>Network <em>behaviour</em></h2>
      <div className="tablewrap"><table className="facts"><tbody>
        <tr><th>Endpoints</th><td className="mono">{RPC_A}<br />{RPC_B}</td></tr>
        <tr><th>Log query span</th><td>At most {MAX_LOG_SPAN.toLocaleString("en-US")} blocks per <code>eth_getLogs</code> call, on both endpoints.</td></tr>
        <tr><th>Methods used</th><td className="mono">eth_chainId, eth_blockNumber, eth_getBlockByNumber, eth_getLogs, eth_call, eth_getCode, eth_getTransactionReceipt</td></tr>
        <tr><th>Browser access</th><td>Both endpoints send <code>access-control-allow-origin: *</code>, so the page reads the chain directly with no proxy.</td></tr>
        <tr><th>Explorer</th><td><a href={EXPLORER}>{EXPLORER.replace("https://", "")}</a></td></tr>
      </tbody></table></div>

      <h2>Canonical <em>data</em></h2>
      <p className="prose">A JSON array of strings and nested arrays of strings: tag, renderer id, chain, registry, token, decimals, owner, request id, issuance salt, dates, block range and hashes, opening and closing in base units, then one row per entry. Hex is lowercase and fixed length, integers are canonical decimals, and any non-canonical input is rejected. <code>dataHash = keccak256(UTF-8 bytes)</code>; <code>pdfHash = SHA-256 of the final PDF</code>.</p>
      <div className="codeblock"><pre>{`requestId = keccak256(abi.encode(
  "bankable-request", chainId, registry, token,
  expectedWallet, startUnix, endUnix, nonce))`}</pre></div>
    </>
  );
}
