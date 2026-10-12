import { describe, expect, it } from 'vitest'
import { gridCandidate, makeSelect, startCompare, stepCandidate, swapCompare } from './compare'

describe('Compare', () => {
  it('starts with the next photo as the Candidate, or the previous one at the end', () => {
    expect(startCompare(2, 5)).toEqual({ select: 2, candidate: 3 })
    expect(startCompare(4, 5)).toEqual({ select: 4, candidate: 3 })
    expect(startCompare(1, 5, 4)).toEqual({ select: 1, candidate: 4 })
    expect(startCompare(1, 5, 1)).toEqual({ select: 1, candidate: 2 })
    expect(startCompare(0, 1)).toBeNull()
  })

  it('steps the Candidate over the Select and stops at the ends', () => {
    const n = 5
    expect(stepCandidate({ select: 2, candidate: 1 }, 1, n)).toEqual({ select: 2, candidate: 3 })
    expect(stepCandidate({ select: 2, candidate: 3 }, -1, n)).toEqual({ select: 2, candidate: 1 })
    expect(stepCandidate({ select: 2, candidate: 4 }, 1, n)).toEqual({ select: 2, candidate: 4 })
    expect(stepCandidate({ select: 4, candidate: 3 }, 1, n)).toEqual({ select: 4, candidate: 3 })
    expect(stepCandidate({ select: 0, candidate: 1 }, -1, n)).toEqual({ select: 0, candidate: 1 })
    // Home / End
    expect(stepCandidate({ select: 0, candidate: 3 }, -n, n)).toEqual({ select: 0, candidate: 1 })
    expect(stepCandidate({ select: 1, candidate: 2 }, n, n)).toEqual({ select: 1, candidate: 4 })
  })

  it('swaps Select and Candidate', () => {
    expect(swapCompare({ select: 1, candidate: 3 })).toEqual({ select: 3, candidate: 1 })
  })

  it('Make Select: the Candidate wins and the photo after it is the new Candidate', () => {
    expect(makeSelect({ select: 0, candidate: 1 }, 5)).toEqual({ select: 1, candidate: 2 })
    expect(makeSelect({ select: 0, candidate: 4 }, 5)).toEqual({ select: 4, candidate: 3 })
    // The old Select can come back as the next photo.
    expect(makeSelect({ select: 3, candidate: 2 }, 5)).toEqual({ select: 2, candidate: 3 })
  })

  it('opens from the grid on the next selected photo, else the next photo', () => {
    const ids = [10, 11, 12, 13, 14]
    expect(gridCandidate(ids, 11, new Set([11]))).toBe(2)
    expect(gridCandidate(ids, 11, new Set())).toBe(2)
    expect(gridCandidate(ids, 11, new Set([11, 14]))).toBe(4)
    expect(gridCandidate(ids, 13, new Set([10, 13]))).toBe(0) // wraps round
    expect(gridCandidate(ids, 14, new Set([14]))).toBe(3)
    expect(gridCandidate([10], 10, new Set([10]))).toBeUndefined()
  })
})
