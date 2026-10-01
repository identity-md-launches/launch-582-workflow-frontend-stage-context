# Tip Jar frontend

A static React + TypeScript app for the deployed Sepolia TipJar and fixed-supply TIPS token. The contracts and root build configuration are preserved. `../dist/` is the production export; the publisher serves these files without rebuilding them.

## Install, build, and preview

Use Node.js 22 and npm. All frontend packages and configuration live here.

```sh
cd web
npm ci --cache .cache/npm
npm run typecheck
npm run build
npm run preview
```

`build` typechecks, runs Vite with `base: './'`, copies implementation-derived ABIs, then generates and verifies `dist/imd-deployment.json`. Never edit the export after generating its manifest without rerunning `npm run build`. The page uses anchors and relative local assets, so it works under an IPFS gateway subpath without server rewrites. No external fonts, remote image assets, backend, API keys, or WalletConnect project ID are required.

For a production-export subpath preview use `node tests/static-server.mjs` and open `http://127.0.0.1:4175/preview/`. Stop the foreground process when finished. Vite's source-only dev server does not generate the deployment manifest; use the production build/preview for contract integration.

## Configuration and trust boundary

`deployment-input.json` retains the attested handoff and exact vetted network block for reproducible builds after the worker's `.imd/reads/` inputs are removed. It is **not imported by the app**. Runtime deployment configuration comes exclusively from `../dist/imd-deployment.json`; `src/config.ts` loads that file and its ABI references, verifies canonical ABI Keccak hashes, and creates the public RPC client. No second runtime address/chain map exists. `src/deployment-blocks.json` stores only the handed-off deployment block by contract name for event pagination.

The export script reads ABIs with `git show <sourceCommit>:docs/abi/<Contract>.json`. Source archives without Git history fall back to the shipped `docs/abi/` files with the same mandatory attested-hash verification. When pinned worker inputs exist, export verification compares the retained input directly with them. See [deployment validation](../docs/DEPLOYMENT-VALIDATION.md).

The exact handoff `poolKey`, including its nonzero initialization hook and fee `12500`, is used for quotes and swaps. Every Uniswap address comes from the manifest's `network.uniswapV4`. The older descriptive pool fee is not used. No private configuration belongs in this project.

## Wallet and contract behavior

- Injected EIP-1193 browser wallets work without a connector service. When multiple providers are exposed through `window.ethereum.providers`, the first is used. WalletConnect and a wallet-selection modal are not configured. Disconnect clears this page's session; it does not revoke wallet permissions.
- Public RPCs are tried in the supplied order. A connected wallet on the deployment chain is a guarded read fallback. Signing stays in the wallet. Initial ABI, RPC chain, and deployed-code checks must succeed before transactions are enabled.
- Unknown-chain switching uses the exact supplied `wallet_addEthereumChain` parameters after a 4902/unknown-chain response, then switches again. Account and chain are rechecked before simulation and before signing.
- The jar shows `totalTipped()` separately from its ETH balance. State reads use one block number. Polling runs every 15 seconds while visible and pauses during writes. Tip logs begin at the pinned deployment block, scan backwards in bounded/adaptive chunks, sort by block/log order, and expose older-scan continuation when history is incomplete. Refresh replaces events in the rescanned range to reconcile reorganizations.
- Messages are literal React text. Validation counts Unicode scalar values, rejects lone UTF-16 surrogates, accepts empty notes, and enforces 140 characters. Notes and addresses are public and permanent.
- The owner-only withdrawal is displayed only for the correct account on the correct chain. It transfers the entire balance to the immutable owner; no recipient override exists.
- TIPS direct transfers validate nonzero recipient addresses and token decimals. Swaps simulate a quoter read, apply integer slippage protection, and expire after 60 seconds. The explicit token approval and Permit2 router approval steps use exact amounts; existing insufficient token allowances are reset first. Router permission expires after 30 minutes. Quotes and approvals do not imply a guaranteed fill.
- Each write simulates, estimates gas, checks native balance for value and gas, and waits for a successful receipt. Buttons remain locked through confirmation/refetch. An unknown receipt outcome keeps all writes paused and exposes a status-check action. A separately replaced/cancelled transaction may require explorer investigation if its replacement cannot be discovered.

Amounts use token units. No USD oracle was supplied, so dollar values are not invented. ENS is not configured on this testnet app; addresses are checksummed, selectable, copyable, and linked to the configured explorer.

## Validation

```sh
cd web
npm run verify
npm run check:rpc             # read-only live chain/code check
PLAYWRIGHT_BROWSERS_PATH=../test/scratch/playwright-browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=../test/scratch/playwright-browsers npm test
```

On this worker's Ubuntu 26.04 environment Playwright 1.56 required `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` for browser download and test execution. Tests serve the production export at `/preview/`, inject a mock wallet, and intercept the configured RPCs. They do not sign or broadcast real transactions. Browser files/caches stay in scratch; only selected evidence is retained under `docs/evidence/`.

See [validation results and limitations](../docs/VALIDATION.md) and [implemented design](../docs/DESIGN.md). Root `DESIGN.md` is outside this assignment's overriding write budget, so the design document is delivered under `docs/`.

The sole ignore-file change is the explicitly allowed `web/.gitignore`; nested dependencies, caches, test output, and compiler caches are excluded. Keep `node_modules`, package-manager caches, and dependency archives out of submission. No site publication, IPFS pinning, naming, redeployment, or real-chain write is performed by this frontend assignment.

The worker checkout's Git metadata is read-only. `../docs/frontend.bundle` supplies a committed source/export snapshot from an isolated clone, including history and every delivered candidate file except the bundle itself. The publisher can collect the ordinary files directly; alternatively, `git clone docs/frontend.bundle <new-directory>` opens that committed snapshot in a writable location.
