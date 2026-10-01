import {
  BaseError, ContractFunctionRevertedError, createWalletClient, custom, encodeAbiParameters,
  formatUnits, getAddress, isAddress, parseAbiParameters, parseUnits, zeroAddress,
  type Abi, type Address, type Hash, type Hex,
} from 'viem'
import type { InjectedProvider, PoolKey, Runtime } from './config'
import { erc20Abi, permit2Abi, poolKeyComponents, quoterAbi, routerAbi } from './protocol'
import deploymentBlocks from './deployment-blocks.json' with { type: 'json' }
export type { InjectedProvider, Runtime } from './config'

export type WalletSession = { account: Address; chainId: number }
export type TxProgress = { stage: 'simulating' | 'signature' | 'pending' | 'confirmed'; hash?: Hash }
export type OnTx = (progress: TxProgress) => void

/** A submitted hash remains unresolved; UI must not offer a duplicate transaction. */
export class PendingTransactionError extends Error {
  readonly hash: Hash
  constructor(hash: Hash, cause: unknown) {
    super('This transaction was sent, but its confirmation is still unknown. Check its status before sending another transaction.', { cause })
    this.name = 'PendingTransactionError'
    this.hash = hash
  }
}
export type ContractState = {
  owner: Address; totalTipped: bigint; jarBalance: bigint; tokenName: string; tokenSymbol: string
  tokenDecimals: number; tokenSupply: bigint; nativeBalance?: bigint; tokenBalance?: bigint; blockNumber: bigint
}
export type Tip = { sender: Address; amount: bigint; message: string; hash: Hash; blockNumber: bigint; logIndex: number; timestamp?: number }
export type TipPage = { tips: Tip[]; nextCursor?: bigint; complete: boolean; scannedFrom: bigint; scannedTo: bigint }
export type Currency = { address: Address; symbol: string; decimals: number }
export type SwapQuote = {
  direction: 'buy' | 'sell'; input: Currency; output: Currency; amountIn: bigint; amountOut: bigint
  minimumOut: bigint; slippageBps: number; createdAt: number; expiresAt: number; zeroForOne: boolean; poolKey: PoolKey
}
export type ApprovalState = { tokenApproved: boolean; routerApproved: boolean; tokenAllowance: bigint; routerAllowance: bigint; expiration: number }

export const displayAmount = (amount: bigint, decimals = 18) => formatUnits(amount, decimals)
export function parseAmount(text: string, decimals: number): bigint {
  const value = text.trim()
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('Enter a positive amount using digits and a decimal point.')
  if ((value.split('.')[1]?.length ?? 0) > decimals) throw new Error(`This currency supports at most ${decimals} decimal places.`)
  const amount = parseUnits(value, decimals)
  if (amount <= 0n) throw new Error('Enter an amount greater than zero.')
  if (amount >= 2n ** 256n) throw new Error('The amount is too large.')
  return amount
}
export function validateMessage(message: string): number {
  const count = Array.from(message).length
  if (count > 140) throw new Error('Keep your message to 140 characters or fewer.')
  // Solidity validates UTF-8 scalar values; lone UTF-16 surrogates cannot be encoded faithfully.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(message)) throw new Error('Your message contains an unsupported character. Remove it and try again.')
  return count
}
export function parseSlippage(text: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim())) throw new Error('Enter slippage as a percentage with up to two decimal places.')
  const bps = Number(parseUnits(text.trim(), 2))
  if (bps < 0 || bps > 500) throw new Error('Choose slippage between 0% and 5%.')
  return bps
}

