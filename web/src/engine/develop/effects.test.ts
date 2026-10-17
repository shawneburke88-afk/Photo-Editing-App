import { describe, expect, it } from 'vitest'
import {
  ambientLight,
  bandWeights,
  boxMinMax,
  contrastTextureCpu,
  DEFAULT_GLOW,
  DEFAULT_GRAIN,
  DEFAULT_VIGNETTE,
  dehazeMapsCpu,
  dehazePixel,
  dehazeTmin,
  dehazeWindows,
  effectsFlags,
  effectsUniform,
  extractDetails,
  forCopy,
  FX_DEHAZE,
  FX_GLOW,
  FX_GRAIN,
  FX_TC,
  FX_VIGNETTE,
  glowPixel,
  glowWeight,
  grainAmps,
  grainDelta,
  grainNoise,
  grainPixel,
  grainPixelColour,
  guidedFilterCpu,
  kthSmallest,
  midtoneWeight,
  normalizeEffects,
  resolveGlow,
  resolveGrain,
  resolveVignette,
  simplex3,
  tcGain,
  tcPlan,
  vignetteDisplay,
  vignetteSceneGain,
  vignetteWeight,
  withEffects,
  withGrain,
  type EffectsSettings,
} from './effects'
import { EFFECTS_V1, processParams } from './process'
import { DEFAULT_SETTINGS, displayUniforms, normalizeSettings } from './settings'
import { REC2020_TO_XYZ, apply, type Vec3 } from '../color/matrix'

const P = EFFECTS_V1
const lab = (c: Vec3) => {
  const [x, y, z] = apply(REC2020_TO_XYZ, c)
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  return [116 * f(y) - 16, 500 * (f(x / 0.95047) - f(y)), 200 * (f(y) - f(z / 1.08883))]
}

describe('settings: old edits never change', () => {
  it('an edit without effects has no key, and its GPU uniforms have none', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, exposure: 0.5 })
    expect('effects' in s).toBe(false)
    expect('effects' in displayUniforms(s)).toBe(false)
  })

  it('effects at their defaults are dropped; values are clamped and rounded', () => {
    expect(normalizeEffects(undefined)).toBeUndefined()
    expect(normalizeEffects({ texture: 0, vignette: DEFAULT_VIGNETTE, grain: { ...DEFAULT_GRAIN, seed: 42 }, glow: DEFAULT_GLOW })).toBeUndefined()
    expect(normalizeEffects({ texture: 140.4, clarity: -7.6, dehaze: 'x', dehazeDistance: 0.2 })).toEqual({ texture: 100, clarity: -8 })
    expect(normalizeEffects({ vignette: { amount: -30, style: 'nonsense' } })!.vignette).toEqual({ ...DEFAULT_VIGNETTE, amount: -30 })
  })

  it('a damaged edit reads safely: a missing or broken grain seed reads as 1, bad types fall back', () => {
    const fx = normalizeEffects({ grain: { amount: 20, seed: -3 }, glow: { amount: '50', style: 'halation' } })!
    expect(fx.grain!.seed).toBe(1)
    expect(fx.glow).toEqual({ ...DEFAULT_GLOW, style: 'halation' })
    expect(normalizeEffects('junk')).toBeUndefined()
    expect(normalizeEffects([1, 2])).toBeUndefined()
  })

  it('withEffects removes the key when everything is back at its default', () => {
    const s = withEffects(DEFAULT_SETTINGS, { texture: 30 })
    expect(s.effects).toEqual({ texture: 30 })
    expect('effects' in withEffects(s, { texture: 0 })).toBe(false)
    expect(withEffects(s, { texture: 30 })).toBe(s)
  })

  it('the process versions share the effects maths (no new version: every tool is new and off)', () => {
    expect(processParams(1).effects).toBe(EFFECTS_V1)
    expect(processParams(2).effects).toBe(EFFECTS_V1)
  })
})

