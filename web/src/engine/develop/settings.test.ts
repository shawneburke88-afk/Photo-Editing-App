import { describe, expect, it } from 'vitest'
import { multipliers, type SensorInfo } from '../../develop/source'
import { invert, mul, REC2020_TO_XYZ, SRGB_TO_REC2020, type Mat3, type Vec3 } from '../color/matrix'
import { multipliersToTemperature } from '../color/temperature'
import { DEFAULT_SETTINGS, defaultsFor, displayUniforms, normalizeSettings, sigmoidContrast, sliderFromTint, tintFromSlider, toneBands } from './settings'

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
  // The Tint slider, through the same conversion the renderer uses (develop/source.ts `multipliers` →
  // temperatureToMultipliers). Multipliers scale the camera channels, so "more magenta" = green scaled down
  // relative to red and blue.
  const greenWeight = (m: Vec3) => m[1] / Math.sqrt(m[0] * m[2])
  const sensor = (wb: Vec3, xyzToCam: Mat3, kind: SensorInfo['kind']): SensorInfo => ({ kind, asShotWb: wb, xyzToCam, asShot: multipliersToTemperature(wb, xyzToCam) })
  const atTint = (info: SensorInfo, slider: number) =>
    multipliers({ ...defaultsFor(info.kind), whiteBalance: { mode: 'custom', temperature: info.asShot.temperature, tint: tintFromSlider(slider, info.asShot.tint) } }, info)
  // Nikon D700 Adobe matrix (XYZ → camera) and the as-shot multipliers of the D700 sample, as LibRaw reports them.
  const D700: Mat3 = [0.8139, -0.2171, -0.0663, -0.8747, 1.6541, 0.2295, -0.1925, 0.2008, 0.8093]
  // On an sRGB JPEG at its as-shot 6500 K, Tint +150 used to ask for a white outside sRGB and the red multiplier came
  // out negative (about −7.9); temperature.ts now stops the tint where a multiplier would pass 8× green, so the whole
  // range is tested.
  const cases: [string, SensorInfo, number[]][] = [
    ['RAW (Nikon D700)', sensor([443 / 256, 1, 367 / 256], D700, 'raw'), [-150, -100, -50, 0, 50, 100, 150]],
    ['JPEG (sRGB)', sensor([1, 1, 1], invert(mul(REC2020_TO_XYZ, SRGB_TO_REC2020)), 'rgb'), [-150, -100, -50, 0, 50, 100, 120, 150]],
  ]
  for (const [name, info, sliders] of cases) {
    it(`moves the rendered white balance towards magenta / green with the Tint slider: ${name}`, () => {
      const neutral = greenWeight(atTint(info, 0))
      let previous = Infinity
      for (const slider of sliders) {
        const g = greenWeight(atTint(info, slider))
        expect(atTint(info, slider).every((v) => v > 0)).toBe(true)
        // Further right = less green = more magenta (or the same, once the white reaches the edge of the gamut).
        expect(g).toBeLessThanOrEqual(previous)
        if (slider <= 100) expect(g).toBeLessThan(previous)
        previous = g
      }
      expect(greenWeight(atTint(info, 60))).toBeLessThan(neutral * 0.95) // towards magenta: green clearly lower
      expect(greenWeight(atTint(info, -60))).toBeGreaterThan(neutral * 1.05) // towards green: green clearly higher
      // Slider 0 at the as-shot temperature reproduces the as-shot multipliers.
      atTint(info, 0).forEach((v, i) => expect(v).toBeCloseTo(info.asShotWb[i], 1))
    })
  }
  it('fills missing fields from defaults', () => {
    const s = normalizeSettings({ exposure: 1, advanced: { demosaic: 'bilinear' } as never })
    expect(s.exposure).toBe(1)
    expect(s.advanced.baseExposure).toBe(0.7)
    expect(s.advanced.demosaic).toBe('bilinear')
  })
})
