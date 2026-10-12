import { describe, expect, it } from 'vitest'
import { tintFromSlider } from '../develop/settings'
import { ADOBE_RGB_PROFILE, profileToRec2020 } from './icc'
import { apply, invert, mul, REC2020_TO_XYZ, SRGB_TO_REC2020, type Mat3, type Vec3 } from './matrix'
import { fitWhite, HIGHEST_TEMPERATURE, LOWEST_TEMPERATURE, multipliersToTemperature, RAW_MULTIPLIER_LIMIT, RGB_MULTIPLIER_LIMIT, temperatureToMultipliers, temperatureToXYZ } from './temperature'

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
const SOURCES: [string, Mat3, Vec3, number][] = [
  ['RAW (Nikon D700)', D700, [443 / 256, 1, 367 / 256], RAW_MULTIPLIER_LIMIT],
  ['JPEG (sRGB)', asCamera(SRGB_TO_REC2020), [1, 1, 1], RGB_MULTIPLIER_LIMIT],
  ['JPEG (Adobe RGB)', asCamera(profileToRec2020(ADOBE_RGB_PROFILE)), [1, 1, 1], RGB_MULTIPLIER_LIMIT],
]
const TEMPS = [LOWEST_TEMPERATURE, 2200, 2500, 2850, 3200, 4000, 5000, 5500, 6500, 7500, 10000, 15000, HIGHEST_TEMPERATURE]
const SLIDERS = Array.from({ length: 31 }, (_, i) => -150 + 10 * i)
/** Every multiplier positive and within [1/limit, limit] of green (green is 1). */
const fits = (m: Vec3, limit: number) => m.every((v) => v > 0) && Math.max(...m) <= limit && Math.min(...m) >= 1 / limit

describe('white balance multipliers over the whole Temp × Tint range', () => {
  for (const [name, m, wb, limit] of SOURCES) {
    const asShot = multipliersToTemperature(wb, m)
    it(`stay positive, finite and within ${limit}× of green either way: ${name}`, () => {
      for (const t of TEMPS) {
        for (const s of SLIDERS) {
          const mm = temperatureToMultipliers(t, tintFromSlider(s, asShot.tint), m, limit)
          for (const v of mm) {
            expect(Number.isFinite(v)).toBe(true)
            expect(v).toBeGreaterThan(0)
          }
          expect(Math.max(...mm)).toBeLessThanOrEqual(limit * (1 + 1e-9))
          expect(Math.min(...mm)).toBeGreaterThanOrEqual((1 / limit) * (1 - 1e-9))
        }
      }
    })

    it(`are unchanged wherever they were already within the limit: ${name}`, () => {
      let same = 0
      for (const t of TEMPS) {
        for (const s of SLIDERS) {
          const tint = tintFromSlider(s, asShot.tint)
          const before = unguarded(t, tint, m)
          if (fits(before, limit)) {
            temperatureToMultipliers(t, tint, m, limit).forEach((v, i) => expect(v).toBe(before[i]))
            same++
          }
        }
      }
      expect(same).toBeGreaterThan(TEMPS.length * SLIDERS.length * (limit === RAW_MULTIPLIER_LIMIT ? 0.9 : 0.55))
    })

    it(`Tint never turns back: right is never greener than left, at every Temp: ${name}`, () => {
      const greenWeight = (v: Vec3) => v[1] / Math.sqrt(v[0] * v[2])
      // For the D700 at 1901 K, darktable's formula itself turns back on the green side before it breaks down (Tint 0
      // → −50: blue 11.4 → 34.2, red 0.55 → 0.19, so the result gets less green); the limit can't undo that.
      for (const t of limit === RAW_MULTIPLIER_LIMIT ? TEMPS.slice(1) : TEMPS) {
        let previous = Infinity
        for (const s of SLIDERS) {
          const g = greenWeight(temperatureToMultipliers(t, tintFromSlider(s, asShot.tint), m, limit))
          expect(g).toBeLessThanOrEqual(previous * (1 + 1e-9))
          previous = g
        }
      }
    })
  }

  it('RAW: only very warm Temp with Tint far to the green side changes (D700, whole grid)', () => {
    const asShot = multipliersToTemperature([443 / 256, 1, 367 / 256], D700)
    const changed: string[] = []
    for (const t of TEMPS) {
      for (const s of SLIDERS) {
        const tint = tintFromSlider(s, asShot.tint)
        const before = unguarded(t, tint, D700)
        const now = temperatureToMultipliers(t, tint, D700)
        if (now.some((v, i) => v !== before[i])) {
          changed.push(`${t}/${s}`)
          expect(t <= 2850 && s <= -40).toBe(true)
        }
      }
    }
    expect(changed.length).toBeLessThan(25)
  })

  it('the case from PHASE2.md: sRGB JPEG, 6500 K, Tint +150', () => {
    const m = asCamera(SRGB_TO_REC2020)
    const asShot = multipliersToTemperature([1, 1, 1], m)
    const at = (slider: number) => temperatureToMultipliers(asShot.temperature, tintFromSlider(slider, asShot.tint), m, RGB_MULTIPLIER_LIMIT)
    expect(unguarded(asShot.temperature, tintFromSlider(150, asShot.tint), m)[0]).toBeCloseTo(-7.9, 1)
    expect(unguarded(asShot.temperature, tintFromSlider(100, asShot.tint), m)[0]).toBeCloseTo(9.48, 1)
    // Now: red stops at 8× green, blue stays above green: magenta at the end of the slider.
    expect(at(150)[0]).toBeCloseTo(8, 9)
    expect(at(150)[2]).toBeGreaterThan(1.5)
    expect(at(100)).toEqual(at(150))
    // +90 is within the limit and unchanged. At the other end, −150 asked for red at about 1/12 of green: it stops at
    // 1/8.
    expect(at(90)).toEqual(unguarded(asShot.temperature, tintFromSlider(90, asShot.tint), m))
    expect(1 / Math.min(...at(-150))).toBeCloseTo(8, 9)
  })

  it('fitWhite leaves whites inside alone and moves others to the limit towards neutral', () => {
    expect(fitWhite([0.5, 1, 0.2], 8)).toEqual([0.5, 1, 0.2])
    const f = fitWhite([-0.1, 1, 0.5], 8)
    expect(f[1] / f[0]).toBeCloseTo(8, 9)
    expect(f[1] / f[2]).toBeLessThan(8)
    expect(fitWhite([1, -0.2, 1], 8)[1]).toBeGreaterThan(0)
    expect(fitWhite([-1, -1, -1], 8)).toEqual([1, 1, 1])
  })
})