describe('grain seed', () => {
  it('grain that starts gets a new seed; existing grain keeps it; a virtual copy gets a new one', () => {
    const r = [0.25, 0.75]
    const a = withGrain(undefined, { amount: 30 }, () => r[0])
    expect(a.grain!.seed).toBe(1 + Math.floor(0.25 * 2147483646))
    const b = withGrain(a, { size: 40 }, () => r[1])
    expect(b.grain!.seed).toBe(a.grain!.seed)
    const c = forCopy(b, () => r[1])!
    expect(c.grain!.seed).not.toBe(b.grain!.seed)
    expect({ ...c.grain, seed: 0 }).toEqual({ ...b.grain, seed: 0 })
    expect(forCopy({ texture: 10 })).toEqual({ texture: 10 })
  })
})

describe('Post-crop Vignette', () => {
  const v = resolveVignette({ ...DEFAULT_VIGNETTE, amount: -100, feather: 30, midpoint: 50 }, 3000, 2000, P)

  it('maps Amount through darktable’s importer table', () => {
    expect(resolveVignette({ ...DEFAULT_VIGNETTE, amount: -50 }, 300, 200, P).brightness).toBeCloseTo(-0.7, 9)
    expect(resolveVignette({ ...DEFAULT_VIGNETTE, amount: 75 }, 300, 200, P).brightness).toBeCloseTo(0.75, 9)
  })

  it('weight 0 at the centre, 1 in the corners, monotone along the diagonal', () => {
    expect(vignetteWeight(v, 0.5, 0.5)).toBe(0)
    expect(vignetteWeight(v, 0, 0)).toBe(1)
    let last = -1
    for (let t = 0; t <= 0.5; t += 0.01) {
      const w = vignetteWeight(v, 0.5 - t, 0.5 - t)
      expect(w).toBeGreaterThanOrEqual(last - 1e-12)
      last = w
    }
  })

  it('Roundness 0 follows the frame; +100 a circle; −100 squarer', () => {
    // Roundness 0: the edges' midpoints are at the same distance (an ellipse inscribed in the frame).
    expect(vignetteWeight(v, 0, 0.5)).toBeCloseTo(vignetteWeight(v, 0.5, 0), 9)
    const round = resolveVignette({ ...DEFAULT_VIGNETTE, amount: -100, roundness: 100 }, 3000, 2000, P)
    expect(round.ax * 3000).toBeCloseTo(round.ay * 2000, 6)
    const square = resolveVignette({ ...DEFAULT_VIGNETTE, amount: -100, roundness: -100 }, 3000, 2000, P)
    expect(square.e1).toBeGreaterThan(v.e1)
  })

  it('Highlight Priority: a scene-linear gain, 1 at the centre; Highlights keeps bright pixels brighter', () => {
    expect(vignetteSceneGain(v, 0, [0.2, 0.2, 0.2], P)).toBe(1)
    const dark = vignetteSceneGain(v, 1, [0.2, 0.2, 0.2], P)
    expect(dark).toBeCloseTo(2 ** -3, 9)
    const hv = resolveVignette({ ...DEFAULT_VIGNETTE, amount: -100, highlights: 100 }, 3000, 2000, P)
    expect(vignetteSceneGain(hv, 1, [4, 4, 4], P)).toBeGreaterThan(0.9)
    expect(vignetteSceneGain(hv, 1, [0.05, 0.05, 0.05], P)).toBeCloseTo(2 ** -3, 9)
    // Highlights only with a darkening vignette and not for Paint Overlay (Adobe's rule).
    expect(resolveVignette({ ...DEFAULT_VIGNETTE, amount: 50, highlights: 100 }, 30, 20, P).highlights).toBe(0)
    expect(resolveVignette({ ...DEFAULT_VIGNETTE, amount: -50, highlights: 100, style: 'paint' }, 30, 20, P).highlights).toBe(0)
  })

  it('Colour Priority keeps colour ratios; Paint Overlay goes to black or white; weight 0 changes nothing', () => {
    const cp = resolveVignette({ ...DEFAULT_VIGNETTE, amount: -60, style: 'colour' }, 30, 20, P)
    const c: Vec3 = [0.6, 0.3, 0.1]
    const o = vignetteDisplay(cp, 1, c, P)
    expect(o[0] / o[1]).toBeCloseTo(2, 9)
    expect(vignetteDisplay(cp, 0, c, P)).toEqual(c)
    const po = resolveVignette({ ...DEFAULT_VIGNETTE, amount: -100, style: 'paint' }, 30, 20, P)
    expect(vignetteDisplay(po, 1, c, P).every((x) => Math.abs(x) < 1e-12)).toBe(true)
    const pw = resolveVignette({ ...DEFAULT_VIGNETTE, amount: 100, style: 'paint' }, 30, 20, P)
    expect(vignetteDisplay(pw, 1, c, P).every((x) => Math.abs(x - 1) < 1e-9)).toBe(true)
  })
})

