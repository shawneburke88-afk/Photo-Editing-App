// darktable's capture sharpening (src/iop/demosaicing/capture.c, darktable developers, GPL-3.0-or-later; "Credits go
// to: Ingo Weyrich (heckflosse67@gmx.de), he implemented the original algorithm for rawtherapee", lines 19-20): the
// parts computed on the CPU — the automatic radius from the raw data, the 9 × 9 Gaussian kernel table, the per-pixel
// sigma — plus LightBench's diffraction fallback for the radius. Line numbers are darktable's at ca5a020.

import type { SensorData } from '../raw/types'

/** capture.c CAPTURE_GAUSS_FRACTION (line 43): the kernel table holds sigmas in steps of 0.01 px. */
export const GAUSS_FRACTION = 0.01
/** capture.c CAPTURE_KERNEL_ALIGN (line 42): floats per kernel in the table (25 used). */
export const KERNEL_ALIGN = 32
/** capture.c CAPTURE_SMALL (line 47): below this sigma the kernel is 5 × 5. */
export const CAPTURE_SMALL = 0.66
/** capture.c `_sigma_to_index`: kernels 0…255. */
export const KERNELS = 256

/**
 * darktable's table of 9 × 9 Gaussians (`_calc_9x9_gauss_coeffs`, lines 79-103; built in demosaic.c `init_global`,
 * line 1407, with sigma = max(1e-7, i · 0.01)): one quadrant (5 × 5, [5·|dy| + |dx|]) per kernel, normalised over
 * the taps inside a circle of radius 2.5 (sigma < 0.66) or 4.5.
 */
export function captureKernels(): Float32Array {
  const table = new Float32Array(KERNELS * KERNEL_ALIGN)
  for (let i = 0; i < KERNELS; i++) {
    const sigma = Math.max(1e-7, i * GAUSS_FRACTION)
    const range = sigma < CAPTURE_SMALL ? 2.5 * 2.5 : 4.5 * 4.5
    const temp = -2 * sigma * sigma
    const kernel: number[][] = []
    let sum = 0
    for (let k = -4; k < 5; k++) {
      const row: number[] = []
      for (let j = -4; j < 5; j++) {
        const rad = k * k + j * j
        const v = rad <= range ? Math.fround(Math.exp(rad / temp)) : 0
        row.push(v)
        sum += v
      }
      kernel.push(row)
    }
    for (let k = 0; k < 5; k++) for (let j = 0; j < 5; j++) table[i * KERNEL_ALIGN + 5 * k + j] = kernel[k + 4][j + 4] / sum
  }
  return table
}

/** The kernel index of a pixel: sigma tapered to 0 over the outer 8 pixels (`_cs_precalc_gauss_idx`, lines 111-144). */
export function kernelIndex(sigma: number, x: number, y: number, w: number, h: number): number {
  const s = sigma * 0.125 * Math.min(8, h - y - 1, w - x - 1, x, y)
  return Math.min(KERNELS - 1, Math.max(0, Math.trunc(Math.fround(s / GAUSS_FRACTION))))
}

const RAWEPS = 0.005
const LOWER = 0.01
const UPPER = 0.9

/**
 * The radius darktable measures from the raw data (`_calc_auto_radius`, lines 408-513, with `_calcRadiusBayer`
 * 149-212 and `_calcRadiusXtrans` 277-406): from the centre 60 % of the frame, the largest ratio between neighbouring
 * green photosites that aren't near clipping gives sigma = √(1 / ln ratio) (+0.2 px for X-Trans), at most 1.5.
 * Values are the sensor's (raw − black) / (white − black), times the white-balance coefficient divided by
 * max(1, coefficient) as darktable feeds them. Returns null when it can't be measured: a linear (already demosaiced)
 * file, a photo under 1000 px (darktable then uses 0.5), or no usable pair (darktable's formula gives infinity).
 */
