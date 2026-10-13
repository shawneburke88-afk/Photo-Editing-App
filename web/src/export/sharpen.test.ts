import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPORT } from './run'
import {
  clampPpi, DEFAULT_OUTPUT_SHARPENING, describeSharpening, MAX_RADIUS, MAX_SIGMA, MIN_SIGMA, printSigma, screenSigma, SHARPEN_TABLE,
  sharpenParams, type SharpenAmount, type SharpenMedium,
} from './sharpen'

const MEDIA: SharpenMedium[] = ['screen', 'glossy', 'matte']
const AMOUNTS: SharpenAmount[] = ['low', 'standard', 'high']

describe('output sharpening table', () => {
  it('is off by default and the export defaults keep 300 ppi', () => {
    expect(DEFAULT_OUTPUT_SHARPENING.on).toBe(false)
    expect(DEFAULT_EXPORT.sharpen.on).toBe(false)
    expect(DEFAULT_EXPORT.ppi).toBe(300)
    expect(sharpenParams(DEFAULT_OUTPUT_SHARPENING, 1, 300)).toBeNull()
    expect(sharpenParams(undefined, 1, 300)).toBeNull()
  })

  it('has the documented values', () => {
    expect(SHARPEN_TABLE).toEqual({
      screen: { low: { sigma: 0.78, amount: 0.35, threshold: 0.5 }, standard: { sigma: 0.78, amount: 0.6, threshold: 0.5 }, high: { sigma: 0.78, amount: 0.9, threshold: 0.5 } },
      glossy: { low: { sigma: 0.075, amount: 0.5, threshold: 0.5 }, standard: { sigma: 0.075, amount: 0.85, threshold: 0.5 }, high: { sigma: 0.075, amount: 1.25, threshold: 0.5 } },
      matte: { low: { sigma: 0.095, amount: 0.65, threshold: 0.5 }, standard: { sigma: 0.095, amount: 1.1, threshold: 0.5 }, high: { sigma: 0.095, amount: 1.6, threshold: 0.5 } },
    })
  })

  it('grows with the amount, and matte > glossy > screen at the same amount (300 ppi, full size)', () => {
    for (const m of MEDIA) {
      const a = AMOUNTS.map((amount) => sharpenParams({ on: true, medium: m, amount }, 1, 300)!.amount)
      expect(a[0]).toBeLessThan(a[1])
      expect(a[1]).toBeLessThan(a[2])
    }
    for (const amount of AMOUNTS) {
      const p = (medium: SharpenMedium) => sharpenParams({ on: true, medium, amount }, 1, 300)!
      expect(p('matte').amount).toBeGreaterThan(p('glossy').amount)
      expect(p('glossy').amount).toBeGreaterThan(p('screen').amount)
      // strength ≈ amount × sigma
      expect(p('matte').amount * p('matte').sigma).toBeGreaterThan(p('glossy').amount * p('glossy').sigma)
      expect(p('glossy').amount * p('glossy').sigma).toBeGreaterThan(p('screen').amount * p('screen').sigma)
    }
  })

  it('uses darktable’s window: ceil(2.5 sigma), at most 12', () => {
    for (const m of MEDIA) for (const amount of AMOUNTS) for (const ppi of [72, 150, 300, 600, 1200]) for (const scale of [0.05, 0.5, 1, 2]) {
      const p = sharpenParams({ on: true, medium: m, amount }, scale, ppi)!
      expect(p.radius).toBe(Math.min(MAX_RADIUS, Math.ceil(2.5 * p.sigma)))
      expect(p.sigma).toBeGreaterThanOrEqual(MIN_SIGMA)
      expect(p.sigma).toBeLessThanOrEqual(MAX_SIGMA)
      expect(p.halo).toBeGreaterThan(0)
    }
  })
})

describe('scaling with the output', () => {
  it('screen: 0.78 px at full size, shrinking towards 0.5 px as the export is downsized', () => {
    expect(screenSigma(1)).toBeCloseTo(0.781, 3)
    expect(screenSigma(0.5)).toBeCloseTo(0.583, 3)
    expect(screenSigma(0.25)).toBeCloseTo(0.522, 3)
    expect(screenSigma(0)).toBeCloseTo(0.5, 6)
    expect(screenSigma(3)).toBe(screenSigma(1)) // enlargements count as 100 %
    const s = (scale: number) => sharpenParams({ on: true, medium: 'screen', amount: 'standard' }, scale, 300)!.sigma
    expect(s(1)).toBeCloseTo(0.78, 6)
    expect(s(0.25)).toBeLessThan(s(0.5))
    expect(s(0.5)).toBeLessThan(s(1))
    // the resolution doesn't matter on screen
    expect(sharpenParams({ on: true, medium: 'screen', amount: 'high' }, 0.4, 72)).toEqual(sharpenParams({ on: true, medium: 'screen', amount: 'high' }, 0.4, 600))
  })

  it('paper: millimetres on the print × pixels per millimetre, independent of the downsizing', () => {
    expect(printSigma(0.075, 300)).toBeCloseTo(0.886, 3)
    expect(printSigma(0.095, 300)).toBeCloseTo(1.122, 3)
    expect(printSigma(0.095, 240)).toBeCloseTo(0.898, 3)
    const g = (ppi: number, scale = 1) => sharpenParams({ on: true, medium: 'glossy', amount: 'standard' }, scale, ppi)!
    expect(g(600).sigma).toBeCloseTo(2 * g(300).sigma, 6)
    expect(g(300, 0.3)).toEqual(g(300, 1))
    expect(g(300).radius).toBe(3)
    expect(g(1200).sigma).toBeCloseTo(3.543, 3)
    expect(g(1200).radius).toBe(9)
    // 72 ppi would be 0.21 px: held at the minimum
    expect(g(72).sigma).toBe(MIN_SIGMA)
  })

  it('clamps the resolution', () => {
    expect(clampPpi(300)).toBe(300)
    expect(clampPpi(299.6)).toBe(300)
    expect(clampPpi(10)).toBe(72)
    expect(clampPpi(5000)).toBe(1200)
    expect(clampPpi(Number.NaN)).toBe(300)
    expect(printSigma(0.1, 5000)).toBeCloseTo(printSigma(0.1, 1200), 9)
  })

  it('tolerates stored settings from elsewhere', () => {
    const odd = { on: true, medium: 'canvas', amount: 'extreme' } as unknown as Parameters<typeof sharpenParams>[0]
    expect(sharpenParams(odd, 1, 300)).toEqual(sharpenParams({ on: true, medium: 'screen', amount: 'standard' }, 1, 300))
  })

  it('describes the choice', () => {
    expect(describeSharpening(sharpenParams({ on: true, medium: 'matte', amount: 'high' }, 1, 300), 'matte', 300)).toBe('Radius 1.12 px, amount 1.6 for matte paper at 300 ppi')
    expect(describeSharpening(null, 'screen', 300)).toBe('')
  })
})
