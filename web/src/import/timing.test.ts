import { describe, expect, it } from 'vitest'
import { durationText, ImportTiming, roundTimes, sizeText, summaryLine, timed, type StepTimes } from './timing'

describe('import timings', () => {
  it('adds up steps over photos, with bytes, MB/s and each step’s share of the work', () => {
    const t = new ImportTiming()
    t.add({ read: 300, hash: 100, write: 200, verify: 200, thumbnail: 150, catalog: 50 }, 25e6)
    t.add({ read: 300, hash: 100, write: 300, verify: 100, thumbnail: 150, catalog: 50 }, 15e6)
    const s = t.totals(4000)
    expect(s.photos).toBe(2)
    expect(s.bytes).toBe(40e6)
    expect(s.mbPerS).toBe(10)
    expect(s.steps).toMatchObject({ read: 600, hash: 200, write: 500, verify: 300, thumbnail: 300, catalog: 100, backup: 0, stacking: 0 })
    expect(s.shares).toMatchObject({ read: 30, hash: 10, write: 25, verify: 15, thumbnail: 15, catalog: 5, backup: 0 })
    expect(Object.values(s.shares).reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('writes the finished state’s line with the two largest groups of at least 5 %', () => {
    const t = new ImportTiming()
    for (let i = 0; i < 1500; i++) t.add({ read: 40, hash: 10, write: 21, verify: 5, thumbnail: 18, catalog: 3, stacking: 3 }, 25.33e6)
    expect(summaryLine(t.totals(372_000))).toBe('1,500 photos, 38 GB in 6 min 12 s · copying 71 % · thumbnails 18 %')
    const one = new ImportTiming()
    one.add({ catalog: 1 }, 4600)
    expect(summaryLine(one.totals(400))).toBe('1 photo, 5 KB in 0.4 s · library 100 %')
  })

  it('formats sizes and durations', () => {
    expect([sizeText(740e6), sizeText(5.24e9), sizeText(38.4e9), sizeText(0)]).toEqual(['740 MB', '5.2 GB', '38 GB', '0 KB'])
    expect([durationText(400), durationText(45_000), durationText(372_000), durationText(3_780_000)]).toEqual(['0.4 s', '45 s', '6 min 12 s', '1 h 3 min'])
  })

  it('times a step (also when it throws) and rounds per-photo times for the log', async () => {
    const t: StepTimes = {}
    await timed(t, 'catalog', async () => 1)
    await expect(timed(t, 'catalog', async () => Promise.reject(new Error('x')))).rejects.toThrow('x')
    expect(t.catalog).toBeGreaterThanOrEqual(0)
    expect(roundTimes({ read: 1.4, verify: 2.6 })).toEqual({ read: 1, verify: 3 })
    expect(await timed(undefined, 'read', async () => 5)).toBe(5)
  })
})
