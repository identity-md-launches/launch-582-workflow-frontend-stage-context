# Worker browser and interaction evidence

The final production export was served as plain files at `http://127.0.0.1:4175/preview/`, with no SPA rewrite. On 2026-10-01 the worker ran **26 tests: 26 passed in 30.7 seconds** (14 browser cases and 12 pure validation/history cases). After expanding the computed-style sample to include the jar label and event text, the affected visual test passed again in 6.4 seconds including startup. No application source or export bytes changed between these runs.

Environment: Node 22.22.1, Playwright 1.56.1, Chromium 141.0.7390.37, axe-core 4.13.0. The checked manifest SHA-256 was `83bfd48beb890968752d1045b14ae3f071f127f8cee96b19551c91d307e98eb2`.

The fixture intercepts the configured RPC hosts and an injected EIP-1193 wallet. Transaction tests use deterministic mocked receipts and never broadcast. Their screenshots show invented test amounts, accounts and event messages. Separately, `live-readonly.mjs` captures actual public RPC reads without injecting a wallet.

## Reproduce

From `web/`, after `npm ci` and `npm run build`:

```sh
npx playwright install chromium
npm test
node tests/live-readonly.mjs
```

On this Ubuntu 26.04 worker Playwright required its Ubuntu 24.04 browser build. Browsers were kept in the disposable scratch area; no downloaded browser is submitted:

```sh
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 PLAYWRIGHT_BROWSERS_PATH=../test/scratch/playwright-browsers npx playwright install chromium
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 PLAYWRIGHT_BROWSERS_PATH=../test/scratch/playwright-browsers npm test
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 PLAYWRIGHT_BROWSERS_PATH=../test/scratch/playwright-browsers node tests/live-readonly.mjs
```

The optional last command depends on public network availability. `npm test` starts and stops its own static server. Traces and ordinary Playwright output go to `test/scratch/`; deliberate evidence artifacts go to this directory. A separate strict TypeScript check of the test files, fixtures and Playwright config also passed.

## Interaction coverage

| Area | Observed result |
| --- | --- |
| Static hosting and disconnected state | `/preview/` resolves the manifest, ABI files and bundled assets; missing-wallet guidance appears; no send control is available before connecting. No browser console/page errors in the deterministic resource check. |
| Wrong network | Sending remains disabled. A mocked `4902` triggers the exact handoff `wallet_addEthereumChain` parameters, then a second switch. |
| Tip validation and receipt | 141 Unicode scalars and a lone UTF-16 surrogate are rejected before sending. Valid amount/message calldata is simulated, signed once and refreshed after confirmation. All primary actions are locked during the pending transaction. |
| Error paths | Simulation revert reason and wallet rejection are visible; neither broadcasts. An account change between simulation and signature prevents sending. A reverted receipt never updates the mocked total. |
| Unknown receipt recovery | Advancing the browser clock past 180 seconds preserves the sent hash and locks new writes. “Check transaction status” confirms the eventual mocked receipt and unlocks without a second send. |
| Owner withdrawal | The owner sees and executes Withdraw. The confirmed balance refreshes to zero and disables Withdraw. A non-owner does not see the control. |
| Event history | An unsorted 24-event response is rendered newest first with exactly 20 entries. HTML-looking messages remain literal text. Nine pure history tests cover pagination continuity, deduplication, ordering and reorganization reconciliation. |
| Native buy | Quoter `eth_call`, router target, command `0x10`, actions `0x060c0f`, the complete handoff pool key, input amount, slippage minimum, settlement/take currencies and amounts, deadline, simulation and native transaction value are checked. No approval is sent. |
| Token sell | Separate exact-amount token-to-Permit2 and Permit2-to-router approvals precede execute; configured addresses and 30-minute Permit2 expiration are decoded and checked. The swap sends zero native value. |
| Token transfer | A zero recipient is rejected; a valid recipient receives calldata with the exact decimal-scaled amount and zero native value. |
| ABI integrity | Replacing the TipJar ABI with an empty array blocks runtime configuration and transaction entry. |
| Pure validation | Amount precision, zero/negative/nondecimal/overflow input, Unicode scalar limits, surrogates and slippage precision/range are covered. |

## Rendered review

Desktop (1440px), tablet (768px), mobile (390px) and narrow mobile (320px) exports were rendered. Document widths match their viewports with no horizontal overflow. The desktop/mobile screenshots and both narrow-width screenshots were inspected visually: headings wrap, addresses wrap, controls remain contained, the form precedes recent tips on narrow screens, and the event list scrolls within its region. `keyboard-focus.png` records the visible input focus ring. The first keyboard Tab reaches “Skip to content.” Reduced-motion emulation reports zero transition and animation duration for the primary button.

`accessibility.json` records **zero axe WCAG 2 A/AA and 2.1 AA violations** in the connected view with swap and transfer sections expanded. Axe leaves contrast checks incomplete for the illustrated label, clipped rows in the scrolling list and decorative glyphs. Those incompletes are retained rather than reported as automatic passes. `contrast.json` supplements the scan with 112 computed-style text/background samples, compositing transparent ancestor backgrounds; the lowest sampled text contrast is **5.400:1**. The jar label is **11.462:1**, focus ring is **5.496:1** on the surface / **5.122:1** on the page, and input boundary is **3.482:1**. Decorative glyphs are excluded from text contrast assertions. This is a targeted review, not complete assistive-technology certification.

Applicable findings repaired before the final export:

- `web/src/styles.css:7`: input boundaries initially measured 2.862:1. The input border was darkened to `#818c7c`; the rendered assertion now passes at 3.482:1.
- `web/src/App.tsx:169`: the labeled statistics container received a valid group role, resolving axe's unsupported generic-container label finding.
- `web/src/styles.css:93` and `web/src/App.tsx:199`: the original 20-row desktop view produced excessive page length; the list now has a bounded scrolling region, keyboard focus and visible scroll guidance.
- `web/src/chain.ts:323`: standard revert reasons are preserved for the visitor instead of being reduced to a generic error name.
- `web/src/components.tsx:28`: failed transactions no longer simultaneously display a contradictory pending-success status; the transaction link remains available.

## Live read-only browser check

`live-browser.json` records a successful actual Sepolia read at block **11,823,961**, with **0 ETH** lifetime tipped, **0 ETH** jar balance and a completed empty event scan from deployment block **11,823,840**. The actual contract owner and addresses were displayed. Every recorded resource/RPC response was HTTP 200; no page or failed-request errors were recorded. Only `eth_chainId`, `eth_getCode`, `eth_blockNumber`, `eth_getBalance`, `eth_call` and `eth_getLogs` appeared. Desktop and mobile had no horizontal overflow. `live-desktop.png` and `live-mobile.png` show this real, unfunded empty state.

No live tip, withdrawal, transfer, approval, quote or swap was submitted or exercised with a funded wallet. Real wallet extensions, mobile wallet browsers, hardware wallets, screen readers, other browser engines, forced-colors rendering, real transaction replacements, and production publication/CID checks remain untested here. Mocked router success does not prove live liquidity, pricing, hook behavior or transaction execution. These are worker observations, not independent verification authority.
