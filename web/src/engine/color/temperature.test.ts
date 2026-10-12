import { describe, expect, it } from 'vitest'
import { tintFromSlider } from '../develop/settings'
import { ADOBE_RGB_PROFILE, profileToRec2020 } from './icc'
import { apply, invert, mul, REC2020_TO_XYZ, SRGB_TO_REC2020, type Mat3, type Vec3 } from './matrix'
import { fitWhite, HIGHEST_TEMPERATURE, LOWEST_TEMPERATURE, MAX_MULTIPLIER_RATIO, multipliersToTemperature, temperatureToMultipliers, temperatureToXYZ } from './temperature'

/** The multipliers as they were computed before the limit (darktable's _temp2mul as it is). */
function unguarded(tempK: number, tint: number, xyzToCam: Mat3): Vec3 {
  const xyz = temperatureToXYZ(tempK)
  xyz[1] /= tint
  const cam = apply(xyzToCam, xyz)
  const m: Vec3 = [1 / cam[0], 1 / cam[1], 1 / cam[2]]
  return [m[0] / m[1], 1, m[2] / m[1]]
}

const D700: Mat3 = [0.8139, -0.2171, -0.0663, -0.8747, 1.6541, 0.2295, -0.1925, 0.2008, 0.8093]
const asCamera = (toRec2020: Mat3) => invert(mul(REC2020_TO_XYZ, toRec2020))
const SOURCES: [string, Mat3, Vec3][] = [
  ['RAW (Nikon D700)', D700, [443 / 256, 1, 367 / 256]],
  ['JPEG (sRGB)', asCamera(SRGB_TO_REC2020), [1, 1, 1]],
  ['JPEG (Adobe RGB)', asCamera(profileToRec2020(ADOBE_RGB_PROFILE)), [1, 1, 1]],
]
const TEMPS = [LOWEST_TEMPERATURE, 2200, 2500, 2850, 3200, 4000, 5000, 5500, 6500, 7500, 10000, 15000, HIGHEST_TEMPERATURE]
const SLIDERS = Array.from({ length: 31 }, (_, i) => -150 + 10 * i)

describe('white balance multipliers over the whole Temp × Tint range', () => {
  for (const [name, m, wb] of SOURCES) {
    const asShot = multipliersToTemperature(wb, m)
    it(`stay positive, finite and within ${MAX_MULTIPLIER_RATIO}× of each other: ${name}`, () => {
      for (const t of TEMPS) {
        for (const s of SLIDERS) {
          const mm = temperatureToMultipliers(t, tintFromSlider(s, asShot.tint), m)
          for (const v of mm) {
            expect(Number.isFinite(v)).toBe(true)
            expect(v).toBeGreaterThan(0)
          }
          expect(Math.max(...mm) / Math.min(...mm)).toBeLessThanOrEqual(MAX_MULTIPLIER_RATIO * (1 + 1e-9))
        }
      }
    })

    it(`are unchanged wherever they were already within the limit: ${name}`, () => {
      let same = 0
      for (const t of TEMPS) {
        for (const s of SLIDERS) {
          const tint = tintFromSlider(s, asShot.tint)
          const before = unguarded(t, tint, m)
          if (before.every((v) => v > 0) && Math.max(...before) / Math.min(...before) <= MAX_MULTIPLIER_RATIO) {
            temperatureToMultipliers(t, tint, m).forEach((v, i) => expect(v).toBe(before[i]))
            same++
          }
        }
      }
      expect(same).toBeGreaterThan(TEMPS.length * SLIDERS.length * 0.7)
    })

    it(`Tint never turns back: right is never greener than left, at every Temp: ${name}`, () => {
      const greenWeight = (v: Vec3) => v[1] / Math.sqrt(v[0] * v[2])
      for (const t of TEMPS) {
        let previous = Infinity
        for (const s of SLIDERS) {
          const g = greenWeight(temperatureToMultipliers(t, tintFromSlider(s, asShot.tint), m))
          expect(g).toBeLessThanOrEqual(previous * (1 + 1e-9))
          previous = g
        }
      }
    })
  }

  it('the case from PHASE2.md: sRGB JPEG, 6500 K, Tint +150', () => {
    const m = asCamera(SRGB_TO_REC2020)
    const asShot = multipliersToTemperature([1, 1, 1], m)
    expect(unguarded(asShot.temperature, tintFromSlider(150, asShot.tint), m)[0]).toBeCloseTo(-7.9, 1)
    const fixed = temperatureToMultipliers(asShot.temperature, tintFromSlider(150, asShot.tint), m)
    expect(fixed[0]).toBeGreaterThan(9) // still strongly magenta: red and blue up against green
    expect(fixed[2]).toBeGreaterThan(1)
    // +100 is inside the limit and renders as before (red ≈ 9.5).
    expect(temperatureToMultipliers(asShot.temperature, tintFromSlider(100, asShot.tint), m)[0]).toBeCloseTo(9.48, 1)
  })

  it('fitWhite leaves whites inside alone and moves others to the limit towards neutral', () => {
    expect(fitWhite([0.5, 1, 0.2])).toEqual([0.5, 1, 0.2])
    const f = fitWhite([-0.1, 1, 0.5])
    expect(Math.min(...f) / Math.max(...f)).toBeCloseTo(1 / MAX_MULTIPLIER_RATIO, 12)
    expect(f[1]).toBe(1)
    expect(fitWhite([-1, -1, -1])).toEqual([1, 1, 1])
  })
})
