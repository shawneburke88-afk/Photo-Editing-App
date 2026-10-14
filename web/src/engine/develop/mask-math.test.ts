import { describe, expect, it } from 'vitest'
import {
  applyDab, applyLocalContrast, applyLocalWb, brushFalloff, colourWeight, combine, erf, featherCpu, featherPlan, filterMargin, guideValue, linearAlpha, lstar, measured, oklab,
  radialAlpha, refineCpu, refinePlan, REC2020_Y, trapezoid,
} from './mask-math'
import { MASKS_V1 } from './process'
import type { Mat3 } from '../color/matrix'

// The mask maths (PHASE3.md Part 23): darktable's falloffs and combine operators, the range masks, the local sliders,
// Feather and Refine (the CPU twin of mask.wgsl and develop-display.wgsl).

const luma = (c: number[]) => REC2020_Y[0] * c[0] + REC2020_Y[1] * c[1] + REC2020_Y[2] * c[2]

describe('falloffs', () => {
  it('erf matches known values', () => {
    expect(erf(0)).toBeCloseTo(0, 6)
    expect(erf(0.5)).toBeCloseTo(0.5204999, 6)
    expect(erf(1)).toBeCloseTo(0.8427008, 6)
    expect(erf(-1)).toBeCloseTo(-0.8427008, 6)
  })

  it('linear gradient: 0 at the Zero line, 1 at the Full line, ½ halfway, monotone, flat beyond', () => {
    const k = MASKS_V1.gradientK
    expect(linearAlpha(0, k)).toBe(0)
    expect(linearAlpha(1, k)).toBe(1)
    expect(linearAlpha(-3, k)).toBe(0)
    expect(linearAlpha(5, k)).toBe(1)
    expect(linearAlpha(0.5, k)).toBeCloseTo(0.5, 6)
    expect(linearAlpha(1e-6, k)).toBeLessThan(1e-3)
    let prev = 0
    for (let t = 0; t <= 1; t += 0.01) {
      const a = linearAlpha(t, k)
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = a
    }
  })

  it('radial gradient: darktable’s quadratic falloff, full inside the feather, 0 on and outside the ellipse', () => {
    expect(radialAlpha(0, 0.5)).toBe(1)
    expect(radialAlpha(0.5, 0.5)).toBe(1)
    expect(radialAlpha(1, 0.5)).toBe(0)
    expect(radialAlpha(1.4, 0.5)).toBe(0)
    // (1 − ρ²) / (1 − inner²) squared, darktable's circle.c with total = 1.
    const rho = 0.75
    const f = (1 - rho * rho) / (1 - 0.25)
    expect(radialAlpha(rho, 0.5)).toBeCloseTo(f * f, 9)
    // Feather 0: a hard edge.
    expect(radialAlpha(0.99, 0)).toBe(1)
    expect(radialAlpha(1, 0)).toBe(0)
  })

  it('brush: solid core, linear falloff (darktable brush.c), and dabs build towards the density or erase', () => {
    expect(brushFalloff(0, 10, 0.5)).toBe(1)
    expect(brushFalloff(5, 10, 0.5)).toBe(1)
    expect(brushFalloff(7.5, 10, 0.5)).toBeCloseTo(0.5, 9)
    expect(brushFalloff(10, 10, 0.5)).toBe(0)
    let a = 0
    for (let i = 0; i < 50; i++) a = applyDab(a, 0.3, 0.6, false)
    expect(a).toBeCloseTo(0.6, 6)
    expect(applyDab(0.8, 1, 1, true)).toBe(0)
    expect(applyDab(0.8, 0.5, 1, true)).toBeCloseTo(0.4, 9)
  })
})

describe('combining and inverting', () => {
  it('uses darktable’s operators: add = max, intersect = min, subtract = a·(1 − c)', () => {
    expect(combine(0.3, 0.7, 'add')).toBe(0.7)
    expect(combine(0.3, 0.7, 'intersect')).toBe(0.3)
    expect(combine(0.8, 0.25, 'subtract')).toBeCloseTo(0.6, 9)
    expect(combine(0.8, 1, 'subtract')).toBe(0)
    expect(combine(0, 1, 'add')).toBe(1)
  })

  it('inverting a component before subtracting it intersects with it (Lightroom’s “Subtract + Invert”, for hard masks)', () => {
    for (const a of [0, 1]) for (const c of [0, 1]) expect(combine(a, 1 - c, 'subtract')).toBe(combine(a, c, 'intersect'))
  })
})

