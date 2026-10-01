import { test, expect } from '@playwright/test'
import type { Tip, TipPage } from '../src/chain'
import { mergeTipPage } from '../src/tip-history'
import blocks from '../src/deployment-blocks.json' with { type: 'json' }
const floor = BigInt(blocks.TipJar)
const tip = (offset: bigint, id: number, logIndex = 0): Tip => ({
  blockNumber: floor + offset, logIndex, hash: `0x${id.toString(16).padStart(64, '0')}`,
  sender: '0x1111111111111111111111111111111111111111', amount: 1n, message: `${id}`,
})
const page = (from: bigint, to: bigint, tips: Tip[] = []): TipPage => ({
  tips, scannedFrom: floor + from, scannedTo: floor + to,
  nextCursor: from > 0n && tips.length < 20 ? floor + from - 1n : undefined,
  complete: from === 0n || tips.length >= 20,
})

test('history: manual pagination keeps the original head and oldest continuation', () => {
  const initial = mergeTipPage({ tips: [] }, page(100n, 200n, [tip(150n, 1)]))
  const merged = mergeTipPage(initial, page(50n, 99n, [tip(70n, 2)]), floor + 99n)
  expect(merged.tips.map(t => t.message)).toEqual(['1', '2'])
  expect(merged.page).toMatchObject({ scannedFrom: floor + 50n, scannedTo: floor + 200n, nextCursor: floor + 49n, complete: false })
})

test('history: a fresh head preserves older scanned tips and replaces reorganized logs', () => {
  const prior = { tips: [tip(180n, 1), tip(60n, 2)], page: page(50n, 200n) }
  const merged = mergeTipPage(prior, page(100n, 220n, [tip(190n, 3)]))
  expect(merged.tips.map(t => t.message)).toEqual(['3', '2'])
  expect(merged.page).toMatchObject({ scannedFrom: floor + 50n, scannedTo: floor + 220n, nextCursor: floor + 49n })
})

test('history: reaching deployment stays complete across overlapping head refreshes', () => {
  const prior = { tips: [tip(2n, 1)], page: page(0n, 200n) }
  const merged = mergeTipPage(prior, page(100n, 220n))
  expect(merged.tips).toHaveLength(1)
  expect(merged.page.complete).toBe(true)
  expect(merged.page.nextCursor).toBeUndefined()
})

test('history: a gap in a fresh scan discards older history instead of claiming the latest twenty', () => {
  const prior = { tips: Array.from({ length: 20 }, (_, i) => tip(BigInt(i), i + 1)), page: page(0n, 99n) }
  const merged = mergeTipPage(prior, page(200n, 300n, [tip(250n, 21)]))
  expect(merged.tips).toHaveLength(1)
  expect(merged.page).toMatchObject({ scannedFrom: floor + 200n, nextCursor: floor + 199n, complete: false })
})

test('history: an incorrect manual cursor cannot skip a gap and claim completion', () => {
  const prior = { tips: [tip(250n, 1)], page: page(200n, 300n) }
  const merged = mergeTipPage(prior, page(0n, 99n, [tip(50n, 2)]), floor + 99n)
  expect(merged.tips.map(t => t.message)).toEqual(['1'])
  expect(merged.page.nextCursor).toBe(floor + 199n)
  expect(merged.page.complete).toBe(false)
})

test('history: a lower canonical head drops orphaned higher events', () => {
  const prior = { tips: [tip(190n, 1), tip(60n, 2)], page: page(50n, 200n) }
  const merged = mergeTipPage(prior, page(100n, 180n, [tip(170n, 3)]))
  expect(merged.tips.map(t => t.message)).toEqual(['3', '2'])
  expect(merged.page.scannedTo).toBe(floor + 180n)
})

test('history: twenty results deduplicate and sort transaction log indices', () => {
  const logs = Array.from({ length: 24 }, (_, i) => tip(150n, i + 1, i))
  const merged = mergeTipPage({ tips: [] }, page(100n, 200n, [...logs, logs[0]]))
  expect(merged.tips).toHaveLength(20)
  expect(merged.tips[0].logIndex).toBe(23)
  expect(merged.tips[19].logIndex).toBe(4)
  expect(merged.page.complete).toBe(true)
  expect(merged.page.nextCursor).toBeUndefined()
})

test('history: after a reorg the prior truncated cutoff block is scanned again', () => {
  const oldTips = Array.from({ length: 20 }, (_, i) => tip(200n - BigInt(i), i + 1))
  const prior = { tips: oldTips, page: page(0n, 200n, oldTips) }
  const merged = mergeTipPage(prior, page(195n, 210n))
  expect(merged.tips).toHaveLength(14)
  expect(merged.page.complete).toBe(false)
  expect(merged.page.nextCursor).toBe(floor + 181n)
})


test('history: repeated head polling keeps an inclusive truncated-block continuation', () => {
  const oldTips = Array.from({ length: 20 }, (_, i) => tip(200n - BigInt(i), i + 1))
  const first = mergeTipPage({ tips: oldTips, page: page(0n, 200n, oldTips) }, page(195n, 210n))
  const second = mergeTipPage(first, page(195n, 220n))
  expect(second.page.nextCursor).toBe(floor + 181n)
  expect(second.page.complete).toBe(false)
})
