import { describe, expect, it } from 'vitest'
import { burstGroups, collapseStacks, pairTwins } from './stacks'

describe('pairTwins (RAW+JPEG)', () => {
  const t = 1760900000
  const f = (group: string | number, name: string, capturedAt = 0, originalName?: string) => ({ group, name, capturedAt, originalName })

  it('pairs a Nikon card’s RAW+JPEG twins whatever the case of the names, one pair per shot', () => {
    const card = [f('100D5200', 'DSC_0001.NEF', t), f('100D5200', 'DSC_0001.JPG', t), f('100D5200', 'dsc_0002.nef', t + 1), f('100D5200', 'DSC_0002.jpg', t + 1), f('100D5200', 'DSC_0003.JPG', t + 2)]
    expect(pairTwins(card)).toEqual([[0, 1], [2, 3]])
  })

  it('pairs by name alone before the capture times are known', () => {
    expect(pairTwins([f('d', 'A.JPG'), f('d', 'A.NEF')])).toEqual([[1, 0]])
  })

  it('pairs twins in different folders (or imported separately) only when they were taken at the same moment', () => {
    const items = [f('RAW', 'DSC_0001.NEF', t), f('JPG', 'DSC_0001.JPG', t + 1), f('RAW', 'DSC_0002.NEF', t + 10), f('JPG', 'DSC_0002.JPG', t + 100)]
    expect(pairTwins(items)).toEqual([[0, 1]])
  })

  it('does not pair the camera’s file numbers starting again (same name, another day)', () => {
    expect(pairTwins([f(1, 'DSC_0001.NEF', t), f(2, 'DSC_0001.JPG', t + 86400)])).toEqual([])
  })

  it('pairs renamed photos by their names on the card and capture time', () => {
    const items = [f(1, '2026-10-19_0001.NEF', t, 'DSC_0042.NEF'), f(1, '2026-10-19_0002.JPG', t, 'DSC_0042.JPG')]
    expect(pairTwins(items)).toEqual([[0, 1]])
  })

  it('does not pair renamed photos of different imports that share a number', () => {
    const items = [f(1, '2026-10-19_0005.NEF', t, 'DSC_0100.NEF'), f(1, '2026-10-19_0005.JPG', t + 3600, 'DSC_0200.JPG')]
    expect(pairTwins(items)).toEqual([])
  })

  it('takes the closest time when names repeat, and uses each file once', () => {
    const items = [f(1, 'IMG_1.CR3', t), f(2, 'IMG_1.JPG', t + 2), f(3, 'IMG_1.JPG', t)]
    expect(pairTwins(items)).toEqual([[0, 2]])
  })
})

const row = (id: number, stackId: number | null = null, stackTop = false, stackExpanded = false) => ({ id, stackId, stackTop, stackExpanded })

describe('collapseStacks', () => {
  it('shows one photo per collapsed stack: the top one, at the first member’s place', () => {
    const rows = [row(1), row(2, 9), row(3, 9, true), row(4)]
    expect(collapseStacks(rows).map((r) => r.id)).toEqual([1, 3, 4])
  })

  it('falls back to the first member when filters hide the top', () => {
    expect(collapseStacks([row(2, 9), row(5, 9)]).map((r) => r.id)).toEqual([2])
  })

  it('shows every photo of an expanded stack', () => {
    expect(collapseStacks([row(2, 9, true, true), row(3, 9, false, true)]).map((r) => r.id)).toEqual([2, 3])
  })
})

describe('burstGroups', () => {
  const p = (id: number, capturedAt: number, stacked = false) => ({ id, capturedAt, stacked })

  it('groups runs within the gap and drops singletons', () => {
    expect(burstGroups([p(1, 100), p(2, 101), p(3, 103), p(4, 200), p(5, 300), p(6, 301)], 2)).toEqual([[1, 2, 3], [5, 6]])
  })

  it('ignores photos without a capture time or already stacked, and sorts by time', () => {
    expect(burstGroups([p(3, 102), p(1, 100), p(2, 0), p(4, 101, true)], 5)).toEqual([[1, 3]])
  })
})
