import { describe, expect, it } from 'vitest'
import { autoColour, autoContrast, clipCounts, COLOUR_LIMIT, curveAtAmount, percentile, withAutoColour, withAutoContrast } from './curve-auto'
import { CURVE_PRESETS, curveFunction, DEFAULT_TONE_CURVE, isLinear, LINEAR, masterFunction, type CurvePoint, type ToneCurveSettings } from './tone-curve'

const BINS = 256
/** A histogram from a density on 0…1 (bin i at x = (i + 0.5)/255, as the stats pass bins floor(v · 255)). */
function hist(density: (x: number) => number, pixels = 1e6): Uint32Array {
  const raw = Array.from({ length: BINS }, (_, i) => Math.max(0, density(Math.min(1, (i + 0.5) / 255))))
  const sum = raw.reduce((a, b) => a + b, 0)
  return Uint32Array.from(raw.map((v) => Math.round((v / sum) * pixels)))
}
const gauss = (mu: number, sd: number) => (x: number) => Math.exp(-0.5 * ((x - mu) / sd) ** 2)
const flat = hist(() => 1)
const contrasty = hist((x) => gauss(0.06, 0.05)(x) + gauss(0.94, 0.05)(x))
const foggy = hist(gauss(0.55, 0.08))
const natural = hist((x) => gauss(0.35, 0.18)(x) + 0.4 * gauss(0.8, 0.1)(x))
const fade: ToneCurveSettings = { ...DEFAULT_TONE_CURVE, rgb: CURVE_PRESETS.find((p) => p.id === 'fade')!.points }
const strong: ToneCurveSettings = { ...DEFAULT_TONE_CURVE, rgb: CURVE_PRESETS.find((p) => p.id === 'strong')!.points }
const xs = Array.from({ length: 1001 }, (_, i) => i / 1000)
const maxDev = (pts: readonly CurvePoint[]) => {
  const f = curveFunction(pts)
  return Math.max(...xs.map((x) => Math.abs(f(x) - x)))
}

describe('percentile', () => {
  it('reads the stats pass axis (bin i from i/255)', () => {
    const h = new Uint32Array(256)
    h[51] = 100
    expect(percentile(h, 0.5)).toBeCloseTo(51.5 / 255, 6)
    expect(percentile(flat, 0.5)).toBeCloseTo(0.5, 2)
    expect(percentile(new Uint32Array(256), 0.5)).toBeNaN()
  })
})

describe('Auto contrast', () => {
  it('gives an S-curve on a flat histogram: below the diagonal in the shadows, above it in the highlights, pivot kept', () => {
    const r = autoContrast(flat)
    expect(r.points).not.toBeNull()
    const f = curveFunction(r.points!)
    expect(f(0.25)).toBeLessThan(0.25 - 0.01)
    expect(f(0.75)).toBeGreaterThan(0.75 + 0.01)
    expect(f(r.pivot)).toBeCloseTo(r.pivot, 3)
    expect(r.slope).toBeGreaterThan(1.05)
  })

  it('is monotonic (rising everywhere) and stays within 0…1', () => {
    for (const h of [flat, foggy, natural]) {
      const f = curveFunction(autoContrast(h).points!)
      for (let i = 1; i < xs.length; i++) expect(f(xs[i])).toBeGreaterThan(f(xs[i - 1]) - 1e-12)
      expect(f(0)).toBe(0)
      expect(f(1)).toBe(1)
    }
  })

  it('leaves an already contrasty photo straight (near identity)', () => {
    const r = autoContrast(contrasty)
    expect(r.points === null || maxDev(r.points) < 0.01).toBe(true)
    expect(r.reason).toBe('contrasty')
  })

  it('is gentle: the steepest it gets is 1.25 at the pivot', () => {
    const r = autoContrast(foggy)
    expect(r.slope).toBeCloseTo(1.25, 6)
    const f = curveFunction(r.points!)
    const slope = (f(r.pivot + 1e-4) - f(r.pivot - 1e-4)) / 2e-4
    expect(slope).toBeGreaterThan(1.15)
    expect(slope).toBeLessThan(1.35)
  })

  it('is deterministic: the same histogram gives the same curve', () => {
    expect(JSON.stringify(autoContrast(natural))).toBe(JSON.stringify(autoContrast(Uint32Array.from(natural))))
    expect(JSON.stringify(autoContrast(natural, strong))).toBe(JSON.stringify(autoContrast(natural, strong)))
  })

  it('never moves the darkest and brightest tones towards black or white', () => {
    for (const h of [flat, foggy, natural]) {
      const r = autoContrast(h)
      const f = curveFunction(r.points!)
      for (const x of xs) {
        if (x <= r.ends[0]) expect(f(x)).toBeGreaterThanOrEqual(x - 1e-9)
        if (x >= r.ends[1]) expect(f(x)).toBeLessThanOrEqual(x + 1e-9)
      }
    }
  })

  it('clips no more than the current state (straight, Strong Contrast, Fade, Regions)', () => {
    const currents: (ToneCurveSettings | undefined)[] = [undefined, strong, fade, { ...DEFAULT_TONE_CURVE, regions: { ...DEFAULT_TONE_CURVE.regions, shadows: -60, highlights: 60 } }]
    const hists = [flat, foggy, natural, contrasty, hist(gauss(0.02, 0.03)), hist(gauss(0.98, 0.03)), hist((x) => (x < 0.004 || x > 0.996 ? 50 : 1))]
    for (const cur of currents) {
      for (const h of hists) {
        const before = clipCounts(h, masterFunction(cur ?? DEFAULT_TONE_CURVE))
        const tc = withAutoContrast(cur, autoContrast(h, cur)) ?? DEFAULT_TONE_CURVE
        const after = clipCounts(h, masterFunction(tc))
        expect(after.black).toBeLessThanOrEqual(before.black)
        expect(after.white).toBeLessThanOrEqual(before.white)
      }
    }
  })

  it('a faded curve keeps lifted blacks: the S-curve is blended back until nothing more is clipped', () => {
    const h = hist((x) => (x < 0.01 ? 30 : 1))
    const r = autoContrast(h, fade)
    expect(r.kept).toBeLessThan(1)
    const f = masterFunction(withAutoContrast(fade, r)!)
    expect(f(0)).toBeGreaterThanOrEqual(0.5 / 255)
  })

  it('writes only the RGB point curve', () => {
    const cur: ToneCurveSettings = { ...DEFAULT_TONE_CURVE, red: [[0, 0], [0.5, 0.55], [1, 1]], regions: { ...DEFAULT_TONE_CURVE.regions, lights: 20 }, saturation: 70 }
    const tc = withAutoContrast(cur, autoContrast(natural, cur))!
    expect(tc.red).toEqual(cur.red)
    expect(tc.regions).toEqual(cur.regions)
    expect(tc.saturation).toBe(70)
    expect(isLinear(tc.rgb)).toBe(false)
  })

  it('does nothing on an empty or single-tone histogram', () => {
    expect(autoContrast(new Uint32Array(256)).points).toBeNull()
    const one = new Uint32Array(256)
    one[120] = 5000
    expect(autoContrast(one).points).toBeNull()
  })
})

