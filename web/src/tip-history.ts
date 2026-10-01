import type { Tip, TipPage } from './chain'
import deploymentBlocks from './deployment-blocks.json' with { type: 'json' }

export type TipHistory = { tips: Tip[]; page?: TipPage }
export type LoadedTipHistory = { tips: Tip[]; page: TipPage }
const deploymentBlock = BigInt(deploymentBlocks.TipJar)
const ordered = (tips: Tip[]) => [...new Map(tips.map(tip => [`${tip.hash}-${tip.logIndex}`, tip])).values()]
  .sort((a, b) => a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1)

/** Retain only contiguous event coverage; newly scanned blocks replace their old events. */
export function mergeTipPage(previous: TipHistory, fetched: TipPage, cursor?: bigint): LoadedTipHistory {
  const prior = previous.page
  const validRange = fetched.scannedFrom <= fetched.scannedTo
  const contiguous = !!prior && validRange && prior.scannedFrom <= prior.scannedTo &&
    fetched.scannedFrom <= prior.scannedTo + 1n && fetched.scannedTo >= prior.scannedFrom - 1n

  // A continuation which skipped blocks cannot establish the latest twenty tips.
  // Keep the known upper interval and offer its actual next block instead.
  if (cursor !== undefined && prior && !contiguous) {
    const tips = ordered(previous.tips).slice(0, 20)
    const complete = tips.length >= 20 || (prior.scannedFrom <= deploymentBlock && prior.nextCursor === undefined)
    return { tips, page: { ...prior, tips, complete, nextCursor: complete ? undefined : prior.nextCursor ?? prior.scannedFrom - 1n } }
  }

  let scannedFrom = contiguous && prior && prior.scannedFrom < fetched.scannedFrom ? prior.scannedFrom : fetched.scannedFrom
  const scannedTo = cursor !== undefined && contiguous && prior && prior.scannedTo > fetched.scannedTo ? prior.scannedTo : fetched.scannedTo
  const retained = contiguous ? previous.tips.filter(tip =>
    // A new head below the old one also removes events from orphaned higher blocks.
    tip.blockNumber <= scannedTo && (tip.blockNumber < fetched.scannedFrom || tip.blockNumber > fetched.scannedTo),
  ) : []
  const tips = ordered([...retained, ...fetched.tips]).slice(0, 20)
  let nextCursor = scannedFrom > deploymentBlock ? scannedFrom - 1n : undefined

  // readTips retains only twenty logs. If a reorg removes newer entries, the old
  // cutoff block can contain additional discarded logs; rescan that block too.
  const oldCutoff = previous.tips.length >= 20 ? ordered(previous.tips).at(19)?.blockNumber : undefined
  if (contiguous && tips.length < 20 && oldCutoff !== undefined && oldCutoff < fetched.scannedFrom) {
    if (oldCutoff > scannedFrom) scannedFrom = oldCutoff
    nextCursor = oldCutoff
  }
  // Preserve an inclusive cutoff continuation across further head refreshes.
  if (contiguous && prior?.nextCursor !== undefined && prior.nextCursor >= prior.scannedFrom && prior.nextCursor < fetched.scannedFrom) {
    nextCursor = prior.nextCursor
  }
  const complete = tips.length >= 20 || nextCursor === undefined
  const page: TipPage = { tips, scannedFrom, scannedTo, complete, nextCursor: complete ? undefined : nextCursor }
  return { tips, page }
}
