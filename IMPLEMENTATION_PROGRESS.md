# Bankable: Implementation Progress

Authoritative spec: *Bankable Master Build Specification v1.0* (27 Nov 2026). This is the living record of Phase 1
(project initialisation and core implementation). **Nothing is marked passed unless it was executed.** Fixture-based results are
labelled as such and are never presented as mainnet evidence.

Last updated: 2026-11-27 (registry deployed, mainnet acceptance 16/16, interface restyled from the Framer design system).

## 1. Current status

| Area | Status |
|---|---|
| G0 Capacity | Not mine to run (owner decision) |
| G1 Ledger | **PASS** on real QIE mainnet, with measured corrections to spec assumptions (section 3) |
| G2 Renderer | **PASS** across Node, Chromium and Firefox, after fixing a real cross-engine defect the gate found |
| G3 Mainnet and wallet | **PASS except the real QIE Wallet extension**: funded deployment, receipt, read-back, and explorer source verification (full match) are done on mainnet. A real QIE Wallet has not been used; only a mock |
| Tier 1 (request, issue, verify, registry, adversarial suite) | Implemented. **Live mainnet acceptance 16/16** (`docs/acceptance/mainnet-2026-11-27.json`), plus fixture chain, real browsers and a local real-EVM run |
| Tier 2 (CSV, CLI, QIE ID, explorer status, metadata locator) | Implemented and tested; live QIE ID and explorer paths verified against the real services |
| Registry deployed on mainnet | **Yes**, source-verified on the explorer (full match). Public address locked: `https://bankable-qie.vercel.app` (deployed to production on Vercel from commit 41bdc45, deployment `dpl_D6KyBabFob5FN3Q5vSxCwxri5FqT`; Vercel Authentication off, so it is public) |

## 2. Repository layout and toolchain

```
packages/core    shared TS core (pure logic + rpc/ adapter)           107 tests
packages/cli     independent Node verifier `bankable-verify`           8 tests
contracts        StatementRegistry.sol, deploy tooling                 23 tests
apps/web         static-export Next.js app + browser E2E               30 checks
scripts          gate probes, local chain-1990 fixture, live acceptance runner
docs/gates       recorded evidence for every gate and live check
docs/acceptance  acceptance transcripts (the one present is a LOCAL FIXTURE, not mainnet)
```

Pinned: Node 22, pnpm 10.33, TypeScript 5.9.3, ethers 6.17.0, pdf-lib 1.17.1, qrcode-generator 2.0.4, Next 16.4.6, React 19.1.10,
Hardhat 2.30.0, Solidity 0.8.20 (`evmVersion: paris`, optimizer 200), vitest 3.2.4, ESLint 9.39.5, typescript-eslint 8.72.2,
`@modelcontextprotocol/sdk` 1.32.2, tsx 4.23.15. Lockfile: `pnpm-lock.yaml`. Every pinned version is at least two weeks old.
No database, auth system or server infrastructure was introduced; the web app is a static export and reads chain data directly.

## 3. Validation gate results (actual; evidence in `docs/gates/`)

### G1 Ledger: PASS, with corrections to the spec
Run on 2026-11-27 against `rpc1mainnet.qie.digital` and `rpc5mainnet.qie.digital`.