export async function connectWallet(provider: InjectedProvider): Promise<WalletSession> {
  const accounts = await provider.request({ method: 'eth_requestAccounts' })
  if (!accounts.length) throw new Error('No account was shared by your wallet.')
  const chain = await provider.request({ method: 'eth_chainId' })
  return { account: getAddress(accounts[0]), chainId: Number(BigInt(chain)) }
}
export async function switchNetwork(runtime: Runtime, provider: InjectedProvider): Promise<void> {
  const chainId = `0x${runtime.manifest.chainId.toString(16)}` as Hex
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
  } catch (error) {
    const e = error as { code?: number; message?: string; data?: { originalError?: { code?: number } } }
    const unknown = e.code === 4902 || e.data?.originalError?.code === 4902 || /unknown chain|unrecognized chain|not added|not configured/i.test(e.message ?? '')
    if (!unknown || !runtime.manifest.walletAddChain) throw error
    await provider.request({ method: 'wallet_addEthereumChain', params: [runtime.manifest.walletAddChain] } as Parameters<InjectedProvider['request']>[0])
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
  }
  if (Number(BigInt(await provider.request({ method: 'eth_chainId' }))) !== runtime.manifest.chainId) throw new Error('The wallet did not switch networks. Select the deployment network in your wallet.')
}
async function assertWallet(runtime: Runtime, provider: InjectedProvider, account: Address): Promise<void> {
  if (!runtime.verified) throw new Error('Deployment verification must complete before sending a transaction.')
  const [chainId, accounts] = await Promise.all([
    provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' }),
  ])
  if (Number(BigInt(chainId)) !== runtime.manifest.chainId) throw new Error(`Switch your wallet to ${runtime.chain.name} first.`)
  if (!accounts[0] || accounts[0].toLowerCase() !== account.toLowerCase()) throw new Error('Your wallet account changed. Reconnect and review the action again.')
}

export async function readState(runtime: Runtime, account?: Address): Promise<ContractState> {
  if (!runtime.verified) throw new Error('Deployment verification is still pending.')
  const { client, contracts } = runtime
  const blockNumber = await client.getBlockNumber()
  const jarRead = (functionName: string) => client.readContract({ ...contracts.TipJar, functionName, blockNumber })
  const tokenRead = (functionName: string) => client.readContract({ ...contracts.LaunchToken, functionName, blockNumber })
  const [owner, totalTipped, jarBalance, tokenName, tokenSymbol, tokenDecimals, tokenSupply, nativeBalance, tokenBalance] = await Promise.all([
    jarRead('owner'), jarRead('totalTipped'), client.getBalance({ address: contracts.TipJar.address, blockNumber }),
    tokenRead('name'), tokenRead('symbol'), tokenRead('decimals'), tokenRead('totalSupply'),
    account ? client.getBalance({ address: account, blockNumber }) : undefined,
    account ? client.readContract({ ...contracts.LaunchToken, functionName: 'balanceOf', args: [account], blockNumber }) : undefined,
  ])
  return {
    owner: getAddress(owner as Address), totalTipped: totalTipped as bigint, jarBalance,
    tokenName: tokenName as string, tokenSymbol: tokenSymbol as string, tokenDecimals: tokenDecimals as number,
    tokenSupply: tokenSupply as bigint, nativeBalance, tokenBalance: tokenBalance as bigint | undefined, blockNumber,
  }
}