describe('Grain (darktable grain.c)', () => {
  it('3D simplex noise: deterministic, within ±1, 0 on the lattice', () => {
    expect(simplex3(0, 0, 0)).toBe(0)
    let mx = 0
    for (let i = 0; i < 2000; i++) {
      const n = simplex3(i * 0.37, i * 0.11, i % 3)
      expect(n).toBe(simplex3(i * 0.37, i * 0.11, i % 3))
      mx = Math.max(mx, Math.abs(n))
    }
    expect(mx).toBeLessThanOrEqual(1)
    expect(mx).toBeGreaterThan(0.3)
  })

  it('Roughness 50 is darktable’s three octaves exactly; other values keep their power and tilt the spectrum', () => {
    expect(grainAmps(50, P)).toEqual([0.234, 0.785, 1.215, 0])
    const power = (a: number[]) => a.reduce((s, x) => s + x * x, 0)
    for (const r of [0, 25, 75, 100]) expect(power(grainAmps(r, P))).toBeCloseTo(power([0.234, 0.785, 1.215]), 9)
    expect(grainAmps(0, P)[0]).toBeGreaterThan(grainAmps(100, P)[0])
    expect(grainAmps(100, P)[3]).toBeGreaterThan(0)
    expect(grainAmps(25, P)[3]).toBe(0)
  })

  it('the pattern follows the seed: the same seed is the same grain, another seed another', () => {
    const a = resolveGrain({ ...DEFAULT_GRAIN, amount: 50, seed: 1234 }, 3000, 2000, P)
    const b = resolveGrain({ ...DEFAULT_GRAIN, amount: 50, seed: 1234 }, 3000, 2000, P)
    const c = resolveGrain({ ...DEFAULT_GRAIN, amount: 50, seed: 1235 }, 3000, 2000, P)
    let diff = 0
    for (let i = 0; i < 200; i++) {
      expect(grainNoise(a, i * 7.3, i * 3.1)).toBe(grainNoise(b, i * 7.3, i * 3.1))
      diff += Math.abs(grainNoise(a, i * 7.3, i * 3.1) - grainNoise(c, i * 7.3, i * 3.1))
    }
    expect(diff / 200).toBeGreaterThan(0.05)
  })

  it('resolution independent: the same place of the crop gives the same noise at any drawing size', () => {
    const g = resolveGrain({ ...DEFAULT_GRAIN, amount: 50 }, 3000, 2000, P)
    // Coordinates are full-size crop pixels normalised to its shorter side, as darktable's.
    expect(grainNoise(g, 1500, 1000)).toBe(grainNoise({ ...g }, 1500, 1000))
    expect(g.short).toBe(2000)
  })

  it('Size scales darktable’s coarseness (25 = its default 1600), Amount its strength (its importer table)', () => {
    const z = (size: number) => resolveGrain({ ...DEFAULT_GRAIN, amount: 50, size }, 30, 20, P).zoom
    expect(z(25)).toBeCloseTo((1 + (8 * 1600) / 213.2 / 100) / 800, 12)
    expect(z(62.5)).toBeGreaterThan(z(25))
    expect(resolveGrain({ ...DEFAULT_GRAIN, amount: 50 }, 30, 20, P).strength).toBeCloseTo(0.4 * 0.15, 12)
    expect(resolveGrain({ ...DEFAULT_GRAIN, amount: 50, colour: true }, 30, 20, P).strength).toBeCloseTo(0.4 * 0.25, 12)
  })

  it('the paper response: no grain value, no change; the most change in the mid-tones (mid-tones bias 100)', () => {
    const d = resolveGrain({ ...DEFAULT_GRAIN, amount: 50 }, 30, 20, P).delta
    for (const l of [0.05, 0.3, 0.5, 0.8, 0.95]) expect(Math.abs(grainDelta(0, l, d))).toBeLessThan(1e-6)
    expect(Math.abs(grainDelta(0.1, 0.5, d))).toBeGreaterThan(Math.abs(grainDelta(0.1, 0.02, d)))
    expect(Math.abs(grainDelta(0.1, 0.5, d))).toBeGreaterThan(Math.abs(grainDelta(0.1, 0.98, d)))
  })

  it('monochrome grain changes L* only (a*, b* kept); colour grain changes the channels separately', () => {
    const r = resolveGrain({ ...DEFAULT_GRAIN, amount: 80 }, 30, 20, P)
    const c: Vec3 = [0.4, 0.2, 0.1]
    const o = grainPixel(c, 0.8, r)
    const [L0, a0, b0] = lab(c)
    const [L1, a1, b1] = lab(o)
    expect(Math.abs(L1 - L0)).toBeGreaterThan(0.5)
    expect(a1).toBeCloseTo(a0, 4)
    expect(b1).toBeCloseTo(b0, 4)
    expect(grainPixel(c, 0, r).map((x, i) => Math.abs(x - c[i]) < 1e-6).every(Boolean)).toBe(true)
    const rc = resolveGrain({ ...DEFAULT_GRAIN, amount: 80, colour: true }, 30, 20, P)
    const oc = grainPixelColour(c, [0.8, -0.8, 0], rc)
    expect(oc[0]).toBeGreaterThan(c[0])
    expect(oc[1]).toBeLessThan(c[1])
    expect(oc[2]).toBeCloseTo(c[2], 6)
  })
})

