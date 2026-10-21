// Object select with SAM 2.1 Hiera Tiny (docs/PHASE3.md Part 27): the pre- and post-processing, as pure code. The app
// runs it with the runtime worker (ai/objectSelect.ts); the "AI models" workflow's sam-check runs this same file in Node
// on the real model (web/scripts/sam-check.mjs).
//
// SAM 2's own processing (facebookresearch/sam2 `sam2/utils/transforms.py` SAM2Transforms, and Hugging Face
// transformers' Sam2Processor, which the onnx-community export follows):
//  - the image is resized to size × size (1024 × 1024) WITHOUT keeping its aspect (no padding: SAM 2 differs from
//    SAM 1 here), RGB / 255, minus ImageNet's mean, over its std;
//  - point and box coordinates are scaled the same way: x × size / width, y × size / height;
//  - the encoder gives three image embeddings (256², 128², 64² cells); the prompt decoder takes them with the prompt
//    and gives three candidate masks as logits over a 256 × 256 grid of the same stretched image, a predicted IoU for
//    each, and an object score (above 0: there is an object there);
//  - the masks are enlarged bilinearly (half-pixel centres, `align_corners=False`) to the photo's size; SAM 2 then
//    thresholds the logits at 0. LightBench keeps the edge: the matte is the logits' sigmoid, 8 bits.
// The photo is the one the Depth map uses (ai/depth.ts): Develop's rendering as shot, in the camera's orientation; the
// prompt and the matte are moved between it and the SENSOR frame through the rendering's uv → sensor map.

import { applyMap } from '../engine/develop/geometry'
import { invert, type Mat3 } from '../engine/color/matrix'
import type { AiPrompt } from '../engine/develop/masks'
import { toTensor } from './depth'
import type { SegmentInput } from './manifest'

/** The export's input and output names (onnx-community/sam2.1-hiera-tiny-ONNX at 814a066; MASKS_PREP.md). */
export const SAM_IO = {
  pixels: 'pixel_values',
  embeddings: ['image_embeddings.0', 'image_embeddings.1', 'image_embeddings.2'],
  points: 'input_points',
  labels: 'input_labels',
  boxes: 'input_boxes',
  iou: 'iou_scores',
  masks: 'pred_masks',
  object: 'object_score_logits',
} as const

/** Develop renders the photo for the encoder at 1.5 × its input size on the long side (a clean resize, as for Depth). */
export const renderLong = (input: SegmentInput, sensorLong: number) => Math.min(sensorLong, Math.ceil(input.size * 1.5))

/** The encoder's input: the rendering stretched to size × size, normalised (float32 NCHW [1, 3, size, size]). */
export function encoderInput(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, input: SegmentInput): Float32Array {
  return toTensor(rgba, w, h, input.size, input.size, input.mean, input.std)
}

/** A prompt on the as-shot rendering: uv 0…1 (points with their label: 1 adds, 0 removes; a box as two corners). */
export interface ShotPrompt {
  points: [number, number, 0 | 1][]
  box?: [number, number, number, number]
}

/**
 * How a box reaches the decoder: as the export's `input_boxes` [1, 1, 4] ("boxes"), or as its two corners with SAM's
 * box-corner labels 2 and 3 among the points ("corners", SAM 2's own `concat_points`). The "AI models" workflow's
 * sam-check runs both on the real model; the app uses BOX_AS.
 */
export type BoxAs = 'boxes' | 'corners'
export const BOX_AS: BoxAs = 'boxes'

/**
 * The prompt decoder's prompt inputs. Points are [1, 1, n, 2] with labels [1, 1, n] (int64: 1 adds, 0 removes); without
 * a box, `input_boxes` is an empty [1, 0, 4] (as the masks-prep run fed it).
 */
