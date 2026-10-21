import { describe, expect, it } from 'vitest'
import { clickDate, dateCounts } from './dates'

describe('dateCounts', () => {
  it('counts photos and ticked photos per date, newest first, skipping photos still being read', () => {
    const items = [
      { day: '2026-10-18', selected: true }, { day: '2026-10-19', selected: false }, { day: '2026-10-18', selected: false },
      { day: null, selected: true }, { day: '2026-10-19', selected: true }, { day: '2026-10-19', selected: true },
    ]
    expect(dateCounts(items)).toEqual([
      { day: '2026-10-19', total: 3, selected: 2 },
      { day: '2026-10-18', total: 2, selected: 1 },
    ])
  })

  it('follows the ticks as they change', () => {
    const items = [{ day: 'd', selected: false }, { day: 'd', selected: false }]
    expect(dateCounts(items)[0].selected).toBe(0)
    items[1].selected = true
    expect(dateCounts(items)[0]).toEqual({ day: 'd', total: 2, selected: 1 })
  })
})

describe('clickDate', () => {
  const order = ['2026-10-19', '2026-10-18', '2026-10-17', '2026-10-16']
  const plain = { toggle: false, range: false }
  const ctrl = { toggle: true, range: false }
  const shift = { toggle: false, range: true }
  const set = (...d: string[]) => new Set(d)

  it('a click shows that date only; clicking it again shows all dates', () => {
    expect(clickDate(set(), order, '2026-10-18', plain, null)).toEqual(set('2026-10-18'))
    expect(clickDate(set('2026-10-19', '2026-10-17'), order, '2026-10-18', plain, null)).toEqual(set('2026-10-18'))
    expect(clickDate(set('2026-10-18'), order, '2026-10-18', plain, '2026-10-18')).toEqual(set())
  })

  it('Ctrl/Cmd-click adds or removes a date', () => {
    expect(clickDate(set('2026-10-19'), order, '2026-10-17', ctrl, '2026-10-19')).toEqual(set('2026-10-19', '2026-10-17'))
    expect(clickDate(set('2026-10-19', '2026-10-17'), order, '2026-10-19', ctrl, '2026-10-17')).toEqual(set('2026-10-17'))
  })

  it('Shift-click shows the range from the last date clicked, in list order', () => {
    expect(clickDate(set('2026-10-17'), order, '2026-10-19', shift, '2026-10-17')).toEqual(set('2026-10-19', '2026-10-18', '2026-10-17'))
    expect(clickDate(set('2026-10-19'), order, '2026-10-16', { toggle: true, range: true }, '2026-10-17')).toEqual(set('2026-10-19', '2026-10-17', '2026-10-16'))
  })

  it('Shift-click without an earlier click acts as a plain click', () => {
    expect(clickDate(set(), order, '2026-10-16', shift, null)).toEqual(set('2026-10-16'))
  })
})