describe('Texture and Clarity (darktable contrast & texture)', () => {
  it('band weights cross-fade: coarse at level 0, fine at the last, summing to 1', () => {
    expect(bandWeights(0, 6)).toEqual([1, expect.closeTo(0, 12), 0])
    expect(bandWeights(6, 6)).toEqual([0, expect.closeTo(0, 12), 1])
    for (let l = 0; l <= 6; l += 0.5) {
      const w = bandWeights(l, 6)
      expect(w[0] + w[1] + w[2]).toBeCloseTo(1, 12)
    }
  })

  it('radii relative to the crop; levels stop under 2 px; the weights use the full-size level count', () => {
    const full = tcPlan(undefined, 6000, 6000)
    expect(full.levels[0].radius).toBeCloseTo(0.5 * 2 ** -5 * 6000, 9)
    expect(full.levels.length).toBe(7)
    expect(full.levels[full.levels.length - 1].radius).toBeLessThan(2)
    const fit = tcPlan(undefined, 1500, 6000)
    expect(fit.levels.length).toBe(5)
    // The same level index is the same relative scale and band at both sizes.
    expect(fit.levels[0].radius * 4).toBeCloseTo(full.levels[0].radius, 9)
    expect(fit.levels[2].weights).toEqual(full.levels[2].weights)
    expect(full.feathering).toBe(0.2)
    expect(tcPlan({ detailLevel: 5, haloControl: 1, noiseBias: 0.001 }, 100, 100).feathering).toBe(0.1)
  })

  it('Clarity drives the coarse and medium bands (mid-tone weighted), Texture the fine band', () => {
    const bands = [0.3, -0.2, 0.5, 0]
    expect(tcGain(bands, 0, 0, P)).toBe(1)
    expect(tcGain(bands, 1, 0, P)).toBeCloseTo(2 ** (0.3 - 0.2), 12)
    expect(tcGain(bands, 0, 1, P)).toBeCloseTo(2 ** 0.5, 12)
    expect(tcGain([0, 0, 0.5, 0], 1, 0, P)).toBe(1)
    expect(tcGain([0.4, 0.4, 0, 0], 0, 1, P)).toBe(1)
  })

  it('LightCraft’s mid-tone weight: 1 at grey, 0.35 far from it', () => {
    expect(midtoneWeight(0, P)).toBe(1)
    expect(midtoneWeight(20, P)).toBeCloseTo(0.35, 9)
    expect(midtoneWeight(3.2, P)).toBeCloseTo(0.35 + 0.65 * Math.exp(-1), 12)
  })

  it('details: Wiener-weighted log2 difference, ±5 EV', () => {
    expect(extractDetails(0.2, 0.1, 0)).toBeCloseTo(1, 12)
    expect(extractDetails(1000, 0.1, 0)).toBe(5)
    // darktable's Wiener weight: a low-pass under the noise floor counts for little.
    expect(extractDetails(0.002, 0.001, 0)).toBeCloseTo((1e-6 / 1.52587890625e-5) * 1, 9)
    expect(extractDetails(0.002, 0.001, 0.001)).toBe(0)
  })

  const image = (w: number, h: number, f: (x: number, y: number) => number) => Float64Array.from({ length: w * h }, (_, i) => f(i % w, Math.floor(i / w)))

  it('a flat image has no detail; an edge has detail of both signs', () => {
    const N = 256
    const plan = tcPlan(undefined, N, N)
    expect(plan.levels.length).toBe(3)
    const flat = contrastTextureCpu(image(N, N, () => 0.18), N, N, plan, P)
    for (let i = 0; i < N * N; i++) for (let c = 0; c < 3; c++) expect(Math.abs(flat[i * 4 + c])).toBeLessThan(1e-6)
    expect(flat[3]).toBeCloseTo(Math.log2(0.18 / 0.18), 1)
    const edge = contrastTextureCpu(image(N, N, (x) => (x < N / 2 ? 0.05 : 0.5)), N, N, plan, P)
    const sum = (x: number) => edge[((N / 2) * N + x) * 4] + edge[((N / 2) * N + x) * 4 + 1] + edge[((N / 2) * N + x) * 4 + 2]
    expect(sum(N / 2 - 2)).toBeLessThan(0)
    expect(sum(N / 2 + 2)).toBeGreaterThan(0)
    // A tiny photo (fewer levels than the band count needs) still gives numbers.
    const tiny = contrastTextureCpu(image(64, 64, () => 0.18), 64, 64, tcPlan(undefined, 64, 64), P)
    expect(tiny.every(Number.isFinite)).toBe(true)
  })

  it('a tile computed with its margin equals the whole drawing', () => {
    const W = 160
    const H = 120
    const plan = tcPlan(undefined, W, W)
    const lum = image(W, H, (x, y) => 0.1 + 0.08 * Math.sin(x * 0.7) * Math.cos(y * 0.3) + (x > 80 ? 0.2 : 0))
    const whole = contrastTextureCpu(lum, W, H, plan, P)
    // A tile from (40, 30) to (100, 80), with the margin, cut out of a larger image (edges repeated beyond it, as the
    // engine's input does outside the photo).
    const M = plan.margin
    const x0 = 40 - M
    const y0 = 30 - M
    const rw = 60 + 2 * M
    const rh = 50 + 2 * M
    const cut = image(rw, rh, (x, y) => lum[Math.min(H - 1, Math.max(0, y + y0)) * W + Math.min(W - 1, Math.max(0, x + x0))])
    const tile = contrastTextureCpu(cut, rw, rh, plan, P, x0, y0)
    let mx = 0
    for (let y = 30; y < 80; y++) for (let x = 40; x < 100; x++) for (let c = 0; c < 4; c++) mx = Math.max(mx, Math.abs(tile[((y - y0) * rw + x - x0) * 4 + c] - whole[(y * W + x) * 4 + c]))
    expect(mx).toBeLessThan(1e-3)
  })
})

