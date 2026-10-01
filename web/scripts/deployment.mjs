import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, toBytes } from 'viem';

export const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.dirname(webRoot);
export const distRoot = path.join(repoRoot, 'dist');
export const maxFileBytes = 8 * 1024 * 1024;
export const maxExportBytes = 8 * 1024 * 1024;

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Canonical JSON preserves array order and recursively sorts object keys.
// ABI hashes bind the complete compiler-exported ABI, including internalType.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const abiHash = (abi) => keccak256(toBytes(canonical(abi))).slice(2);
export const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

export function safePath(relative) {
  return typeof relative === 'string' && relative.length > 0 &&
    !relative.includes('\\') && !relative.includes(':') && !relative.startsWith('/') &&
    relative.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function manifestBase(handoff, network) {
  const result = {
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts: handoff.contracts.map(({ name, address, abiHash: hash }) => ({ name, address, abiHash: hash })),
  };
  if (handoff.poolKey) result.poolKey = handoff.poolKey;
  if (network?.network) result.network = network.network;
  if (network?.walletAddChain) result.walletAddChain = network.walletAddChain;
  return result;
}

export async function loadInput() {
  const input = await readJson(path.join(webRoot, 'deployment-input.json'));
  assert(input.version === 1, 'Deployment version must be 1');
  assert(Number.isSafeInteger(input.chainId) && input.chainId > 0, 'Invalid chain ID');
  assert(/^[a-f0-9]{40}$/.test(input.sourceCommit), 'Invalid pinned source commit');
  assert(/^[a-f0-9]{64}$/.test(input.attestationHash), 'Invalid attestation hash');
  assert(Array.isArray(input.contracts) && input.contracts.length > 0, 'No attested contracts');
  assert(new Set(input.contracts.map((contract) => contract.name)).size === input.contracts.length, 'Duplicate contract name');
  for (const contract of input.contracts) {
    assert(/^[A-Za-z][A-Za-z0-9_]*$/.test(contract.name), 'Unsafe contract name');
    assert(/^0x[a-fA-F0-9]{40}$/.test(contract.address), `Invalid address for ${contract.name}`);
    assert(/^[a-f0-9]{64}$/.test(contract.abiHash), `Invalid ABI hash for ${contract.name}`);
  }
  assert(canonical(input) === canonical(manifestBase(input, input)), 'Unexpected retained deployment field');
  if (input.network) {
    assert(input.network.chainId === input.chainId, 'Network chain ID differs from handoff');
    for (const rpc of input.network.rpcUrls) {
      const url = new URL(rpc);
      assert(url.protocol === 'https:' && !url.username && !url.password, 'Public RPC must use credential-free HTTPS');
    }
  }
  const blocks = await readJson(path.join(webRoot, 'src/deployment-blocks.json'));
  assert(canonical(Object.keys(blocks).sort()) === canonical(input.contracts.map((contract) => contract.name).sort()), 'Deployment block contract set differs');
  assert(Object.values(blocks).every((block) => Number.isSafeInteger(block) && block >= 0), 'Invalid deployment block');

  // Pinned worker inputs are not shipped. When present, compare the retained
  // build input directly against them before creating or verifying an export.
  let handoff;
  try {
    handoff = await readJson(path.join(repoRoot, '.imd/reads/deployment.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (handoff) {
    let network;
    try {
      network = await readJson(path.join(repoRoot, '.imd/reads/network.json'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    assert(canonical(input) === canonical(manifestBase(handoff, network)), 'Retained configuration differs from the pinned handoff/network');
    const expectedBlocks = Object.fromEntries(handoff.contracts.map(({ name, blockNumber }) => [name, blockNumber]));
    assert(canonical(blocks) === canonical(expectedBlocks), 'Deployment blocks differ from pinned handoff');
  }
  return input;
}

export async function pinnedAbi(input, contract) {
  const relative = `docs/abi/${contract.name}.json`;
  let raw;
  let origin;
  try {
    raw = execFileSync('git', ['show', `${input.sourceCommit}:${relative}`], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: maxFileBytes,
    });
    origin = `${input.sourceCommit}:${relative}`;
  } catch {
    // A source archive may omit Git history. The attested ABI hash is still
    // mandatory, so a changed working-tree ABI cannot silently be accepted.
    raw = await readFile(path.join(repoRoot, relative), 'utf8');
    origin = `${relative} (source archive fallback; attested hash verified)`;
  }
  const abi = JSON.parse(raw);
  assert(Array.isArray(abi), `${contract.name} ABI must be a raw JSON array`);
  assert(abiHash(abi) === contract.abiHash, `${contract.name} ABI does not match attested canonical Keccak hash`);
  return { abi, raw, origin };
}

export async function inventory(root = distRoot, prefix = '') {
  const files = [];
  for (const entry of (await readdir(path.join(root, prefix))).sort()) {
    const relative = prefix ? `${prefix}/${entry}` : entry;
    assert(safePath(relative), `Unsafe exported path: ${relative}`);
    const info = await lstat(path.join(root, relative));
    assert(!info.isSymbolicLink(), `Export must not contain symlinks: ${relative}`);
    if (info.isDirectory()) files.push(...await inventory(root, relative));
    else {
      assert(info.isFile(), `Not a regular exported file: ${relative}`);
      if (relative === 'imd-deployment.json') continue;
      assert(info.size <= maxFileBytes, `Asset exceeds 8 MiB: ${relative}`);
      files.push({ path: relative, sha256: sha256(await readFile(path.join(root, relative))), bytes: info.size });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export async function verifyExport() {
  const input = await loadInput();
  const manifest = await readJson(path.join(distRoot, 'imd-deployment.json'));
  const { assets, ...base } = manifest;
  const expected = {
    ...input,
    contracts: input.contracts.map((contract) => ({ ...contract, abiPath: `abi/${contract.name}.json` })),
  };
  assert(canonical(base) === canonical(expected), 'Export manifest differs from attested build input');
  assert(Array.isArray(assets) && assets.length <= 128, 'Export must contain at most 128 assets');
  assert(new Set(assets.map((asset) => asset.path)).size === assets.length, 'Duplicate manifest asset');
  for (const asset of assets) {
    assert(safePath(asset.path) && asset.path !== 'imd-deployment.json', `Invalid manifest asset path: ${asset.path}`);
    assert(/^[a-f0-9]{64}$/.test(asset.sha256), `Invalid SHA-256: ${asset.path}`);
    assert(Object.keys(asset).sort().join(',') === 'path,sha256', `Unexpected asset fields: ${asset.path}`);
  }
  const files = await inventory();
  assert(files.some((file) => file.path === 'index.html'), 'Export is missing index.html');
  assert(canonical(assets) === canonical(files.map(({ path: name, sha256: hash }) => ({ path: name, sha256: hash }))), 'Asset inventory is incomplete or content hashes differ');
  const totalBytes = files.reduce((total, file) => total + file.bytes, 0) + (await lstat(path.join(distRoot, 'imd-deployment.json'))).size;
  assert(totalBytes <= maxExportBytes, 'Export exceeds 8 MiB conservative packaging budget');
  for (const contract of manifest.contracts) {
    assert(safePath(contract.abiPath), `Invalid ABI path for ${contract.name}`);
    const abi = await readJson(path.join(distRoot, contract.abiPath));
    assert(Array.isArray(abi), `${contract.name} exported ABI must be an array`);
    assert(abiHash(abi) === contract.abiHash, `${contract.name} exported ABI hash differs`);
    const pinned = await pinnedAbi(input, contract);
    assert(canonical(abi) === canonical(pinned.abi), `${contract.name} ABI differs from implementation export`);
  }
  return { files: files.length, totalBytes, sourceCommit: input.sourceCommit, abiHashes: Object.fromEntries(input.contracts.map(({ name, abiHash: hash }) => [name, hash])) };
}