export function promptFeeds(p: ShotPrompt, size: number, boxAs: BoxAs = BOX_AS): { points: Float32Array; pointDims: number[]; labels: BigInt64Array; labelDims: number[]; boxes: Float32Array; boxDims: number[] } {
  const b = p.box ? [Math.min(p.box[0], p.box[2]), Math.min(p.box[1], p.box[3]), Math.max(p.box[0], p.box[2]), Math.max(p.box[1], p.box[3])] : null
  const pts: [number, number, number][] = p.points.map(([u, v, l]) => [u, v, l])
  if (b && boxAs === 'corners') pts.push([b[0], b[1], 2], [b[2], b[3], 3])
  const n = pts.length
  const points = new Float32Array(n * 2)
  const labels = new BigInt64Array(n)
  pts.forEach(([u, v, l], i) => {
    points[2 * i] = u * size
    points[2 * i + 1] = v * size
    labels[i] = BigInt(l)
  })
  const boxes = b && boxAs === 'boxes' ? Float32Array.from(b.map((x) => x * size)) : new Float32Array(0)
  return { points, pointDims: [1, 1, n, 2], labels, labelDims: [1, 1, n], boxes, boxDims: [1, boxes.length ? 1 : 0, 4] }
}

/** The candidate with the highest predicted IoU (SAM's own choice with several masks). */
export function bestMask(iou: ArrayLike<number>): number {
  let best = 0
  for (let i = 1; i < iou.length; i++) if (iou[i] > iou[best]) best = i
  return best
}

/** One of the decoder's masks: its logits (lw × lh, over the stretched as-shot image). */
export interface Logits {
  data: Float32Array
  w: number
  h: number
  /** The model's predicted IoU and its object score (above 0: something is there). */
  iou: number
  object: number
}

/** The chosen mask from the decoder's outputs (pred_masks [1, 1, k, lh, lw], iou_scores [1, 1, k], object [1, 1, 1]). */
export function pickMask(masks: Float32Array, dims: number[], iou: Float32Array, object: Float32Array | null): Logits {
  const lh = dims[dims.length - 2]
  const lw = dims[dims.length - 1]
  const k = masks.length / (lw * lh)
  if (!Number.isInteger(k) || k < 1) throw new Error(`The model gave masks of shape ${dims.join(' × ')}.`)
  const i = iou.length === k ? bestMask(iou) : 0
  return { data: masks.subarray(i * lw * lh, (i + 1) * lw * lh), w: lw, h: lh, iou: iou[i] ?? 0, object: object?.[0] ?? 1 }
}

/** Non-finite values (fp16 overflow, ONNX Runtime issue #26732) anywhere: the result can't be used. */
export const finiteAll = (d: ArrayLike<number>) => {
  for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) return false
  return true
}

/** The logits at as-shot uv (bilinear, half-pixel centres, clamped at the edges: PyTorch's `align_corners=False`). */
export function logitAt(l: Pick<Logits, 'data' | 'w' | 'h'>, u: number, v: number): number {
  const x = Math.min(l.w - 1, Math.max(0, u * l.w - 0.5))
  const y = Math.min(l.h - 1, Math.max(0, v * l.h - 0.5))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(l.w - 1, x0 + 1)
  const y1 = Math.min(l.h - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const d = l.data
  return (d[y0 * l.w + x0] * (1 - fx) + d[y0 * l.w + x1] * fx) * (1 - fy) + (d[y1 * l.w + x0] * (1 - fx) + d[y1 * l.w + x1] * fx) * fy
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

/** The matte's size in the sensor frame: the sensor's aspect, `long` texels on its long side (not more than the sensor). */
export function matteSize(sensor: [number, number], long: number): [number, number] {
  const k = Math.min(1, long / Math.max(sensor[0], sensor[1]))
  return [Math.max(1, Math.round(sensor[0] * k)), Math.max(1, Math.round(sensor[1] * k))]
}

/**
 * The matte stored in the edit: each sensor-frame texel's centre mapped to as-shot uv (the inverse of the rendering's
 * uv → sensor map), the logits read there bilinearly, their sigmoid in 8 bits (255 = selected). No object (object
 * score ≤ 0): all 0.
 */
export function matteToSensor(l: Logits, uvToSensor: Mat3, sensor: [number, number], long: number): { px: Uint8Array; w: number; h: number } {
  const [w, h] = matteSize(sensor, long)
  const out = new Uint8Array(w * h)
  if (l.object <= 0) return { px: out, w, h }
  const toShot = invert(uvToSensor)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const [u, v] = applyMap(toShot, (i + 0.5) / w, (j + 0.5) / h)
      out[j * w + i] = Math.round(255 * sigmoid(logitAt(l, u, v)))
    }
  }
  return { px: out, w, h }
}