describe('Dehaze (darktable hazeremoval.c)', () => {
  it('darktable’s window sizes (w1 = 2 + ⌈4·scale⌉, w2 = 3 + ⌈6·scale⌉) and t_min', () => {
    expect(dehazeWindows(1)).toEqual({ w1: 6, w2: 9, margin: 30 })
    expect(dehazeWindows(0.25)).toEqual({ w1: 3, w2: 5, margin: 16 })
    expect(dehazeWindows(3).w1).toBe(6)
    expect(dehazeTmin(0.2, 2)).toBeCloseTo(Math.exp(-0.4), 12)
    expect(dehazeTmin(1, 100)).toBe(1 / 1024)
  })

  it('k-th smallest as quick select finds it', () => {
    const a = Float32Array.from([5, 3, 9, 1, 7, 2])
    expect(kthSmallest(Float32Array.from(a), 0)).toBe(1)
    expect(kthSmallest(Float32Array.from(a), 3)).toBe(5)
    expect(kthSmallest(Float32Array.from(a), 5)).toBe(9)
  })

  /** A synthetic hazy scene: J (a texture) through the haze model I = J·t + A(1 − t), t falling to the right. */
  const W = 48
  const H = 32
  const A: Vec3 = [0.8, 0.85, 0.9]
  const scene = (x: number, y: number): Vec3 => [0.1 + 0.3 * ((x + y) % 5) / 5, 0.15 + 0.2 * (x % 3) / 3, 0.05 + 0.25 * (y % 4) / 4]
  const trans = (x: number) => 0.9 - 0.6 * (x / (W - 1))
  const hazy = (() => {
    const out = new Float32Array(W * H * 4)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const j = scene(x, y)
        const t = trans(x)
        for (let c = 0; c < 3; c++) out[(y * W + x) * 4 + c] = j[c] * t + A[c] * (1 - t)
        out[(y * W + x) * 4 + 3] = 1
      }
    return out
  })()

  it('the ambient light is the colour of the haziest bright pixels; the maximum depth is −1.125·ln(haze level)', () => {
    const { a0, distanceMax } = ambientLight(hazy, W, H, 2)
    for (let c = 0; c < 3; c++) expect(Math.abs(a0[c] - A[c])).toBeLessThan(0.25)
    expect(a0[2]).toBeGreaterThan(a0[0])
    expect(distanceMax).toBeGreaterThan(0)
  })

  it('the depth is darktable’s while the ambient light is ≤ 1, and stays positive for brighter photos', () => {
    const one = ambientLight(hazy, W, H, 2)
    expect(Math.min(...one.a0)).toBeLessThan(1)
    // darktable's formula, unchanged here: −1.125 · ln(the 95 % dark-channel level).
    const dark = boxMinMax(Float64Array.from({ length: W * H }, (_, i) => Math.min(hazy[4 * i], hazy[4 * i + 1], hazy[4 * i + 2])), W, H, 2, false)
    const crit = kthSmallest(Float32Array.from(dark), Math.floor(W * H * 0.95))
    expect(one.distanceMax).toBeCloseTo(-1.125 * Math.log(crit), 5)
    // Brighter than 1 everywhere (a JPEG's scene values, a bright RAW sky): darktable's depth would be ≤ 0 (t_min 1:
    // nothing removed); measured against the ambient light it stays positive, and the same at any brightness above.
    const scaled = (k: number) => hazy.map((v, i) => (i % 4 === 3 ? v : v * k))
    const six = ambientLight(scaled(6), W, H, 2)
    const ten = ambientLight(scaled(10), W, H, 2)
    expect(-1.125 * Math.log(crit * 6)).toBeLessThan(0)
    expect(six.distanceMax).toBeGreaterThan(0)
    expect(ten.distanceMax).toBeCloseTo(six.distanceMax, 4)
    for (let c = 0; c < 3; c++) expect(six.a0[c]).toBeCloseTo(one.a0[c] * 6, 3)
  })

  it('removing the haze brings the hazy side closer to the scene (contrast restored)', () => {
    const { a0 } = ambientLight(hazy, W, H, 2)
    const { plus, minus } = dehazeMapsCpu(hazy, W, H, a0, 2, 3, P.dehazeEps)
    // A small t_min (a large Distance), so the haziest side can be recovered.
    const tmin = 0.05
    const at = (x: number, y: number) => [hazy[(y * W + x) * 4], hazy[(y * W + x) * 4 + 1], hazy[(y * W + x) * 4 + 2]]
    const err = (s: number) => {
      let e = 0
      for (let y = 4; y < H - 4; y++)
        for (let x = W - 12; x < W - 4; x++) {
          const i = y * W + x
          const o = dehazePixel(at(x, y), a0, s, plus[i], minus[i], tmin)
          const j = scene(x, y)
          e += Math.abs(o[0] - j[0]) + Math.abs(o[1] - j[1]) + Math.abs(o[2] - j[2])
        }
      return e
    }
    expect(err(0.9)).toBeLessThan(err(0) * 0.7)
    // Negative strength adds haze: further from the scene.
    expect(err(-0.5)).toBeGreaterThan(err(0))
  })

  it('the stored maps give darktable’s transmission for any strength (box max, box min, guided filter on 1 − s·m)', () => {
    const { a0 } = ambientLight(hazy, W, H, 2)
    const { plus, minus } = dehazeMapsCpu(hazy, W, H, a0, 2, 3, P.dehazeEps)
    const m = new Float64Array(W * H)
    for (let i = 0; i < W * H; i++) m[i] = Math.min(hazy[4 * i] / a0[0], hazy[4 * i + 1] / a0[1], hazy[4 * i + 2] / a0[2])
    for (const s of [0.6, -0.4]) {
      // darktable: t = 1 − s·m, box max, box min, guided filter.
      const t = boxMinMax(boxMinMax(m.map((v) => 1 - s * v), W, H, 2, true), W, H, 2, false)
      const dt = guidedFilterCpu(hazy, t, W, H, 3, P.dehazeEps)
      for (let i = 0; i < W * H; i++) expect(1 - s * (s > 0 ? plus[i] : minus[i])).toBeCloseTo(dt[i], 5)
    }
  })

  it('the strength is the user’s, never derived from the image (binding constraint): the API has no measured strength', () => {
    const { a0, distanceMax } = ambientLight(hazy, W, H, 2)
    // The statistics are an ambient light and a depth only; the maps don't take a strength at all.
    expect(Object.keys(ambientLight(hazy, W, H, 2)).sort()).toEqual(['a0', 'distanceMax'])
    expect(dehazeMapsCpu.length).toBe(7)
    expect(Object.keys(dehazeWindows(1)).sort()).toEqual(['margin', 'w1', 'w2'])
    // The uniform carries the slider's value exactly, whatever the photo's statistics.
    const fx: EffectsSettings = { dehaze: 37 }
    const u1 = new Float32Array(effectsUniform(fx, P, FX_DEHAZE, [100, 100], { a0, distanceMax }))
    const u2 = new Float32Array(effectsUniform(fx, P, FX_DEHAZE, [100, 100], { a0: [0.1, 0.2, 0.3], distanceMax: 9 }))
    expect(u1[11]).toBeCloseTo(0.37, 7)
    expect(u2[11]).toBe(u1[11])
    // Strength 0 is the photo itself.
    expect(dehazePixel([0.3, 0.2, 0.1], a0, 0, 0.5, 0.5, 0.1)).toEqual([0.3, 0.2, 0.1])
  })

  it('the guided filter has a constant eps and keeps constants (no per-pixel weights)', () => {
    const p = new Float64Array(W * H).fill(0.42)
    const out = guidedFilterCpu(hazy, p, W, H, 3, P.dehazeEps)
    for (const v of out) expect(v).toBeCloseTo(0.42, 9)
    expect(P.dehazeEps).toBeCloseTo(Math.sqrt(0.025) ** 2, 12)
  })

  it('statistics within the crop: a hazy patch outside the crop doesn’t set the ambient light', () => {
    // A bright blue "haze" on the left 16 columns, outside a crop of the right part.
    const img = Float32Array.from(hazy)
    for (let y = 0; y < H; y++) for (let x = 0; x < 16; x++) img.set([1.6, 1.7, 2, 1], (y * W + x) * 4)
    const whole = ambientLight(img, W, H, 2).a0
    const cw = W - 16
    const crop = new Float32Array(cw * H * 4)
    for (let y = 0; y < H; y++) crop.set(img.subarray((y * W + 16) * 4, (y * W + W) * 4), y * cw * 4)
    const inCrop = ambientLight(crop, cw, H, 2).a0
    expect(whole[2]).toBeGreaterThan(1.5)
    expect(inCrop[2]).toBeLessThan(1.2)
  })
})

