// The Subject mask with BiRefNet_lite (docs/PHASE3.md Part 30): the pre- and post-processing, as pure code. The app runs
// it with the runtime worker (ai/subjectSelect.ts); the "AI models" workflow's subject-check runs this same file in Node
// on the real model (web/scripts/subject-check.mjs).
//
// BiRefNet's own processing (ZhengPeng7/BiRefNet's inference code, and transformers.js' processor config for
// onnx-community/BiRefNet_lite-ONNX, which the patched file keeps): the photo resized to 1024 × 1024 WITHOUT keeping its
// aspect, RGB / 255, minus ImageNet's mean, over its std. The model gives one number per pixel of that square
// (`output_image` [1, 1, 1024, 1024], logits); BiRefNet's own output is their sigmoid, resized back to the photo
// (bilinear). LightBench keeps exactly that: the probability itself is the matte, so hair and other fine, partly
// covering edges stay soft (no threshold, no ramp).
// The photo is Develop's rendering as shot (the one Object select and the Depth map use: the edit's tones and colours, in
// the camera's orientation), at 1.5 × the model's input on its long side; the matte is moved into the SENSOR frame
// through the rendering's uv → sensor map and stored at most 1024 texels on its long side (owner, 2026-10-22), 8 bits,
// like every AI matte.

import { applyMap } from '../engine/develop/geometry'
import { invert, type Mat3 } from '../engine/color/matrix'
import { toTensor } from './depth'
import type { SegmentInput } from './manifest'

/** The model's input and output names (onnx-community/BiRefNet_lite-ONNX, kept by LightBench's patch). */
export const SUBJECT_IO = { pixels: 'input_image', matte: 'output_image' } as const

/** Develop renders the photo at 1.5 × the model's input on its long side (a clean resize, as for Object select). */
export const subjectRenderLong = (input: Pick<SegmentInput, 'size'>, sensorLong: number) => Math.min(sensorLong, Math.ceil(input.size * 1.5))

/** The model's input: the rendering stretched to size × size, normalised (float32 NCHW [1, 3, size, size]). */
export function subjectTensor(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, input: SegmentInput): Float32Array {
  return toTensor(rgba, w, h, input.size, input.size, input.mean, input.std)
}

/** One number per cell of the model's square. */
export interface Grid {
  data: Float32Array
  w: number
  h: number
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

/** The model's logits ([1, 1, h, w]) → how much each cell belongs to the subject, 0…1 (their sigmoid). */
export function subjectProbabilities(logits: Float32Array, dims: readonly number[]): Grid {
  const h = dims[dims.length - 2]
  const w = dims[dims.length - 1]
  if (!(w > 0 && h > 0) || logits.length !== w * h) throw new Error(`The model gave a matte of shape ${dims.join(' × ')}.`)
  const out = new Float32Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = sigmoid(logits[i])
  return { data: out, w, h }
}

/** A grid's value at uv (bilinear, half-pixel centres, clamped at the edges: PyTorch's `align_corners=False`). */
export function probAt(g: Grid, u: number, v: number): number {
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

/** The matte's size in the sensor frame: the sensor's aspect, `long` texels on its long side (not more than the sensor). */
export function subjectMatteSize(sensor: [number, number], long: number): [number, number] {
  const k = Math.min(1, long / Math.max(sensor[0], sensor[1]))
  return [Math.max(1, Math.round(sensor[0] * k)), Math.max(1, Math.round(sensor[1] * k))]
}

/**
 * The matte stored in the edit: each sensor-frame texel's centre mapped to as-shot uv (the inverse of the rendering's
 * uv → sensor map; the model's square covers the whole rendering, stretched), the probability read there bilinearly,
 * 8 bits (255 = the subject).
 */
export function subjectToSensor(p: Grid, uvToSensor: Mat3, sensor: [number, number], long: number): { px: Uint8Array; w: number; h: number } {
  const [w, h] = subjectMatteSize(sensor, long)
  const out = new Uint8Array(w * h)
  const toShot = invert(uvToSensor)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const [u, v] = applyMap(toShot, (i + 0.5) / w, (j + 0.5) / h)
      out[j * w + i] = Math.round(255 * Math.min(1, Math.max(0, probAt(p, u, v))))
    }
  }
  return { px: out, w, h }
}

/** Non-finite values anywhere: the result can't be used. */
export const finiteAll = (d: ArrayLike<number>) => {
  for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) return false
  return true
}

/** The share of the model's cells it gives more to the subject than to the rest (probability ≥ ½). */
export function subjectShare(p: Grid): number {
  let n = 0
  for (let i = 0; i < p.data.length; i++) if (p.data[i] >= 0.5) n++
  return p.data.length ? n / p.data.length : 0
}
