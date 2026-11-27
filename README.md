# Bankable

Owner-authorised, byte-reproducible QUSDC statements on QIE mainnet. A recipient requests a statement of one QIE address's QUSDC
history for a fixed completed UTC period; the address owner registers it on QIE mainnet; anyone can drop the file on the Verify page
and learn whether it is the canonical rendering of on-chain data for the expected wallet, whether that wallet authorised it for that
request, and whether it is still valid.

Status: Phase 1 (core implementation) complete in the sense recorded in [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md),
including what has **not** been done (mainnet deployment and live mainnet acceptance need the project owner's funded key).

## Layout
| Path | What |
|---|---|
| `packages/core` | Shared TypeScript core: typed request, canonical statement, ledger, deterministic PDF renderer, verdict machine, dual-endpoint RPC adapter, verify and issue pipelines, Tier 2 CSV/locator/QIE ID/explorer helpers |
| `contracts` | `StatementRegistry.sol` (Solidity 0.8.20, `paris`), tests, deploy tooling |
| `apps/web` | Static-export Next.js site: `/`, `/how-it-works`, `/security`, `/limits`, `/developers`, and the journeys `/request`, `/new`, `/verify`. The browser talks to the two QIE RPCs directly (no server) |
| `packages/cli` | Independent Node verifier `bankable-verify` (Tier 2) |
| `scripts` | Gate probes, local chain-1990 fixture, live acceptance runner |
| `docs/gates`, `docs/acceptance` | Recorded evidence |

## Commands
```bash
pnpm install
pnpm lint            # eslint + tsc in every package
pnpm typecheck
pnpm test            # core (107), cli (8), contracts (23)
NEXT_PUBLIC_REGISTRY_ADDRESS=0x... pnpm --filter @bankable/web build   # static export to apps/web/out
pnpm --filter @bankable/web e2e                                         # Chromium + Firefox browser E2E (fixture chain, mock wallet)
```

## Verify from the command line (Tier 2)
```bash
pnpm --filter @bankable/cli verify -- statement.pdf --owner 0x... --registry 0x... \
  --rpc-a https://rpc1mainnet.qie.digital --rpc-b https://rpc5mainnet.qie.digital [--request "<link>"] [--json]
# exit status: 0 verified, 1 failed, 2 inconclusive, 64 usage error
```
It uses only the endpoints you pass; it never contacts the Bankable site or a proxy.

## Deploying the registry (owner action; the key never enters this repository)
```bash
cd contracts
DEPLOYER_PRIVATE_KEY=0x... pnpm deploy:mainnet     # checks chain 1990, balance, receipt, deployed bytecode; writes deployments/mainnet.json
pnpm export:verify-input                           # standard-JSON input for explorer source verification
```
Then set `NEXT_PUBLIC_REGISTRY_ADDRESS` / `STATEMENT_REGISTRY_ADDRESS`, **regenerate the renderer profile** with the final origin
(`BANKABLE_ORIGIN=https://your-domain node packages/core/scripts/make-profile.mjs`; this changes `rendererId`), rebuild, and run the live
acceptance matrix: `scripts/mainnet-acceptance.mts` (see its header).

## What a positive result does not prove
Cryptographic completeness of the RPC history; earlier control of the address; genuine income; source of funds; the owner's total
finances; recipient identity; institutional acceptance. QUSDC is a bridged token, not Circle-issued native USDC. Two endpoints agreeing
plus reconciliation does not prove every transfer was returned. Source code and lockfiles make the verifier inspectable, not inherently
trustworthy: a recipient who does not rebuild it from source trusts the code the site serves.

## Authorship and AI assistance
This codebase was produced with substantial AI assistance (Claude). The hackathon's originality and AI-assistance rules (spec section 16.1,
item 9) require substantive developer involvement and an authentic commit history by the human developer; see the progress document.