/** Bounded backwards scan; callers can continue with nextCursor until 20 tips or deployment. */
export async function readTips(runtime: Runtime, cursor?: bigint): Promise<TipPage> {
  if (!runtime.verified) throw new Error('Deployment verification is still pending.')
  const floor = BigInt(deploymentBlocks.TipJar)
  const latest = cursor ?? await runtime.client.getBlockNumber()
  const event = runtime.contracts.TipJar.abi.find(item => item.type === 'event' && item.name === 'Tip')
  if (!event || event.type !== 'event') throw new Error('The verified Tip event interface is missing.')
  if (latest < floor) return { tips: [], complete: true, scannedFrom: floor, scannedTo: latest }
  let toBlock = latest
  let scannedFrom = latest
  let range = 2000n
  const tips: Tip[] = []
  let requests = 0
  while (toBlock >= floor && tips.length < 20 && requests < 12) {
    const fromBlock = toBlock - range + 1n > floor ? toBlock - range + 1n : floor
    requests++
    let logs
    try {
      logs = await runtime.client.getLogs({ address: runtime.contracts.TipJar.address, event, fromBlock, toBlock, strict: true })
    } catch (error) {
      if (range > 125n && /range|too many|limit|large|size|exceed/i.test(describeError(error))) { range /= 2n; continue }
      throw error
    }
    for (const log of logs) {
      const args = log.args as { sender: Address; amount: bigint; message: string }
      if (log.blockNumber === null || log.logIndex === null || !log.transactionHash || log.removed) continue
      tips.push({ sender: args.sender, amount: args.amount, message: args.message, hash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex })
    }
    scannedFrom = fromBlock
    toBlock = fromBlock - 1n
  }
  tips.sort((a, b) => a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1)
  const recent = tips.slice(0, 20)
  const timestamps = new Map<bigint, number>()
  await Promise.all([...new Set(recent.map(t => t.blockNumber))].map(async blockNumber => {
    try { timestamps.set(blockNumber, Number((await runtime.client.getBlock({ blockNumber })).timestamp)) } catch { /* A timestamp failure does not erase the on-chain event. */ }
  }))
  return {
    tips: recent.map(t => ({ ...t, timestamp: timestamps.get(t.blockNumber) })),
    nextCursor: toBlock >= floor && recent.length < 20 ? toBlock : undefined,
    complete: toBlock < floor || recent.length >= 20, scannedFrom, scannedTo: latest,
  }
}

type Action = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint }
async function transact(runtime: Runtime, provider: InjectedProvider, account: Address, action: Action, onTx: OnTx): Promise<Hash> {
  await assertWallet(runtime, provider, account)
  onTx({ stage: 'simulating' })
  const simulation = await runtime.client.simulateContract({ ...action, account })
  const [estimatedGas, balance, gasPrice] = await Promise.all([
    runtime.client.estimateContractGas({ ...action, account }),
    runtime.client.getBalance({ address: account }),
    runtime.client.getGasPrice(),
  ])
  const gas = estimatedGas * 120n / 100n
  if (balance < (action.value ?? 0n) + gas * gasPrice) throw new Error('Your wallet needs more native currency for this amount and estimated network gas.')
  await assertWallet(runtime, provider, account)
  onTx({ stage: 'signature' })
  const wallet = createWalletClient({ chain: runtime.chain, transport: custom(provider), account })
  const hash = await wallet.writeContract({ ...simulation.request, chain: runtime.chain, account, gas })
  onTx({ stage: 'pending', hash })
  let confirmedHash = hash
  let replacedWithDifferentAction = false
  let receipt
  try {
    receipt = await runtime.client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000,
      onReplaced: ({ reason, transaction }) => {
        replacedWithDifferentAction = reason === 'cancelled' || reason === 'replaced'
        confirmedHash = transaction.hash
        onTx({ stage: 'pending', hash: confirmedHash })
      },
    })
  } catch (error) {
    if (replacedWithDifferentAction) throw new Error('The transaction was cancelled or changed in your wallet. Check the explorer before trying again.')
    throw new PendingTransactionError(confirmedHash, error)
  }
  if (replacedWithDifferentAction) throw new Error('The transaction was cancelled or changed in your wallet. Check the explorer before trying again.')
  if (receipt.status !== 'success') throw new Error('The transaction reverted. No requested contract action was completed; network gas may still have been spent.')
  onTx({ stage: 'confirmed', hash: confirmedHash })
  return confirmedHash
}
export async function sendTip(runtime: Runtime, provider: InjectedProvider, account: Address, amount: string, message: string, onTx: OnTx): Promise<Hash> {
  validateMessage(message)
  const value = parseAmount(amount, runtime.chain.nativeCurrency.decimals)
  return transact(runtime, provider, account, { ...runtime.contracts.TipJar, functionName: 'tip', args: [message], value }, onTx)
}
export async function withdraw(runtime: Runtime, provider: InjectedProvider, account: Address, onTx: OnTx): Promise<Hash> {
  const owner = await runtime.client.readContract({ ...runtime.contracts.TipJar, functionName: 'owner' }) as Address
  if (owner.toLowerCase() !== account.toLowerCase()) throw new Error('Only the jar owner can withdraw.')
  return transact(runtime, provider, account, { ...runtime.contracts.TipJar, functionName: 'withdraw' }, onTx)
}
export async function transferToken(runtime: Runtime, provider: InjectedProvider, account: Address, recipient: string, amount: string, onTx: OnTx): Promise<Hash> {
  const to = recipient.trim()
  if (!isAddress(to) || to.toLowerCase() === zeroAddress) throw new Error('Enter a valid, nonzero Ethereum recipient address.')
  const decimals = await runtime.client.readContract({ ...runtime.contracts.LaunchToken, functionName: 'decimals' }) as number
  return transact(runtime, provider, account, { ...runtime.contracts.LaunchToken, functionName: 'transfer', args: [getAddress(to), parseAmount(amount, decimals)] }, onTx)
}

