import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { formatUnits, getAddress, type Address } from 'viem';
import { loadRuntime, useWalletFallback, verifyRuntime, type InjectedProvider, type Runtime } from './config';
import * as chain from './chain';
import { mergeTipPage, type TipHistory } from './tip-history';
import { AddressView, Jar, TransactionStatus, idleAction, type ActionStatus } from './components';

declare global { interface Window { ethereum?: InjectedProvider } }
const amountOf = (value: bigint | undefined, decimals = 18) => value === undefined ? '—' : formatUnits(value, decimals);
type ActionName = 'tip' | 'withdraw' | 'transfer' | 'tokenApproval' | 'routerApproval' | 'swap';
type RunAction = (name: ActionName, work: (onTx: chain.OnTx) => Promise<unknown>) => Promise<boolean>;

export default function App() {
  const [runtime, setRuntime] = useState<Runtime>();
  const [fatal, setFatal] = useState('');
  const [data, setData] = useState<chain.ContractState>();
  const [readError, setReadError] = useState('');
  const [session, setSession] = useState<chain.WalletSession>();
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [provider, setProvider] = useState<InjectedProvider>();
  const [tips, setTips] = useState<chain.Tip[]>([]);
  const [tipPage, setTipPage] = useState<chain.TipPage>();
  const [tipsError, setTipsError] = useState('');
  const [tipsBusy, setTipsBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [actions, setActions] = useState<Partial<Record<ActionName, ActionStatus>>>({});
  const [unresolved, setUnresolved] = useState<{ name: ActionName; hash: `0x${string}` }>();
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState('');
  const [amount, setAmount] = useState('0.01');
  const [message, setMessage] = useState('');
  const [fieldError, setFieldError] = useState<{ field: string; text: string }>();
  const actionLock = useRef(false);
  const readLock = useRef(false);
  const readQueued = useRef(false);
  const tipsLock = useRef(false);
  const historyRef = useRef<TipHistory>({ tips: [] });
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    let active = true;
    loadRuntime().then(r => { if (active) setRuntime(r); }).catch(e => { if (active) setFatal(chain.describeError(e)); });
    return () => { active = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!runtime) return;
    if (readLock.current) { readQueued.current = true; return; }
    readLock.current = true; setRefreshBusy(true);
    const account = sessionRef.current?.account;
    try {
      await verifyRuntime(runtime);
      const next = await chain.readState(runtime, account);
      if (sessionRef.current?.account !== account) return;
      setData(next); setReadError('');
    } catch (e) { setReadError(chain.describeError(e)); }
    finally {
      readLock.current = false; setRefreshBusy(false);
      if (readQueued.current) { readQueued.current = false; queueMicrotask(() => { void refresh(); }); }
    }
  }, [runtime]);

  const refreshTips = useCallback(async (cursor?: bigint) => {
    if (!runtime?.verified || tipsLock.current) return;
    tipsLock.current = true; setTipsBusy(true);
    try {
      const page = await chain.readTips(runtime, cursor);
      const merged = mergeTipPage(historyRef.current, page, cursor);
      historyRef.current = merged;
      setTips(merged.tips); setTipPage(merged.page); setTipsError('');
    } catch (e) { setTipsError(chain.describeError(e)); }
    finally { tipsLock.current = false; setTipsBusy(false); }
  }, [runtime]);

  useEffect(() => { void refresh(); }, [refresh, session?.account]);
  useEffect(() => { if (data) void refreshTips(); }, [!!data, refreshTips]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden && !actionLock.current) { void refresh().then(() => refreshTips()); } }, 15_000);
    return () => clearInterval(timer);
  }, [refresh, refreshTips]);

  useEffect(() => {
    if (!provider) return;
    const accountsChanged = (accounts: string[]) => {
      setSession(current => accounts.length && current ? { ...current, account: getAddress(accounts[0]) } : undefined);
      setData(undefined); setWalletError('');
    };
    const chainChanged = (id: string) => { setSession(current => current ? { ...current, chainId: Number(BigInt(id)) } : current); };
    const disconnected = () => { setSession(undefined); setData(undefined); };
    provider.on?.('accountsChanged', accountsChanged); provider.on?.('chainChanged', chainChanged); provider.on?.('disconnect', disconnected);
    return () => { provider.removeListener?.('accountsChanged', accountsChanged); provider.removeListener?.('chainChanged', chainChanged); provider.removeListener?.('disconnect', disconnected); };
  }, [provider]);

  async function connect() {
    if (walletBusy || !runtime) return;
    setWalletBusy(true); setWalletError('');
    try {
      const selected = window.ethereum?.providers?.[0] ?? window.ethereum;
      if (!selected) throw new Error('No browser wallet found. Install an Ethereum browser wallet or open this page in your wallet’s browser.');
      const connected = await chain.connectWallet(selected);
      setProvider(selected); setSession(connected); useWalletFallback(runtime, selected);
    } catch (e) { setWalletError(chain.describeError(e)); }
    finally { setWalletBusy(false); }
  }
  async function switchChain() {
    if (!runtime || !provider || walletBusy) return;
    setWalletBusy(true); setWalletError('');
    try { await chain.switchNetwork(runtime, provider); setSession(await chain.connectWallet(provider)); await refresh(); }
    catch (e) { setWalletError(chain.describeError(e)); }
    finally { setWalletBusy(false); }
  }

  const wrongChain = !!session && !!runtime && session.chainId !== runtime.manifest.chainId;
  const anyBusy = !!unresolved || Object.values(actions).some(a => a?.busy);
  const ready = !!runtime?.verified && !!data && !!session && !wrongChain && !readError && !anyBusy;
  const isOwner = !!data && !!session && !wrongChain && data.owner.toLowerCase() === session.account.toLowerCase();

  const runAction: RunAction = async (name, work) => {
    if (actionLock.current || !ready) return false;
    actionLock.current = true;
    setActions(old => ({ ...old, [name]: { busy: true } }));
    try {
      await work(progress => setActions(old => ({ ...old, [name]: { busy: true, progress } })));
      await refresh(); await refreshTips();
      return true;
    } catch (e) {
      if (e instanceof chain.PendingTransactionError) setUnresolved({ name, hash: e.hash });
      setActions(old => ({ ...old, [name]: { ...old[name], busy: true, error: chain.describeError(e) } })); return false;
    }
    finally { actionLock.current = false; setActions(old => ({ ...old, [name]: { ...old[name], busy: false } })); }
  };

  async function checkReceipt() {
    if (!runtime || !unresolved || receiptBusy) return;
    setReceiptBusy(true); setReceiptError('');
    try {
      const receipt = await runtime.client.getTransactionReceipt({ hash: unresolved.hash });
      setActions(old => ({ ...old, [unresolved.name]: receipt.status === 'success'
        ? { busy: false, progress: { stage: 'confirmed', hash: receipt.transactionHash } }
        : { busy: false, progress: { stage: 'pending', hash: receipt.transactionHash }, error: 'The transaction reverted. The requested action was not completed.' } }));
      setUnresolved(undefined); await refresh(); await refreshTips();
    } catch { setReceiptError('A receipt is not available yet. Check the transaction in the explorer and try again.'); }
    finally { setReceiptBusy(false); }
  }

  async function submitTip(event: FormEvent) {
    event.preventDefault(); setFieldError(undefined);
    if (!ready || !runtime || !session || !provider) return;
    try { chain.parseAmount(amount, runtime.chain.nativeCurrency.decimals); }
    catch (e) { setFieldError({ field: 'tip-amount', text: chain.describeError(e) }); document.getElementById('tip-amount')?.focus(); return; }
    try { chain.validateMessage(message); }
    catch (e) { setFieldError({ field: 'tip-message', text: chain.describeError(e) }); document.getElementById('tip-message')?.focus(); return; }
    if (await runAction('tip', onTx => chain.sendTip(runtime, provider, session.account, amount, message, onTx))) setMessage('');
  }

  const symbol = runtime?.chain.nativeCurrency.symbol ?? 'ETH';
  return <div className="shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="header"><a className="brand" href="#main"><Jar />Tip Jar<span className="fine">↗</span></a>
      <div className="header-right"><nav aria-label="Page"><a href="#support">Leave a tip</a><a href="#recent">Recent kindness</a><a href="#token">TIPS token</a></nav>
        <span className="network">{runtime?.chain.name ?? 'Loading network'}</span>
        {session ? <button className="small" disabled={anyBusy} onClick={() => { setSession(undefined); setProvider(undefined); setData(undefined); }}>Disconnect</button> : <button className="small" onClick={connect} disabled={!runtime || walletBusy}>{walletBusy ? 'Connecting…' : 'Connect wallet'}</button>}
      </div>
    </header>
    <main id="main">
      <section className="hero" aria-labelledby="hero-title"><div><p className="eyebrow">Small gestures. Shared onchain.</p><h1 id="hero-title">A little thanks.<br /><em>A lasting note.</em></h1><p className="hero-copy">Send a little ETH. Leave a few kind words.<br />An open tip jar, where every contribution has a story.</p></div><Jar hero /></section>
      <div className="stats" role="group" aria-label="Tip jar statistics">
        <div className="stat"><div className="stat-label">Total kindness, all time</div><div className="stat-value">{amountOf(data?.totalTipped)} <span>{symbol}</span></div><div className="stat-caption">Lifetime tips · never reset by withdrawals</div></div>
        <div className="stat"><div className="stat-label">Currently in the jar</div><div className="stat-value">{amountOf(data?.jarBalance)} <span>{symbol}</span></div><div className="stat-caption">Available for the owner to withdraw</div></div>
        <div className="stat"><div className="stat-label">Straight to the jar</div><div className="stat-value">100<span>% of every tip</span></div><div className="stat-caption">No application fees · network gas applies</div></div>
      </div>
      {fatal && <div className="error" role="alert">{fatal} <button onClick={() => location.reload()}>Reload configuration</button></div>}
      {readError && <div className="banner"><p role="alert">Live data unavailable. {readError} {data && 'Previously loaded amounts may be out of date.'}</p><button disabled={refreshBusy} onClick={refresh}>Retry live data</button></div>}
      {wrongChain && <div className="banner"><p>Your wallet is on another network. Switch to {runtime?.chain.name} to continue.</p><button disabled={walletBusy} onClick={switchChain}>{walletBusy ? 'Switching…' : `Switch to ${runtime?.chain.name}`}</button></div>}
      <div className="error" role="alert">{walletError}</div>
      {unresolved && <div className="banner"><p>A sent transaction still needs a confirmed receipt. New transactions are paused.</p><button disabled={receiptBusy} onClick={checkReceipt}>{receiptBusy ? 'Checking receipt…' : 'Check transaction status'}</button><div role="alert" className="error">{receiptError}</div></div>}
      {session && runtime && <div className="wallet-info row"><span>Connected:</span><AddressView runtime={runtime} value={session.account} /><span className="fine">Balance: {amountOf(data?.nativeBalance)} {symbol}</span></div>}
      <div className="section-grid">
        <section className="card" id="support" aria-labelledby="support-title"><div className="section-heading"><h2 id="support-title">Leave a little kindness</h2><span className="step">01 / Give</span></div><p className="help">Big or small, it all means something.</p>
          <form onSubmit={submitTip} noValidate>
            <fieldset disabled={anyBusy}>
              <div className="field"><label htmlFor="tip-amount">Tip amount ({symbol})</label><div className="amount-wrap"><input id="tip-amount" name="tipAmount" inputMode="decimal" autoComplete="off" value={amount} onChange={e => { setAmount(e.target.value); setFieldError(undefined); }} aria-invalid={fieldError?.field === 'tip-amount'} aria-describedby="amount-help tip-field-error" /><span className="amount-unit">{symbol}</span></div>
                <div className="presets">{['0.001', '0.01', '0.05'].map(value => <button type="button" key={value} aria-pressed={amount === value} onClick={() => { setAmount(value); setFieldError(undefined); }}>{value} {symbol}</button>)}</div><span className="fine" id="amount-help">Sepolia test ETH · USD value unavailable</span>
              </div>
              <div className="field"><div className="label-row"><label htmlFor="tip-message">Message (optional)</label><span className={`counter ${Array.from(message).length > 140 ? 'invalid' : ''}`}>{Array.from(message).length} / 140</span></div><textarea id="tip-message" name="message" placeholder="Thanks for making something worth supporting." value={message} onChange={e => { setMessage(e.target.value); setFieldError(undefined); }} aria-invalid={fieldError?.field === 'tip-message'} aria-describedby="message-help tip-field-error" /><p className="fine public-note" id="message-help"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 7V4a3 3 0 0 1 6 0v3M3 7h10v8H3Z" stroke="currentColor" strokeWidth="1.5"/></svg>Your note and wallet address will be public and permanent. Up to 140 Unicode characters.</p></div>
            </fieldset>
            <div className="error" id="tip-field-error" role="alert">{fieldError?.text}</div>
            <div className="transaction-summary">You’ll send <strong>{amount || '0'} {symbol}</strong> to this jar, plus network gas. Only the jar owner can withdraw it.</div>
            {!session ? <button type="button" className="primary full" disabled={!runtime || walletBusy} onClick={connect}>Connect to send a tip <span aria-hidden="true">↗</span></button> : <button data-testid="tip-submit" className="primary full" type="submit" disabled={!ready}>{actions.tip?.busy ? 'Sending tip…' : 'Send tip'} <span aria-hidden="true">↗</span></button>}
            <p className="fine" style={{ textAlign: 'center', marginBlock: '12px 0' }}>Sepolia testnet. No real-world payment is required.</p>
            {runtime && <TransactionStatus runtime={runtime} state={actions.tip ?? idleAction} />}
          </form>
          {isOwner && runtime && provider && session && <div className="transaction-summary"><h3>Owner withdrawal</h3><p>Withdraw the entire {amountOf(data?.jarBalance)} {symbol} balance to your connected owner address. Lifetime tips stay recorded.</p><button style={{ marginBlockStart: 12 }} disabled={!ready || data?.jarBalance === 0n} onClick={() => runAction('withdraw', onTx => chain.withdraw(runtime, provider, session.account, onTx))}>{actions.withdraw?.busy ? 'Withdrawing…' : 'Withdraw'}</button><TransactionStatus runtime={runtime} state={actions.withdraw ?? idleAction} /></div>}
        </section>
        <section className="recent" id="recent" aria-labelledby="recent-title"><div className="recent-header"><h2 id="recent-title">Recent kindness</h2><button className="small" disabled={!data || tipsBusy} onClick={() => refreshTips()}>{tipsBusy ? 'Refreshing…' : 'Refresh tips'}</button></div><p className="help">The latest 20 notes, straight from the chain. Scroll to read more.</p>
          <div className="error" role="alert">{tipsError}</div>
          {!tipPage && !tipsError ? <div className="empty"><div className="empty-icon" aria-hidden="true">↻</div><h3>Reading the jar…</h3><p className="help">Fetching tip events from {runtime?.chain.name ?? 'the network'}.</p></div> : !tips.length ? <div className="empty"><div className="empty-icon" aria-hidden="true">♡</div><h3>{tipPage?.complete ? 'The first kind word could be yours.' : 'No tips in the scanned blocks yet.'}</h3><p className="help">{tipPage?.complete ? 'Leave a tip and a note to start the story.' : 'Continue scanning to check older history.'}</p></div> : <ol className="tip-list" tabIndex={0} aria-label="Recent tip events">{tips.map(tip => <li className="tip-row" key={`${tip.hash}-${tip.logIndex}`}><div className="tip-top"><div className="avatar" aria-hidden="true">{tip.sender.slice(2, 4).toUpperCase()}</div><div className="tip-sender">{runtime && <AddressView value={tip.sender} runtime={runtime} />}</div><span className="tip-amount">+{amountOf(tip.amount)} {symbol}</span></div><p className="tip-message" data-testid="tip-message" dir="auto">{tip.message || 'A little kindness, without a note.'}</p><div className="tip-meta">{tip.timestamp ? <time dateTime={new Date(tip.timestamp * 1000).toISOString()}>{new Date(tip.timestamp * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}</time> : `Block ${tip.blockNumber}`} · <a href={`${runtime?.manifest.network?.explorer}/tx/${tip.hash}`} target="_blank" rel="noreferrer">View tip ↗</a></div></li>)}</ol>}
          {tipPage?.nextCursor !== undefined && tips.length < 20 && <button disabled={tipsBusy} onClick={() => refreshTips(tipPage.nextCursor)}>Scan older blocks</button>}
          <p className="fine">{tipPage && `Scanned blocks ${tipPage.scannedFrom.toLocaleString()}–${tipPage.scannedTo.toLocaleString()}. `}Recent events refresh every 15 seconds and may change before finality.</p>
        </section>
      </div>
      {runtime && <TokenTools runtime={runtime} data={data} session={session} provider={provider} ready={ready} anyBusy={anyBusy} actions={actions} runAction={runAction} />}
      {runtime && <section className="contracts" aria-labelledby="contracts-title"><h2 id="contracts-title">Open by design</h2><p className="help" style={{ marginBlockStart: 10 }}>The jar has no application fees. Its owner is fixed. Every tip and withdrawal is public.</p><div className="contract-grid">{Object.values(runtime.contracts).map(contract => <div key={contract.name}><h3>{contract.name === 'TipJar' ? 'Tip jar contract' : 'TIPS token contract'}</h3><AddressView runtime={runtime} value={contract.address} full /></div>)}{data && <div><h3>Jar owner</h3><AddressView runtime={runtime} value={data.owner} full /></div>}<div><h3>Deployment</h3><p className="fine">{runtime.verified ? 'ABI hashes and contract presence checked.' : 'Checking deployment…'} {data && `State at block ${data.blockNumber.toLocaleString()}.`} <a href="./imd-deployment.json">View deployment manifest</a></p></div></div></section>}
    </main>
    <footer className="footer"><p>Tip Jar <span aria-hidden="true">♡</span> A small gesture goes a long way.</p><p>{runtime?.chain.name ?? 'Network loading'} · {runtime?.manifest.network?.faucets?.[0] && <a href={runtime.manifest.network.faucets[0]} target="_blank" rel="noreferrer">Get test ETH ↗</a>}</p></footer>
  </div>;
}