/** A sensor-frame point (x / width, y / height) on the as-shot rendering (uv), and back. */
export const sensorToShot = (uvToSensor: Mat3, x: number, y: number): [number, number] => applyMap(invert(uvToSensor), x, y) as [number, number]
export const shotToSensor = (uvToSensor: Mat3, u: number, v: number): [number, number] => applyMap(uvToSensor, u, v) as [number, number]

/** A stored prompt (sensor frame) on the as-shot rendering. */
export function promptToShot(p: AiPrompt, uvToSensor: Mat3): ShotPrompt {
  const toShot = invert(uvToSensor)
  const at = (x: number, y: number) => applyMap(toShot, x, y) as [number, number]
  const out: ShotPrompt = { points: (p.points ?? []).map(([x, y, l]) => [...at(x, y), l] as [number, number, 0 | 1]) }
  if (p.box) {
    const a = at(p.box[0], p.box[1])
    const b = at(p.box[2], p.box[3])
    out.box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
  }
  return out
}

/** How much of a matte is selected (0…1), for the log and the tests. */
export function coverage(px: Uint8Array): number {
  let n = 0
  for (let i = 0; i < px.length; i++) n += px[i]
  return px.length ? n / 255 / px.length : 0
}

/**
 * The preview over the photo as drawn: a grid of gw × gh cells over the displayed image, each cell's centre mapped to
 * as-shot uv by `toShot` (null outside the photo), with the mask's selection 0…1 there.
 */
export function previewGrid(l: Logits, gw: number, gh: number, toShot: (u: number, v: number) => [number, number] | null): Float32Array {
  const out = new Float32Array(gw * gh)
  if (l.object <= 0) return out
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const s = toShot((i + 0.5) / gw, (j + 0.5) / gh)
      out[j * gw + i] = s && s[0] >= 0 && s[1] >= 0 && s[0] <= 1 && s[1] <= 1 ? sigmoid(logitAt(l, s[0], s[1])) : 0
    }
  }
  return out
}

/**
 * The outline of a grid's selection (above ½) as an SVG path in grid cells (marching squares, one segment per cell
 * the edge crosses; the overlay scales it to the photo).
 */
export function outlinePath(a: Float32Array, gw: number, gh: number, level = 0.5): string {
  const parts: string[] = []
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= gw || j >= gh ? 0 : a[j * gw + i])
  const lerp = (p: number, q: number) => (level - p) / (q - p || 1e-9)
  for (let j = -1; j < gh; j++) {
    for (let i = -1; i < gw; i++) {
      // Corners at cell centres (i + 0.5, j + 0.5) … (i + 1.5, j + 1.5).
      const tl = at(i, j)
      const tr = at(i + 1, j)
      const br = at(i + 1, j + 1)
      const bl = at(i, j + 1)
      const c = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0)
      if (c === 0 || c === 15) continue
      const x = i + 0.5
      const y = j + 0.5
      const top: [number, number] = [x + lerp(tl, tr), y]
      const right: [number, number] = [x + 1, y + lerp(tr, br)]
      const bottom: [number, number] = [x + lerp(bl, br), y + 1]
      const left: [number, number] = [x, y + lerp(tl, bl)]
      const seg = (p: [number, number], q: [number, number]) => parts.push(`M${p[0].toFixed(2)} ${p[1].toFixed(2)}L${q[0].toFixed(2)} ${q[1].toFixed(2)}`)
      switch (c) {
        case 1: case 14: seg(left, bottom); break
        case 2: case 13: seg(bottom, right); break
        case 3: case 12: seg(left, right); break
        case 4: case 11: seg(top, right); break
        case 6: case 9: seg(top, bottom); break
        case 7: case 8: seg(left, top); break
        case 5: seg(left, top); seg(bottom, right); break
        case 10: seg(top, right); seg(left, bottom); break
      }
    }
  }
  return parts.join('')
}

/** Median and 95th percentile of durations (ms), for the hover summary in Diagnostics. */
export function quantiles(ms: number[]): { median: number; p95: number } {
  if (!ms.length) return { median: 0, p95: 0 }
  const s = [...ms].sort((a, b) => a - b)
  const q = (f: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(f * s.length) - 1))]
  return { median: Math.round(q(0.5)), p95: Math.round(q(0.95)) }
}
