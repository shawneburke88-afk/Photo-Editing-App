// darktable's denoise (profiled), wavelets mode, Y0U0V0 colour mode — its defaults (src/iop/denoiseprofile.c,
// `reload_defaults` lines 2677-2747; `$DEFAULT`s lines 103-136) — as the parameters LightBench's GPU kernels take
// (engine/gpu/detail.wgsl), and a CPU reference of those kernels for tests.
//
// The GPU path follows darktable's OpenCL path (`process_wavelets_cl`, denoiseprofile.c lines 2186-2578, and
// data/kernels/denoiseprofile.cl): precondition (variance-stabilising transform + Y0U0V0) → per scale, the
// edge-aware à-trous decomposition (`denoiseprofile_decompose`), the sum of the detail band's squares
// (`reduce_first/second`), BayesShrink thresholds from it (`variance_stabilizing_xform`), soft thresholding
// (`denoiseprofile_synthesize`) → backtransform. One difference in the order of work, not in the maths: darktable
// keeps every detail band and synthesizes from the coarsest; LightBench adds each band's thresholded detail to an
// accumulator as soon as its threshold is known (the sum is the same), so it needs three images instead of up to
// nine. The images are half floats (rgba16float); darktable's are floats (the effect is measured in PHASE3.md
// Part 13).
//
// Scale (darktable's `roi` scale): a preview at 1/2^k of the photo's size runs with in_scale = 2^-k, which drops
// the finest wavelet bands (they are below the preview's pixels) and rescales the transform, so the preview shows
// what the full-size result looks like at that size. This is darktable's own handling (lines 2196-2215,
// 2330-2364); LightBench uses it for the fitted view and thumbnails.

import type { NoiseProfile } from './noiseprofiles'
import { DENOISE_BANDS } from './settings'

/** DT_IOP_DENOISE_PROFILE_P_FULCRUM (line 64). */
const P_FULCRUM = 0.05
/** The 5-tap à-trous filter's noise reduction per scale: √(2 + 2·4² + 6²) / 16 ≈ 0.52 (line 2448). */
export const VARF = Math.sqrt(2 + 2 * 16 + 36) / 16

/** darktable's defaults that `reload_defaults` derives from the profile's green `a` (lines 2626-2644). */
export const inferShadows = (a: number) => Math.min(Math.max(0.1 - 0.1 * Math.log(a), 0.7), 1.8)
export const inferBias = (a: number) => -Math.max(5 + 0.5 * Math.log(a), 0)

/** How many wavelet scales darktable uses at this scale (`process_wavelets_cl` lines 2196-2215). */
export function maxScale(fullW: number, fullH: number, inScale: number): number {
  const MAX = DENOISE_BANDS
  const scale = Math.min(inScale, 1)
  const supp0 = Math.min(2 * (2 << (MAX - 1)) + 1, Math.max(fullH, fullW) * 0.2)
  const i0 = Math.log2((supp0 - 1) * 0.5)
  let s = 0
  for (; s < MAX; s++) {
    const supp = 2 * (2 << s) + 1
    const suppIn = supp * (1 / scale)
    const iIn = Math.log2((suppIn - 1) * 0.5) - 1
    const t = 1 - (iIn + 0.5) / i0
    if (t < 0) break
  }
  return s
}

type M3 = [number, number, number, number, number, number, number, number, number]

function invert3(m: M3): M3 | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (det === 0) return null
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det]
}

/** darktable's white-balance-adapted Y0U0V0 matrices (`set_up_conversion_matrices`, lines 1291-1346). */
export function y0u0v0Matrices(wb: [number, number, number]): { toYuv: M3; toRgb: M3 } {
  const m: M3 = [1 / 3, 1 / 3, 1 / 3, 0.5, 0, -0.5, 0.25, -0.5, 0.25]
  const sumInv = (1 / wb[0] + 1 / wb[1] + 1 / wb[2]) * Math.sqrt(3)
  m[0] = sumInv / wb[0]
  m[1] = sumInv / wb[1]
  m[2] = sumInv / wb[2]
  const sdU = Math.sqrt(0.25 * wb[0] * wb[0] + 0.25 * wb[2] * wb[2])
  const sdV = Math.sqrt(0.0625 * wb[0] * wb[0] + 0.25 * wb[1] * wb[1] + 0.0625 * wb[2] * wb[2])
  for (let c = 0; c < 3; c++) {
    m[3 + c] /= sdU
    m[6 + c] /= sdV
  }
  let inv = invert3(m)
  if (!inv) {
    const sdY = Math.sqrt((wb[0] * wb[0] + wb[1] * wb[1] + wb[2] * wb[2]) / 9)
    m[0] = m[1] = m[2] = 1 / (3 * sdY)
    inv = invert3(m)!
  }
  return { toYuv: m, toRgb: inv }
}

