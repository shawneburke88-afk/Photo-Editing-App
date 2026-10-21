// The pixels an AI Remove spot generated, as stored inside the edit and the .xmp (docs/PHASE3.md Part 26).
//
// Diffusion results depend on the seed and on the GPU, so the generated patch itself is stored with the spot (like the
// depth map of a Depth range, Part 24) and every drawing re-renders from it: the model is never run again on load, and
// another computer draws the same spot without the model. The spot records the model version, the runtime, the seed and
// the settings it was made with.
//
// What is stored: the model's own output (an sRGB-encoded picture, 8 bits per channel) over the patch's rectangle,
// which is the spot plus a ring of RING pixels around it, in the SENSOR frame like every spot (its rectangle normalised
// to the sensor). The model saw the scene's linear Rec.2020 values converted to linear sRGB and multiplied by `gain`
// (a per-spot exposure so the model sees a normally exposed picture); the patch is turned back the same way. Pixels of
// the rectangle farther than the ring from the spot are stored as 0 (they are never used) and compress to nearly
// nothing.
//
// Encoding "rgb8-med-deflate-b64": the R, G and B planes one after the other, each byte replaced by its difference from
// the median-edge predictor (as depth-map.ts), raw DEFLATE, base64. The patch is at most the model's 512 × 512 resolution
// plus the ring, so about 0.3–1 MB of text for a large spot.

import { inflateRaw } from '../../lib/inflate'
import { apply, SRGB_TO_REC2020 } from '../color/matrix'
import { deflateRaw, fromBase64, medFilter, medUnfilter, toBase64 } from './depth-map'

export const PATCH_ENCODING = 'rgb8-med-deflate-b64'
/** Caps against damaged or hostile files (a patch is at most about 520 × 520). */
export const MAX_PATCH_SIDE = 1024
export const MAX_PATCH_CHARS = 4 << 20

/** What an AI Remove spot stores. */
export interface AiFill {
  /** The model's id (manifest), its version (`<commit 7>/<variant>`) and the runtime that ran it. */
  model: string
  modelVersion: string
  runtime: string
  /** The seed of the starting noise, and the sampling settings. */
  seed: number
  steps: number
  strength: number
  guidance: number
  /** The patch's rectangle, normalised to the sensor like the spot's points: x0, y0, x1, y1. */
  rect: [number, number, number, number]
  /** The exposure the model saw: stored values are sRGB-encoded (linear sRGB × gain). */
  gain: number
  width: number
  height: number
  encoding: string
  data: string
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** Checks a stored AI fill's fields (not its pixels); null when it can't be used. */
export function normalizeAiFill(v: unknown): AiFill | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Partial<AiFill>
  const side = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_PATCH_SIDE
  if (!side(o.width) || !side(o.height)) return null
  if (o.encoding !== PATCH_ENCODING || typeof o.data !== 'string' || !o.data.length || o.data.length > MAX_PATCH_CHARS || !/^[A-Za-z0-9+/]*={0,2}$/.test(o.data)) return null
  const r = o.rect
  if (!Array.isArray(r) || r.length !== 4 || !r.every(finite) || r[0] < -1 || r[1] < -1 || r[2] > 2 || r[3] > 2 || r[2] <= r[0] || r[3] <= r[1]) return null
  if (!finite(o.gain) || o.gain <= 0 || o.gain > 1e4) return null
  return {
    model: str(o.model, 64),
    modelVersion: str(o.modelVersion, 64),
    runtime: str(o.runtime, 80),
    seed: finite(o.seed) ? Math.abs(Math.floor(o.seed)) % 2 ** 31 : 0,
    steps: finite(o.steps) ? Math.max(1, Math.min(1000, Math.round(o.steps))) : 20,
    strength: finite(o.strength) ? Math.max(0, Math.min(1, o.strength)) : 1,
    guidance: finite(o.guidance) ? Math.max(0, Math.min(50, o.guidance)) : 1,
    rect: [r[0], r[1], r[2], r[3]],
    gain: o.gain,
    width: o.width,
    height: o.height,
    encoding: o.encoding,
    data: o.data,
  }
}

