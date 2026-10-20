import { describe, expect, it } from 'vitest'
import { cardDate, dayHeading, dayOf, gridLines, lineOf, verticalNeighbour } from './grid-layout'

const at = (day: number, hour = 12) => Date.UTC(2026, 9, day, hour) / 1000
const rows = (...t: number[]) => t.map((capturedAt) => ({ capturedAt }))

describe('gridLines', () => {
  it('without headings, fills lines of `cols` cells', () => {
    expect(gridLines(rows(at(19), at(19), at(18), at(18), at(17)), 2, false)).toEqual([
      { kind: 'cells', start: 0, end: 2 }, { kind: 'cells', start: 2, end: 4 }, { kind: 'cells', start: 4, end: 5 },
    ])
  })

  it('with headings, starts each date on a new line under its heading, with its count', () => {
    expect(gridLines(rows(at(19, 23), at(19, 1), at(19, 0), at(18), at(0, 0) * 0), 2, true)).toEqual([
      { kind: 'head', day: '2026-10-19', count: 3 },
      { kind: 'cells', start: 0, end: 2 },
      { kind: 'cells', start: 2, end: 3 },
      { kind: 'head', day: '2026-10-18', count: 1 },
      { kind: 'cells', start: 3, end: 4 },
      { kind: 'head', day: '', count: 1 },
      { kind: 'cells', start: 4, end: 5 },
    ])
  })

  it('a collapsed stack is one row of the query, so it is one cell under its date', () => {
    expect(gridLines(rows(at(19), at(18)), 4, true).filter((l) => l.kind === 'head').map((l) => l.kind === 'head' && l.count)).toEqual([1, 1])
  })
})

describe('keyboard up and down with headings', () => {
  // 19th: 5 photos (lines of 3: [0,1,2] [3,4]); 18th: 2 photos ([5,6]); 17th: 3 ([7,8,9]).
  const lines = gridLines(rows(at(19), at(19), at(19), at(19), at(19), at(18), at(18), at(17), at(17), at(17)), 3, true)

  it('finds the line of a cell', () => {
    expect(lineOf(lines, 4)).toBe(2)
    expect(lineOf(lines, 5)).toBe(4)
  })

  it('moves to the same column of the next or previous line of photos, skipping headings', () => {
    expect(verticalNeighbour(lines, 1, 1)).toBe(4)
    expect(verticalNeighbour(lines, 2, 1)).toBe(4) // the next line is shorter: its last photo
    expect(verticalNeighbour(lines, 4, 1)).toBe(6)
    expect(verticalNeighbour(lines, 6, 1)).toBe(8)
    expect(verticalNeighbour(lines, 7, -1)).toBe(5)
    expect(verticalNeighbour(lines, 0, -1)).toBe(0)
    expect(verticalNeighbour(lines, 9, 1)).toBe(9)
  })
})

describe('dates', () => {
  it('uses the camera clock (stored as UTC), not this computer’s time zone', () => {
    expect(dayOf(at(19, 23))).toBe('2026-10-19')
    expect(dayOf(0)).toBe('')
    expect(dayHeading('2026-10-19', 'en-GB')).toMatch(/^Monday,? 19 October 2026$/)
    expect(dayHeading('')).toBe('No capture date')
    expect(cardDate(at(19, 23), 'en-GB')).toBe('19 Oct 2026')
    expect(cardDate(0)).toBe('')
  })
})
