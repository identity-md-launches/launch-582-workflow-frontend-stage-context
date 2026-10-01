# Deployment binding and static export

The frontend uses `dist/imd-deployment.json` as its runtime configuration and fetches the raw ABI arrays it names. `web/deployment-input.json` is a retained **build input**, not a second runtime configuration. It copies only the permitted deployment identifiers, complete contract set, exact pool key, network, and wallet-add-chain parameters. `web/src/deployment-blocks.json` contains only the contract-name-to-block-number metadata needed to begin event scans; it contains no contract addresses, chain IDs, or ABIs.

`web/scripts/export.mjs` runs after Vite. It obtains each ABI with `git show 34bc1640f8c0e6f1c6bdcb69d191dd664f74eb5c:docs/abi/<Contract>.json`, confirms a raw array, verifies its attested canonical Keccak-256, and copies the implementation export to `dist/abi/`. Canonicalization recursively sorts object keys and preserves array order and all compiler-exported fields. A source archive without Git history can use `docs/abi/` only if the same attested hash still matches.

The verified hashes are:

| Contract | Canonical ABI Keccak-256 |
| --- | --- |
| LaunchToken | `38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee` |
| TipJar | `cfa90d153c7cde5bfb3edb6fce70965d0ce1b719222fd45b0273336d16cc597f` |

The deployed `poolKey` is authoritative: fee `12500`, tick spacing `60`, native ETH as currency0, TIPS as currency1, and the handoff's initialization hook. The older nested manifest description says fee `3000`; it is not used to construct the export or swaps.

The final manifest inventories every exported file except itself with lowercase SHA-256 values, including `index.html` and both ABI files. The verifier rejects additional top-level or contract fields, handoff/network differences, unsafe paths, symlinks, unlisted or changed files, malformed hashes, duplicate assets, more than 128 assets, files larger than 8 MiB, or an export larger than 8 MiB. The export limit is intentionally below the later HTTP verification budget; the separate Git submission budget also includes source and documentation.

While worker inputs exist, `loadInput()` directly compares all retained configuration and deployment blocks against the pinned handoff and network. Those pinned input files are not required by a subsequent rebuild. No root build configuration or deployed contract source was changed.

## Commands and observed checks

From `web/`:

```sh
node scripts/export.mjs # after vite build; always regenerate after export changes
node scripts/verify.mjs
node scripts/check-rpc.mjs
```

Both implementation ABI hashes were verified from the pinned Git commit on this worker. `docs/rpc-validation.json` records successful read-only checks against all three configured public RPCs: each returned Sepolia chain ID `11155111` and nonempty code at both attested contract addresses, with matching code hashes between RPCs. The report includes the check time and observed block numbers. It is an observation of those endpoints at that time, not a claim that bytecode equivalence, publication, pinning, or browser transactions have been independently certified.

A separate Node assertion check exercised canonicalization with nested object keys, rejection of unsafe relative paths, complete file inventory, exact SHA-256 bytes, manifest self-exclusion, symlink rejection, and rejection of a file one byte over 8 MiB. All assertions passed. Its temporary fixture directory lived under the assignment's scratch area and is not part of the export.

An isolated copy of the production export passed verification, then correctly rejected six mutations: changed `index.html` bytes, an unlisted file, omitted `poolKey`, an extra top-level field, a changed network block, and an altered TipJar ABI even after the attacker recomputed its asset SHA-256. These mutations were confined to `test/scratch/`; the delivered export was not changed by the tests.

## Submission size and scope

The final production inventory contains seven assets plus the manifest, totaling 516,831 bytes. The source, lockfile, export, documentation, and committed delivery bundle are below the 8 MiB submission budget. `web/.gitignore` is the one explicitly allowed ignore-file change; nested `node_modules`, package caches, Vite caches, and browser test output are excluded. No dependency archives or Git submodules are included.

The worker's root `.git` directory is read-only; staging and an initial bundle attempt could not write its index or partial-clone objects. To deliver committed source without changing that directory, the public handoff repository was fully cloned into `test/scratch/`, checked out at the pinned source commit, and overlaid with permitted files selected using Git's ignore rules. `docs/frontend.bundle` contains the complete repository history and a `frontend-delivery` branch with every final authorized source, static-export, and evidence file except the bundle itself. Its own exclusion prevents a recursive archive. It is the committed delivery artifact, not a dependency archive. The read-only worker checkout remains untouched.

The delivery bundle was verified and cloned into a second scratch checkout, where the restored manifest and ABI inventory were verified again. A second, outer bundle measurement included `docs/frontend.bundle` alongside the ordinary final files to check the complete submission against 8,388,608 bytes; that measurement also passed. Both bundle sizes and the delivery commit are reported in the worker's completion evidence. Reproduce or inspect the committed snapshot with:

```sh
git bundle verify docs/frontend.bundle
git bundle list-heads docs/frontend.bundle refs/heads/frontend-delivery
git clone docs/frontend.bundle /path/to/new-writable-checkout
```

Restoring requires a writable destination; bundle verification and list-heads are read-only. This artifact does not publish the site or create a commit in the protected worker checkout.

No transaction was sent. Contract writes, wallet signing, and live swaps remain untested on chain; browser interaction tests use mocked wallet/RPC responses. Build, browser, interaction, and design-review results are documented separately in the frontend validation report.
