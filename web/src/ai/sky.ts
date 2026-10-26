// The Sky mask with EfficientViT-Seg B1 (ADE20K) (docs/PHASE3.md Part 29): the pre- and post-processing, as pure code.
// The app runs it with the runtime worker (ai/skySelect.ts); the "AI models" workflow's sky-check runs this same file in
// Node on the real model (web/scripts/sky-check.mjs).
//
// The model's own processing (mit-han-lab/efficientvit at de7d773, applications/efficientvit_seg/
// eval_efficientvit_seg_model.py, ADE20KDataset): the photo's short side resized to 512 and its long side to the next
// multiple of 32 above the same scale (the aspect kept, within one 32-pixel step); RGB / 255 minus ImageNet's mean, over
// its std. The model gives 150 class scores per cell of 8 × 8 input pixels (ADE20K's classes; sky is class 2).
//
// LightBench's matte, in three steps:
//  1. Per cell, the sky's log-odds against all other classes: z_sky − log Σ_{c ≠ sky} e^{z_c} (the logit of the sky's
//     softmax probability), so the 150 scores become one number per cell.
//  2. The log-odds enlarged to the guide's size (bilinear, half-pixel centres) and turned into a probability (the
//     logistic function), so the edge stays where the model puts it (½) while the model's 8-pixel cells don't show.
//  3. The edges refined against the photo as shot, in two steps on its log luminance (the guide of the masks' Refine:
//     engine/develop/mask-math.ts `guideValue`):
//     a. A local two-tone fit, a guided filter whose two references come from the model: within about two model cells
//        of each pixel, the photo's typical sky tone (the guide averaged with the weights p²) and its typical other tone
//        (weights (1 − p)²); where they differ clearly, the pixel's own tone between them says how much of it is sky.
//        It moves only where both are present nearby (the edges), so the model's answer stands inside the sky (clouds
//        included) and inside the land. This is what puts thin branches, and the sky between leaves, back into the
//        matte: the model sees the photo in cells of 8 × 8 of its input pixels and can't.
//     b. The engine's guided filter (mask-math.ts `refineCpu`: He and Sun's fast guided filter, as the masks' Refine
//        slider runs it), radius 2 pixels, which smooths what step a leaves noisy while keeping the edges on the photo's.
//     (The guided filter alone, at one or two cells, was tried first: in the synthetic test (sky.test.ts) it lowered the
//     error at the edges only from 0.21 to 0.19, because the model's matte barely varies where a thin branch crosses the
//     sky; with step a it is 0.024. Dehaze's colour guided filter, effects.ts `guidedFilterCpu`, made edges worse: its
//     guard against a nearly singular 3 × 3 solve, kept from darktable, makes it a box blur at a clean edge between two
//     flat colours unless eps is large.)
// The guide is the photo as shot (Develop's rendering in the camera's orientation, as for the Depth map and Object
// select), at most 1024 pixels on its long side; the matte is then moved into the SENSOR frame through the rendering's
// uv → sensor map and stored at most 1024 texels on its long side (owner, 2026-10-22), 8 bits, like every AI matte.

import { applyMap } from '../engine/develop/geometry'
import { invert, type Mat3 } from '../engine/color/matrix'
import { guideValue, refineCpu } from '../engine/develop/mask-math'
import { toTensor } from './depth'
import type { SkyInput } from './manifest'

/** Our export's input and output names (web/scripts/sky/export_efficientvit.py). */
export const SKY_IO = { pixels: 'pixel_values', logits: 'logits' } as const

/**
 * The model's input size (width, height) for a w × h photo: the short side to `shortSide`, the long side to the next
 * multiple of `multiple` at the same scale (EfficientViT's ADE20K evaluation), not more than `maxLong` (a panorama is
 * then squeezed a little along its length).
 */
export function skyModelSize(w: number, h: number, input: Pick<SkyInput, 'shortSide' | 'multiple' | 'maxLong'>): [number, number] {
  const s = input.shortSide
  const k = input.multiple
  const capped = Math.max(s, Math.floor(input.maxLong / k) * k)
  const long = (a: number, b: number) => Math.min(capped, Math.ceil(((a / b) * s) / k) * k)
  return w >= h ? [long(w, h), s] : [s, long(h, w)]
}

/** The largest tensor the graph makes at this input size (bytes): measured per input pixel by the export task. */
export const skyLargestTensor = (mw: number, mh: number, input: Pick<SkyInput, 'bytesPerPixel'>) => input.bytesPerPixel * mw * mh

/** The guide's long side, and so the rendering's: the stored matte's 1024, or the model's input if larger (≤ the photo). */
export const SKY_GUIDE_LONG = 1024
export const skyRenderLong = (sensorLong: number, model: [number, number]) => Math.min(sensorLong, Math.max(SKY_GUIDE_LONG, model[0], model[1]))