/** Everything the GPU kernels need for one run, computed on the CPU as darktable's host code does. */
export interface DenoiseRun {
  /** Wavelet scales at this scale. */
  scales: number
  /** Precondition: a (green, × compensate_p), b (green), exponent per channel, and RGB → Y0U0V0 (scaled). */
  a: number
  b: number
  p: [number, number, number]
  toYuv: M3
  /** Backtransform: Y0U0V0 → RGB (scaled), bias, the scaled white balance. */
  toRgb: M3
  bias: number
  wb: [number, number, number]
  /** Per scale s (0 = finest): 1/σ_band² for the edge weights, σ_band², and the threshold multipliers (Y0, U0, V0). */
  bands: { invSigma2: number; sb2: number; adjt: [number, number, number] }[]
}

/**
 * The parameters of one run (`process_wavelets_cl` lines 2290-2398 and 2440-2504), for darktable's defaults
 * (strength 1, shadows and bias from the profile, white-balance-adaptive transform, the new VST, Y0U0V0) and
 * LightBench's force curves (settings.ts `denoiseCurves`).
 *
 * `wb` is the white balance applied to the photo (green = 1; [1, 1, 1] for JPEGs, as darktable's
 * `compute_wb_factors` does when the white-balance coefficients are 0); `inScale` the run's scale (1 = full size);
 * `full` the photo's full size (darktable's buf_in × iscale).
 */
export function denoiseRun(profile: NoiseProfile, curves: { y0: number[]; uv: number[] }, wb: [number, number, number], inScale: number, full: [number, number]): DenoiseRun {
  const strength = 1
  const a1 = profile.a[1]
  const shadows = inferShadows(a1)
  const bias0 = inferBias(a1)
  const scale = Math.min(inScale, 1)
  const scales = maxScale(full[0], full[1], scale)
  const p = wb.map((w) => Math.max(shadows + 0.1 * Math.log(scale / w), 0)) as [number, number, number]
  const { toYuv, toRgb } = y0u0v0Matrices(wb)
  // "more strength in Y0U0V0 in order to get a similar smoothing as in other modes" (line 2337).
  const k = strength * 2.5 * scale
  const ty = toYuv.map((v) => v / k) as M3
  const tr = toRgb.map((v) => v * k) as M3
  const wbs = wb.map((w) => w * k) as [number, number, number]
  const compensateP = P_FULCRUM / P_FULCRUM ** shadows
  const bands: DenoiseRun['bands'] = []
  for (let s = 0; s < scales; s++) {
    const sigmaBand = VARF ** s
    const offset = DENOISE_BANDS - scales
    const band = DENOISE_BANDS - (s + offset + 1)
    const fy = 4 * curves.y0[band] ** 2
    const fuv = 4 * curves.uv[band] ** 2
    bands.push({ invSigma2: 1 / (sigmaBand * sigmaBand), sb2: sigmaBand * sigmaBand, adjt: [8 * fy, 8 * fuv, 8 * fuv] })
  }
  return { scales, a: a1 * compensateP, b: profile.b[1], p, toYuv: ty, toRgb: tr, bias: bias0 - 0.5 * Math.log(scale), wb: wbs, bands }
}

/** darktable's BayesShrink threshold of one band (lines 2425-2504) from the sum of its squared detail. */
export function bandThreshold(sumSq: number, pixels: number, sb2: number, adjt: number): number {
  const varY = sumSq / (pixels - 1)
  const stdX = Math.sqrt(Math.max(1e-6, varY - sb2))
  return (adjt * sb2) / stdX
}

// ---- CPU reference of the GPU kernels (detail.wgsl), for tests

/** Rounds to the nearest IEEE half float (what an rgba16float texture stores). */
export function f16(v: number): number {
  if (!Number.isFinite(v)) return v
  const s = v < 0 ? -1 : 1
  const x = Math.abs(v)
  if (x >= 65520) return s * Infinity
  if (x === 0) return v
  const e = Math.max(Math.floor(Math.log2(x)), -14)
  const q = 2 ** (e - 10)
  // Round half to even.
  const r = x / q
  const fl = Math.floor(r)
  const n = r - fl > 0.5 || (r - fl === 0.5 && fl % 2 === 1) ? fl + 1 : fl
  return s * n * q
}