function swapConfig(runtime: Runtime) {
  const key = runtime.manifest.poolKey
  const uniswap = runtime.manifest.network?.uniswapV4
  if (!key || !uniswap) throw new Error('Swaps are unavailable because this deployment has no vetted pool or Uniswap network configuration.')
  const token = runtime.contracts.LaunchToken.address.toLowerCase()
  if (key.currency0.toLowerCase() !== token && key.currency1.toLowerCase() !== token) throw new Error('The deployment pool does not contain this token.')
  return { key, uniswap }
}
async function currency(runtime: Runtime, address: Address): Promise<Currency> {
  if (address.toLowerCase() === zeroAddress) return { address, symbol: runtime.chain.nativeCurrency.symbol, decimals: runtime.chain.nativeCurrency.decimals }
  const abi = address.toLowerCase() === runtime.contracts.LaunchToken.address.toLowerCase() ? runtime.contracts.LaunchToken.abi : erc20Abi
  const [symbol, decimals] = await Promise.all([
    runtime.client.readContract({ address, abi, functionName: 'symbol' }),
    runtime.client.readContract({ address, abi, functionName: 'decimals' }),
  ])
  return { address, symbol: symbol as string, decimals: decimals as number }
}
export async function quoteSwap(runtime: Runtime, account: Address, direction: 'buy' | 'sell', amount: string, slippage: string): Promise<SwapQuote> {
  if (!runtime.verified) throw new Error('Deployment verification is still pending.')
  const { key, uniswap } = swapConfig(runtime)
  const token = runtime.contracts.LaunchToken.address.toLowerCase()
  const pair = key.currency0.toLowerCase() === token ? key.currency1 : key.currency0
  const inputAddress = direction === 'buy' ? pair : runtime.contracts.LaunchToken.address
  const outputAddress = direction === 'buy' ? runtime.contracts.LaunchToken.address : pair
  const [input, output] = await Promise.all([currency(runtime, inputAddress), currency(runtime, outputAddress)])
  const amountIn = parseAmount(amount, input.decimals)
  if (amountIn >= 2n ** 128n) throw new Error('The amount exceeds the pool swap limit.')
  const slippageBps = parseSlippage(slippage)
  const zeroForOne = inputAddress.toLowerCase() === key.currency0.toLowerCase()
  const result = await runtime.client.simulateContract({
    address: uniswap.quoter, abi: quoterAbi, functionName: 'quoteExactInputSingle',
    args: [{ poolKey: key, zeroForOne, exactAmount: amountIn, hookData: '0x' }], account,
  })
  const amountOut = result.result[0]
  const minimumOut = amountOut * BigInt(10_000 - slippageBps) / 10_000n
  if (amountOut === 0n || minimumOut === 0n) throw new Error('This amount is too small to produce a protected swap quote.')
  const createdAt = Date.now()
  return { direction, input, output, amountIn, amountOut, minimumOut, slippageBps, createdAt, expiresAt: createdAt + 60_000, zeroForOne, poolKey: { ...key } }
}
function assertQuote(runtime: Runtime, quote: SwapQuote, requireFresh = false) {
  const { key } = swapConfig(runtime)
  if (quote.poolKey.currency0 !== key.currency0 || quote.poolKey.currency1 !== key.currency1 || quote.poolKey.fee !== key.fee || quote.poolKey.tickSpacing !== key.tickSpacing || quote.poolKey.hooks !== key.hooks) throw new Error('Pool configuration changed. Request a new quote.')
  if (requireFresh && Date.now() >= quote.expiresAt) throw new Error('Your quote expired. Request a fresh quote before swapping.')
}
export async function approvalState(runtime: Runtime, account: Address, quote: SwapQuote): Promise<ApprovalState> {
  const { uniswap } = swapConfig(runtime)
  assertQuote(runtime, quote)
  if (quote.input.address.toLowerCase() === zeroAddress) return { tokenApproved: true, routerApproved: true, tokenAllowance: quote.amountIn, routerAllowance: quote.amountIn, expiration: 0 }
  const [tokenAllowance, permit] = await Promise.all([
    runtime.client.readContract({ address: quote.input.address, abi: quote.input.address.toLowerCase() === runtime.contracts.LaunchToken.address.toLowerCase() ? runtime.contracts.LaunchToken.abi : erc20Abi, functionName: 'allowance', args: [account, uniswap.permit2] }) as Promise<bigint>,
    runtime.client.readContract({ address: uniswap.permit2, abi: permit2Abi, functionName: 'allowance', args: [account, quote.input.address, uniswap.universalRouter] }),
  ])
  return {
    tokenApproved: tokenAllowance >= quote.amountIn,
    routerApproved: permit[0] >= quote.amountIn && Number(permit[1]) > Math.floor(Date.now() / 1000) + 120,
    tokenAllowance, routerAllowance: permit[0], expiration: Number(permit[1]),
  }
}
export async function approveToken(runtime: Runtime, provider: InjectedProvider, account: Address, quote: SwapQuote, onTx: OnTx): Promise<Hash> {
  assertQuote(runtime, quote)
  const { uniswap } = swapConfig(runtime)
  if (quote.input.address.toLowerCase() === zeroAddress) throw new Error('Native currency does not need token approval.')
  const allowance = await approvalState(runtime, account, quote)
  if (allowance.tokenApproved) throw new Error('This token is already approved. Refresh the approval status.')
  const abi = quote.input.address.toLowerCase() === runtime.contracts.LaunchToken.address.toLowerCase() ? runtime.contracts.LaunchToken.abi : erc20Abi
  return transact(runtime, provider, account, { address: quote.input.address, abi, functionName: 'approve', args: [uniswap.permit2, allowance.tokenAllowance > 0n ? 0n : quote.amountIn] }, onTx)
}
export async function approveRouter(runtime: Runtime, provider: InjectedProvider, account: Address, quote: SwapQuote, onTx: OnTx): Promise<Hash> {
  assertQuote(runtime, quote)
  const { uniswap } = swapConfig(runtime)
  if (quote.input.address.toLowerCase() === zeroAddress) throw new Error('Native currency does not need router approval.')
  const allowance = await approvalState(runtime, account, quote)
  if (!allowance.tokenApproved) throw new Error('Approve the input token for Permit2 first.')
  if (allowance.routerApproved) throw new Error('The router is already approved. Refresh the approval status.')
  return transact(runtime, provider, account, { address: uniswap.permit2, abi: permit2Abi, functionName: 'approve', args: [quote.input.address, uniswap.universalRouter, quote.amountIn, Math.floor(Date.now() / 1000) + 1800] }, onTx)
}