/** The model's input: the rendering resized to mw × mh, normalised (float32 NCHW [1, 3, mh, mw]). */
export function skyTensor(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, mw: number, mh: number, input: Pick<SkyInput, 'mean' | 'std'>): Float32Array {
  return toTensor(rgba, w, h, mw, mh, input.mean, input.std)
}

/** One number per model cell (lw × lh). */
export interface Grid {
  data: Float32Array
  w: number
  h: number
}

/**
 * The sky's log-odds per cell from the model's scores ([1, classes, lh, lw]): z_sky − log Σ_{c ≠ sky} e^{z_c}, computed
 * stably. Positive where the model finds sky more likely than not.
 */
export function skyLogOdds(scores: Float32Array, dims: readonly number[], skyClass: number): Grid {
  const lh = dims[dims.length - 2]
  const lw = dims[dims.length - 1]
  const classes = dims[dims.length - 3]
  const n = lw * lh
  if (!(classes > skyClass) || scores.length !== classes * n) throw new Error(`The model gave scores of shape ${dims.join(' × ')}.`)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let mx = -Infinity
    for (let c = 0; c < classes; c++) if (c !== skyClass && scores[c * n + i] > mx) mx = scores[c * n + i]
    let s = 0
    for (let c = 0; c < classes; c++) if (c !== skyClass) s += Math.exp(scores[c * n + i] - mx)
    out[i] = scores[skyClass * n + i] - (mx + Math.log(s))
  }
  return { data: out, w: lw, h: lh }
}

/** The share of cells whose highest score is the sky (the model's own answer, as MASKS_PREP.md measured it). */
export function skyArgmaxShare(scores: Float32Array, dims: readonly number[], skyClass: number): number {
  const n = dims[dims.length - 1] * dims[dims.length - 2]
  const classes = dims[dims.length - 3]
  let k = 0
  for (let i = 0; i < n; i++) {
    let best = 0
    for (let c = 1; c < classes; c++) if (scores[c * n + i] > scores[best * n + i]) best = c
    if (best === skyClass) k++
  }
  return n ? k / n : 0
}

