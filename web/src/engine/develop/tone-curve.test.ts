import { describe, expect, it } from 'vitest'
import {
  applyMaster,
  applyToneCurve,
  blendToneCurve,
  brightness,
  buildLut,
  CURVE_NORMS,
  CURVE_PRESETS,
  curveActive,
  curveFunction,
  decode,
  DEFAULT_TONE_CURVE,
  encode,
  fixSplits,
  hermiteAt,
  LINEAR,
  lutAt,
  masterFunction,
  monotoneTangents,
  normalizePoints,
  normalizeToneCurve,
  presetOf,
  regionAt,
  regionPoints,
  toneCurveGpu,
  withToneCurve,
  type CurveNorm,
  type CurvePoint,
  type ToneCurveSettings,
} from './tone-curve'

/** darktable's monotone_hermite_set as it is (src/common/curve_tools.c lines 393-452), without LightBench's step. */
function darktableTangents(x: number[], y: number[]): number[] {
  const n = x.length
  const delta = new Array<number>(n).fill(0)
  const m = new Array<number>(n + 1).fill(0)
  for (let i = 0; i < n - 1; i++) delta[i] = (y[i + 1] - y[i]) / (x[i + 1] - x[i])
  delta[n - 1] = delta[n - 2]
  m[0] = delta[0]
  m[n - 1] = delta[n - 1]
  for (let i = 1; i < n - 1; i++) m[i] = (delta[i - 1] + delta[i]) * 0.5
  for (let i = 0; i < n; i++) {
    if (Math.abs(delta[i]) < 2 * 1.1754943508222875e-38) {
      m[i] = 0
      m[i + 1] = 0
    } else {
      const a = m[i] / delta[i]
      const b = m[i + 1] / delta[i]
      const tau = a * a + b * b
      if (tau > 9) {
        m[i] = (3 * a * delta[i]) / Math.sqrt(tau)
        m[i + 1] = (3 * b * delta[i]) / Math.sqrt(tau)
      }
    }
  }
  return m.slice(0, n)
}

