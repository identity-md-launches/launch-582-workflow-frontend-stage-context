import {
  createPublicClient, custom, defineChain, fallback, http, isAddress,
  keccak256, stringToHex, type Abi, type Address, type Chain,
  type EIP1193Provider, type PublicClient,
} from 'viem'

export type InjectedProvider = EIP1193Provider & {
  on?: (event: string, callback: (...args: any[]) => void) => void
  removeListener?: (event: string, callback: (...args: any[]) => void) => void
  providers?: InjectedProvider[]
}
export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }
export type DeploymentContract = { name: string; address: Address; abiHash: string; abiPath: string }
export type Network = {
  chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string
  nativeCurrency: { name: string; symbol: string; decimals: number }; faucets?: string[]
  pairToken?: Address
  uniswapV4?: {
    poolManager: Address; universalRouter: Address; quoter: Address; stateView: Address
    positionManager: Address; permit2: Address; extendedSwapParams?: boolean
  }
}
export type Deployment = {
  version: 1; launchId: string; chainId: number; sourceCommit: string; attestationHash: string
  contracts: DeploymentContract[]; assets: { path: string; sha256: string }[]
  poolKey?: PoolKey; network?: Network
  walletAddChain?: { chainId: string; chainName: string; rpcUrls: string[]; nativeCurrency: Network['nativeCurrency']; blockExplorerUrls?: string[] }
}
export type LoadedContract = DeploymentContract & { abi: Abi }
export type Runtime = {
  manifest: Deployment; contracts: { TipJar: LoadedContract; LaunchToken: LoadedContract }
  chain: Chain; client: PublicClient; verified: boolean
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
export const canonicalAbiHash = (abi: unknown) => keccak256(stringToHex(canonicalJson(abi))).slice(2)

function relativePath(path: string): boolean {
  return typeof path === 'string' && !path.startsWith('/') && !path.includes('..') && !path.includes(':') && !path.includes('\\')
}
function checkedManifest(value: unknown): Deployment {
  const d = value as Deployment
  if (!d || d.version !== 1 || !Number.isSafeInteger(d.chainId) || d.chainId <= 0 ||
      !Array.isArray(d.contracts) || !Array.isArray(d.assets) || !/^[a-f0-9]{64}$/.test(d.attestationHash)) {
    throw new Error('The deployment configuration is invalid. Transactions are unavailable.')
  }
  if (new Set(d.contracts.map(c => c.name)).size !== d.contracts.length || d.contracts.some(c => !isAddress(c.address) || !/^[a-f0-9]{64}$/.test(c.abiHash) || !relativePath(c.abiPath))) {
    throw new Error('The deployment contains an invalid contract or ABI reference.')
  }
  if (d.network && (d.network.chainId !== d.chainId || !d.network.rpcUrls.length || d.network.rpcUrls.some(u => !u.startsWith('https://')))) {
    throw new Error('The deployment network configuration is invalid.')
  }
  if (d.poolKey && (!isAddress(d.poolKey.currency0) || !isAddress(d.poolKey.currency1) || !isAddress(d.poolKey.hooks) ||
      BigInt(d.poolKey.currency0) >= BigInt(d.poolKey.currency1) || !Number.isInteger(d.poolKey.fee) || !Number.isInteger(d.poolKey.tickSpacing))) {
    throw new Error('The deployment pool key is invalid.')
  }
  return d
}

/** The exported manifest is the only deployment/address/RPC source. */
export async function loadRuntime(): Promise<Runtime> {
  const base = new URL('./', document.baseURI)
  const response = await fetch(new URL('imd-deployment.json', base), { cache: 'no-store' })
  if (!response.ok) throw new Error('Could not load the deployment configuration. Refresh to try again.')
  const manifest = checkedManifest(await response.json())
  const loaded = await Promise.all(manifest.contracts.map(async c => {
    const result = await fetch(new URL(c.abiPath, base))
    if (!result.ok) throw new Error(`Could not load the ${c.name} contract interface.`)
    const abi: unknown = await result.json()
    if (!Array.isArray(abi) || canonicalAbiHash(abi) !== c.abiHash) throw new Error(`${c.name} ABI verification failed. Transactions are disabled.`)
    return { ...c, abi: abi as Abi }
  }))
  const TipJar = loaded.find(c => c.name === 'TipJar')
  const LaunchToken = loaded.find(c => c.name === 'LaunchToken')
  if (!TipJar || !LaunchToken) throw new Error('The deployment is missing a required contract.')
  const network = manifest.network
  const chain = defineChain({
    id: manifest.chainId,
    name: network?.name ?? `Chain ${manifest.chainId}`,
    nativeCurrency: network?.nativeCurrency ?? { name: 'Native currency', symbol: 'Native', decimals: 18 },
    rpcUrls: { default: { http: network?.rpcUrls ?? [] } },
    ...(network?.explorer ? { blockExplorers: { default: { name: 'Explorer', url: network.explorer } } } : {}),
    testnet: network?.testnet,
  })
  // An unconfigured chain cannot silently fall through to another network.
  const client = createPublicClient({ chain, transport: network?.rpcUrls.length
    ? fallback(network.rpcUrls.map(url => http(url, { timeout: 12_000, retryCount: 0 })), { retryCount: 0 })
    : custom({ request: async () => { throw new Error('No public RPC is configured. Connect a wallet on the deployment chain for reads.') } }) }) as PublicClient
  return { manifest, contracts: { TipJar, LaunchToken }, chain, client, verified: false }
}

/** Only a provider on this deployment chain can participate in read fallback. */
export function useWalletFallback(runtime: Runtime, provider: InjectedProvider): void {
  const guardedWallet = custom({ request: async ({ method, params }) => {
    const chainId = await provider.request({ method: 'eth_chainId' })
    if (Number(BigInt(chainId)) !== runtime.manifest.chainId) throw new Error('Wallet is on another network.')
    return provider.request({ method, params } as Parameters<InjectedProvider['request']>[0])
  } }, { retryCount: 0 })
  runtime.client = createPublicClient({ chain: runtime.chain, transport: fallback([
    ...(runtime.manifest.network?.rpcUrls ?? []).map(url => http(url, { timeout: 12_000, retryCount: 0 })), guardedWallet,
  ], { retryCount: 0 }) }) as PublicClient
}

export async function verifyRuntime(runtime: Runtime): Promise<void> {
  runtime.verified = false
  const chainId = await runtime.client.getChainId()
  if (chainId !== runtime.manifest.chainId) throw new Error('RPC network does not match the deployment. Transactions are disabled.')
  const codes = await Promise.all(Object.values(runtime.contracts).map(c => runtime.client.getCode({ address: c.address })))
  if (codes.some(code => !code || code === '0x')) throw new Error('A deployed contract has no code on this network. Transactions are disabled.')
  runtime.verified = true
}
