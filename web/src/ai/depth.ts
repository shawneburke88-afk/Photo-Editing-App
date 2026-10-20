// Computing a photo's depth map for the Depth range mask (docs/PHASE3.md Part 24) with Depth Anything V2 Small.
//
// 1. Develop renders the photo AS SHOT: the edit's tones and colours, but no crop, angle, perspective, flips, lens
//    correction or masks, in the camera's orientation (upright, as the model expects), at about the model's size.
// 2. It is resized and normalised as the model's own code does (Depth-Anything-V2 `image2tensor`, commit a561b84: the
//    short side to 518 and both sides to multiples of 14, "lower_bound"; RGB 0…1 minus ImageNet's mean, over its std).
// 3. The model gives relative inverse depth at its input size; it is scaled to 8 bits (depth-map.ts
//    `quantizeDisparity`) and moved into the SENSOR frame through the as-shot rendering's own uv → sensor map (a whole
//    number of quarter turns and flips), so it follows the photo's geometry like every mask (owner's decision 1).
// 4. It is encoded for the edit (depth-map.ts `encodeDepth`).

import { applyMap } from '../engine/develop/geometry'
import { invert, type Mat3 } from '../engine/color/matrix'
import { encodeDepth, quantizeDisparity, type RasterData } from '../engine/develop/depth-map'
import type { DepthShape } from '../engine/develop/masks'
import type { ModelEntry } from './manifest'
import { prepareModel, runModel } from './runtime'
import type { Provider } from './runtime.worker'

/** DA-V2's `constrain_to_multiple_of` (np.round, then up to the minimum). */
function multipleOf(x: number, k: number, min: number): number {
  let y = Math.round(x / k) * k
  if (y < min) y = Math.ceil(x / k) * k
  return y
}

/**
 * The model's input size (width, height) for an image: DA-V2's "lower_bound" resize with keep_aspect_ratio (the side
 * that needs the larger scale reaches `shortSide`), each side a multiple of `multiple`. A model file with fixed sizes
 * gets those.
 */
export function modelSize(w: number, h: number, input: ModelEntry['input'], fixed: [number, number] | null = null): [number, number] {
  if (fixed) return [fixed[1], fixed[0]]
  const s = Math.max(input.shortSide / w, input.shortSide / h)
  return [multipleOf(s * w, input.multiple, input.shortSide), multipleOf(s * h, input.multiple, input.shortSide)]
}

/** The size Develop should render the photo at: its long edge for `modelSize`, a little larger for a clean resize. */
export function renderSize(w: number, h: number, input: ModelEntry['input']): number {
  const [mw, mh] = modelSize(w, h, input)
  return Math.min(Math.max(w, h), Math.ceil(Math.max(mw, mh) * 1.5))
}

/**
 * RGBA pixels → the model's float32 NCHW tensor at mw × mh: an area-weighted resize (a box over each output pixel's
 * footprint, bilinear when enlarging), RGB / 255, minus `mean`, over `std`.
 */
export function toTensor(rgba: Uint8ClampedArray | Uint8Array, iw: number, ih: number, mw: number, mh: number, mean: readonly number[], std: readonly number[]): Float32Array {
  const out = new Float32Array(3 * mw * mh)
  const plane = mw * mh
  const sx = iw / mw
  const sy = ih / mh
  for (let y = 0; y < mh; y++) {
    const y0 = y * sy
    const y1 = y0 + sy
    for (let x = 0; x < mw; x++) {
      const x0 = x * sx
      const x1 = x0 + sx
      const acc = [0, 0, 0]
      let wsum = 0
      if (sx <= 1 && sy <= 1) {
        // Enlarging: bilinear at the centre.
        const cx = Math.min(iw - 1, Math.max(0, (x + 0.5) * sx - 0.5))
        const cy = Math.min(ih - 1, Math.max(0, (y + 0.5) * sy - 0.5))
        const ix = Math.floor(cx)
        const iy = Math.floor(cy)
        const fx = cx - ix
        const fy = cy - iy
        for (const [dx, dy, wt] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]] as const) {
          const i = (Math.min(ih - 1, iy + dy) * iw + Math.min(iw - 1, ix + dx)) * 4
          acc[0] += rgba[i] * wt
          acc[1] += rgba[i + 1] * wt
          acc[2] += rgba[i + 2] * wt
        }
        wsum = 1
      } else {
        for (let py = Math.floor(y0); py < Math.min(ih, Math.ceil(y1)); py++) {
          const wy = Math.min(y1, py + 1) - Math.max(y0, py)
          for (let px = Math.floor(x0); px < Math.min(iw, Math.ceil(x1)); px++) {
            const wt = wy * (Math.min(x1, px + 1) - Math.max(x0, px))
            const i = (py * iw + px) * 4
            acc[0] += rgba[i] * wt
            acc[1] += rgba[i + 1] * wt
            acc[2] += rgba[i + 2] * wt
            wsum += wt
          }
        }
      }
      const o = y * mw + x
      for (let c = 0; c < 3; c++) out[c * plane + o] = (acc[c] / wsum / 255 - mean[c]) / std[c]
    }
  }
  return out
}

