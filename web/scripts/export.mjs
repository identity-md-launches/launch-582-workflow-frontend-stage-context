import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { distRoot, loadInput, pinnedAbi, inventory, verifyExport } from './deployment.mjs';

const input = await loadInput();
await mkdir(path.join(distRoot, 'abi'), { recursive: true });
for (const contract of input.contracts) {
  const { raw, origin } = await pinnedAbi(input, contract);
  await writeFile(path.join(distRoot, 'abi', `${contract.name}.json`), raw);
  console.log(`Verified ${contract.name} ABI from ${origin}`);
}
const assets = (await inventory()).map(({ path: name, sha256 }) => ({ path: name, sha256 }));
const manifest = {
  ...input,
  contracts: input.contracts.map((contract) => ({ ...contract, abiPath: `abi/${contract.name}.json` })),
  assets,
};
await writeFile(path.join(distRoot, 'imd-deployment.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(await verifyExport(), null, 2));
