import { describe, expect, it } from 'vitest'
import { darktableEigfCpu, eigfBlend, eigfMaskCpu, eigfSigma, eigfStatsCpu, gaussKernel, luminance, MASK_FLOOR, maskPlan, sampleStats } from './tone-mask'

/** A backlit scene: bright textured sky over a dark textured treeline with a wavy, sharp edge. */
function scene(W: number, H: number, gain = 1): Float32Array {
  const lum = new Float32Array(W * H)
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const edge = H * (0.45 + 0.1 * Math.sin((x / W) * 6))
      const base = y < edge ? 0.8 : 0.02
      lum[y * W + x] = gain * base * (1 + 0.4 * Math.sin(x / 7) * Math.sin(y / 5) + 0.2 * (rnd() - 0.5))
    }
  }
  return lum
}

/** Exact Gaussian (σ in full-size pixels, edges repeated) of I and I² at one pixel: the continuous target. */
function exactStats(lum: Float32Array, W: number, H: number, sigma: number, px: number, py: number): [number, number] {
  const r = Math.ceil(4 * sigma)
  let s1 = 0, s2 = 0, ws = 0
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const w = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
      const v = lum[Math.min(H - 1, Math.max(0, py + dy)) * W + Math.min(W - 1, Math.max(0, px + dx))]
      s1 += w * v
      s2 += w * v * v
      ws += w
    }
  }
  return [s1 / ws, s2 / ws - (s1 / ws) ** 2]
}