export function measureRadius(sensor: SensorData, wb: [number, number, number]): number | null {
  const { width: W, height: H, layout } = sensor
  if (layout === 'linear' || W < 1000 || H < 1000) return null
  let dx = Math.trunc(0.2 * W)
  let dy = Math.trunc(0.2 * H)
  dx = Math.trunc(dx / 6) * 6
  dy = Math.trunc(dy / 6) * 6
  const ow = Math.trunc(Math.min(W - dx, 0.8 * W - dx))
  const oh = Math.trunc(Math.min(H - dy, 0.8 * H - dy))
  const xt = layout === 'xtrans' && sensor.xtrans ? sensor.xtrans : null
  const colour = (r: number, c: number) => (xt ? xt[(r % 6) * 6 + (c % 6)] : sensor.cfa[(r & 1) * 2 + (c & 1)])
  const pos = (r: number, c: number) => (r & 1) * 2 + (c & 1)
  const scale = [0, 1, 2].map((c) => wb[c] / Math.max(1, wb[c]))
  const d = sensor.data
  const v = (r: number, c: number) => {
    // Local coordinates in the centre crop; dx and dy are multiples of 6, so the pattern's phase is kept.
    const R = r + dy
    const C = c + dx
    const b = sensor.black[pos(R, C)]
    return Math.max(0, ((d[R * W + C] - b) / (sensor.white - b)) * scale[colour(R, C)])
  }
  let maxRatio = 1
  if (!xt) {
    const fc = [colour(dy, dx), colour(dy + 1, dx)]
    for (let row = 4; row < oh - 4; row++) {
      for (let col = 5 + (fc[row & 1] & 1); col < ow - 4; col += 2) {
        const val00 = v(row, col)
        if (!(val00 > RAWEPS)) continue
        const val1m1 = v(row + 1, col - 1)
        const val1p1 = v(row + 1, col + 1)
        const max0 = Math.max(val00, val1m1)
        if (val1m1 > RAWEPS && max0 > LOWER) {
          const min = Math.min(val00, val1m1)
          if (max0 > maxRatio * min) {
            const clipped = max0 === val00
              ? Math.max(v(row - 1, col - 1), v(row - 1, col + 1), val1p1) >= UPPER
              : Math.max(v(row, col - 2), val00, v(row + 2, col - 2), v(row + 2, col)) >= UPPER
            if (!clipped) maxRatio = max0 / min
          }
        }
        const max1 = Math.max(val00, val1p1)
        if (val1p1 > RAWEPS && max1 > LOWER) {
          const min = Math.min(val00, val1p1)
          if (max1 > maxRatio * min) {
            const clipped = max1 === val00
              ? Math.max(v(row - 1, col - 1), v(row - 1, col + 1), val1p1) >= UPPER
              : Math.max(val00, v(row, col + 2), v(row + 2, col), v(row + 2, col + 2)) >= UPPER
            if (!clipped) maxRatio = max1 / min
          }
        }
      }
    }
  } else {
    // A solitary green whose left and right neighbours differ and whose upper and left neighbours aren't green.
    let sx = 6
    let sy = 6
    let found = false
    for (sy = 6; sy < 12 && !found; sy++) {
      for (sx = 6; sx < 12 && !found; sx++) {
        if (colour(sy + dy, sx + dx) === 1 && colour(sy + dy, sx - 1 + dx) !== colour(sy + dy, sx + 1 + dx) && colour(sy - 1 + dy, sx + dx) !== 1 && colour(sy + dy, sx - 1 + dx) !== 1) {
          found = true
          break
        }
      }
      // darktable's outer loop still increments starty after the inner `break` (its `!found` test comes after).
      if (found) {
        sy++
        break
      }
    }
    const pair = (a: number, b: number) => {
      if (b > RAWEPS) {
        const mx = Math.max(a, b)
        if (mx > LOWER) {
          const mn = Math.min(a, b)
          if (mx > maxRatio * mn) maxRatio = mx / mn
        }
      }
    }
    for (let row = sy + 2; row < oh - 4; row += 3) {
      for (let col = sx + 2; col < ow - 4; col += 3) {
        const p11 = v(row + 1, col + 1)
        const squareClipped = Math.max(p11, v(row + 1, col + 2), v(row + 2, col + 1), v(row + 2, col + 2)) >= UPPER
        const solitary = v(row, col)
        if (solitary > RAWEPS && Math.max(v(row - 1, col - 1), v(row - 1, col + 1)) < UPPER) {
          if (solitary < UPPER) {
            const pm1 = v(row + 1, col - 1)
            if (pm1 > RAWEPS && Math.max(v(row + 1, col - 2), pm1, v(row + 2, col - 2), v(row + 1, col - 1)) < UPPER) pair(solitary, pm1)
            if (p11 > RAWEPS && !squareClipped) pair(solitary, p11)
          }
        }
        if (!squareClipped) {
          const p22 = v(row + 2, col + 2)
          if (p22 > RAWEPS) {
            if (p11 > RAWEPS) pair(p11, p22)
            const right = v(row + 3, col + 3)
            if (Math.max(right, v(row + 4, col + 2), v(row + 4, col + 4)) < UPPER && right > RAWEPS) pair(right, p22)
          }
          const p12 = v(row + 1, col + 2)
          const p21 = v(row + 2, col + 1)
          if (p21 > RAWEPS) {
            if (p12 > RAWEPS) pair(p12, p21)
            const left = v(row + 3, col)
            if (Math.max(left, v(row + 4, col - 1), v(row + 4, col + 1)) < UPPER && left > RAWEPS) pair(left, p21)
          }
        }
      }
    }
  }
  const r = Math.sqrt(1 / Math.log(maxRatio)) + (xt ? 0.2 : 0)
  return Number.isFinite(r) ? Math.min(1.5, Math.max(0, r)) : null
}

/**
 * LightBench's fallback when the radius can't be measured (docs/research/DETAIL_DENOISE_SHARPEN.md section 3.6): the
 * blur of diffraction, a Gaussian fitted to the Airy core (sigma ≈ 0.42 · λ · N, λ = 0.55 µm; general knowledge, not a
 * published calibration), and of the pixel's own aperture (1/√12 px), added in quadrature, in pixels of the sensor's
 * pitch (36 mm / crop factor / width). Without an f-number or crop factor, darktable's default 0.5 px.
 */
export function diffractionRadius(fNumber: number, cropFactor: number, widthPx: number): number {
  if (!(fNumber > 0) || !(cropFactor > 0) || !(widthPx > 0)) return 0.5
  const pitchUm = ((36 / cropFactor) * 1000) / widthPx
  const diffraction = (0.42 * 0.55 * fNumber) / pitchUm
  return Math.min(1.5, Math.max(0.25, Math.hypot(diffraction, 1 / Math.sqrt(12))))
}

/** How the radius of a photo was found, for the Sharpening section. */
export interface RadiusChoice {
  sigma: number
  from: 'measured' | 'diffraction' | 'default' | 'manual'
  fNumber?: number
}