describe('Auto colour', () => {
  const base = (x: number) => gauss(0.42, 0.17)(x) + 0.3 * gauss(0.85, 0.06)(x)
  const shifted = (d: number) => hist((x) => base(x - d))
  it('removes a cast on a synthetic tinted histogram (red +0.03, blue −0.02)', () => {
    const r0 = shifted(0.03)
    const g0 = shifted(0)
    const b0 = shifted(-0.02)
    const res = autoColour(r0, g0, b0)
    const mids = [r0, g0, b0].map((h) => percentile(h, 0.5))
    const fs = [res.red, res.green, res.blue].map((p) => curveFunction(p))
    const after = mids.map((x, c) => fs[c](x))
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v)
    expect(spread(mids)).toBeGreaterThan(0.045)
    expect(spread(after)).toBeLessThan(0.004)
    // The shadows and highlights move halfway.
    const hi = [r0, g0, b0].map((h) => percentile(h, 0.98))
    expect(spread(hi.map((x, c) => fs[c](x)))).toBeLessThan(spread(hi) * 0.6)
  })

  it('is bounded: a strong cast moves a channel by at most 4 % (plus the spline between points)', () => {
    const res = autoColour(shifted(0.2), shifted(0), shifted(-0.2))
    for (const pts of [res.red, res.green, res.blue]) expect(maxDev(pts)).toBeLessThanOrEqual(COLOUR_LIMIT[1] + 0.006)
    for (const a of res.anchors) a.dy.forEach((d, k) => expect(Math.abs(d)).toBeLessThanOrEqual(COLOUR_LIMIT[k] + 1e-12))
  })

  it('changes nothing on neutral input', () => {
    const h = shifted(0)
    const res = autoColour(h, h, h)
    expect(res.red).toEqual(LINEAR)
    expect(res.green).toEqual(LINEAR)
    expect(res.blue).toEqual(LINEAR)
    expect(withAutoColour(undefined, res)).toBeUndefined()
  })

  it('keeps each channel curve rising, and leaves the RGB curve and Regions alone', () => {
    const res = autoColour(shifted(0.05), shifted(-0.01), shifted(0.02))
    for (const pts of [res.red, res.green, res.blue]) {
      const f = curveFunction(pts)
      for (let i = 1; i < xs.length; i++) expect(f(xs[i])).toBeGreaterThan(f(xs[i - 1]) - 1e-12)
    }
    const tc = withAutoColour(strong, res)!
    expect(tc.rgb).toEqual(strong.rgb)
    expect(tc.regions).toEqual(strong.regions)
  })

  it('is deterministic', () => {
    const a = autoColour(shifted(0.03), shifted(0), shifted(-0.02))
    const b = autoColour(shifted(0.03), shifted(0), shifted(-0.02))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('Amount', () => {
  it('scales the result between the curve before Auto (0) and the Auto curve (1)', () => {
    const before = fade
    const after = withAutoContrast(before, autoContrast(natural, before))!
    expect(curveAtAmount(before, after, 0)).toEqual(before)
    expect(curveAtAmount(before, after, 1)).toEqual(after)
    const half = curveAtAmount(before, after, 0.5)!
    const [fb, fa, fh] = [before, after, half].map((t) => masterFunction(t))
    for (const x of [0.1, 0.3, 0.5, 0.7, 0.9]) expect(fh(x)).toBeCloseTo((fb(x) + fa(x)) / 2, 2)
    // Clamped to 0…100 %.
    expect(curveAtAmount(before, after, 1.7)).toEqual(after)
    // From no curve at all: 0 % is no curve.
    const fresh = withAutoContrast(undefined, autoContrast(natural))!
    expect(curveAtAmount(undefined, fresh, 0)).toBeUndefined()
  })
})