/** RGB bytes (interleaved, width × height × 3) → the stored text. */
export async function encodePatch(rgb: Uint8Array, width: number, height: number): Promise<string> {
  if (rgb.length !== width * height * 3) throw new Error('AI patch: size mismatch')
  const n = width * height
  const planes = new Uint8Array(3 * n)
  for (let c = 0; c < 3; c++) {
    const p = new Uint8Array(n)
    for (let i = 0; i < n; i++) p[i] = rgb[i * 3 + c]
    planes.set(medFilter(p, width, height), c * n)
  }
  return toBase64(await deflateRaw(planes))
}

/** The stored text → RGB bytes (interleaved), or null when damaged. */
export function decodePatchBytes(f: Pick<AiFill, 'width' | 'height' | 'encoding' | 'data'>): Uint8Array | null {
  try {
    if (f.encoding !== PATCH_ENCODING) return null
    const n = f.width * f.height
    const res = inflateRaw(fromBase64(f.data), 3 * n)
    if (res.length !== 3 * n) return null
    const rgb = new Uint8Array(3 * n)
    for (let c = 0; c < 3; c++) {
      const p = medUnfilter(res.subarray(c * n, (c + 1) * n), f.width, f.height)
      for (let i = 0; i < n; i++) rgb[i * 3 + c] = p[i]
    }
    return rgb
  } catch {
    return null
  }
}

/** sRGB transfer: encoded 0…1 → linear. */
export const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
/** sRGB transfer: linear → encoded 0…1 (clipped). */
export const linearToSrgb = (v: number) => {
  const x = v <= 0 ? 0 : v >= 1 ? 1 : v
  return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055
}

let lut: Float32Array | null = null
const toLinear = () => (lut ??= Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255)))

/** The patch as scene values: linear Rec.2020, interleaved RGB, width × height. */
export function patchToScene(rgb: Uint8Array, gain: number): Float32Array {
  const t = toLinear()
  const out = new Float32Array(rgb.length)
  for (let i = 0; i < rgb.length; i += 3) {
    const v = apply(SRGB_TO_REC2020, [t[rgb[i]] / gain, t[rgb[i + 1]] / gain, t[rgb[i + 2]] / gain])
    out[i] = v[0]
    out[i + 1] = v[1]
    out[i + 2] = v[2]
  }
  return out
}

/** Decoded patches in scene values, most recent last (drawings reuse them). Keyed by their data. */
const cache = new Map<string, Float32Array | null>()
const KEEP = 24

/** A stored patch in scene values (linear Rec.2020), or null when its data is damaged. Cached. */
export function decodePatch(f: AiFill): Float32Array | null {
  const key = `${f.gain}|${f.width}x${f.height}|${f.data}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const rgb = decodePatchBytes(f)
  const v = rgb ? patchToScene(rgb, f.gain) : null
  cache.set(key, v)
  while (cache.size > KEEP) cache.delete(cache.keys().next().value!)
  return v
}

/** The patch's rectangle in pixels of a w × h image (continuous coordinates). */
export function patchRectPx(f: Pick<AiFill, 'rect'>, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: f.rect[0] * w, y0: f.rect[1] * h, x1: f.rect[2] * w, y1: f.rect[3] * h }
}

/** Samples the decoded patch (scene values) bilinearly at image pixel centre (x + ½, y + ½); out gets RGB. */
export function samplePatch(p: Float32Array, f: Pick<AiFill, 'width' | 'height' | 'rect'>, w: number, h: number, x: number, y: number, out: Float32Array, o: number) {
  const r = patchRectPx(f, w, h)
  const u = Math.min(f.width - 1, Math.max(0, ((x + 0.5 - r.x0) / (r.x1 - r.x0)) * f.width - 0.5))
  const v = Math.min(f.height - 1, Math.max(0, ((y + 0.5 - r.y0) / (r.y1 - r.y0)) * f.height - 0.5))
  const x0 = Math.floor(u)
  const y0 = Math.floor(v)
  const x1 = Math.min(f.width - 1, x0 + 1)
  const y1 = Math.min(f.height - 1, y0 + 1)
  const fx = u - x0
  const fy = v - y0
  const a = (y0 * f.width + x0) * 3
  const b = (y0 * f.width + x1) * 3
  const c = (y1 * f.width + x0) * 3
  const d = (y1 * f.width + x1) * 3
  for (let k = 0; k < 3; k++) {
    const top = p[a + k] + (p[b + k] - p[a + k]) * fx
    const bot = p[c + k] + (p[d + k] - p[c + k]) * fx
    out[o + k] = top + (bot - top) * fy
  }
}
