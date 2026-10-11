import { describe, expect, it } from 'vitest'
import { apply, invert, mul, REC2020_TO_SRGB, SRGB_TO_REC2020, type Mat3 } from './matrix'
import { loglogistic, MIDDLE_GREY, SIGMOID_DEFAULTS, sigmoidCurve } from './sigmoid'
import { multipliersToTemperature, temperatureToMultipliers, temperatureToXYZ } from './temperature'
import { toneCorrection, toneEqualizerFactors } from './tone-equalizer'

// Nikon D700 Adobe matrix (XYZ → camera), as LibRaw reports it.
const D700: Mat3 = [0.8139, -0.2171, -0.0663, -0.8747, 1.6541, 0.2295, -0.1925, 0.2008, 0.8093]

describe('matrices', () => {
  it('Rec.2020 ⇄ sRGB round-trips and keeps white neutral', () => {
    const id = mul(REC2020_TO_SRGB, SRGB_TO_REC2020)
    id.forEach((v, i) => expect(v).toBeCloseTo(i % 4 === 0 ? 1 : 0, 6))
    apply(REC2020_TO_SRGB, [1, 1, 1]).forEach((v) => expect(v).toBeCloseTo(1, 3))
  })
  it('inverts', () => {
    const p = mul(D700, invert(D700))
    p.forEach((v, i) => expect(v).toBeCloseTo(i % 4 === 0 ? 1 : 0, 9))
  })
})

describe('temperature', () => {
  it('produces a daylight white close to D65 at 6504 K', () => {
    const [X, Y, Z] = temperatureToXYZ(6504)
    const s = X + Y + Z
    expect(X / s).toBeCloseTo(0.3127, 2)
    expect(Y / s).toBeCloseTo(0.329, 2)
  })
  it('warmer light needs more blue gain', () => {
    const tungsten = temperatureToMultipliers(3200, 1, D700)
    const daylight = temperatureToMultipliers(5500, 1, D700)
    expect(tungsten[2]).toBeGreaterThan(daylight[2])
    expect(tungsten[0]).toBeLessThan(daylight[0])
  })
  it('round-trips multipliers ⇄ temperature/tint', () => {
    for (const t of [3000, 4500, 5600, 7500]) {
      for (const tint of [0.9, 1, 1.1]) {
        const m = temperatureToMultipliers(t, tint, D700)
        const back = multipliersToTemperature(m, D700)
        expect(Math.abs(back.temperature - t) / t).toBeLessThan(0.01)
        expect(back.tint).toBeCloseTo(tint, 2)
      }
    }
  })
  it('finds a plausible temperature for the D700 sample as-shot multipliers', () => {
    const { temperature } = multipliersToTemperature([443 / 256, 1, 367 / 256], D700)
    expect(temperature).toBeGreaterThan(4500)
    expect(temperature).toBeLessThan(6500) // sunny daylight scene
  })
})

describe('sigmoid', () => {
  const c = sigmoidCurve(SIGMOID_DEFAULTS)
  const f = (x: number) => loglogistic(x, c.whiteTarget, c.paperExp, c.filmFog, c.filmPower, c.paperPower)
  it('maps middle grey to middle grey, 0 to the black target, ∞ towards white', () => {
    expect(f(MIDDLE_GREY)).toBeCloseTo(MIDDLE_GREY, 4)
    expect(f(0)).toBeCloseTo(0.000152, 5)
    expect(f(1e6)).toBeCloseTo(1, 3)
  })
  it('is monotonic', () => {
    let prev = -1
    for (let x = 0; x < 20; x += 0.01) {
      const y = f(x)
      expect(y).toBeGreaterThanOrEqual(prev)
      prev = y
    }
  })
})

describe('tone equalizer', () => {
  it('is neutral with zero gains, within the RBF fit ripple (as in darktable)', () => {
    const f = toneEqualizerFactors(new Array(9).fill(0))
    for (let ev = -8; ev <= 0; ev += 0.25) expect(Math.abs(toneCorrection(ev, f) - 1)).toBeLessThan(0.02)
  })
  it('approximately reproduces a +1 EV shadow boost', () => {
    const gains = [0, 0, 0, 1, 1, 0, 0, 0, 0]
    const f = toneEqualizerFactors(gains)
    expect(Math.log2(toneCorrection(-4.5, f))).toBeGreaterThan(0.6)
    expect(Math.abs(Math.log2(toneCorrection(0, f)))).toBeLessThan(0.15)
  })
})
