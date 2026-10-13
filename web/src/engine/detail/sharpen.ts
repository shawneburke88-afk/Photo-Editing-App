// CPU reference of the sharpening kernels (engine/gpu/detail.wgsl): darktable capture sharpening's contrast mask
// (src/iop/demosaicing/capture.c `_prepare_blend`, `_modify_blend`, the blur and blend of `_capture_sharpen`) and the
// interim method, darktable's unsharp mask (src/iop/sharpen.c) on luminance applied as a luminance ratio. For tests.

import type { SharpenRun } from './run'

const FLUM = [0.212671, 0.71516, 0.072169]
const YMIN = 0.001
/** capture.c: the mask is blurred with sigma 2. */
const MASK_SIGMA = 2

const luma = (c: ArrayLike<number>, i: number) => Math.max(0, FLUM[0] * c[3 * i] + FLUM[1] * c[3 * i + 1] + FLUM[2] * c[3 * i + 2])

function gaussLine(src: Float32Array, w: number, h: number, sigma2: number, rad: number, horizontal: boolean): Float32Array {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      let ws = 0
      for (let k = -rad; k <= rad; k++) {
        const wt = Math.exp(-(k * k) / (2 * sigma2))
        const xx = horizontal ? Math.min(w - 1, Math.max(0, x + k)) : x
        const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + k))
        sum += wt * src[yy * w + xx]
        ws += wt
      }
      out[y * w + x] = sum / ws
    }
  }
  return out
}

/** The sharpening mask (0…1 per pixel) of camera RGB `cam` (3 floats per pixel). */
export function sharpenMask(cam: Float32Array, w: number, h: number, cs: number, clipWb: [number, number, number]): Float32Array {
  const clipMask = new Float32Array(w * h)
  const hot = (x: number, y: number) => {
    const i = y * w + x
    return cam[3 * i] > clipWb[0] || cam[3 * i + 1] > clipWb[1] || cam[3 * i + 2] > clipWb[2] || luma(cam, i) < YMIN
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 1
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) m = 0
      else {
        for (let dy = -2; dy <= 2 && m; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (Math.abs(dx) === 2 && Math.abs(dy) === 2) continue
            const kx = x + dx
            const ky = y + dy
            if (kx < 2 || ky < 2 || kx >= w - 2 || ky >= h - 2) continue
            if (hot(kx, ky)) {
              m = 0
              break
            }
          }
        }
      }
      clipMask[y * w + x] = m
    }
  }
  const Y = (x: number, y: number) => luma(cam, Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x)))
  const blend = new Float32Array(w * h)
  const threshold = 0.6 * cs * cs
  const offset = -2.5 + (200 * threshold) / 2
  for (let iy = 0; iy < h; iy++) {
    const row = Math.min(Math.max(iy, 2), h - 3)
    for (let ix = 0; ix < w; ix++) {
      const col = Math.min(Math.max(ix, 2), w - 3)
      let sum = 0
      let sq = 0
      for (let y = row - 1; y < row + 2; y++) for (let x = col - 2; x < col + 3; x++) {
        const v = Y(x, y)
        sum += v
        sq += v * v
      }
      for (let x = col - 1; x < col + 2; x++) {
        const a = Y(x, row - 2)
        const b = Y(x, row + 2)
        sum += a + b
        sq += a * a + b * b
      }
      const sd = Math.sqrt(Math.max(0, sq - (sum * sum) / 21) / 21)
      const mean = Math.max(1.17549435e-38, sum / 21)
      const t = Math.log(1 + sd / Math.sqrt(mean))
      const weight = 1 / (1 + Math.exp(offset - 200 * t))
      blend[iy * w + ix] = Math.min(1, Math.max(0, clipMask[iy * w + ix] * 1.01011 * (weight - 0.01)))
    }
  }
  const rad = Math.ceil(3 * MASK_SIGMA)
  const blurred = gaussLine(gaussLine(blend, w, h, MASK_SIGMA ** 2, rad, true), w, h, MASK_SIGMA ** 2, rad, false)
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const diff = blend[i] - blurred[i]
    const k = 1 / (1 + Math.exp(5 - 10 * diff))
    out[i] = Math.min(1, Math.max(0, k * blend[i] + (1 - k) * blurred[i]))
  }
  return out
}

/** The interim sharpening of camera RGB `cam` in place; returns the mask. */
export function sharpenCpu(cam: Float32Array, w: number, h: number, run: SharpenRun, clipWb: [number, number, number]): Float32Array {
  const mask = sharpenMask(cam, w, h, run.cs, clipWb)
  const Y = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) Y[i] = luma(cam, i)
  const blurred = gaussLine(gaussLine(Y, w, h, run.sigma2, run.rad, true), w, h, run.sigma2, run.rad, false)
  for (let i = 0; i < w * h; i++) {
    const y = Y[i]
    const diff = y - blurred[i]
    const t = run.threshold * y
    const detail = Math.abs(diff) > t ? Math.sign(diff) * Math.max(Math.abs(diff) - t, 0) : 0
    const m = mask[i]
    const yNew = y + (y + detail * run.amount - y) * m
    if (m > 0 && y >= YMIN) {
      const f = Math.max(yNew / Math.max(y, YMIN), 0)
      for (let c = 0; c < 3; c++) cam[3 * i + c] *= f
    }
  }
  return mask
}
