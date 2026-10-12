import { describe, expect, it } from 'vitest'
import { burstGroups, collapseStacks } from './stacks'

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