export function encodeSwap(runtime: Runtime, quote: SwapQuote): { commands: Hex; inputs: Hex[]; deadline: bigint; value: bigint } {
  assertQuote(runtime, quote)
  const { uniswap, key } = swapConfig(runtime)
  const common = [
    { name: 'poolKey', type: 'tuple', components: poolKeyComponents }, { name: 'zeroForOne', type: 'bool' },
    { name: 'amountIn', type: 'uint128' }, { name: 'amountOutMinimum', type: 'uint128' },
  ] as const
  if (quote.minimumOut >= 2n ** 128n) throw new Error('The quoted output exceeds the router limit.')
  const swap = uniswap.extendedSwapParams
    ? encodeAbiParameters([{ type: 'tuple', components: [...common, { name: 'minHopPriceX36', type: 'uint256' }, { name: 'hookData', type: 'bytes' }] }], [{ poolKey: key, zeroForOne: quote.zeroForOne, amountIn: quote.amountIn, amountOutMinimum: quote.minimumOut, minHopPriceX36: 0n, hookData: '0x' }])
    : encodeAbiParameters([{ type: 'tuple', components: [...common, { name: 'hookData', type: 'bytes' }] }], [{ poolKey: key, zeroForOne: quote.zeroForOne, amountIn: quote.amountIn, amountOutMinimum: quote.minimumOut, hookData: '0x' }])
  const settle = encodeAbiParameters(parseAbiParameters('address currency,uint256 amount'), [quote.input.address, quote.amountIn])
  const take = encodeAbiParameters(parseAbiParameters('address currency,uint256 amount'), [quote.output.address, quote.minimumOut])
  return {
    commands: '0x10', inputs: [encodeAbiParameters(parseAbiParameters('bytes actions,bytes[] params'), ['0x060c0f', [swap, settle, take]])],
    deadline: BigInt(Math.floor(quote.expiresAt / 1000)), value: quote.input.address.toLowerCase() === zeroAddress ? quote.amountIn : 0n,
  }
}
export async function executeSwap(runtime: Runtime, provider: InjectedProvider, account: Address, quote: SwapQuote, onTx: OnTx): Promise<Hash> {
  assertQuote(runtime, quote, true)
  const { uniswap } = swapConfig(runtime)
  const approved = await approvalState(runtime, account, quote)
  if (!approved.tokenApproved || !approved.routerApproved) throw new Error('Complete the token and router approval steps first.')
  assertQuote(runtime, quote, true)
  const encoded = encodeSwap(runtime, quote)
  return transact(runtime, provider, account, { address: uniswap.universalRouter, abi: routerAbi, functionName: 'execute', args: [encoded.commands, encoded.inputs, encoded.deadline], value: encoded.value }, onTx)
}

