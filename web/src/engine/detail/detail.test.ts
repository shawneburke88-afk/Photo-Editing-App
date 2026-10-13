import { describe, expect, it } from 'vitest'
import { DEFAULT_RGB_SETTINGS, DEFAULT_SETTINGS, displayUniforms, normalizeSettings } from '../develop/settings'
import { bandThreshold, denoiseCpu, denoiseRun, f16, fastMexp2, inferBias, inferShadows, maxScale, VARF, y0u0v0Matrices } from './denoise'
import { GENERIC_PROFILE, type NoiseProfile } from './noiseprofiles'
import { detailRun } from './run'
import { autoThreshold, captureParams, DEFAULT_DETAIL, denoiseCurves, detailOn, normalizeDetail, RAW_DETAIL, type DetailSettings } from './settings'
import { captureKernels, diffractionRadius, kernelIndex, KERNEL_ALIGN } from './capture'

const D700_3200: NoiseProfile = { iso: 3200, a: [0.00004404345, 0.000020206908, 0.00002897195], b: [2.3825315e-7, 1.4574454e-7, 2.7817939e-7] }
const withNoise = (n: Partial<DetailSettings['noise']>, s: Partial<DetailSettings['sharpen']> = {}): DetailSettings => ({ sharpen: { ...DEFAULT_DETAIL.sharpen, ...s }, noise: { ...DEFAULT_DETAIL.noise, ...n } })

describe('Detail settings', () => {
  it('reads an edit without them as off, adding no key', () => {
    const old = { version: 1, exposure: 0.5 }
    const s = normalizeSettings(old as never, 'raw')
    expect('detail' in s).toBe(false)
    expect('detail' in displayUniforms(s)).toBe(false)
    expect(detailOn(s.detail)).toBe(false)
    // New RAW photos are sharpened (owner, 2026-10-13); JPEGs aren't, and nothing has noise reduction.
    expect(DEFAULT_SETTINGS.detail).toEqual(RAW_DETAIL)
    expect(RAW_DETAIL.sharpen).toMatchObject({ amount: 40, radiusAuto: true, detail: 25, masking: 0 })
    expect('detail' in DEFAULT_RGB_SETTINGS).toBe(false)
    expect(detailOn({ ...RAW_DETAIL, sharpen: { ...RAW_DETAIL.sharpen, amount: 0 } })).toBe(false)
  })

  it('fills in and clamps stored values', () => {
    const d = normalizeDetail({ sharpen: { amount: 400, radius: 0.1 }, noise: { luminance: 30, colorDetail: 'x' } })!
    expect(d.sharpen).toEqual({ amount: 150, radius: 0.25, radiusAuto: true, detail: 25, masking: 0 })
    expect(d.noise.luminance).toBe(30)
    expect(d.noise.colorDetail).toBe(50)
    expect(normalizeDetail(null)).toBeUndefined()
  })

  it('keeps Detail through normalizeSettings and displayUniforms', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, detail: withNoise({ luminance: 40 }) }, 'raw')
    expect(s.detail?.noise.luminance).toBe(40)
    expect(displayUniforms(s).detail?.noise.luminance).toBe(40)
  })
})

describe('Lightroom Noise Reduction → darktable force curves (LightBench mapping)', () => {
  it('Luminance 50 and Color 50 are darktable\'s default curves (0.5 on every band)', () => {
    const c = denoiseCurves(withNoise({ luminance: 50, color: 50 }).noise)
    for (const v of [...c.y0, ...c.uv]) expect(v).toBeCloseTo(0.5, 12)
  })

  it('0 leaves luminance or colour alone', () => {
    const c = denoiseCurves(withNoise({ luminance: 0, color: 40 }).noise)
    expect(c.y0.every((v) => v === 0)).toBe(true)
    expect(c.uv.every((v) => v > 0)).toBe(true)
  })

  it('Detail lowers the force on the finest bands only; Contrast on the coarse ones; Smoothness raises coarse colour', () => {
    const base = denoiseCurves(withNoise({ luminance: 60, color: 60 }).noise)
    const fine = denoiseCurves(withNoise({ luminance: 60, color: 60, luminanceDetail: 100, colorDetail: 100 }).noise)
    expect(fine.y0[6]).toBeCloseTo(base.y0[6] / 2, 12)
    expect(fine.y0[3]).toBeCloseTo(base.y0[3], 12)
    expect(fine.uv[6]).toBeCloseTo(base.uv[6] / 2, 12)
    const contrast = denoiseCurves(withNoise({ luminance: 60, luminanceContrast: 100 }).noise)
    expect(contrast.y0[0]).toBeCloseTo(base.y0[0] * 2 ** -1.5, 12)
    expect(contrast.y0[6]).toBeCloseTo(base.y0[6], 12)
    const smooth = denoiseCurves(withNoise({ color: 60, colorSmoothness: 100 }).noise)
    expect(smooth.uv[0]).toBeCloseTo(base.uv[0] * 2, 12)
    expect(smooth.uv[6]).toBeCloseTo(base.uv[6], 12)
  })

  it('maps the Sharpening sliders onto the interim method', () => {
    // Amount / 5 iterations (40 → darktable's 8), Detail / 100 of the overshoot, Masking above the automatic threshold.
    expect(captureParams({ ...RAW_DETAIL.sharpen }, 0.3)).toEqual({ iterations: 8, halo: 0.25, threshold: 0.3 })
    expect(captureParams({ ...RAW_DETAIL.sharpen, amount: 150, detail: 100, masking: 100 }, 0.3)).toEqual({ iterations: 30, halo: 1, threshold: 1 })
    expect(captureParams({ ...RAW_DETAIL.sharpen, amount: 42, masking: 50 }, 0.2).iterations).toBeCloseTo(8.4, 12)
    expect(captureParams({ ...RAW_DETAIL.sharpen, masking: 50 }, 0.2).threshold).toBeCloseTo(0.6, 12)
  })
})