/** darktable's fast_mexp2f (data/kernels/common.h, line 187): 2^-x by bit manipulation. */
export function fastMexp2(x: number): number {
  const i1 = 0x3f800000
  const i2 = 0x3f000000
  const k0 = Math.fround(i1 + Math.fround(x * (i2 - i1)))
  if (!(k0 >= 0x800000)) return 0
  const b = new DataView(new ArrayBuffer(4))
  b.setUint32(0, Math.trunc(k0) >>> 0)
  return b.getFloat32(0)
}

const FILTER = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16]

/**
 * Denoises camera RGB (`rgb`, 3 floats per pixel, white-balanced, 0…1) in place, as the GPU kernels do. With
 * `half`, the intermediate images are rounded to half floats as the GPU's rgba16float textures store them.
 */
export function denoiseCpu(rgb: Float32Array, w: number, h: number, run: DenoiseRun, half = true): void {
  const n = w * h
  const R = half ? f16 : (v: number) => Math.fround(v)
  let A = new Float32Array(n * 3)
  let B = new Float32Array(n * 3)
  const acc = new Float32Array(n * 3)
  const { a, b, p, toYuv: M } = run
  // precondition (denoiseprofile_precondition_Y0U0V0)
  for (let i = 0; i < n; i++) {
    const t = [0, 1, 2].map((c) => Math.max((2 * Math.max(0, rgb[3 * i + c] + b) ** (1 - p[c] / 2)) / ((2 - p[c]) * Math.sqrt(a)), 0))
    for (let r = 0; r < 3; r++) A[3 * i + r] = R(M[3 * r] * t[0] + M[3 * r + 1] * t[1] + M[3 * r + 2] * t[2])
  }
  for (let s = 0; s < run.scales; s++) {
    const mult = 1 << s
    const { invSigma2, sb2, adjt } = run.bands[s]
    // decompose (denoiseprofile_decompose): edge-aware 5×5 à-trous, edges clamped.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = 3 * (y * w + x)
        let s0 = 0, s1 = 0, s2 = 0, wt = 0
        for (let j = 0; j < 5; j++) {
          const yy = Math.min(h - 1, Math.max(0, y + mult * (j - 2)))
          for (let k = 0; k < 5; k++) {
            const xx = Math.min(w - 1, Math.max(0, x + mult * (k - 2)))
            const q = 3 * (yy * w + xx)
            const d0 = A[i] - A[q], d1 = A[i + 1] - A[q + 1], d2 = A[i + 2] - A[q + 2]
            const dot = (d0 * d0 + d1 * d1 + d2 * d2) * invSigma2
            const wgt = FILTER[j] * FILTER[k] * fastMexp2(Math.max(0, dot * 0.02 - 9))
            s0 += wgt * A[q]
            s1 += wgt * A[q + 1]
            s2 += wgt * A[q + 2]
            wt += wgt
          }
        }
        B[i] = R(s0 / wt)
        B[i + 1] = R(s1 / wt)
        B[i + 2] = R(s2 / wt)
      }
    }
    // reduce: sum of the detail band's squares
    const sum = [0, 0, 0]
    for (let i = 0; i < 3 * n; i++) {
      const d = A[i] - B[i]
      sum[i % 3] += d * d
    }
    const thr = [0, 1, 2].map((c) => bandThreshold(sum[c], n, sb2, adjt[c]))
    // synthesize: soft-threshold the detail and add it up
    for (let i = 0; i < 3 * n; i++) {
      const d = A[i] - B[i]
      const t = thr[i % 3]
      acc[i] = R(acc[i] + Math.sign(d) * Math.max(0, Math.abs(d) - t))
    }
    const T = A
    A = B
    B = T
  }
  // backtransform (denoiseprofile_backtransform_Y0U0V0)
  const Q = run.toRgb
  for (let i = 0; i < n; i++) {
    const t = [0, 1, 2].map((c) => A[3 * i + c] + acc[3 * i + c])
    for (let c = 0; c < 3; c++) {
      const px = Math.max(0, Q[3 * c] * t[0] + Q[3 * c + 1] * t[1] + Q[3 * c + 2] * t[2])
      const delta = px * px + run.bias * run.wb[c]
      const den = 4 / (Math.sqrt(a) * (2 - p[c]))
      const z1 = (px + Math.sqrt(Math.max(0, delta))) / den
      rgb[3 * i + c] = Math.max(z1 ** (1 / (1 - p[c] / 2)) - b, 0)
    }
  }
}