export function describeError(error: unknown): string {
  const messages: Record<string, string> = {
    ZeroTip: 'Enter an amount greater than zero.', MessageTooLong: 'Keep your message to 140 characters or fewer.',
    InvalidUTF8: 'Your message contains an unsupported character.', NotOwner: 'Only the jar owner can withdraw.',
    NothingToWithdraw: 'The jar is empty. There is nothing to withdraw.', WithdrawalFailed: 'The owner address could not receive the withdrawal.',
    ERC20InsufficientBalance: 'Your token balance is too low for this amount.', ERC20InsufficientAllowance: 'The token allowance is too low. Complete the approval step.',
    ERC20InvalidReceiver: 'The recipient address cannot receive tokens.',
  }
  if (error instanceof BaseError) {
    const revert = error.walk(e => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError
    const name = revert?.data?.errorName
    if (name && messages[name]) return messages[name]
    if (revert?.reason) return `The contract rejected this action: ${revert.reason.slice(0, 180)}`
    if (name) return `The contract rejected this action (${name}). Check the amount and try again.`
  }
  const err = error as { code?: number; shortMessage?: string; message?: string }
  const message = err?.shortMessage || err?.message || String(error)
  if (err?.code === 4001 || /user rejected|user denied|rejected the request/i.test(message)) return 'You declined the request in your wallet. Nothing was sent.'
  if (/insufficient funds/i.test(message)) return 'Your wallet needs more native currency for the amount and network gas.'
  if (/timeout|timed out/i.test(message)) return 'The network did not respond in time. If a transaction hash is shown, check it before retrying.'
  if (/failed to fetch|network request|http request failed/i.test(message)) return 'The network could not be reached. Try refreshing the live data.'
  return message.split('\n')[0].slice(0, 260)
}