describe('darktable denoise (profiled) parameters', () => {
  it('uses 7 wavelet scales at full size and drops the finest ones for a smaller preview (roi scale)', () => {
    expect(maxScale(6000, 4000, 1)).toBe(7)
    expect(maxScale(6000, 4000, 0.5)).toBe(6)
    expect(maxScale(6000, 4000, 0.25)).toBe(5)
    // Small images: the largest filter is limited to 20 % of the photo.
    expect(maxScale(200, 150, 1)).toBe(4)
  })

  it('maps the preview\'s scales onto the same bands (band = 7 − (s + offset + 1))', () => {
    const curves = { y0: [0, 1, 2, 3, 4, 5, 6].map((k) => k / 10), uv: [0, 0, 0, 0, 0, 0, 0] }
    const full = denoiseRun(D700_3200, curves, [2, 1, 1.5], 1, [6000, 4000])
    const quarter = denoiseRun(D700_3200, curves, [2, 1, 1.5], 0.25, [6000, 4000])
    // Finest band at full size is band 6; the quarter preview's finest scale is band 4 (the full size's scale 2).
    expect(full.bands[0].adjt[0]).toBeCloseTo(8 * 4 * 0.6 ** 2, 10)
    expect(quarter.bands[0].adjt[0]).toBeCloseTo(8 * 4 * 0.4 ** 2, 10)
    expect(full.bands[2].adjt[0]).toBeCloseTo(quarter.bands[0].adjt[0], 10)
  })

  it('derives shadows and bias from the profile as reload_defaults does, and rescales them for previews', () => {
    expect(inferShadows(1e-4)).toBeCloseTo(0.1 - 0.1 * Math.log(1e-4), 12)
    expect(inferShadows(1)).toBe(0.7)
    expect(inferBias(1e-4)).toBeCloseTo(-(5 + 0.5 * Math.log(1e-4)), 12)
    expect(inferBias(1e-12)).toBeCloseTo(0, 12)
    const r1 = denoiseRun(D700_3200, denoiseCurves(withNoise({ luminance: 50 }).noise), [2, 1, 1.5], 1, [4000, 3000])
    const r4 = denoiseRun(D700_3200, denoiseCurves(withNoise({ luminance: 50 }).noise), [2, 1, 1.5], 0.25, [4000, 3000])
    expect(r4.bias - r1.bias).toBeCloseTo(-0.5 * Math.log(0.25), 10)
    expect(r1.p[1]).toBeCloseTo(inferShadows(D700_3200.a[1]), 10)
    expect(r1.p[0]).toBeCloseTo(inferShadows(D700_3200.a[1]) + 0.1 * Math.log(1 / 2), 10)
  })

  it('builds darktable\'s white-balance-adapted Y0U0V0 matrices', () => {
    const { toYuv, toRgb } = y0u0v0Matrices([2, 1, 1.5])
    // toRgb is the inverse.
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      let v = 0
      for (let k = 0; k < 3; k++) v += toYuv[3 * i + k] * toRgb[3 * k + j]
      expect(v).toBeCloseTo(i === j ? 1 : 0, 10)
    }
    const sumInv = (1 / 2 + 1 + 1 / 1.5) * Math.sqrt(3)
    expect(toYuv[0]).toBeCloseTo(sumInv / 2, 12)
    // With equal coefficients the U0/V0 rows are darktable's base rows scaled.
    const eq = y0u0v0Matrices([1, 1, 1]).toYuv
    expect(eq[3] / eq[5]).toBeCloseTo(-1, 12)
    expect(eq[7] / eq[6]).toBeCloseTo(-2, 12)
  })

  it('computes BayesShrink thresholds as darktable', () => {
    const sb2 = VARF ** 2
    expect(bandThreshold(1000 * 4, 1001, sb2, 8)).toBeCloseTo((8 * sb2) / Math.sqrt(4 - sb2), 10)
    expect(bandThreshold(0, 1001, sb2, 8)).toBeCloseTo((8 * sb2) / 1e-3, 6)
  })

  it('fast_mexp2f is 2^-x (to its own approximation) and 0 for large x', () => {
    expect(fastMexp2(0)).toBe(1)
    expect(fastMexp2(1)).toBe(0.5)
    expect(fastMexp2(2)).toBe(0.25)
    expect(fastMexp2(200)).toBe(0)
  })

  it('rounds to half floats like a GPU texture', () => {
    expect(f16(1)).toBe(1)
    expect(f16(1 + 2 ** -11)).toBe(1) // half way: to even
    expect(f16(1 + 3 * 2 ** -11)).toBe(1 + 2 ** -9)
    expect(f16(65504)).toBe(65504)
    expect(f16(2 ** -24)).toBe(2 ** -24)
    expect(f16(-0.1)).toBeCloseTo(-0.0999755859375, 12)
  })
})

