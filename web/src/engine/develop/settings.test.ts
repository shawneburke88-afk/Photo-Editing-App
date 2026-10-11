import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, displayUniforms, normalizeSettings, sigmoidContrast, sliderFromTint, tintFromSlider, toneBands } from './settings'

describe('develop settings', () => {
  it('defaults match darktable scene-referred defaults', () => {
    const u = displayUniforms(DEFAULT_SETTINGS)
    expect(u.exposureGain).toBeCloseTo(2 ** 0.7)
    expect(u.toneEnabled).toBe(false)
    expect(sigmoidContrast(0)).toBe(1.5)
  })
  it('maps tone sliders onto the right brightness bands', () => {
    const shadows = toneBands({ ...DEFAULT_SETTINGS, shadows: 100 })
    expect(shadows[4]).toBeCloseTo(1.5) // −4 EV
    expect(shadows[8]).toBe(0) // whites untouched
    const whites = toneBands({ ...DEFAULT_SETTINGS, whites: -100 })
    expect(whites[8]).toBeCloseTo(-1.5)
    expect(whites[0]).toBe(0)
  })
  it('round-trips the tint slider', () => {
    expect(sliderFromTint(tintFromSlider(37, 1.04), 1.04)).toBeCloseTo(37)
    expect(tintFromSlider(100, 1)).toBeLessThan(1) // magenta = lower darktable tint
  })
  it('fills missing fields from defaults', () => {
    const s = normalizeSettings({ exposure: 1, advanced: { demosaic: 'bilinear' } as never })
    expect(s.exposure).toBe(1)
    expect(s.advanced.baseExposure).toBe(0.7)
    expect(s.advanced.demosaic).toBe('bilinear')
  })
})
