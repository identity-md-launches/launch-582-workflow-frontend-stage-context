import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult,
  parseAbi, parseEther, toHex, type Abi, type Address, type Hex,
} from 'viem';

export const manifest = JSON.parse(readFileSync(new URL('../../dist/imd-deployment.json', import.meta.url), 'utf8'));
export const jar = manifest.contracts.find((contract: { name: string }) => contract.name === 'TipJar');
export const token = manifest.contracts.find((contract: { name: string }) => contract.name === 'LaunchToken');
export const jarAbi = JSON.parse(readFileSync(new URL(`../../dist/${jar.abiPath}`, import.meta.url), 'utf8')) as Abi;
export const tokenAbi = JSON.parse(readFileSync(new URL(`../../dist/${token.abiPath}`, import.meta.url), 'utf8')) as Abi;
export const OWNER = '0x1111111111111111111111111111111111111111' as Address;
export const VISITOR = '0x2222222222222222222222222222222222222222' as Address;
export const routerAbi = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
export const permitAbi = parseAbi([
  'function allowance(address user,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)',
  'function approve(address token,address spender,uint160 amount,uint48 expiration)',
]);
const quoterAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut,uint256 gasEstimate)',
]);
const stateAbi = parseAbi(['function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)']);
const blockNumber = 11824000n;
const hash = (value: number) => `0x${value.toString(16).padStart(64, '0')}` as Hex;
type Request = { method: string; params?: any[]; id?: number };
type Options = { missingWallet?: boolean; wrongChain?: boolean; owner?: boolean; logCount?: number };

/** Deliberately local and deterministic. No test broadcasts or contacts a live RPC. */
export class MockChain {
  requests: Request[] = [];
  walletRequests: Request[] = [];
  transactions: Record<string, any>[] = [];
  chainId: number;
  account: Address;
  unknownChain = true;
  connected = false;
  rejectSignature = false;
  rejectConnection = false;
  failSimulation = false;
  failReads = false;
  missingCode = false;
  holdReceipt = false;
  revertReceipt = false;
  accountChangeAfterSimulation = false;
  withdrawn = false;
  approvedToken = false;
  approvedPermit = false;
  quoteOut = parseEther('25');
  jarBalance = parseEther('1.25');
  totalTipped = parseEther('2.75');
  head = blockNumber;
  logCount: number;
  constructor(options: Options = {}) {
    this.chainId = options.wrongChain ? 1 : manifest.chainId;
    this.account = options.owner ? OWNER : VISITOR;
    this.logCount = options.logCount ?? 24;
  }

