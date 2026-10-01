# Frontend validation

Worker report for the deployed Tip Jar frontend, 2026-10-01. These are local observations, not independent certification or publication checks.

## Scope and assumptions

The approved workflow is one Sepolia page for ETH tips, optional public messages, the latest 20 tip events, lifetime tipped value, and owner-only full withdrawal. The page also exposes TIPS transfer and the mandatory handoff-bound swap/approval controls. Contract sources, root configuration, existing ABIs, and prior contract-stage review artifacts were preserved.

Source, dependencies, lockfile, frontend configuration, and tests are in `web/`; production files are in `dist/`; documentation/evidence are in `docs/`. `web/.gitignore` is the sole changed ignore path and has an explicit path budget. The requested root `DESIGN.md` conflicts with the overriding path restriction; its complete content is delivered at `docs/DESIGN.md`.

The visual direction is an inferred warm, light-only interface. System fonts and local SVG artwork avoid external asset dependencies. No USD price source, WalletConnect ID, or hosted domain was supplied. The app reports USD context as unavailable, uses injected wallets, and leaves an absolute social-preview image pending publication.

## Executed validation

| Check | Result |
| --- | --- |
| `cd web && npm run typecheck` | Passed, exit 0 |
| `cd web && npm run build` | Passed, exit 0; TypeScript + Vite + ABI/export generation + manifest verification |
| `cd web && npm run verify` | Passed, exit 0 after final source build |
| `cd web && npm run check:rpc` | Passed, exit 0; all three configured RPCs returned Sepolia and nonempty code for both contracts |
| `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 PLAYWRIGHT_BROWSERS_PATH=../test/scratch/playwright-browsers npm test` from `web/` | 26/26 passed in 30.7 seconds on the frozen production export |
| Supplemental `npx playwright test tests/visual.spec.ts` with the same browser environment | 1/1 passed in 6.4 seconds; expanded to 112 rendered text samples |
| Manifest integrity/tamper assertions | Passed; details in `DEPLOYMENT-VALIDATION.md` |
| Submission path/dependency check | No new files outside allowed paths; no dependency/cache directories, `.tgz` archives, or Git submodules in the candidate file set |

Final production export: **7 declared assets plus the manifest, 516,831 bytes total**. Every asset is below 8 MiB, and the entire export is far below the HTTP checker budget. The manifest was generated after the final Vite build. It preserves the exact contract set, addresses, ABI hashes, source commit, attestation, pool key, network, and wallet-add-chain parameters. Its complete SHA-256 inventory excludes itself.

The browser suite uses Chromium 141 through Playwright 1.56.1, serving the export under `/preview/`. Mock wallet/RPC responses isolate writes from real funds. The supplied browser connector could not reliably reach worker localhost; local Playwright provided the actual browser execution and screenshots, which were inspected with the image viewer. Early setup runs hit an occupied port and an export rebuild race; the final suite used port 4175 and a frozen export and passed.

## Interaction coverage

The final 26 cases cover:

- Missing wallet and disconnected states; exact 4902 chain-add/switch parameters; correct-chain readiness.
- Literal rendering of hostile-looking public messages; newest-20 ordering; subpath assets and responsive overflow checks.
- Unicode scalar counting, 140 emoji acceptance, 141 rejection, lone-surrogate rejection, exact decimal parsing, and slippage limits.
- Tip simulation, exact value/calldata, pending write locks, successful receipt refresh, wallet rejection, simulation revert, reverted receipt, and account changes between simulation and signing.
- Confirmation timeout: transaction hash retained, further writes locked, explicit receipt recovery restores readiness.
- Owner-only withdrawal and post-withdraw balance refresh; token transfer recipient validation and exact units.
- Native ETH buy with exact pool key, command/action bytes, settle/take currencies, minimum output, deadline, and transaction value.
- Token sell with separate exact-amount ERC-20 and Permit2 approvals, 30-minute router expiration, and zero native value.
- ABI tampering disables readiness.
- Nine history cases: contiguous pagination, reorg replacement, lower-head orphan removal, gaps, deduplication/order, deployment completion, and recovery of truncated oldest-block history.
- Automated accessibility scan, keyboard focus, reduced motion, computed rendered contrast, and 320px/768px reflow.

The alternate six-field router encoding is implemented for an `extendedSwapParams` network but this Sepolia handoff does not enable it. It was not exercised against a live alternate-chain router. No real wallet signature, funded transaction, live swap execution, or fee-market behavior was tested. Mock protocol assertions establish encoding/interaction behavior, not liquidity or execution success on chain.

## Better Interface review

The pinned workflow and core principles of all six domains were read before implementation. Applicable findings were repaired before the final build. Final source values and reusable patterns are documented in `DESIGN.md`.

| Domain | Coverage and evidence | Limitations |
| --- | --- | --- |
| Accessibility — Checked | Native labeled controls, skip link, heading structure, status/error regions, owner/wallet gating, keyboard-focus screenshot, axe WCAG 2 A/AA and 2.1 AA scan with zero violations | No screen-reader session or complete keyboard-only wallet-extension session; axe has manual-review items for clipped offscreen list rows and decorative/pseudo-background content |
| Layout — Checked | Actual screenshots and document-width assertions at 1440×1000, 390×844, 320×844, and 768×1024; stacked controls and long addresses; scrollable recent events | Native 200% browser zoom, pseudo-localization, and a full RTL mirror were not performed |
| Writing — Checked | Explicit public/permanent note, separate lifetime/withdrawable amounts, ETH/TIPS distinction, gas and approval explanations, recoverable errors, transaction explorer links | English only; no user comprehension study |
| Typography — Checked | System serif/sans hierarchy, minimum 16px inputs, readable wrapped descriptions, tabular balances and counters, isolated addresses/messages | No physical iOS device or cross-platform font comparison |
| Colors — Checked | Rendered text/background sampling, focus and input-boundary measurements, axe scan; tokens corrected where needed | Light theme only; disabled controls, every possible error state, and all forced-colors combinations were not individually measured |
| UI details — Checked | Pending/error/empty/connected/wrong-network states, disclosure controls, input presets, focus and reduced-motion state; final screenshots visually reviewed | No slow-motion DevTools animation replay; no animation beyond short optional button transitions |

