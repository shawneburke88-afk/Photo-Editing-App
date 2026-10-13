// CPU reference of the capture-sharpening kernels (engine/gpu/detail.wgsl; darktable's data/kernels/capture.cl and
// src/iop/demosaicing/capture.c `_capture_sharpen`), for tests: the contrast mask, Richardson–Lucy iterations with the
// per-pixel Gaussian table, and LightBench's fractional iterations and halo limit.

import { captureKernels, kernelIndex, KERNEL_ALIGN } from './capture'
import type { CaptureRun } from './run'

const FLUM = [0.212671, 0.71516, 0.072169]
const YMIN = 0.001
const SMALL_ULIM = 66

const luma = (c: ArrayLike<number>, i: number) => Math.max(0, FLUM[0] * c[3 * i] + FLUM[1] * c[3 * i + 1] + FLUM[2] * c[3 * i + 2])
const f = Math.fround

let table: Float32Array | null = null

/**
 * Capture-sharpens camera RGB `cam` (3 floats per pixel) in place, as the GPU does; returns the mask (blendmask).
 * With `maskOnly`, only the mask is computed.
 */
export function captureCpu(cam: Float32Array, w: number, h: number, run: CaptureRun, clipWb: [number, number, number], maskOnly = false): Float32Array {
  const n = w * h
  const Y = new Float32Array(n)
  const T1 = new Float32Array(n)
  const T2 = new Float32Array(n)
  for (let i = 0; i < n; i++) Y[i] = luma(cam, i)
  T1.set(Y)
  // prepare_blend as a gather.
  const hot = (x: number, y: number) => {
    const i = y * w + x
    return cam[3 * i] > clipWb[0] || cam[3 * i + 1] > clipWb[1] || cam[3 * i + 2] > clipWb[2] || luma(cam, i) < YMIN
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 1
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) m = 0
      else {
        outer: for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (Math.abs(dx) === 2 && Math.abs(dy) === 2) continue
            const kx = x + dx
            const ky = y + dy
            if (kx < 2 || ky < 2 || kx >= w - 2 || ky >= h - 2) continue
            if (hot(kx, ky)) {
              m = 0
              break outer
            }
          }
        }
      }
      T2[y * w + x] = m
    }
  }
  // modify_blend
  const threshold = 0.6 * run.threshold * run.threshold
  const offset = -2.5 + (200 * threshold) / 2
  for (let iy = 0; iy < h; iy++) {
    const row = Math.min(Math.max(iy, 2), h - 3)
    for (let ix = 0; ix < w; ix++) {
      const col = Math.min(Math.max(ix, 2), w - 3)
      let sum = 0
      let sq = 0
      for (let y = row - 1; y < row + 2; y++) for (let x = col - 2; x < col + 3; x++) {
        const v = Y[y * w + x]
        sum += v
        sq += v * v
      }
      for (let x = col - 1; x < col + 2; x++) {
        const a = Y[(row - 2) * w + x]
        const b = Y[(row + 2) * w + x]
        sum += a + b
        sq += a * a + b * b
      }
      const sd = Math.sqrt(Math.max(0, sq - (sum * sum) / 21) / 21)
      const t = Math.log(1 + sd / Math.sqrt(Math.max(1.17549435e-38, sum / 21)))
      const weight = 1 / (1 + Math.exp(offset - 200 * t))
      const i = iy * w + ix
      T2[i] = Math.min(1, Math.max(0, T2[i] * 1.01011 * (weight - 0.01)))
    }
  }
  // Blur (sigma 2, 13 taps) and final_blend.
  const g = (src: Float32Array, horizontal: boolean) => {
    const o = new Float32Array(n)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0
      let ws = 0
      for (let k = -6; k <= 6; k++) {
        const wt = Math.exp(-(k * k) / 8)
        const xx = horizontal ? Math.min(w - 1, Math.max(0, x + k)) : x
        const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + k))
        s += wt * src[yy * w + xx]
        ws += wt
      }
      o[y * w + x] = s / ws
    }
    return o
  }
  const BM = g(g(T2, true), false)
  for (let i = 0; i < n; i++) {
    const diff = T2[i] - BM[i]
    const k = 1 / (1 + Math.exp(5 - 10 * diff))
    BM[i] = Math.min(1, Math.max(0, k * T2[i] + (1 - k) * BM[i]))
  }
  if (maskOnly) return BM
  // Richardson–Lucy (kernel_9x9_div / kernel_9x9_mul).
  table ??= captureKernels()
  const K = table
  const blur = (src: Float32Array, x: number, y: number) => {
    const ki = kernelIndex(run.sigma, x, y, w, h)
    const bd = ki < SMALL_ULIM ? 2 : 4
    let v = 0
    for (let ir = -bd; ir <= bd; ir++) {
      const r = y + ir
      if (r < 0 || r >= h) continue
      for (let ic = -bd; ic <= bd; ic++) {
        const c = x + ic
        if (c < 0 || c >= w) continue
        v += K[KERNEL_ALIGN * ki + 5 * Math.abs(ir) + Math.abs(ic)] * src[r * w + c]
      }
    }
    return v
  }
  const total = Math.ceil(run.iterations)
  const floor = Math.floor(run.iterations)
  let BX = floor === 0 ? Y.slice() : new Float32Array(n)
  for (let k = 0; k < total; k++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (BM[i] > 0) T2[i] = f(Y[i] / Math.max(blur(T1, x, y), YMIN))
    }
    const next = T1.slice()
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (BM[i] > 0) next[i] = f(T1[i] * blur(T2, x, y))
    }
    T1.set(next)
    if (k + 1 === floor) BX = T1.slice()
  }
  const frac = run.iterations - floor
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!(BM[i] > 0)) continue
      const yv = Y[i]
      const rl = BX[i] + (T1[i] - BX[i]) * frac
      let lo = yv
      let hi = yv
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const v = Y[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))]
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
      const within = Math.min(hi, Math.max(lo, rl))
      const limited = within + run.halo * (rl - within)
      const yNew = yv + (limited - yv) * Math.min(1, Math.max(0, BM[i]))
      const k = yNew / Math.max(yv, YMIN)
      for (let c = 0; c < 3; c++) cam[3 * i + c] *= k
    }
  }
  return BM
}