describe('tone mask (process version 2)', () => {
  it('measures brightness as darktable’s estimators do', () => {
    expect(luminance(0.3, 0.3, 0.3, 'mean')).toBeCloseTo(0.3, 12)
    expect(luminance(0.3, 0.3, 0.3, 'norm2')).toBeCloseTo(0.3 * Math.sqrt(3), 12)
    // Saturated colours read brighter with the norm than with the average.
    expect(Math.log2(luminance(1, 0.1, 0.1, 'norm2') / luminance(1, 0.1, 0.1, 'mean'))).toBeGreaterThan(1.3)
    expect(luminance(0, 0, 0, 'norm2')).toBe(MASK_FLOOR)
    expect(luminance(-1, -1, -1, 'mean')).toBe(0)
  })

  it('scales the filter radius with the photo as darktable’s modify_roi_in does', () => {
    expect(eigfSigma(6000, 5)).toBe(149)
    expect(eigfSigma(1600, 5)).toBe(39)
    // The same fraction of the photo at any size (± darktable's integer rounding).
    for (const size of [512, 1024, 4284, 9504]) expect(eigfSigma(size, 5) / size).toBeCloseTo(0.025, 2)
  })

  it('plans a small grid with σ of 3…6 cells, the same fraction of the frame at any photo size', () => {
    for (const [w, h] of [[1600, 1072], [4284, 2844], [6024, 4024], [9504, 6336]]) {
      const p = maskPlan(w, h, Math.max(w, h), 5)
      expect(p.block).toBe(4)
      expect(p.sigma).toBeGreaterThan(2.9)
      expect(p.sigma).toBeLessThan(6)
      expect(p.cell).toBe(4 * 2 ** p.levels)
      expect(p.gridW).toBe(Math.ceil(w / p.cell))
      expect(p.gridH).toBe(Math.ceil(h / p.cell))
      expect(p.sizes).toHaveLength(p.levels + 1)
      expect(p.radius).toBe(Math.ceil(3 * p.sigma))
    }
    // A crop keeps the photo's radius (darktable's tone equalizer runs before its crop).
    expect(maskPlan(1000, 800, 6000, 5).cell).toBe(maskPlan(6000, 4000, 6000, 5).cell)
    // Tiny photos: no downscaling, as darktable's `scaling` = clamp(σ, 1, 4).
    expect(maskPlan(100, 60, 100, 5).block).toBe(1)
    const k = gaussKernel(3, 9)
    expect(k.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
  })

  it('computes the averages and variance of an exact Gaussian over 2.5 % of the photo', () => {
    const W = 600, H = 400
    // As if the frame were a 2400 px photo's: σ = 59 px, so the plan averages and halves twice.
    const plan = maskPlan(W, H, 2400, 5)
    expect(plan.levels).toBe(2)
    const lum = scene(W, H)
    const stats = eigfStatsCpu(lum, plan)
    for (const [x, y] of [[300, 100], [100, 330], [450, 200], [200, 300]]) {
      const [avg, v] = sampleStats(stats, plan, x, y)
      const [ea, ev] = exactStats(lum, W, H, 59, x, y)
      expect(Math.abs(avg - ea) / ea).toBeLessThan(0.02)
      expect(Math.abs(v - ev) / (ev + 0.01 * ea * ea)).toBeLessThan(0.05)
    }
    // In the corners the edge is repeated per cell (the average of a 16 px band) rather than per pixel row, so E[I]
    // can be off by a few % and the variance by 2× (darktable repeats its own quarter-size edge sample: a third
    // variant). The variance is small there next to E[I]·I, so the mask moves by less than 0.1 EV.
    for (const [x, y] of [[20, 20], [590, 390], [5, 395]]) {
      const [avg, v] = sampleStats(stats, plan, x, y)
      const [ea, ev] = exactStats(lum, W, H, 59, x, y)
      const I = lum[y * W + x]
      expect(Math.abs(Math.log2(eigfBlend(I, avg, v, 1) / eigfBlend(I, ea, ev, 1)))).toBeLessThan(0.1)
    }
  })

  it('matches darktable’s own EIGF algorithm (literal port) to a few hundredths of an EV', () => {
    const W = 800, H = 540
    const lum = scene(W, H)
    const ours = eigfMaskCpu(lum, maskPlan(W, H, W, 5), 1)
    const dt = darktableEigfCpu(lum, W, H, eigfSigma(W, 5), 1)
    const d = Array.from(ours, (v, i) => Math.abs(Math.log2(v / dt[i]))).sort((a, b) => a - b)
    expect(d.reduce((a, b) => a + b, 0) / d.length).toBeLessThan(0.01)
    expect(d[Math.floor(0.98 * d.length)]).toBeLessThan(0.05)
  })

  it('smooths flat areas and keeps strong edges (the guided filter), unlike a blur', () => {
    const W = 800, H = 540
    const lum = scene(W, H)
    const mask = eigfMaskCpu(lum, maskPlan(W, H, W, 5), 1)
    const ev = (i: number) => Math.log2(mask[i])
    // Inside the sky and the trees, fine texture is pulled towards the surroundings' average…
    const row = 50 * W, rowDark = 500 * W
    const spread = (o: number, f: (i: number) => number) => {
      let mn = Infinity, mx = -Infinity
      for (let x = 100; x < 700; x++) { mn = Math.min(mn, f(o + x)); mx = Math.max(mx, f(o + x)) }
      return mx - mn
    }
    expect(spread(row, ev)).toBeLessThan(0.5 * spread(row, (i) => Math.log2(lum[i])))
    expect(spread(rowDark, ev)).toBeLessThan(0.5 * spread(rowDark, (i) => Math.log2(lum[i])))
    // …while the sky/tree edge stays sharp: a few pixels either side of it are still several EV apart.
    const x = 400
    const edge = Math.round(H * (0.45 + 0.1 * Math.sin((x / W) * 6)))
    expect(ev((edge - 4) * W + x) - ev((edge + 4) * W + x)).toBeGreaterThan(3)
  })

  it('scales exactly with exposure, so the GPU can measure once and multiply', () => {
    const W = 400, H = 270
    const plan = maskPlan(W, H, W, 5)
    const a = eigfMaskCpu(scene(W, H), plan, 1)
    const b = eigfMaskCpu(scene(W, H, 4), plan, 1)
    for (let i = 0; i < a.length; i += 97) expect(b[i] / a[i]).toBeCloseTo(4, 4)
  })

  it('blends as darktable eigf_blending_no_mask: flat → the average, strong variance → the pixel', () => {
    expect(eigfBlend(0.5, 0.2, 0, 1)).toBeCloseTo(0.2, 12)
    expect(eigfBlend(0.5, 0.2, 1e6, 1)).toBeCloseTo(0.5, 4)
    // a = v / (v + 1/feathering) with v = var / (avg · I)
    const v = 0.01 / (0.2 * 0.5)
    const a = v / (v + 1)
    expect(eigfBlend(0.5, 0.2, 0.01, 1)).toBeCloseTo(0.5 * a + 0.2 * (1 - a), 12)
    expect(eigfBlend(0, 0, 0, 1)).toBe(MASK_FLOOR)
  })
})