Measured examples from `evidence/contrast.json`: supporting text on page **5.400:1**, supporting text on card **5.793:1**, primary button text **11.553:1**, form labels and the decorative jar label **11.462:1**, focus outline against card **5.496:1** and page **5.122:1**, input border against surface **3.482:1**. These are computed from the rendered styles and opaque ancestor backgrounds. The supplemental sample set measures 112 text elements, including the jar label and public event text that axe marked for manual review. Its minimum ratio is **5.400:1**; this supplements the automated scan without claiming complete accessibility compliance.

## Findings, repairs, and rechecks

| Severity / location | Evidence and impact | Repair and recheck |
| --- | --- | --- |
| High — `web/src/App.tsx:80` | Source review showed the simultaneous state refresh cleared verification before the tip refresh checked it, skipping event polling | Sequence refreshes; pause polling during writes. Final build/typecheck and browser suite passed |
| Medium — `web/src/App.tsx:50` | An account change during an in-flight read could lose the requested new-account refresh | Queue a subsequent read and discard old-account results; account-race test passes |
| Medium — `web/src/App.tsx:241` | Receipt confirmation could release approval controls before allowance refetch; a late result could overwrite another quote/account | Keep an approval refresh lock and a quote-generation guard; both-direction swap tests pass |
| High — `web/src/chain.ts:16`, `web/src/App.tsx:135` | A receipt lookup failure after submission leaves mining status unknown; simply unlocking could allow duplicate sends | Preserve hash in `PendingTransactionError`, pause new writes, expose receipt recovery. Timeout/recovery browser test passes |
| Medium — `web/src/tip-history.ts:11` | A new-head refresh could discard manually scanned history or preserve removed events | Merge only contiguous coverage; replace rescanned ranges and handle cutoffs. Nine dedicated cases pass |
| Medium — `web/src/components.tsx:27` | A reverted receipt left the old waiting-for-confirmation text beside the failure | Suppress obsolete progress text on errors while retaining hash link. Reverted-receipt test passes |
| Medium — `web/src/styles.css:92` | Initial full-page screenshot with 20 events showed a very long empty column beside the form and distant token controls | Cap the event list at 610px with scrolling cue and keyboard focus. Final full-page/mobile/reflow screenshots inspected |
| Medium — `web/src/styles.css:7` | Input-border token `#919b8c` against `#fffefa` calculated at 2.862:1, below 3:1 | Darken to `#818c7c`; actual rendered boundary remeasured at 3.482:1 and passes |
| Low — `web/src/App.tsx:169` | Accessibility manual-review item: named generic statistics div lacked a semantic role | Add `role="group"`; final axe scan reports no aria-prohibited-attr item |

No known primary-flow blocker remains in the tested frontend. No claim of full accessibility compliance is made.

## Evidence and completion limits

`evidence/desktop.png`, `mobile.png`, corresponding full-page captures, `reflow-320.png`, `reflow-768.png`, and `keyboard-focus.png` show actual browser rendering with **mocked chain data**, including test hostile-looking message text. They are not screenshots of actual donations. `evidence/accessibility.json` and `contrast.json` retain scan/measurement detail. `rpc-validation.json` records genuine read-only public-RPC observations separately.

An additional genuine browser session used only the configured public RPC, without a wallet or mock responses. It successfully loaded state at Sepolia block **11,823,961**, showing **0 ETH** lifetime tips and jar balance, and scanned the entire tip history from deployment with no tips. All recorded local/RPC responses were HTTP 200, no request/browser errors occurred, and desktop/mobile overflow checks passed. Only `eth_blockNumber`, `eth_call`, `eth_chainId`, `eth_getBalance`, `eth_getCode`, and `eth_getLogs` were requested. See `evidence/live-browser.json`, `live-desktop.png`, and `live-mobile.png`. These are read-only observations at the recorded time; they do not validate live writes.

The source/export/validation work is complete for the authorized frontend scope. Publication, IPFS naming/pinning, and later immutable/named HTTP checks belong to the publisher and have not run here. The pre-existing contract review is preserved; this report is not a replacement contract security audit.

Local Git delivery has an environment limitation: even `git add -n web dist docs` fails with `Unable to create .git/index.lock: Read-only file system`. The checkout cannot be staged or committed by this worker. To deliver committed source and export, `frontend.bundle` contains a full-history commit made in an isolated scratch clone, with all authorized candidate files except the bundle itself. It can be verified with `git bundle verify docs/frontend.bundle` in a normal writable checkout, or cloned into a new directory. Packaging evidence is recorded in `DEPLOYMENT-VALIDATION.md`. The ordinary source/export files also remain in the allowed working-tree paths for the contributor publisher to collect. The worker does not claim a commit in the protected checkout or a root design file outside scope.
