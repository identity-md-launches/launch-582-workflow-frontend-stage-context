import { useState } from 'react';
import { getAddress } from 'viem';
import type { Runtime } from './config';
import type { TxProgress } from './chain';

export function Jar({ hero = false }: { hero?: boolean }) {
  return hero ? <div className="jar-art" aria-hidden="true">
    <svg viewBox="0 0 180 220" fill="none"><path d="M53 45h75v15H53z" fill="#f7f6f0" stroke="currentColor" strokeWidth="3"/><path d="M58 60v17L41 97v85q0 14 15 14h68q15 0 15-14V97l-16-20V60" fill="#fffefa" stroke="currentColor" strokeWidth="3"/><path d="M44 153q45-13 92 0v30q0 10-13 10H57q-13 0-13-10" fill="#dbe6a8"/><path d="M67 118c0-15 19-18 24-4 5-14 24-11 24 4 0 14-24 29-24 29s-24-15-24-29Z" stroke="currentColor" strokeWidth="3"/><path d="M64 33l-5-9m31 7V17m25 17 7-10M25 93l-9-4m136 45 10 2" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
    <span className="jar-label">A small act of kindness</span>
  </div> : <svg className="brand-mark" viewBox="0 0 40 44" fill="none" aria-hidden="true"><path d="M12 5h16m-14 6h12l6 8v16q0 4-4 4H12q-4 0-4-4V19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M13 24q3-6 7 0 4-6 7 0t-7 9q-10-6-7-9" fill="currentColor"/></svg>;
}

export function AddressView({ value, runtime, full = false }: { value: string; runtime: Runtime; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const address = getAddress(value);
  const explorer = runtime.manifest.network?.explorer;
  const label = full ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
  return <span className="address"><bdi>{explorer ? <a href={`${explorer}/address/${address}`} title={address} target="_blank" rel="noreferrer">{label}</a> : <span title={address}>{label}</span>}</bdi><button className="copy" type="button" aria-label={`Copy address ${address}`} onClick={async () => {
    try { await navigator.clipboard.writeText(address); setCopied(true); setCopyError(false); setTimeout(() => setCopied(false), 2500); }
    catch { setCopyError(true); }
  }}>{copied ? 'Copied' : 'Copy'}</button>{copyError && <span className="fine">Copy unavailable; select the address.</span>}</span>;
}

export type ActionStatus = { busy: boolean; progress?: TxProgress; error?: string };
export const idleAction: ActionStatus = { busy: false };
export function TransactionStatus({ state, runtime }: { state: ActionStatus; runtime: Runtime }) {
  const labels = { simulating: 'Checking this transaction…', signature: 'Review and confirm in your wallet.', pending: 'Transaction sent. Waiting for confirmation…', confirmed: 'Transaction confirmed.' };
  return <><div className="status" role="status">{state.progress && <>{state.error ? (state.progress.hash ? 'Transaction submitted.' : '') : labels[state.progress.stage]} {state.progress.hash && runtime.manifest.network?.explorer && <a href={`${runtime.manifest.network.explorer}/tx/${state.progress.hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}</>}</div><div className="error" role="alert">{state.error}</div></>;
}