describe('range masks', () => {
  it('measure the photo after the white-balance fix and the exposure only', () => {
    const fix: Mat3 = [1.1, 0, 0, 0, 1, 0, 0, 0, 0.9]
    expect(measured([0.2, 0.3, 0.4], fix, 2)).toEqual([0.2 * 1.1 * 2, 0.3 * 2, 0.4 * 0.9 * 2].map((v) => expect.closeTo(v, 12)))
  })

  it('luminance: L* of the measured luminance through darktable’s trapezoid', () => {
    expect(lstar(1)).toBeCloseTo(100, 6)
    expect(lstar(0.18)).toBeCloseTo(49.5, 1)
    expect(lstar(4)).toBe(100)
    expect(lstar(0)).toBe(0)
    const r: [number, number, number, number] = [20, 40, 60, 80]
    expect(trapezoid(10, r)).toBe(0)
    expect(trapezoid(30, r)).toBeCloseTo(0.5, 9)
    expect(trapezoid(50, r)).toBe(1)
    expect(trapezoid(70, r)).toBeCloseTo(0.5, 9)
    expect(trapezoid(90, r)).toBe(0)
    expect(trapezoid(40, [40, 40, 60, 60])).toBe(1)
  })

  it('colour: OkLab distance to the samples, full within half the tolerance', () => {
    const white = oklab([1, 1, 1])
    expect(white[0]).toBeCloseTo(1, 3)
    expect(white[1]).toBeCloseTo(0, 3)
    expect(white[2]).toBeCloseTo(0, 3)
    const blue = oklab([0.05, 0.12, 0.45])
    const red = oklab([0.5, 0.05, 0.04])
    expect(colourWeight(blue, [blue], 50, MASKS_V1)).toBe(1)
    expect(colourWeight(red, [blue], 50, MASKS_V1)).toBe(0)
    // A slightly different blue counts; at Refine 0 less than at 100.
    const blue2 = oklab([0.06, 0.13, 0.43])
    expect(colourWeight(blue2, [blue], 100, MASKS_V1)).toBeGreaterThan(colourWeight(blue2, [blue], 0, MASKS_V1))
    // Several samples: the closest wins.
    expect(colourWeight(red, [blue, red], 50, MASKS_V1)).toBe(1)
  })
})

describe('local sliders', () => {
  it('Temp and Tint shift the colour and keep the luminance', () => {
    const c = [0.3, 0.35, 0.4]
    const warm = applyLocalWb(c, 50, 0, MASKS_V1)
    expect(warm[0] / warm[2]).toBeGreaterThan(c[0] / c[2])
    expect(luma(warm)).toBeCloseTo(luma(c), 9)
    const magenta = applyLocalWb(c, 0, 50, MASKS_V1)
    expect(magenta[1] / magenta[0]).toBeLessThan(c[1] / c[0])
    expect(luma(magenta)).toBeCloseTo(luma(c), 9)
    expect(applyLocalWb(c, 0, 0, MASKS_V1)).toEqual(c.map((v) => expect.closeTo(v, 12)))
  })

  it('Contrast is scene-referred about the 18.45 % fulcrum and keeps the colour’s ratios', () => {
    const grey = [0.1845, 0.1845, 0.1845]
    expect(luma(applyLocalContrast(grey, 0.5, 0.6, MASKS_V1))).toBeCloseTo(0.1845, 6)
    const bright = [0.6, 0.5, 0.4]
    const up = applyLocalContrast(bright, 0.5, 0.6, MASKS_V1)
    expect(luma(up)).toBeGreaterThan(luma(bright))
    expect(up[0] / up[2]).toBeCloseTo(bright[0] / bright[2], 9)
    const dark = [0.03, 0.03, 0.03]
    expect(luma(applyLocalContrast(dark, 0.5, 0.6, MASKS_V1))).toBeLessThan(luma(dark))
    expect(luma(applyLocalContrast(dark, -0.5, 0.6, MASKS_V1))).toBeGreaterThan(luma(dark))
  })
})