/** A small deterministic random generator. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function randomPoints(r: () => number, monotone: boolean): CurvePoint[] {
  const n = 2 + Math.floor(r() * 10)
  const xs = [0, ...Array.from({ length: n - 2 }, () => 0.02 + r() * 0.96), 1].sort((a, b) => a - b)
  let ys = xs.map(() => r())
  if (monotone) ys = [...ys].sort((a, b) => a - b)
  return normalizePoints(xs.map((x, i) => [x, ys[i]])) ?? LINEAR
}

const tc = (patch: Partial<ToneCurveSettings>): ToneCurveSettings => ({ ...DEFAULT_TONE_CURVE, ...patch })

describe('the spline (darktable monotone Hermite)', () => {
  it('has darktable’s tangents wherever the points rise or fall throughout', () => {
    const r = rng(1)
    for (let k = 0; k < 300; k++) {
      const p = randomPoints(r, true)
      const x = p.map((q) => q[0])
      const y = p.map((q) => q[1])
      const ours = monotoneTangents(x, y)!
      const dt = darktableTangents(x, y)
      ours.forEach((m, i) => expect(m).toBeCloseTo(dt[i], 12))
    }
  })

  it('passes through its points', () => {
    const r = rng(2)
    for (let k = 0; k < 200; k++) {
      const p = randomPoints(r, k % 2 === 0)
      const f = curveFunction(p)
      for (const [x, y] of p) expect(f(x)).toBeCloseTo(y, 9)
    }
  })

  it('never overshoots: between two points it stays between their outputs, also for dips and bumps', () => {
    const r = rng(3)
    let worst = 0
    for (let k = 0; k < 500; k++) {
      const p = randomPoints(r, false)
      const f = curveFunction(p)
      for (let i = 0; i < p.length - 1; i++) {
        const lo = Math.min(p[i][1], p[i + 1][1])
        const hi = Math.max(p[i][1], p[i + 1][1])
        for (let s = 1; s < 40; s++) {
          const v = f(p[i][0] + ((p[i + 1][0] - p[i][0]) * s) / 40)
          worst = Math.max(worst, lo - v, v - hi)
        }
      }
    }
    expect(worst).toBeLessThan(1e-9)
  })

  it('darktable’s own tangents do overshoot at a dip (why LightBench adds the step)', () => {
    const x = [0, 0.3, 0.5, 1]
    const y = [0, 0.6, 0.2, 1]
    const m = darktableTangents(x, y)
    let low = Infinity
    for (let s = 1; s < 100; s++) low = Math.min(low, hermiteAt(x, y, m, 0.3 + (0.2 * s) / 100), hermiteAt(x, y, m, 0.5 + (0.5 * s) / 100))
    expect(low).toBeLessThan(0.2 - 1e-3)
    let ours = Infinity
    const f = curveFunction(x.map((v, i) => [v, y[i]]))
    for (let s = 0; s <= 1000; s++) ours = Math.min(ours, f(0.3 + (0.7 * s) / 1000))
    expect(ours).toBeGreaterThanOrEqual(0.2 - 1e-12)
  })

  it('is monotone when its points are', () => {
    const r = rng(4)
    let bad = 0
    for (let k = 0; k < 200; k++) {
      const f = curveFunction(randomPoints(r, true))
      let prev = -Infinity
      for (let s = 0; s <= 400; s++) {
        const v = f(s / 400)
        bad += +(v < prev - 1e-12)
        prev = v
      }
    }
    expect(bad).toBe(0)
  })

  it('is flat beyond its end points and clamped to 0…1 (darktable CurveDataSample)', () => {
    const f = curveFunction([
      [0.1, 0.2],
      [0.9, 0.7],
    ])
    expect(f(0)).toBe(0.2)
    expect(f(0.05)).toBe(0.2)
    expect(f(0.95)).toBe(0.7)
    expect(f(1)).toBe(0.7)
    expect(curveFunction(LINEAR)(0.37)).toBeCloseTo(0.37, 12)
  })
})

describe('Regions (LightBench’s parametric curve)', () => {
  it('is the identity at zero, with the ends fixed', () => {
    const f = masterFunction(DEFAULT_TONE_CURVE)
    for (let s = 0; s <= 10; s++) expect(f(s / 10)).toBeCloseTo(s / 10, 12)
    const p = regionPoints({ shadows: 100, darks: -100, lights: 100, highlights: -100, splits: [25, 50, 75] })
    expect(p[0]).toEqual([0, 0])
    expect(p[p.length - 1]).toEqual([1, 1])
  })

  it('moves its own region most and stays monotone for any values and splits', () => {
    const r = rng(5)
    let bad = 0
    for (let k = 0; k < 300; k++) {
      const splits = fixSplits([5 + r() * 90, 5 + r() * 90, 5 + r() * 90].sort((a, b) => a - b), 1)
      const v = () => Math.round(r() * 200 - 100)
      const f = masterFunction(tc({ regions: { shadows: v(), darks: v(), lights: v(), highlights: v(), splits } }))
      let prev = -Infinity
      for (let s = 0; s <= 400; s++) {
        const y = f(s / 400)
        bad += +(y < prev - 1e-12 || y < 0 || y > 1)
        prev = y
      }
    }
    expect(bad).toBe(0)
    const f = masterFunction(tc({ regions: { shadows: 100, darks: 0, lights: 0, highlights: 0, splits: [25, 50, 75] } }))
    expect(f(0.125) - 0.125).toBeCloseTo(0.09375, 6)
    expect(Math.abs(f(0.75) - 0.75)).toBeLessThan(1e-9)
    const g = masterFunction(tc({ regions: { shadows: 0, darks: 0, lights: 0, highlights: -100, splits: [25, 50, 75] } }))
    expect(g(0.875)).toBeLessThan(0.875 - 0.08)
    expect(Math.abs(g(0.3) - 0.3)).toBeLessThan(1e-9)
  })

  it('finds the region of a tone and keeps the splits apart', () => {
    expect(regionAt(0.1, [25, 50, 75])).toBe('shadows')
    expect(regionAt(0.3, [25, 50, 75])).toBe('darks')
    expect(regionAt(0.6, [25, 50, 75])).toBe('lights')
    expect(regionAt(0.9, [25, 50, 75])).toBe('highlights')
    expect(fixSplits([25, 22, 75], 1)).toEqual([17, 22, 75])
    expect(fixSplits([25, 50, 99], 2)).toEqual([25, 50, 95])
    expect(fixSplits([60, 50, 75], 0)).toEqual([60, 65, 75])
  })
})

describe('the lookup table', () => {
  it('holds R, G, B and the RGB curve, sampled on the encoded axis', () => {
    const t = tc({ rgb: CURVE_PRESETS[1].points, red: [[0, 0.1], [1, 1]] })
    const lut = buildLut(t, 4096)
    const m = masterFunction(t)
    const r = curveFunction(t.red)
    for (const i of [0, 1, 1000, 2047, 4095]) {
      expect(lut[i * 4 + 3]).toBeCloseTo(m(i / 4095), 6)
      expect(lut[i * 4]).toBeCloseTo(r(i / 4095), 6)
      expect(lut[i * 4 + 1]).toBeCloseTo(i / 4095, 6)
    }
    // Interpolated between entries; slope 1 above white.
    expect(lutAt(lut, 1, 0.123456)).toBeCloseTo(0.123456, 6)
    expect(lutAt(buildLut(DEFAULT_TONE_CURVE), 3, 1.2)).toBeCloseTo(1.2, 6)
    // Interpolating the 4096 entries stays within 2·10⁻⁶ of the curve itself.
    let worst = 0
    for (let s = 0; s <= 10000; s++) worst = Math.max(worst, Math.abs(lutAt(lut, 3, s / 10000) - m(s / 10000)))
    expect(worst).toBeLessThan(2e-6)
  })

  it('is only sent to the GPU when the curve does something', () => {
    expect(toneCurveGpu(undefined)).toBeNull()
    expect(toneCurveGpu({ ...DEFAULT_TONE_CURVE, saturation: 40 })).toBeNull()
    expect(toneCurveGpu(tc({ rgb: CURVE_PRESETS[1].points }))?.flags).toBe(1)
    expect(toneCurveGpu(tc({ blue: [[0, 0], [0.5, 0.6], [1, 1]] }))?.flags).toBe(2)
    expect(curveActive(tc({ regions: { ...DEFAULT_TONE_CURVE.regions, lights: 10 } }))).toBe(true)
  })
})

describe('colour (hue kept, Saturation)', () => {
  const S: CurvePoint[] = [
    [0, 0],
    [0.25, 0.18],
    [0.75, 0.82],
    [1, 1],
  ]
  const f = (v: number) => decode(curveFunction(S)(encode(v)))
  const colours = [
    [0.6, 0.35, 0.22],
    [0.15, 0.3, 0.6],
    [0.25, 0.04, 0.03],
    [0.85, 0.8, 0.1],
    [0.1, 0.35, 0.08],
    [0.02, 0.01, 0.005],
  ]
  const norms: CurveNorm[] = ['power', 'luminance', 'max', 'average', 'norm']

  it('puts a neutral grey where the curve says, with every brightness measure', () => {
    for (const norm of [...norms, 'channels' as CurveNorm]) {
      for (const g of [0.01, 0.18, 0.5, 0.9]) {
        const o = applyMaster([g, g, g], f, norm, 1)
        for (const v of o) expect(v).toBeCloseTo(f(g), 9)
        expect(brightness([g, g, g], norm === 'channels' ? 'power' : norm)).toBeCloseTo(g, 12)
      }
    }
  })

  it('keeps the hue: the colour stays in the plane of grey and the input colour, on the same side', () => {
    for (const norm of norms) {
      for (const s of [0, 0.5, 1]) {
        for (const c of colours) {
          const o = applyMaster(c, f, norm, s)
          const m = (c[0] + c[1] + c[2]) / 3
          const d = c.map((v) => v - m)
          const om = (o[0] + o[1] + o[2]) / 3
          const e = o.map((v) => v - om)
          // Parallel chroma vectors (perpendicular to grey) pointing the same way.
          const cross = [d[1] * e[2] - d[2] * e[1], d[2] * e[0] - d[0] * e[2], d[0] * e[1] - d[1] * e[0]]
          expect(Math.hypot(...cross)).toBeLessThan(1e-9)
          expect(d[0] * e[0] + d[1] * e[1] + d[2] * e[2]).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('at Saturation 0 changes brightness only; at 100 % with the largest channel it is Adobe’s method', () => {
    for (const c of colours) {
      const n = brightness(c, 'power')
      const o = applyMaster(c, f, 'power', 0)
      const n2 = f(n)
      // Same colour relative to brightness (the input's chroma scaled with it), unless held in range.
      if (Math.max(...c.map((v) => (v * n2) / n)) <= 1) o.forEach((v, i) => expect(v).toBeCloseTo((c[i] * n2) / n, 9))
      // Adobe's hue-keeping method (rtengine/curves.h AdobeToneCurve::RGBTone): the curve on the largest and smallest
      // channel, the middle one placed so its share between them stays.
      const idx = [0, 1, 2].sort((a, b) => c[a] - c[b])
      const [lo, mid, hi] = idx.map((i) => c[i])
      const adobe = [0, 0, 0]
      adobe[idx[0]] = f(lo)
      adobe[idx[2]] = f(hi)
      adobe[idx[1]] = f(lo) + ((f(hi) - f(lo)) * (mid - lo)) / (hi - lo)
      const a = applyMaster(c, f, 'max', 1)
      a.forEach((v, i) => expect(v).toBeCloseTo(adobe[i], 9))
    }
  })

  it('by default (Largest channel, Refine Saturation 100 %) is Adobe’s method, through the GPU’s lookup table', () => {
    // Owner's decision (2026-10-13): the default result is Adobe's film-like, hue-keeping curve.
    expect(DEFAULT_TONE_CURVE.norm).toBe('max')
    expect(DEFAULT_TONE_CURVE.saturation).toBe(100)
    expect(CURVE_NORMS[0].id).toBe('max')
    expect(CURVE_NORMS[0].help).toMatch(/\(default\)/)
    expect(CURVE_NORMS.filter((n) => /\(default\)/.test(n.help))).toHaveLength(1)
    const t = tc({ rgb: S })
    const lut = buildLut(t)
    const fl = (v: number) => decode(lutAt(lut, 3, encode(v)))
    for (const c of colours) {
      const idx = [0, 1, 2].sort((a, b) => c[a] - c[b])
      const [lo, mid, hi] = idx.map((i) => c[i])
      const adobe = [0, 0, 0]
      adobe[idx[0]] = fl(lo)
      adobe[idx[2]] = fl(hi)
      adobe[idx[1]] = fl(lo) + ((fl(hi) - fl(lo)) * (mid - lo)) / (hi - lo)
      applyToneCurve(c, t, lut).forEach((v, i) => expect(v).toBeCloseTo(adobe[i], 9))
    }
  })

  it('makes colours stronger where the curve steepens, less at lower Saturation', () => {
    const c = [0.4, 0.25, 0.15]
    const chroma = (o: number[]) => (Math.max(...o) - Math.min(...o)) / brightness(o, 'power')
    const full = chroma(applyMaster(c, f, 'power', 1))
    const half = chroma(applyMaster(c, f, 'power', 0.5))
    const none = chroma(applyMaster(c, f, 'power', 0))
    expect(full).toBeGreaterThan(half)
    expect(half).toBeGreaterThan(none)
    expect(none).toBeCloseTo(chroma(c), 2)
  })

  it('keeps every channel in range rather than clipping a hue', () => {
    const r = rng(6)
    let bad = 0
    for (let k = 0; k < 2000; k++) {
      const c = [r(), r(), r()].map((v) => v ** 2)
      for (const norm of norms) {
        const o = applyMaster(c, f, norm, 1)
        for (const v of o) bad += +(v < -1e-9 || v > Math.max(1, ...c) + 1e-9)
      }
    }
    expect(bad).toBe(0)
  })

  it('per channel at 100 % is the curve on R, G and B', () => {
    const c = [0.6, 0.35, 0.22]
    applyMaster(c, f, 'channels', 1).forEach((v, i) => expect(v).toBeCloseTo(f(c[i]), 9))
  })

  it('applies the RGB curve, then the channel curves (LightBench’s design)', () => {
    const t = tc({ rgb: S, red: [[0, 0.1], [1, 1]] })
    const lut = buildLut(t)
    const c = [0.3, 0.3, 0.3]
    const o = applyToneCurve(c, t, lut)
    const g = decode(curveFunction(S)(encode(0.3)))
    expect(o[1]).toBeCloseTo(g, 5)
    expect(o[0]).toBeCloseTo(decode(curveFunction(t.red)(encode(g))), 5)
  })
})

describe('presets, storing and Amount', () => {
  it('has Linear, darktable’s medium and high contrast, and a fade', () => {
    expect(CURVE_PRESETS.map((p) => p.name)).toEqual(['Linear', 'Medium Contrast', 'Strong Contrast', 'Fade'])
    expect(CURVE_PRESETS[1].points).toEqual([[0, 0], [0.08, 0.06], [0.17, 0.14], [0.5, 0.5], [0.83, 0.86], [0.92, 0.94], [1, 1]])
    expect(CURVE_PRESETS[2].points[2]).toEqual([0.17, 0.11])
    expect(presetOf(CURVE_PRESETS[2].points)).toBe('strong')
    expect(presetOf([[0, 0], [0.4, 0.5], [1, 1]])).toBeNull()
  })

  it('is absent when untouched or reset', () => {
    expect(normalizeToneCurve(undefined)).toBeUndefined()
    expect(normalizeToneCurve(DEFAULT_TONE_CURVE)).toBeUndefined()
    expect(normalizeToneCurve({ rgb: [[0, 0], [1, 1]] })).toBeUndefined()
    // Largest channel is the default: on its own it leaves no trace; another measure is kept; a missing or unknown one
    // reads as the default.
    expect(normalizeToneCurve({ norm: 'max', saturation: 100 })).toBeUndefined()
    expect(normalizeToneCurve({ norm: 'power' })?.norm).toBe('power')
    expect(normalizeToneCurve({ rgb: S2 })?.norm).toBe('max')
    expect(normalizeToneCurve({ rgb: S2, norm: 'nonsense' })?.norm).toBe('max')
    expect(withToneCurve<{ toneCurve?: ToneCurveSettings }>({}, { ...DEFAULT_TONE_CURVE, norm: 'power' }).toneCurve?.norm).toBe('power')
    const s = withToneCurve<{ exposure: number; toneCurve?: ToneCurveSettings }>({ exposure: 1, toneCurve: tc({ rgb: S2 }) }, undefined)
    expect('toneCurve' in s).toBe(false)
    expect(withToneCurve<{ exposure: number; toneCurve?: ToneCurveSettings }>({ exposure: 1 }, tc({ rgb: S2 })).toneCurve?.rgb).toEqual(S2)
  })

  it('stores points sorted, within 0…1, apart and at most 16', () => {
    expect(normalizePoints([[1, 1], [0.5, 1.2], [0, -0.1]])).toEqual([[0, 0], [0.5, 1], [1, 1]])
    expect(normalizePoints([[0, 0], [0.5, 0.5], [0.501, 0.7], [1, 1]])).toEqual([[0, 0], [0.5, 0.5], [1, 1]])
    expect(normalizePoints(Array.from({ length: 30 }, (_, i) => [i / 29, i / 29]))!.length).toBe(16)
    expect(normalizePoints([[0.5, 0.5]])).toBeNull()
    expect(normalizePoints('x')).toBeNull()
  })

  it('scales the curve’s deviation from linear by the Amount', () => {
    const p = tc({ rgb: S2, regions: { ...DEFAULT_TONE_CURVE.regions, shadows: 40 }, saturation: 60 })
    const half = blendToneCurve(undefined, p, 0.5)!
    const fp = curveFunction(p.rgb)
    const fh = curveFunction(half.rgb)
    for (const x of [0.1, 0.25, 0.6, 0.9]) expect(fh(x) - x).toBeCloseTo((fp(x) - x) / 2, 2)
    expect(half.regions.shadows).toBe(20)
    expect(half.saturation).toBe(80)
    const twice = blendToneCurve(undefined, p, 2)!
    expect(curveFunction(twice.rgb)(0.25) - 0.25).toBeCloseTo(2 * (fp(0.25) - 0.25), 2)
    expect(blendToneCurve(undefined, p, 0)).toBeUndefined()
    expect(blendToneCurve(undefined, p, 1)).toBe(p)
    // From a photo's own curve towards the preset's.
    const own = tc({ rgb: CURVE_PRESETS[3].points })
    const mid = blendToneCurve(own, p, 0.5)!
    const fo = curveFunction(own.rgb)
    expect(curveFunction(mid.rgb)(0.25)).toBeCloseTo((fo(0.25) + fp(0.25)) / 2, 2)
    // The brightness measure: a preset's own above 0 %; the default (Largest channel) when the preset has no curve.
    expect(blendToneCurve(undefined, p, 0.5)!.norm).toBe('max')
    expect(blendToneCurve(undefined, { ...p, norm: 'power' }, 0.5)!.norm).toBe('power')
    expect(blendToneCurve({ ...own, norm: 'luminance' }, undefined, 0.5)!.norm).toBe('max')
  })
})

const S2: CurvePoint[] = [
  [0, 0],
  [0.25, 0.2],
  [0.75, 0.8],
  [1, 1],
]
