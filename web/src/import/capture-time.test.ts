import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cameraClockSeconds } from './capture-time'

// LibRaw turns a RAW's EXIF time into seconds with mktime (this computer's local time); here a computer on Atlantic
// time, like the owner's. The JPEG of the same shot is read as the camera's clock written as UTC.
/** Node's environment (the time zone is read from TZ each time a date is converted). */
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
const before = env.TZ
beforeAll(() => {
  env.TZ = 'America/Halifax'
})
afterAll(() => {
  if (before === undefined) delete env.TZ
  else env.TZ = before
})

const mktime = (y: number, mo: number, d: number, h: number, mi: number, s: number) => new Date(y, mo - 1, d, h, mi, s).getTime() / 1000

describe('cameraClockSeconds', () => {
  it('gives a RAW the same capture time as its JPEG (the bug: 3 hours apart on Atlantic time)', () => {
    const jpeg = Date.UTC(2026, 9, 18, 21, 30, 5) / 1000
    const raw = mktime(2026, 10, 18, 21, 30, 5)
    expect(raw - jpeg).toBe(3 * 3600)
    expect(cameraClockSeconds(raw)).toBe(jpeg)
  })

  it('also in winter (standard time) and for an evening shot that LibRaw put on the next day', () => {
    const jpeg = Date.UTC(2026, 0, 5, 23, 59, 59) / 1000
    const raw = mktime(2026, 1, 5, 23, 59, 59)
    expect(new Date(raw * 1000).getUTCDate()).toBe(6)
    expect(cameraClockSeconds(raw)).toBe(jpeg)
  })

  it('keeps an unknown time unknown', () => {
    expect(cameraClockSeconds(0)).toBe(0)
    expect(cameraClockSeconds(-5)).toBe(0)
  })
})