| Property | Measured result | Evidence file |
|---|---|---|
| Chain id | 1990 on both | `g1-token-probe.json` |
| QUSDC | `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`, 6,096 bytes, `decimals()` 6, `name()` = `symbol()` = "QUSDC" | `g1-token-probe.json` |
| Contract nature (from explorer-verified source) | OpenZeppelin `ERC20 + AccessControl`; **`mint` and `burn(from, amount)` are `onlyRole(VAULT_ROLE)`**; no proxy/upgradeable/pausable/blacklist code; solc 0.8.20; explorer shows "verified" but **not "fully verified"**. A VAULT_ROLE holder can burn from any holder; this shows in statements as an outgoing transfer to the zero address | `g1-qusdc-verified-source.json` |
| Deployment block | 5,244,996 (ts 1768997480 = 2026-01-21 12:11:20 UTC); code absent at N-1, present at N on both endpoints. Periods starting before this are rejected (`before-token-history`), observed live | `g1-real-*.json`, tests |
| **Block time** | **about 3.6 s**, not the spec's ~2 s (a year is ~8.7M blocks) | `g1-logs-limits-probe.json` |
| **`eth_getLogs` span** | **10,000 blocks maximum** on both endpoints | `g1-logs-limits-probe.json` |
| Historical state | `eth_call balanceOf` at pinned historic blocks works at ~10 months depth; returns `0x` before deployment | `g1-real-14days-near-deployment.json` |
| Throughput | `getLogs` ceiling about 1.6 calls/s (rpc1) and about 1.1 calls/s (rpc5); more than ~8 concurrent only adds latency; **32 concurrent caused 25 of 48 calls to time out at 20 s**. Default scan concurrency 6, timeout 30 s | `g1-concurrency.txt` |
| Headers and batching | `getBlockByNumber` 40/s (rpc1) and 167/s (rpc5) at concurrency 16; batches of 50 accepted | `g1-headers-batch-cors.json` |
| **Browser CORS** | Real Chromium 158 and Firefox 155 on a foreign origin can POST JSON-RPC to **both** endpoints. **No proxy needed**. (Firefox test used a throwaway profile trusting only the sandbox proxy CA; verification stayed on) | `g1-browser-cors.json` |
| Strategy | **Plan A** (pinned historical balances at `fromBlock-1` and `toBlock`, both endpoints, must equal the reconstructed closing) | runs below |

Real mainnet runs of the actual `buildLedger` (dual endpoint, reconciled, zero retries and failures):

| Run | Blocks | Entries | Time | Result |
|---|---|---|---|---|
| 1 UTC day, recent | 23,892 | 6 | 38 s (incl. wallet discovery) | reconciled |
| same wallet, **31 days** | 731,844 | 6 | **139.7 s** | reconciled |
| 14 days from 2026-01-22 (~10 months deep) | 321,834 | 46 | 90.7 s | reconciled: 12,139.424286 - 3,070.225960 = 9,069.198326 |