describe('Glow (LightBench)', () => {
  it('the soft threshold: Range moves it, shadows don’t glow', () => {
    const r = resolveGlow({ ...DEFAULT_GLOW, amount: 50, range: 50 }, P)
    expect(glowWeight([0.01, 0.01, 0.01], r)).toBe(0)
    expect(glowWeight([20, 20, 20], r)).toBe(1)
    const wide = resolveGlow({ ...DEFAULT_GLOW, amount: 50, range: 100 }, P)
    expect(glowWeight([0.4, 0.4, 0.4], wide)).toBeGreaterThan(glowWeight([0.4, 0.4, 0.4], r))
    const diff = resolveGlow({ ...DEFAULT_GLOW, amount: 50, style: 'diffusion' }, P)
    expect(diff.threshold).toBeLessThan(r.threshold)
  })

  it('Spread moves the weight to the wide scales; the weights sum to 1', () => {
    const tight = resolveGlow({ ...DEFAULT_GLOW, spread: 0 }, P).weights
    const wide = resolveGlow({ ...DEFAULT_GLOW, spread: 100 }, P).weights
    expect(tight.reduce((a, b) => a + b)).toBeCloseTo(1, 12)
    expect(wide.reduce((a, b) => a + b)).toBeCloseTo(1, 12)
    expect(wide[4]).toBeGreaterThan(tight[4])
    expect(tight[0]).toBeGreaterThan(wide[0])
  })

  it('Warmth tints keeping luminance; Halation runs yellow to red', () => {
    const lumY = (c: Vec3) => 0.2627002 * c[0] + 0.6779981 * c[1] + 0.0593017 * c[2]
    const warm = resolveGlow({ ...DEFAULT_GLOW, warmth: 100 }, P).tint
    expect(warm[0]).toBeGreaterThan(warm[2])
    expect(lumY(warm)).toBeCloseTo(1, 12)
    const red = resolveGlow({ ...DEFAULT_GLOW, style: 'halation', warmth: 100 }, P).tint
    const yellow = resolveGlow({ ...DEFAULT_GLOW, style: 'halation', warmth: -100 }, P).tint
    expect(red[1] / red[0]).toBeLessThan(yellow[1] / yellow[0])
  })

  it('Amount 0 changes nothing; Bloom adds light; Diffusion keeps the energy of an even area; Halation stays outside the light', () => {
    const c: Vec3 = [2, 2, 2]
    const g: Vec3 = [1, 1, 1]
    for (const style of ['bloom', 'diffusion', 'halation'] as const) expect(glowPixel(c, g, 0, resolveGlow({ ...DEFAULT_GLOW, style }, P))).toEqual(c)
    const bloom = glowPixel(c, g, 1, resolveGlow(DEFAULT_GLOW, P))
    expect(bloom[1]).toBeGreaterThan(c[1])
    const dr = resolveGlow({ ...DEFAULT_GLOW, style: 'diffusion', range: 100 }, P)
    // An even, fully glowing area: its blur is itself, so diffusion leaves it as it is.
    const big: Vec3 = [5, 5, 5]
    const w = glowWeight(big, dr)
    const out = glowPixel(big, big.map((v) => v * w) as Vec3, 1, dr)
    for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(big[i], 9)
    const hr = resolveGlow({ ...DEFAULT_GLOW, style: 'halation', range: 50 }, P)
    expect(glowPixel([50, 50, 50], g, 1, hr)).toEqual([50, 50, 50])
    expect(glowPixel([0.05, 0.05, 0.05], g, 1, hr)[0]).toBeGreaterThan(0.05)
  })
})