describe('Feather and Refine', () => {
  const W = 96
  const H = 64
  /** A hard-edged disc. */
  const disc = () => {
    const a = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = Math.hypot(x + 0.5 - 48, y + 0.5 - 32) < 16 ? 1 : 0
    return a
  }

  it('plans a reduced grid only for large filters, and a margin that covers them', () => {
    expect(featherPlan(0)).toBeNull()
    expect(featherPlan(3)).toEqual({ d: 1, sigma: 3, radius: 9 })
    expect(featherPlan(40)?.d).toBe(16)
    expect(featherPlan(40)!.sigma).toBeLessThanOrEqual(4)
    expect(refinePlan(0.2)).toBeNull()
    expect(refinePlan(3)).toEqual({ d: 1, radius: 3 })
    expect(refinePlan(30)?.d).toBe(8)
    expect(filterMargin(10, 0)).toBeGreaterThanOrEqual(30)
    expect(filterMargin(0, 12)).toBeGreaterThanOrEqual(24)
    expect(filterMargin(0, 0)).toBe(0)
  })

  it('feather softens an edge, keeps the inside and the far outside, and keeps the mask’s total', () => {
    const a = disc()
    const f = featherCpu(a, W, H, 3)
    expect(f[32 * W + 48]).toBeCloseTo(1, 3)
    expect(f[2 * W + 2]).toBeCloseTo(0, 3)
    const edge = f[32 * W + 48 + 16]
    expect(edge).toBeGreaterThan(0.2)
    expect(edge).toBeLessThan(0.8)
    const sum = (x: Float32Array) => x.reduce((s, v) => s + v, 0)
    expect(sum(f) / sum(a)).toBeCloseTo(1, 2)
  })

  it('feather on the reduced grid (large σ) stays smooth and bounded', () => {
    const f = featherCpu(disc(), W, H, 12)
    for (const v of f) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1 + 1e-6)
    }
    expect(f[32 * W + 48]).toBeGreaterThan(f[32 * W + 48 + 30])
  })

  it('refine turns a soft mask into one with the guide’s edge', () => {
    // The photo: bright on the left (x < 40), dark on the right. The mask: a soft ramp from x = 30 to 50.
    const guide = new Float32Array(W * H)
    const soft = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      guide[y * W + x] = x < 40 ? 0.9 : 0.2
      soft[y * W + x] = Math.min(1, Math.max(0, (50 - x) / 20))
    }
    const r = refineCpu(soft, guide, W, H, 6, MASKS_V1.refineEps)
    const at = (x: number) => r[32 * W + x]
    // The step across the photo's edge is far larger than the ramp's own step (0.05 per pixel)…
    expect(at(39) - at(40)).toBeGreaterThan(0.3)
    // …and the mask stays itself away from the edge.
    expect(at(10)).toBeGreaterThan(0.95)
    expect(at(80)).toBeLessThan(0.05)
    for (const v of r) expect(v).toBeGreaterThanOrEqual(0)
  })

  it('a tile computed with its margin gives the same values inside as the whole', () => {
    const a = disc()
    const sigma = 3
    const whole = featherCpu(a, W, H, sigma)
    // The left half plus the margin, then only the left half compared.
    const m = filterMargin(sigma, 0)
    const tw = 48 + m
    const tile = new Float32Array(tw * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < tw; x++) tile[y * tw + x] = a[y * W + x]
    const t = featherCpu(tile, tw, H, sigma)
    for (let y = 0; y < H; y++) for (let x = 0; x < 48; x++) expect(t[y * tw + x]).toBeCloseTo(whole[y * W + x], 5)
  })

  it('the guide is log luminance on 0…1', () => {
    expect(guideValue([1, 1, 1])).toBeCloseTo(12 / 14, 6)
    expect(guideValue([0, 0, 0])).toBe(0)
    expect(guideValue([8, 8, 8])).toBe(1)
  })
})