**Published supported limits (spec 6.4):** period at most 31 days (about 150 `getLogs` per endpoint, **about 2.3 minutes measured**, slightly above
the spec's two-minute target; see deviations), at most 2,000 entries (about 1.1 MB PDF), PDF at most 2 MiB. Beyond that: Inconclusive or refusal, never silent truncation.

### G2 Renderer: PASS (after a real defect was found and fixed)
`g2-result.json`: 5 fixtures (no-activity, single, 120-entry, 600-entry, page-boundary), each rendered 35 times across Node 22.23.5, Chromium 158.0.8127.36
and Firefox 155.0 in three locale/timezone contexts with a fresh page per run: **one distinct SHA-256 per fixture**.

The **first run failed**: the 600-entry fixture differed on Chromium. Root cause: pdf-lib derives font resource names from a seeded RNG built on `Math.sin`,
whose last bit differs between V8 versions. Fix: a counter replaces `context.addRandomSuffix` (`render/pdf.ts`). Regression tests perturb `Math.sin`, `Math.random`,
clock and timezone; the `Math.sin` test was mutation-checked (fails without the fix). `updateMetadata:false` plus fixed dates leaves no `/ID` and no XMP.
Browsers also regenerate the exact same bytes during verification (E2E, section 7).

### G3 Mainnet and wallet: PASS except the real wallet extension
Verified **without funds** by executing on QIE mainnet's real EVM (`eth_call`, no transaction; `g3-evm-probe.json`):
- Geth-family node, EIP-1559 (base fee 1 gwei), block gas limit 4,294,967,295.
- **PUSH0 is supported**. The registry is compiled for `paris` as specified.
- The registry creation bytecode executes on QIE and returns exactly the local 2,147-byte runtime code.
- Deployment gas about 516,000 at about 1.12 gwei, so well under 0.001 QIE.
- A probe contract run inside one `eth_call` registers, reads back, revokes and exercises every revert path on the real EVM: **13 of 13 observations true**.
- The node **ignores `eth_call` state overrides**, which was not relied on. (An early probe that assumed support was discarded.)

**Done on mainnet (2026-11-27):** registry deployed at `0x1E9FC096bebe1f142AeeD317d0054583E9227804` (block 12203114, tx `0xb5251402c6b971633a510b8a36d47fc86a6a570ab68b2f70e5e65fd083e1bd0a`); on-chain runtime bytecode byte-identical to the local build; source submitted to the explorer's standard-JSON verification and reported **fully verified**; receipt and read-back through `confirmRegistration`; the complete spec 11.1 matrix **16/16** (`docs/acceptance/mainnet-2026-11-27.json`), including forged, third-party, revoked and reissued cases with real transactions. Total gas for deployment, three transfers and the acceptance run was about 0.002 QIE. The acceptance used the period 05:00 to 06:10 UTC (ledger: 4 entries, opening 0, closing 0.75 QUSDC), a completed range, because the core accepts any completed range (only the request form is whole-day).

**Not done:** QIE Wallet (`me.qiewallet`) chain-switch and transaction behaviour with the real extension; (earlier probe notes follow) explorer source
verification of the registry (the explorer is Blockscout v7.0.2 with an open API, so status reading is implemented; the submission flow is untested until deployment).
`rpc1testnet.qie.digital` reset connections from this environment, so no testnet run was possible.

## 4. Architectural decisions
1. Pure core never touches the network; `rpc/` supplies typed data through an allowlisted read-only client (`eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber`, `eth_getLogs`, `eth_call`, `eth_getCode`, `eth_getTransactionReceipt`).
2. Browser reads the two RPCs directly (G1 CORS result). Static export, no application server, strict CSP (no third-party scripts; connections only to the two RPCs, the Wallet MCP and the explorer), `no-referrer`.
3. Plan A scan; two indexed filters per 10,000-block chunk; both endpoints in parallel; merged and de-duplicated by (blockHash, logIndex); parentHash links checked at range boundaries.
4. Endpoint disagreement, truncation, reconciliation failure, removed logs, RPC errors and unknown profiles are **Inconclusive**. Established contradictions are **Failed**. A failure always dominates (`verdict.ts`, exhaustively tested).
5. Confirmation buffer of 12 blocks (about 43 s). A record inside the buffer is not yet visible to the verifier, so the issue flow waits for it (`confirmRegistration`) and compares every submitted field on both endpoints before releasing the download.
6. Renderer profile manifest commits to renderer source hashes, locked dependency integrity, fonts, QR parameters and origin. `rendererId = keccak256(manifest bytes)`. A test fails if the renderer or lockfile changes without a regenerated profile (mutation-checked).
7. Registry address lives in the canonical data, not the profile. The registry stores owner-scoped ids `keccak256(abi.encode(owner, pdfHash))`.
8. Locator extraction is a bounded, schema-strict byte scan in an isolated Web Worker with a hard timeout, not a PDF parser. It only pre-fills the owner field and never overwrites what the user typed.

## 5. Defects found by the tests and gates (and fixed)
1. **Cross-engine PDF divergence** (`Math.sin`-based resource names), found by G2.
2. **Owner pre-fill race** (the locator worker overwrote an owner the user had typed, hiding a forged file's real owner), found by the Firefox E2E; fixed with a functional state update.
3. ethers v6 caches identical calls for 250 ms and returned stale nonces to the live runner; `cacheTimeout: -1`.
4. Bundlers (Turbopack, webpack) do not map TypeScript `.js` import specifiers to `.ts`; core imports are now extensionless.
5. Test-bug class: no-op mutations and wrong constants initially passed or failed vacuously; mutation guards were added.
6. Local-fixture quirks (never product bugs): Hardhat `hardhat_mine` blocks have zero `parentHash` and no historical state; `hardhat_setCode` rewrites the latest block's view. The product's checks correctly refused both.

## 6. Deviations from the specification and justification
| Spec statement | Reality | Handling |
|---|---|---|
| ~2 s blocks [S5] | about 3.6 s | A year is 8.7M blocks; only limits change |
| "Target under two minutes" | 31 days takes about 140 s (rpc5 slower) | Cap stays 31 days (one calendar month), published as about 2.3 min. Lower the cap if strictly under two minutes is required |
| Entry cap unspecified | 5,000 would exceed the 2 MiB file cap | 2,000 |
| Hardhat `paris` | named `merge` in Hardhat 2.30 | In-process test network uses `merge` (no PUSH0) |
| Hardhat downloads solc | downloader ignores the egress proxy | solc 0.8.20 fetched with `curl` from `binaries.soliditylang.org`, sha256 matched the official list, placed in Hardhat's cache (sandbox workaround only) |
| `bankable.vercel.app` as the public address | already owned by another Vercel team (409) | `bankable-qie.vercel.app` attached to the project and verified; baked into the renderer profile |
| Tier 2 "accounting-import test" | no Xero or QuickBooks access | Real import into **LibreOffice** with exact-sum reconciliation (`tier2-import-test.json`). **No Xero/QuickBooks compatibility is claimed** |
| Wallet MCP "via a server route if browsers cannot reach it" | `mcp.qie.digital/mcp` answers CORS `*` with the MCP headers | Called directly from the browser; no server route |

## 7. Tests (actual results)

| Suite | Result | What it covers |
|---|---|---|
| `packages/core` vitest | **107 passed** | request/ID (independent hand-encoded ABI), strict parsers, ledger rules, verdict table (exhaustive), spec 11.1 matrix on a fixture chain, renderer determinism and hardening, profile sync, read-back, CSV, locator, QIE ID, explorer |
| `contracts` hardhat (Paris EVM) | **23 passed** | every revert in spec 7, owner scoping, revoke, third-party, reissue, no payable/admin surface |
| `packages/cli` vitest | **8 passed** | verdicts and exit codes, equals the library, real child process, usage errors |
| `apps/web` browser E2E (Chromium and Firefox) | **see section 7.1** | request, issue, download, verify, forged, altered, wrong link, revoked, QR-only, disagreement, RPC failure, wallet safety, Tier 2 |
| ESLint, `tsc --noEmit` (all packages), Next build, contract compile | **clean** | |
| Local real-EVM acceptance (`docs/acceptance/LOCAL-FIXTURE-*.json`) | **16 of 16** | registry bytecode + signed transactions + JSON-RPC; mock QUSDC at the real address and pinned deployment block. **Not mainnet** |
| Live mainnet reads | G1 runs, G3 `eth_call` probes, Wallet MCP, explorer, CSV from a real 46-entry ledger | `docs/gates/*` |

### 7.1 Browser E2E
See `docs/gates/web-e2e-result.txt` (copied from the last run). The E2E uses the fixture chain behind intercepted RPC, a mock wallet announcing `me.qiewallet`
over EIP-6963, and labelled stubs for the Wallet MCP and explorer; the real services were exercised live separately. A negative control (corrupt one endpoint) makes
the data-dependent checks fail, so the suite is not vacuous.

### 7.2 What the fixture chain cannot show
Real QIE Wallet behaviour, real gas estimation by that wallet, and mainnet registry behaviour. Those are the blockers below.

## 8. Outstanding tasks and blockers

**Needs the project owner**
1. Try one issuance with your own QIE Wallet extension on the deployed site (everything so far used keys directly or a mock wallet).
2. Approve deploying the app to Vercel. Before it goes public, Vercel Authentication on the `bankable` project must be switched off (it is on by default and would put a login in front of the verifier and the QR links), and `NEXT_PUBLIC_REGISTRY_ADDRESS=0x1E9FC096bebe1f142AeeD317d0054583E9227804` set for the build.
3. When we are done: give me the address for the leftover funds (the two generated wallets hold 0.75 and 0.25 QUSDC and about 1 QIE each).
4. Non-blocking: one genuine finance recipient (not done).

**Known limits and risks**
- Registration through the real QIE Wallet extension is untested; gas is left to the wallet's estimation. The mainnet acceptance signed with local keys.
- The 31-day cap takes about 2.3 minutes, above the two-minute target.
- Agreement of two endpoints plus reconciliation does not prove completeness; they may share infrastructure (spec 6.4). rpc1 and rpc5 appear to be QIE-operated.
- `VAULT_ROLE` can mint and burn arbitrarily; statements record those events faithfully but the token's admin power is outside Bankable's scope.
- Spec items still unverified: QIE Wallet registration behaviour, explorer source-verification submission for the new contract, Xero/QuickBooks import, Wallet MCP rate limits.

**Not in Phase 1 by instruction:** premium UI, marketing material, public deployment, video, submission.

## 9. Continuing development
```
pnpm install
pnpm lint && pnpm typecheck && pnpm test
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm --filter @bankable/web e2e              # needs Playwright Chromium+Firefox
NODE_USE_ENV_PROXY=1 npx tsx scripts/gates/g1-real.mts <wallet> <days> [endUnix]       # real-data ledger run (NODE_USE_ENV_PROXY only inside the sandbox)
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx tsx scripts/gates/g2-render.mts          # cross-engine determinism
NODE_USE_ENV_PROXY=1 npx tsx scripts/gates/g3-evm.mts                                  # real-EVM eth_call probes
scripts/local-chain/start.sh && npx tsx scripts/local-chain/setup.mts                  # local chain-1990 fixture (then deploy with --network localhost, run the acceptance runner with ACCEPT_LOCAL_MINE=1)
```
After any change to `render/*`, `canonical.ts`, `ledger.ts` or the lockfile: `node packages/core/scripts/make-profile.mjs` (changes `rendererId`; old records keep their old profile).
In this sandbox only: Node's `fetch` needs `NODE_USE_ENV_PROXY=1`; Hardhat cannot download solc through the egress proxy (see deviations).

## 10. Contract addresses and deployment
| Item | Value |
|---|---|
| QUSDC (QIE mainnet, chain 1990) | `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` (read-only) |
| StatementRegistry (QIE mainnet) | `0x1E9FC096bebe1f142AeeD317d0054583E9227804`, deployed at block 12203114, tx `0xb5251402c6b971633a510b8a36d47fc86a6a570ab68b2f70e5e65fd083e1bd0a`; on-chain bytecode verified byte-identical to the local build (see `contracts/deployments/mainnet.json`) |
| Local build | solc 0.8.20+commit.a1b79de6, evm paris, optimizer 200 runs, runtime 2,147 bytes, runtime keccak256 `0x86877a3f2bfcf34e32cebea9cef8ec201c15a3e8a0dfcc5377d25ded89414183` |
| Local fixture registry (NOT a real network) | `0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6` on a throwaway local chain-1990 node |
| Explorer | `https://mainnet.qie.digital/address/0x1E9FC096bebe1f142AeeD317d0054583E9227804`: source verified, full match |
| Renderer profile (current) | `bankable-renderer/1`, origin `https://bankable-qie.vercel.app`, rendererId `0x88501b7ead79174dfa554c54c664a28cb562f6477cc8ad8a0d437f668b9ac532` |
| Public address | `https://bankable-qie.vercel.app` (Vercel project `bankable`, id `prj_u8B6f7vOGZIm7RYucODjoCF3uU5p`; root `apps/web`, `NEXT_PUBLIC_REGISTRY_ADDRESS` set as a build variable; Vercel Authentication off). All eight pages return HTTP 200 anonymously |
| Wallet A (owner and deployer; funded by you) | `0x264d758f555793F54B14E02567CD6F6aE004c436`: swept (see below) |
| Wallet B (second wallet) | `0xD2612D30646BafB05fa28B8363e8F2AaDD54e0c4`: swept (see below). Private keys are in a 0600 file outside the repository and are not committed |

## 11. Interface refinement (design, accessibility, performance)

Scope: frontend only. No change to the core, the contract, the security model or any integration. Every verification guarantee and every label the tests rely on is unchanged.

**Visual identity.** One design source: the Framer "Paper" system (Paper, Paper Elevated, Warm Sand, Ink, Muted Ink, Ink Blue, Brass, Hairline; Instrument Serif for display, Inter for text, self-hosted so the CSP stays `'self'`). The app uses it as an editorial financial document: serif headlines with Ink Blue italic emphasis, folio labels, hairline rules, "plates" for evidence, a seal mark and favicon, and a static network chip. Dark mode is derived. No gradients, no decorative imagery, no crypto-dashboard conventions.

**Site structure (a real multi-page site, not one scroll).** Eight routes with a shared header navigation (current page marked with `aria-current`), a footer sitemap and per-page titles: `/` (home: hero, three journeys, three trust points, each linking to its page), `/how-it-works` (the three journeys, what is inside the file, why the bytes matter, the four checks, the five outcomes, authorisation, revocation and reissue), `/security` (what is and is not public, controls by risk, and what you still have to trust), `/limits` (scope, measured limits, plain FAQ), `/developers` (live registry address with the explorer's own verification status, the contract interface, the renderer profile and `rendererId`, the command-line verifier, network behaviour, canonical data), and the three working journeys `/request`, `/new`, `/verify`. All copy comes from the approved specification or from measurements recorded in this document; nothing is promotional or invented.

**What changed, and why each element exists**
- *Verify*: an input panel (file card showing name, size and the SHA-256 computed in the browser; inline owner validation; the verifier is disabled until the owner is a full address) beside a result panel. Before a check: a method explainer with the four checks and the five outcomes. During: a skeleton and real query progress (never fake progress), announced to assistive technology. After: focus moves to the result; the verdict, a plain-language explanation of what it means and what to do (inconclusive is explicitly "not a pass", with Try again; failed is "do not rely on this file"), the four checks revealed in order, collapsible evidence with copy buttons, the chain-derived statement as a plate with a balances band and a reconciliation line, CSV, QIE ID and revoke.
- *Issue*: a five-step progress indicator; a request summary; honest wallet states (not found, wrong account, wrong network); a "statement preview" plate showing exactly what the PDF will contain; an explicit privacy approval; a success panel with the record id and the three next steps.
- *Request*: UTC presets (yesterday, 7 and 30 days), inline validation, a copyable link line, and a "what happens next" explainer.
- *Micro-interactions*: button press feedback, a short staggered reveal of the four checks (it conveys that they are evaluated in order), a drop-zone state change, copy confirmation. All of it is disabled under `prefers-reduced-motion`.

**Accessibility.** Colour tokens are checked by an automated gate (`apps/web/e2e/contrast.mts`) that reads the real CSS: all 30 text/background pairs meet WCAG AA in light and dark. This found and fixed a defect in the previous version: Brass labels were 2.95 to 3.10:1 (below 4.5); they now use a darker text-only Brass. Results are always words plus an icon, never colour alone; the drop zone is keyboard operable; inputs are labelled and described; errors use `role="alert"`; the result takes focus; skip link and visible focus rings; touch targets at least 44px (except small inline copy controls at 28px).

**Performance (gzipped JavaScript needed to render each page, measured on the static export).** Home 171 KB. Request 382 to 200 KB (about 48% less). Verify 388 to 207 KB and Issue 385 to 204 KB (about 47% less each): the PDF renderer is loaded only when a check or scan actually starts, and the core is marked side-effect free so unused code is dropped. CSS is about 5 KB. Fonts: five latin woff2 files, 113 KB, `font-display: swap`.

**Defects found and fixed while testing this pass:** a phone-width horizontal overflow when a real result was shown (a long hash inside a grid cell widened the whole column; only a result on screen exposes it); a squeezed ledger table (now keeps readable columns and scrolls in its own container); the footer's uppercase styling altered the case of an address; the Request page shipped the whole PDF renderer. Each is covered by a test or a gate.

**Verified.** ESLint and types clean; core 107, CLI 8, contracts 23; browser suite on Chromium and Firefox: 44 of 44 (Chromium and Firefox: journeys, adversarial cases, Tier 2, interface states, multi-page site); the first full run was 42 of 44, the 2 misses being an ambiguous selector in a new test, fixed and rerun; layout check: 48 of 48 (eight pages at 390, 768 and 1280 px, light and dark, no horizontal scroll); contrast gate: 30 of 30.

**Known limits.** Not tested with the real QIE Wallet extension. The web app is not deployed: the Vercel project exists, Vercel Authentication must be switched off before it is public. The Turbopack build also copies the worker's TypeScript source into the static assets; it is not executed and is harmless. Small copy buttons are 28px high by design (secondary controls). No automated screen-reader pass was run (no assistive technology is available here); the semantics were checked structurally instead.

## 12. Deployment and live verification (2026-11-27)

Deployed to production from the repository (`main`, commit `41bdc45`). **Live end-to-end check on `https://bankable-qie.vercel.app` (`apps/web/e2e/live.mts`), Chromium and Firefox, with no fixtures and no mock wallet:** a statement for the generated wallet was issued and registered on mainnet (`scripts/mainnet-demo-statement.mts`; record `0xac8426294bc649ac11cab3bd2b30af08993e94a8c07f52298e59094e9c3041e9`, tx `0x2d1c60e1eaa8ee2764fc7413b02c0eb6e457e58e5a9862b88a1cfd3454d89683`). In both browsers: the worker pre-filled the owner from the PDF metadata; with the request link the verdict was **Verified, request matched** with all four checks PASS; the explorer status read live as verified (full match); one altered byte gave **Verification failed**; a wrong link failed the Request check; no page errors.

**Funds.** At the owner's instruction all remaining QUSDC (0.75 + 0.25) and QIE were swept from both generated wallets to `0x1d7d7Ee39f730d49E37E718a12E23671A31D280B` (four transactions; about 0.000021 QIE of dust remains in each wallet). The private keys exist only in a temporary file outside the repository.

**Not done.** The real QIE Wallet extension was never used (the issue flow was tested with a mock wallet and with direct signing). The project was paused by its owner here.
