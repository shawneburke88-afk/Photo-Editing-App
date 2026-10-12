import { afterEach, describe, expect, it, vi } from 'vitest'
import { DISPLAY_P3_PROFILE, rec2020ToProfile } from '../color/icc'
import { currentDisplaySpace, REC2020_TO_DISPLAY_P3, srgbColourIn, watchDisplaySpace } from './display-space'
import developDisplay from './develop-display.wgsl?raw'

afterEach(() => vi.unstubAllGlobals())

/** A matchMedia stand-in whose `(color-gamut: p3)` answer can be changed. */
function fakeScreen(p3: boolean) {
  const listeners = new Set<() => void>()
  const m = {
    matches: p3,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  vi.stubGlobal('matchMedia', (q: string) => {
    expect(q).toBe('(color-gamut: p3)')
    return m
  })
  return {
    move(toP3: boolean) {
      m.matches = toP3
      listeners.forEach((fn) => fn())
    },
    listeners,
  }
}

describe('display colour space', () => {
  it('is Display P3 only on wide-gamut screens', () => {
    fakeScreen(true)
    expect(currentDisplaySpace()).toBe('display-p3')
    fakeScreen(false)
    expect(currentDisplaySpace()).toBe('srgb')
    vi.stubGlobal('matchMedia', undefined)
    expect(currentDisplaySpace()).toBe('srgb')
  })

  it('follows the window to another screen until unwatched', () => {
    const screen = fakeScreen(false)
    const seen: string[] = []
    const stop = watchDisplaySpace((s) => seen.push(s))
    screen.move(true)
    screen.move(false)
    stop()
    screen.move(true)
    expect(seen).toEqual(['display-p3', 'srgb'])
    expect(screen.listeners.size).toBe(0)
  })

  it('uses the Display P3 export’s matrix', () => {
    expect(REC2020_TO_DISPLAY_P3).toEqual(rec2020ToProfile(DISPLAY_P3_PROFILE))
  })

  it('keeps indicator colours the same colour on a P3 canvas', () => {
    expect(srgbColourIn('srgb', [1, 0, 0])).toEqual([1, 0, 0])
    // sRGB red in Display P3 is about (0.9175, 0.2003, 0.1386) (CSS Color 4 conversion).
    const red = srgbColourIn('display-p3', [1, 0, 0])
    expect(red[0]).toBeCloseTo(0.9175, 2)
    expect(red[1]).toBeCloseTo(0.2003, 2)
    expect(red[2]).toBeCloseTo(0.1386, 2)
    srgbColourIn('display-p3', [1, 1, 1]).forEach((v) => expect(v).toBeCloseTo(1, 3))
  })

  it('the shader’s View struct ends with the Display P3 matrix at byte 368 (VIEW_SIZE 416)', () => {
    const struct = /struct View \{([\s\S]*?)\n\}/.exec(developDisplay)![1]
    const fields = [...struct.matchAll(/^\s+(\w+): (\w+),/gm)].map((m) => [m[1], m[2]])
    let at = 0
    const offsets: Record<string, number> = {}
    for (const [name, type] of fields) {
      const size = type === 'vec4f' ? 16 : type === 'vec2f' ? 8 : 4
      at = Math.ceil(at / size) * size
      offsets[name] = at
      at += size
    }
    expect(offsets.statsPass).toBe(64 * 4)
    expect(offsets.displaySpace).toBe(65 * 4)
    expect(offsets.texMap0).toBe(68 * 4)
    expect(offsets.toDisplay0).toBe(92 * 4)
    expect(Math.ceil(at / 16) * 16).toBe(416)
  })
})
