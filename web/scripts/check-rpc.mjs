import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadInput, repoRoot, sha256 } from './deployment.mjs';

const input = await loadInput();
const report = {
  checkedAt: new Date().toISOString(),
  expectedChainId: input.chainId,
  sourceCommit: input.sourceCommit,
  transactionBroadcast: false,
  checks: [],
};

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message ?? 'JSON-RPC error');
  if (payload.result === undefined) throw new Error('Missing JSON-RPC result');
  return payload.result;
}

report.checks = await Promise.all((input.network?.rpcUrls ?? []).map(async (url) => {
  const check = { url, passed: false };
  try {
    check.chainId = Number(BigInt(await rpc(url, 'eth_chainId')));
    if (check.chainId !== input.chainId) throw new Error('Configured RPC chain ID mismatch');
    const block = await rpc(url, 'eth_blockNumber');
    check.blockNumber = Number(BigInt(block));
    check.contracts = await Promise.all(input.contracts.map(async ({ name, address }) => {
      const code = await rpc(url, 'eth_getCode', [address, block]);
      if (!/^0x[0-9a-f]+$/i.test(code) || code === '0x0') throw new Error(`No contract code at ${name}`);
      const bytes = Buffer.from(code.slice(2), 'hex');
      return { name, address, codeBytes: bytes.length, codeSha256: sha256(bytes) };
    }));
    check.passed = true;
  } catch (error) {
    check.error = error.message;
  }
  return check;
}));
report.passed = report.checks.some((check) => check.passed);
await writeFile(path.join(repoRoot, 'docs/rpc-validation.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