/** A grid's value at uv (bilinear, half-pixel centres, clamped at the edges: PyTorch's `align_corners=False`). */
export function gridAt(g: Grid, u: number, v: number): number {
  const x = Math.min(g.w - 1, Math.max(0, u * g.w - 0.5))
  const y = Math.min(g.h - 1, Math.max(0, v * g.h - 0.5))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(g.w - 1, x0 + 1)
  const y1 = Math.min(g.h - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const d = g.data
  return (d[y0 * g.w + x0] * (1 - fx) + d[y0 * g.w + x1] * fx) * (1 - fy) + (d[y1 * g.w + x0] * (1 - fx) + d[y1 * g.w + x1] * fx) * fy
}

const logistic = (z: number) => 1 / (1 + Math.exp(-z))

/** The edge refinement's settings (see the top of this file). */
export interface SkyRefine {
  /** Step a: the window's half-width in model cells, the weights' power, and the least tone difference (0…1 guide). */
  cells: number
  power: number
  minContrast: number
  /** Step b: the guided filter's radius in guide pixels and its eps; radius 0 skips it. */
  fineRadius: number
  fineEps: number
}
/**
 * LightBench's choice, from the synthetic test in sky.test.ts (a tree's branches and twigs against a sky that brightens
 * towards the horizon, the model's view stood in for by the true matte averaged over 8-pixel cells): the error at the
 * edges falls from 0.21 (the enlargement alone) to about 0.024. Not tuned on real photos (docs/PHASE3.md Part 29).
 */
export const SKY_REFINE: SkyRefine = { cells: 2, power: 2, minContrast: 0.03, fineRadius: 2, fineEps: 1e-4 }

/**
 * The matte over the guide (w × h, 0…1): the log-odds enlarged and made a probability, then refined against the photo
 * (RGBA 8-bit). `refine` null: the plain enlargement (for comparisons).
 */
export function skyMatte(lo: Grid, rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, refine: SkyRefine | null = SKY_REFINE): Float32Array {
  const n = w * h
  let p = new Float32Array(n)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p[y * w + x] = logistic(gridAt(lo, (x + 0.5) / w, (y + 0.5) / h))
  if (refine) {
    const guide = skyGuide(rgba, n)
    const cell = Math.max(w / lo.w, h / lo.h)
    p = twoTone(p, guide, w, h, Math.max(1, Math.round(refine.cells * cell)), refine.power, refine.minContrast)
    if (refine.fineRadius > 0) p = refineCpu(p, guide, w, h, refine.fineRadius, refine.fineEps)
  }
  return p
}

/** Sums over (2r + 1)² windows, edges repeated (running sums: the cost doesn't grow with r). */
export function boxSum(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const t = new Float32Array(w * h)
  const o = new Float32Array(w * h)
  const cx = (x: number) => (x < 0 ? 0 : x >= w ? w - 1 : x)
  const cy = (y: number) => (y < 0 ? 0 : y >= h ? h - 1 : y)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let s = 0
    for (let x = -r; x <= r; x++) s += a[row + cx(x)]
    for (let x = 0; x < w; x++) {
      t[row + x] = s
      s += a[row + cx(x + r + 1)] - a[row + cx(x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0
    for (let y = -r; y <= r; y++) s += t[cy(y) * w + x]
    for (let y = 0; y < h; y++) {
      o[y * w + x] = s
      s += t[cy(y + r + 1) * w + x] - t[cy(y - r) * w + x]
    }
  }
  return o
}

/**
 * Step a (see the top of this file): per pixel, the sky's and the rest's typical guide tones within radius r (weights
 * p^k and (1 − p)^k); where they differ by at least `minContrast`, the pixel's tone placed between them (0 the rest, 1
 * the sky), mixed in as far as both are present (fully from a 5 % share of the window each).
 */
export function twoTone(p: Float32Array, g: Float32Array, w: number, h: number, r: number, k: number, minContrast: number): Float32Array {
  const n = w * h
  const ws = new Float32Array(n)
  const wg = new Float32Array(n)
  const wsI = new Float32Array(n)
  const wgI = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const s = p[i] ** k
    const q = (1 - p[i]) ** k
    ws[i] = s
    wg[i] = q
    wsI[i] = s * g[i]
    wgI[i] = q * g[i]
  }
  const S = boxSum(ws, w, h, r)
  const G = boxSum(wg, w, h, r)
  const SI = boxSum(wsI, w, h, r)
  const GI = boxSum(wgI, w, h, r)
  const N = (2 * r + 1) ** 2
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const share = Math.min(S[i], G[i]) / N
    const ms = SI[i] / Math.max(S[i], 1e-6)
    const mg = GI[i] / Math.max(G[i], 1e-6)
    const c = ms - mg
    if (share < 1e-3 || Math.abs(c) < minContrast) {
      out[i] = p[i]
      continue
    }
    const t = Math.min(1, Math.max(0, (g[i] - mg) / c))
    out[i] = p[i] + (t - p[i]) * Math.min(1, share * 20)
  }
  return out
}

/** sRGB (8 bits) → linear, as a table. */
const SRGB_LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
})

/** The guide: each pixel's log luminance mapped to 0…1, as the masks' Refine has it (mask-math.ts `guideValue`). */
export function skyGuide(rgba: Uint8ClampedArray | Uint8Array, n: number): Float32Array {
  const g = new Float32Array(n)
  for (let i = 0; i < n; i++) g[i] = guideValue([SRGB_LINEAR[rgba[4 * i]], SRGB_LINEAR[rgba[4 * i + 1]], SRGB_LINEAR[rgba[4 * i + 2]]])
  return g
}

/** The matte's size in the sensor frame: the sensor's aspect, `long` texels on its long side (not more than the sensor). */
export function skyMatteSize(sensor: [number, number], long: number): [number, number] {
  const k = Math.min(1, long / Math.max(sensor[0], sensor[1]))
  return [Math.max(1, Math.round(sensor[0] * k)), Math.max(1, Math.round(sensor[1] * k))]
}

/**
 * The matte stored in the edit: each sensor-frame texel's centre mapped to as-shot uv (the inverse of the rendering's
 * uv → sensor map), the matte read there bilinearly, 8 bits (255 = sky).
 */
export function skyToSensor(matte: Float32Array, w: number, h: number, uvToSensor: Mat3, sensor: [number, number], long: number): { px: Uint8Array; w: number; h: number } {
  const [sw, sh] = skyMatteSize(sensor, long)
  const out = new Uint8Array(sw * sh)
  const toShot = invert(uvToSensor)
  const g: Grid = { data: matte, w, h }
  for (let j = 0; j < sh; j++) {
    for (let i = 0; i < sw; i++) {
      const [u, v] = applyMap(toShot, (i + 0.5) / sw, (j + 0.5) / sh)
      out[j * sw + i] = Math.round(255 * Math.min(1, Math.max(0, gridAt(g, u, v))))
    }
  }
  return { px: out, w: sw, h: sh }
}

/** Non-finite values anywhere: the result can't be used. */
export const finiteAll = (d: ArrayLike<number>) => {
  for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) return false
  return true
}