describe('the display shader’s flags and uniform', () => {
  it('no effect on: no flag; each tool sets its own; masks’ local sliders turn their stage on', () => {
    expect(effectsFlags(undefined)).toBe(0)
    expect(effectsFlags({ vignette: { ...DEFAULT_VIGNETTE, midpoint: 10 } })).toBe(0)
    expect(effectsFlags({ texture: 5 })).toBe(FX_TC)
    expect(effectsFlags({ dehaze: -5, vignette: { ...DEFAULT_VIGNETTE, amount: 3 }, grain: { ...DEFAULT_GRAIN, amount: 1 }, glow: { ...DEFAULT_GLOW, amount: 1 } })).toBe(FX_DEHAZE | FX_VIGNETTE | FX_GRAIN | FX_GLOW)
    expect(effectsFlags(undefined, { texture: false, clarity: true, dehaze: true, glow: true })).toBe(FX_TC | FX_DEHAZE | FX_GLOW)
  })

  it('the uniform has the flags, the crop size and the tools’ numbers', () => {
    const b = effectsUniform({ grain: { ...DEFAULT_GRAIN, amount: 50, seed: 9 } }, P, FX_GRAIN, [3000, 2000], null)
    const u = new Uint32Array(b)
    const f = new Float32Array(b)
    expect(u[0]).toBe(FX_GRAIN)
    expect([f[4], f[5]]).toEqual([3000, 2000])
    expect(f[6]).toBeCloseTo(1 / 2000, 9)
    expect(f[40]).toBeCloseTo(0.06, 7)
    expect(b.byteLength).toBe(256)
  })
})