describe('denoise CPU reference', () => {
  const noisy = (w: number, h: number, level: number, a: number, b: number, seed = 7) => {
    let s = seed
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296)
    const g = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())
    const img = new Float32Array(w * h * 3)
    for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) img[3 * i + c] = level + Math.sqrt(a * level + b) * g()
    return img
  }
  const stats = (img: Float32Array, c: number) => {
    let m = 0
    let q = 0
    const n = img.length / 3
    for (let i = 0; i < n; i++) m += img[3 * i + c]
    m /= n
    for (let i = 0; i < n; i++) q += (img[3 * i + c] - m) ** 2
    return { mean: m, sd: Math.sqrt(q / n) }
  }

  it('changes nothing with zero forces and no bias correction (the transform is inverted exactly)', () => {
    const img = noisy(48, 40, 0.2, 2e-4, 1e-6)
    const run = { ...denoiseRun(D700_3200, { y0: [0, 0, 0, 0, 0, 0, 0], uv: [0, 0, 0, 0, 0, 0, 0] }, [1, 1, 1], 1, [48, 40]), bias: 0 }
    const out = img.slice()
    denoiseCpu(out, 48, 40, run, false)
    let max = 0
    for (let i = 0; i < img.length; i++) max = Math.max(max, Math.abs(out[i] - img[i]) / img[i])
    expect(max).toBeLessThan(2e-5)
  })

  it('removes most noise of a flat patch at darktable\'s default strength and keeps its level', () => {
    const img = noisy(96, 96, 0.18, D700_3200.a[1], D700_3200.b[1])
    const before = stats(img, 1)
    const out = img.slice()
    denoiseCpu(out, 96, 96, denoiseRun(D700_3200, denoiseCurves(withNoise({ luminance: 50, color: 50 }).noise), [1, 1, 1], 1, [96, 96]), true)
    const after = stats(out, 1)
    expect(after.sd).toBeLessThan(before.sd * 0.5)
    expect(Math.abs(after.mean - before.mean) / before.mean).toBeLessThan(0.02)
  })

  it('removes more with a higher Luminance', () => {
    const img = noisy(64, 64, 0.1, D700_3200.a[1], D700_3200.b[1])
    const sds = [20, 50, 90].map((l) => {
      const out = img.slice()
      denoiseCpu(out, 64, 64, denoiseRun(D700_3200, denoiseCurves(withNoise({ luminance: l }).noise), [1, 1, 1], 1, [64, 64]), true)
      return stats(out, 1).sd
    })
    expect(sds[0]).toBeGreaterThan(sds[1])
    expect(sds[1]).toBeGreaterThan(sds[2])
  })
})