  async install(page: Page, options: Options = {}) {
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      const isWallet = url.pathname === '/__wallet_rpc';
      if (!isWallet && !manifest.network.rpcUrls.some((rpc: string) => new URL(rpc).hostname === url.hostname)) return route.continue();
      const body = route.request().postDataJSON();
      const run = (request: Request) => {
        try { return { jsonrpc: '2.0', id: request.id, result: this.respond(request, isWallet) }; }
        catch (error: any) { return { jsonrpc: '2.0', id: request.id, error: { code: error.code ?? -32000, message: error.message, data: error.data } }; }
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? body.map(run) : run(body)) });
    });
    if (options.missingWallet) return;
    await page.addInitScript(() => {
      const listeners: Record<string, ((...args: any[]) => void)[]> = {};
      Object.defineProperty(window, 'ethereum', {
        value: {
          isMetaMask: true,
          on(event: string, listener: (...args: any[]) => void) { (listeners[event] ||= []).push(listener); },
          removeListener(event: string, listener: (...args: any[]) => void) { listeners[event] = (listeners[event] || []).filter(item => item !== listener); },
          async request(request: { method: string; params?: any[] }) {
            const response = await fetch('/__wallet_rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, id: 1 }) });
            const payload = await response.json();
            if (payload.error) throw Object.assign(new Error(payload.error.message), payload.error);
            if (request.method === 'wallet_switchEthereumChain') for (const listener of listeners.chainChanged || []) listener(request.params?.[0]?.chainId);
            return payload.result;
          },
        },
      });
    });
  }

  respond(request: Request, wallet: boolean): any {
    this.requests.push(request);
    if (wallet) this.walletRequests.push(request);
    const { method, params = [] } = request;
    if (method === 'eth_chainId') return toHex(wallet ? this.chainId : manifest.chainId);
    if (method === 'eth_accounts') return this.connected ? [this.account] : [];
    if (method === 'eth_requestAccounts') {
      if (this.rejectConnection) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      this.connected = true; return [this.account];
    }
    if (method === 'wallet_switchEthereumChain') {
      if (this.unknownChain) throw Object.assign(new Error('Unknown chain'), { code: 4902 });
      this.chainId = Number(BigInt(params[0].chainId)); return null;
    }
    if (method === 'wallet_addEthereumChain') { this.unknownChain = false; return null; }
    if (method === 'eth_getCode') return this.missingCode ? '0x' : '0x60006000';
    if (method === 'eth_blockNumber') return toHex(this.transactions.length ? this.head++ : this.head);
    if (method === 'eth_getBalance') return toHex(params[0].toLowerCase() === jar.address.toLowerCase() ? this.jarBalance : parseEther('10'));
    if (method === 'eth_getTransactionCount') return '0x0';
    if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00';
    if (method === 'eth_estimateGas') return '0x30d40';
    if (method === 'eth_getBlockByNumber') return { number: toHex(blockNumber), hash: hash(99), parentHash: hash(98), timestamp: toHex(Math.floor(Date.now() / 1000)), baseFeePerGas: '0x3b9aca00', gasLimit: '0x1c9c380', gasUsed: '0x0', transactions: [], extraData: '0x', miner: OWNER, difficulty: '0x0', totalDifficulty: '0x0', size: '0x0', nonce: '0x0000000000000000', logsBloom: `0x${'0'.repeat(512)}`, receiptsRoot: hash(1), stateRoot: hash(1), transactionsRoot: hash(1), sha3Uncles: hash(1), uncles: [] };
    if (method === 'eth_getLogs') {
      const filter = params[0];
      const from = filter.fromBlock === 'earliest' ? 0n : BigInt(filter.fromBlock ?? 0);
      const to = filter.toBlock === 'latest' ? blockNumber : BigInt(filter.toBlock ?? blockNumber);
      return Array.from({ length: this.logCount }, (_, index) => {
        const height = blockNumber - BigInt(index);
        return {
          address: jar.address, blockHash: hash(99 - index), blockNumber: toHex(height), transactionHash: hash(100 + index), transactionIndex: '0x0', logIndex: '0x0', removed: false,
          topics: encodeEventTopics({ abi: jarAbi, eventName: 'Tip', args: { sender: VISITOR } }),
          data: encodeAbiParameters([{ type: 'uint256' }, { type: 'string' }], [parseEther('0.01'), index === 0 ? '<img src=x onerror=alert(1)> & hello' : `Tip message ${String(index).padStart(2, '0')}`]),
        };
      }).filter(log => BigInt(log.blockNumber) >= from && BigInt(log.blockNumber) <= to).reverse();
    }
    if (method === 'eth_call') {
      if (this.failReads) throw new Error('RPC temporarily unavailable');
      const tx = params[0];
      const address = tx.to.toLowerCase();
      let abi: Abi = tokenAbi;
      if (address === jar.address.toLowerCase()) abi = jarAbi;
      else if (address === manifest.network.uniswapV4.permit2.toLowerCase()) abi = permitAbi;
      else if (address === manifest.network.uniswapV4.quoter.toLowerCase()) abi = quoterAbi;
      else if (address === manifest.network.uniswapV4.universalRouter.toLowerCase()) abi = routerAbi;
      else if (address === manifest.network.uniswapV4.stateView.toLowerCase()) abi = stateAbi;
      const { functionName } = decodeFunctionData({ abi, data: tx.data });
      if (functionName === 'tip' && this.accountChangeAfterSimulation) this.account = OWNER;
      if (this.failSimulation && ['tip', 'withdraw', 'execute', 'approve', 'transfer'].includes(functionName)) throw Object.assign(new Error('execution reverted: test simulation denied'), { data: '0x08c379a0' + encodeAbiParameters([{ type: 'string' }], ['test simulation denied']).slice(2) });
      const values: Record<string, any> = {
        owner: OWNER, MAX_MESSAGE_CHARACTERS: 140n, totalTipped: this.totalTipped, name: 'Tip Jar', symbol: 'TIPS', decimals: 18, totalSupply: parseEther('1000000'), balanceOf: parseEther('1000'),
        allowance: address === manifest.network.uniswapV4.permit2.toLowerCase() ? [this.approvedPermit ? parseEther('1000') : 0n, 281474976710655, 0] : this.approvedToken ? parseEther('1000') : 0n,
        approve: address === manifest.network.uniswapV4.permit2.toLowerCase() ? undefined : true,
        transfer: true, transferFrom: true, getSlot0: [79228162514264337593543950336n, 0, 0, manifest.poolKey.fee],
        quoteExactInputSingle: [this.quoteOut, 125000n],
      };
      return encodeFunctionResult({ abi, functionName, result: values[functionName] });
    }
    if (method === 'eth_sendTransaction') {
      if (this.rejectSignature) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      this.transactions.push(params[0]);
      return hash(500 + this.transactions.length);
    }
    if (method === 'eth_getTransactionByHash') {
      const tx = this.transactions[Number(BigInt(params[0])) - 501];
      if (!tx) return null;
      return { ...tx, hash: params[0], from: this.account, input: tx.data, nonce: '0x0', value: tx.value || '0x0', gas: '0x30d40', gasPrice: '0x3b9aca00', blockNumber: this.holdReceipt ? null : toHex(blockNumber), blockHash: this.holdReceipt ? null : hash(99), transactionIndex: this.holdReceipt ? null : '0x0', type: '0x2', chainId: toHex(manifest.chainId), v: '0x0', r: hash(1), s: hash(1) };
    }
    if (method === 'eth_getTransactionReceipt') {
      if (this.holdReceipt) return null;
      const txIndex = Number(BigInt(params[0])) - 501;
      const tx = this.transactions[txIndex];
      if (!tx) return null;
      if (!tx.applied && !this.revertReceipt) {
        const address = tx.to.toLowerCase();
        if (address === jar.address.toLowerCase()) {
          const { functionName } = decodeFunctionData({ abi: jarAbi, data: tx.data });
          if (functionName === 'withdraw') { this.withdrawn = true; this.jarBalance = 0n; }
          if (functionName === 'tip') { this.totalTipped += BigInt(tx.value); this.jarBalance += BigInt(tx.value); }
        } else if (address === token.address.toLowerCase()) this.approvedToken = true;
        else if (address === manifest.network.uniswapV4.permit2.toLowerCase()) this.approvedPermit = true;
        tx.applied = true;
      }
      return { transactionHash: params[0], transactionIndex: '0x0', blockHash: hash(99), blockNumber: toHex(blockNumber), from: this.account, to: tx.to, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', contractAddress: null, logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: this.revertReceipt ? '0x0' : '0x1', effectiveGasPrice: '0x3b9aca00', type: '0x2' };
    }
    throw Object.assign(new Error(`Unsupported mock RPC ${method}`), { code: -32601 });
  }
}