function TokenTools({ runtime, data, session, provider, ready, anyBusy, actions, runAction }: { runtime: Runtime; data?: chain.ContractState; session?: chain.WalletSession; provider?: InjectedProvider; ready: boolean; anyBusy: boolean; actions: Partial<Record<ActionName, ActionStatus>>; runAction: RunAction }) {
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('0.001');
  const [slippage, setSlippage] = useState('0.5');
  const [quote, setQuote] = useState<chain.SwapQuote>();
  const [approval, setApproval] = useState<chain.ApprovalState>();
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [recipient, setRecipient] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const quoteRequest = useRef(0);
  function invalidate() { quoteRequest.current++; setQuote(undefined); setApproval(undefined); setQuoteError(''); }
  useEffect(() => { invalidate(); }, [session?.account, session?.chainId]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  async function getQuote(event?: FormEvent) {
    event?.preventDefault();
    if (!session || !ready || quoteBusy) return;
    const request = ++quoteRequest.current;
    setQuoteBusy(true); setQuoteError(''); setQuote(undefined); setApproval(undefined);
    try {
      const result = await chain.quoteSwap(runtime, session.account, direction, amount, slippage);
      const allowances = await chain.approvalState(runtime, session.account, result);
      if (request !== quoteRequest.current) return;
      setQuote(result); setApproval(allowances); setNow(Date.now());
    } catch (e) { if (request === quoteRequest.current) setQuoteError(chain.describeError(e)); }
    finally { setQuoteBusy(false); }
  }
  async function approve(kind: 'tokenApproval' | 'routerApproval') {
    if (!quote || !provider || !session || approvalBusy) return;
    setApprovalBusy(true);
    const request = quoteRequest.current;
    try {
      const result = await runAction(kind, onTx => kind === 'tokenApproval' ? chain.approveToken(runtime, provider, session.account, quote, onTx) : chain.approveRouter(runtime, provider, session.account, quote, onTx));
      if (result) { try { const next = await chain.approvalState(runtime, session.account, quote); if (request === quoteRequest.current) setApproval(next); } catch (e) { if (request === quoteRequest.current) { setApproval(undefined); setQuoteError(chain.describeError(e)); } } }
    } finally { setApprovalBusy(false); }
  }
  const tokenSymbol = data?.tokenSymbol ?? 'TIPS';
  const expired = !!quote && now >= quote.expiresAt;
  const swapAvailable = !!runtime.manifest.network?.uniswapV4 && !!runtime.manifest.poolKey;
  return <section className="token-section" id="token" aria-labelledby="token-title"><div className="token-header"><div className="token-brand"><span className="token-symbol" aria-hidden="true">T</span><div><h2 id="token-title">A token of appreciation</h2><p className="help">{data?.tokenName ?? 'Tip Jar'} · {tokenSymbol} · Fixed supply, no future minting</p></div></div><span className="fine">Supply: {amountOf(data?.tokenSupply, data?.tokenDecimals)} {tokenSymbol}</span></div>
    <p className="help">TIPS is separate from the jar. Tips are sent in ETH; holding or swapping TIPS does not give withdrawal rights.</p>
    <div className="token-grid"><details><summary>Swap {tokenSymbol}</summary><p className="help">Trade in the deployed Uniswap v4 pool. Review the quote and minimum received before signing.</p>
      {!swapAvailable && <p className="error">Swaps are unavailable: this deployment has no vetted pool or network configuration.</p>}
      <form onSubmit={getQuote}><fieldset disabled={anyBusy || quoteBusy || approvalBusy}><label htmlFor="swap-direction">Direction</label><select id="swap-direction" value={direction} onChange={e => { setDirection(e.target.value as 'buy' | 'sell'); invalidate(); }}><option value="buy">Buy {tokenSymbol}</option><option value="sell">Sell {tokenSymbol}</option></select><div className="inline-fields"><div className="field"><label htmlFor="swap-amount">Swap amount</label><input id="swap-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={e => { setAmount(e.target.value); invalidate(); }} /></div><div className="field"><label htmlFor="slippage">Slippage (%)</label><input id="slippage" inputMode="decimal" autoComplete="off" value={slippage} onChange={e => { setSlippage(e.target.value); invalidate(); }} /></div></div></fieldset>
        <p className="fine">Spend {direction === 'sell' ? tokenSymbol : runtime.chain.nativeCurrency.symbol}. Slippage: 0–5%. USD value unavailable. Pool fee: {runtime.manifest.poolKey ? `${runtime.manifest.poolKey.fee / 10000}%` : 'unavailable'}.</p><button type="submit" className="full" disabled={!ready || quoteBusy || approvalBusy || !swapAvailable}>{quoteBusy ? 'Getting quote…' : 'Get quote'}</button>
      </form>
      {!session && <p className="fine">Connect your wallet above to request a quote.</p>}
      <div className="error" role="alert">{quoteError}</div>
      {quote && <><dl className="quote-grid"><dt>You pay</dt><dd>{amountOf(quote.amountIn, quote.input.decimals)} {quote.input.symbol}</dd><dt>Estimated receive</dt><dd>{amountOf(quote.amountOut, quote.output.decimals)} {quote.output.symbol}</dd><dt>Minimum received</dt><dd>{amountOf(quote.minimumOut, quote.output.decimals)} {quote.output.symbol}</dd><dt>Rate per {quote.input.symbol}</dt><dd>{(Number(amountOf(quote.amountOut, quote.output.decimals)) / Number(amountOf(quote.amountIn, quote.input.decimals))).toLocaleString(undefined, { maximumSignificantDigits: 6 })} {quote.output.symbol}</dd></dl><p className="fine">{expired ? 'Quote expired. Get a new quote before swapping.' : `Quote expires in ${Math.max(0, Math.ceil((quote.expiresAt - now) / 1000))} seconds.`} Network gas applies.</p>
        {approval && !approval.tokenApproved ? <><p className="fine">Step 1 of 3 · {approval.tokenAllowance > 0n ? 'Reset the existing allowance to zero before replacing it.' : `Allow Permit2 to spend exactly ${amountOf(quote.amountIn, quote.input.decimals)} ${quote.input.symbol}.`}</p><button disabled={!ready || approvalBusy} onClick={() => approve('tokenApproval')}>{actions.tokenApproval?.busy ? 'Approving token…' : approval.tokenAllowance > 0n ? `Reset ${quote.input.symbol} approval` : `Approve ${quote.input.symbol} to Permit2`}</button></> : approval && !approval.routerApproved ? <><p className="fine">Step 2 of 3 · Allow the router to spend this amount through Permit2 for 30 minutes.</p><button disabled={!ready || approvalBusy} onClick={() => approve('routerApproval')}>{actions.routerApproval?.busy ? 'Approving router…' : 'Approve router'}</button></> : approval && <button className="full" disabled={!ready || expired || approvalBusy} onClick={async () => { if (!provider || !session) return; if (await runAction('swap', onTx => chain.executeSwap(runtime, provider, session.account, quote, onTx))) invalidate(); }}>{actions.swap?.busy ? 'Swapping…' : `Swap ${quote.input.symbol} for ${quote.output.symbol}`}</button>}
      </>}
      {(['tokenApproval', 'routerApproval', 'swap'] as const).map(name => <TransactionStatus key={name} runtime={runtime} state={actions[name] ?? idleAction} />)}
    </details>
    <details><summary>Send {tokenSymbol}</summary><p className="help">Transfer tokens directly to another wallet. Check the recipient carefully; transfers cannot be undone.</p><p className="fine">Your balance: {amountOf(data?.tokenBalance, data?.tokenDecimals)} {tokenSymbol} · USD value unavailable</p><form onSubmit={event => { event.preventDefault(); if (session && provider) void runAction('transfer', onTx => chain.transferToken(runtime, provider, session.account, recipient, transferAmount, onTx)); }}><fieldset disabled={anyBusy}><div className="field"><label htmlFor="recipient">Recipient address</label><input id="recipient" placeholder="0x…" value={recipient} onChange={e => setRecipient(e.target.value)} autoComplete="off" spellCheck={false} /></div><div className="field"><label htmlFor="transfer-amount">Amount ({tokenSymbol})</label><input id="transfer-amount" inputMode="decimal" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} autoComplete="off" /></div></fieldset><p className="fine">Send {transferAmount || '0'} {tokenSymbol} to <bdi style={{ overflowWrap: 'anywhere' }}>{recipient || 'the recipient above'}</bdi>, plus network gas.</p><button className="full" disabled={!ready}>{actions.transfer?.busy ? 'Sending tokens…' : `Send ${tokenSymbol}`}</button></form>{!session && <p className="fine">Connect your wallet above to send tokens.</p>}<TransactionStatus runtime={runtime} state={actions.transfer ?? idleAction} /></details></div>
  </section>;
}