describe('capture sharpening (darktable capture.c)', () => {
  it('estimates the contrast threshold from bit depth and ISO as darktable', () => {
    // 14-bit raw at ISO 100: 0.4 − 0.07 − 0.01 − 0.012 · 5 ≈ 0.26 (in float just under: 0.25 after truncation);
    // 12-bit (white 4095) at ISO 1600: 0.4 + 0.048 = 0.448 → 0.44; 14-bit at ISO 1600: 0.368 → 0.36.
    expect([0.25, 0.26].some((v) => Math.abs(autoThreshold(16383, 100) - v) < 1e-9)).toBe(true)
    expect(autoThreshold(4095, 1600)).toBeCloseTo(0.44, 9)
    expect(autoThreshold(15000, 1600)).toBeCloseTo(0.36, 9)
    expect(autoThreshold(255, 600)).toBeCloseTo(0.4, 9)
  })

  it('builds darktable\'s 9 × 9 kernel table, normalised, 5 × 5 below sigma 0.66', () => {
    const t = captureKernels()
    const sum = (i: number) => {
      let s = 0
      for (let k = -4; k <= 4; k++) for (let j = -4; j <= 4; j++) s += t[i * KERNEL_ALIGN + 5 * Math.abs(k) + Math.abs(j)]
      return s
    }
    for (const i of [0, 30, 65, 66, 100, 150, 255]) expect(sum(i)).toBeCloseTo(1, 5)
    expect(t[0 * KERNEL_ALIGN]).toBeCloseTo(1, 6) // sigma 1e-7: a delta
    expect(t[50 * KERNEL_ALIGN + 3]).toBe(0) // sigma 0.5: nothing beyond radius 2.5
    expect(t[100 * KERNEL_ALIGN + 3]).toBeGreaterThan(0)
  })

  it('tapers the sigma to 0 over the outer 8 pixels', () => {
    expect(kernelIndex(0.6, 100, 100, 400, 300)).toBe(60)
    expect(kernelIndex(0.6, 4, 100, 400, 300)).toBe(Math.trunc(Math.fround(0.6 * 0.125 * 4 / 0.01)))
    expect(kernelIndex(0.6, 0, 0, 400, 300)).toBe(0)
  })

  it('falls back to diffraction (plus the pixel aperture) from the f-number and pixel pitch', () => {
    // 24 MP full frame (6000 px, 6 µm) at f/8: 0.42 · 0.55 · 8 / 6 = 0.308 px, with 0.289 in quadrature: 0.42 px.
    expect(diffractionRadius(8, 1, 6000)).toBeCloseTo(Math.hypot((0.42 * 0.55 * 8) / 6, 1 / Math.sqrt(12)), 10)
    expect(diffractionRadius(22, 1.5, 6000)).toBeGreaterThan(diffractionRadius(8, 1.5, 6000))
    expect(diffractionRadius(0, 1, 6000)).toBe(0.5)
    expect(diffractionRadius(64, 2, 6000)).toBe(1.5)
  })
})

const AUTO = { sigma: 0.6, from: 'measured' as const }

describe('the Detail run', () => {
  const meta = { maker: 'Nikon', model: 'D700', iso: 3200, kind: 'raw' as const }
  it('is null when nothing is on, and for old edits', () => {
    expect(detailRun(undefined, meta, [1, 1, 1], [100, 100], 0, null, AUTO)).toBeNull()
    expect(detailRun(DEFAULT_DETAIL, meta, [1, 1, 1], [100, 100], 0, null, AUTO)).toBeNull()
  })
  it('uses the generic profile when the profiles aren\'t available, and keys runs by their parameters', () => {
    const r = detailRun(withNoise({ luminance: 30 }), meta, [2, 1, 1.5], [400, 300], 1, null, AUTO)!
    expect(r.profile).toMatchObject({ kind: 'generic', reason: 'no-data' })
    expect(r.denoise!.a).toBeCloseTo(GENERIC_PROFILE.a[1] * (0.05 / 0.05 ** inferShadows(1e-4)), 12)
    const r2 = detailRun(withNoise({ luminance: 31 }), meta, [2, 1, 1.5], [400, 300], 1, null, AUTO)!
    expect(r2.key).not.toBe(r.key)
  })
  it('scales the sharpening radius with the level, auto or set by hand', () => {
    const r = detailRun(withNoise({}, { amount: 50 }), { ...meta, white: 16383, iso: 100 }, [1, 1, 1], [400, 300], 1, null, AUTO)!
    expect(r.capture).toMatchObject({ sigma: 0.3, iterations: 10, halo: 0.25 })
    expect(r.capture!.threshold).toBeCloseTo(autoThreshold(16383, 100), 9)
    expect(r.radius).toEqual(AUTO)
    const m = detailRun(withNoise({}, { amount: 50, radius: 1.2, radiusAuto: false }), meta, [1, 1, 1], [400, 300], 0, null, AUTO)!
    expect(m.capture!.sigma).toBe(1.2)
    expect(m.radius).toEqual({ sigma: 1.2, from: 'manual' })
    expect(r.denoise).toBeNull()
  })
  it('makes a mask-only run for the Masking preview', () => {
    const r = detailRun(withNoise({}, { masking: 40 }), meta, [1, 1, 1], [400, 300], 0, null, AUTO, true)!
    expect(r.maskOnly).toBe(true)
    // ISO 3200, 8-bit "white": darktable's automatic 0.4 − 0.012 · (−4) = 0.448 → 0.44; Masking 40 adds 40 % of the rest.
    expect(r.capture?.threshold).toBeCloseTo(0.44 + 0.4 * 0.56, 6)
  })
})