/**
 * The model's map (ow × oh over the as-shot image) moved into the sensor frame: each sensor-frame texel's centre is
 * mapped to as-shot uv (the inverse of the rendering's uv → sensor map) and read bilinearly. The texel count stays the
 * model's; the shape follows the sensor's aspect.
 */
export function toSensorFrame(px: Uint8Array, ow: number, oh: number, uvToSensor: Mat3, sensor: [number, number]): { px: Uint8Array; w: number; h: number } {
  const aspect = sensor[0] / sensor[1]
  const w = Math.max(1, Math.round(Math.sqrt(ow * oh * aspect)))
  const h = Math.max(1, Math.round((ow * oh) / w))
  const toShot = invert(uvToSensor)
  const out = new Uint8Array(w * h)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const [u, v] = applyMap(toShot, (i + 0.5) / w, (j + 0.5) / h)
      const x = Math.min(ow - 1, Math.max(0, u * ow - 0.5))
      const y = Math.min(oh - 1, Math.max(0, v * oh - 0.5))
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      const x1 = Math.min(ow - 1, x0 + 1)
      const y1 = Math.min(oh - 1, y0 + 1)
      const fx = x - x0
      const fy = y - y0
      const a = px[y0 * ow + x0] * (1 - fx) + px[y0 * ow + x1] * fx
      const b = px[y1 * ow + x0] * (1 - fx) + px[y1 * ow + x1] * fx
      out[j * w + i] = Math.round(a * (1 - fy) + b * fy)
    }
  }
  return { px: out, w, h }
}

/** The photo as shot, rendered by Develop (see the top of this file). */
export interface AsShot {
  rgba: Uint8ClampedArray
  width: number
  height: number
  /** The rendering's uv → sensor uv (orientation only: no crop, angle or lens). */
  uvToSensor: Mat3
  sensor: [number, number]
}

export class Fp16InvalidError extends Error {
  constructor() {
    super('The half-precision (fp16) model gave invalid numbers on this GPU (ONNX Runtime issue #26732).')
    this.name = 'Fp16InvalidError'
  }
}

export interface DepthResult {
  depth: Omit<DepthShape, 'range'> & { raster: RasterData }
  /** Milliseconds: loading the model into the runtime (0 when it was already loaded), the model run alone, and everything after the rendering. */
  loadMs: number
  inferMs: number
  totalMs: number
  provider: Provider
  size: [number, number]
}

/** Runs the model on the as-shot rendering and returns what a Depth range stores. */
export async function computeDepth(m: ModelEntry, shot: AsShot, provider: Provider, runtimeVersion: string): Promise<DepthResult> {
  const t0 = performance.now()
  const fixed = await prepareModel(m, provider)
  const loadMs = performance.now() - t0
  const [mw, mh] = modelSize(shot.width, shot.height, m.input, fixed)
  const tensor = toTensor(shot.rgba, shot.width, shot.height, mw, mh, m.input.mean, m.input.std)
  const r = await runModel(m, tensor, [1, 3, mh, mw], provider)
  const oh = r.dims[r.dims.length - 2]
  const ow = r.dims[r.dims.length - 1]
  if (ow * oh !== r.data.length) throw new Error(`The model gave ${r.dims.join(' × ')} values for a ${mw} × ${mh} input.`)
  let q: Uint8Array
  try {
    q = quantizeDisparity(r.data)
  } catch (e) {
    if (r.variant === 'fp16') throw new Fp16InvalidError()
    throw e
  }
  const sensorMap = toSensorFrame(q, ow, oh, shot.uvToSensor, shot.sensor)
  const raster = await encodeDepth(sensorMap.px, sensorMap.w, sensorMap.h)
  return {
    depth: {
      kind: 'depth',
      model: m.id,
      modelVersion: `${m.source.revision?.slice(0, 7) ?? 'unpinned'}/${r.variant}`,
      runtime: `onnxruntime-web ${runtimeVersion} ${r.provider}`,
      raster,
    },
    loadMs,
    inferMs: r.ms,
    totalMs: performance.now() - t0,
    provider: r.provider,
    size: [mw, mh],
  }
}
