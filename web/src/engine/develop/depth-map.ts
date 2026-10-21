// The depth map a Depth range mask stores inside the edit, and so inside the .xmp (owner's decision 10; docs/PHASE3.md
// Part 24): compact, portable and identical on every machine, so another computer renders the same mask without the
// model and without computing anything again.
//
// Frame: the SENSOR frame, as every mask control point (owner's decision 1): texel (i, j) covers sensor uv
// ((i + ½) / width, (j + ½) / height), in the sensor's orientation, before lens correction, perspective, straightening,
// rotation, flips and crop. Each drawing maps its pixels to sensor uv through its own geometry (mask-render.ts
// `sensorGrid`), so the mask stays on its content when the crop, angle, Upright or lens settings change later.
//
// Values: 8 bits, 255 = nearest, 0 = farthest: the model's relative inverse depth (disparity), scaled per photo between
// its 0.1st and 99.9th percentiles. The mask's range is on a 0 (near) … 100 (far) scale of that value.
//
// Encoding "u8-med-deflate-b64": each byte replaced by its difference (mod 256) from the median-edge predictor of its
// left, upper and upper-left neighbours (LOCO-I/JPEG-LS's MED: depth maps are smooth, so most differences are 0 or
// ±1), the rows compressed with raw DEFLATE, and the result in base64.

import { inflateRaw } from '../../lib/inflate'

export const DEPTH_ENCODING = 'u8-med-deflate-b64'

/** Caps against damaged or hostile files (a model's output is about 518 × 784). */
export const MAX_DEPTH_SIDE = 2048
export const MAX_DEPTH_PIXELS = 2048 * 1536
export const MAX_DEPTH_CHARS = 8 << 20

export interface RasterData {
  width: number
  height: number
  encoding: string
  data: string
}

const med = (a: number, b: number, c: number) => (c >= Math.max(a, b) ? Math.min(a, b) : c <= Math.min(a, b) ? Math.max(a, b) : a + b - c)

/** The prediction residuals (mod 256), row by row. */
export function medFilter(px: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const a = x ? px[i - 1] : y ? px[i - w] : 0
      const b = y ? px[i - w] : a
      const c = x && y ? px[i - w - 1] : b
      out[i] = (px[i] - med(a, b, c)) & 255
    }
  }
  return out
}

export function medUnfilter(res: Uint8Array, w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const a = x ? px[i - 1] : y ? px[i - w] : 0
      const b = y ? px[i - w] : a
      const c = x && y ? px[i - w - 1] : b
      px[i] = (res[i] + med(a, b, c)) & 255
    }
  }
  return px
}

export function toBase64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deflateRaw(b: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw')
  const writer = cs.writable.getWriter()
  void writer.write(b as Uint8Array<ArrayBuffer>)
  void writer.close()
  const reader = cs.readable.getReader()
  const parts: Uint8Array[] = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    n += value.length
  }
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** A depth map (255 = nearest) as stored in the edit. */
export async function encodeDepth(px: Uint8Array, width: number, height: number): Promise<RasterData> {
  if (px.length !== width * height) throw new Error('depth map: size mismatch')
  const z = await deflateRaw(medFilter(px, width, height))
  return { width, height, encoding: DEPTH_ENCODING, data: toBase64(z) }
}

/** Checks a stored raster's fields (not its contents); null when unusable. */
export function normalizeRaster(v: unknown): RasterData | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Partial<RasterData>
  const okSide = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_DEPTH_SIDE
  if (!okSide(r.width) || !okSide(r.height) || r.width * r.height > MAX_DEPTH_PIXELS) return null
  if (r.encoding !== DEPTH_ENCODING || typeof r.data !== 'string' || !r.data.length || r.data.length > MAX_DEPTH_CHARS) return null
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(r.data)) return null
  return { width: r.width, height: r.height, encoding: r.encoding, data: r.data }
}

/** Decoded maps, most recent last (decoding a 518 × 784 map takes a few milliseconds; drawings reuse it). */
const decoded = new Map<string, Uint8Array | null>()
const KEEP = 6

/** The map's bytes (width × height, 255 = nearest), or null when the data is damaged. Cached by its data. */
export function decodeDepth(r: RasterData): Uint8Array | null {
  const hit = decoded.get(r.data)
  if (hit !== undefined) {
    decoded.delete(r.data)
    decoded.set(r.data, hit)
    return hit
  }
  let px: Uint8Array | null = null
  try {
    if (r.encoding !== DEPTH_ENCODING) throw new Error('unknown encoding')
    const res = inflateRaw(fromBase64(r.data), r.width * r.height)
    if (res.length !== r.width * r.height) throw new Error('wrong size')
    px = medUnfilter(res, r.width, r.height)
  } catch {
    px = null
  }
  decoded.set(r.data, px)
  while (decoded.size > KEEP) decoded.delete(decoded.keys().next().value!)
  return px
}

/** The map at sensor uv (bilinear, clamped at the edges): 0…1, 1 = nearest. */
export function sampleDepth(px: Uint8Array, w: number, h: number, u: number, v: number): number {
  const x = Math.min(w - 1, Math.max(0, u * w - 0.5))
  const y = Math.min(h - 1, Math.max(0, v * h - 0.5))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const at = (i: number, j: number) => px[j * w + i] / 255
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy
}

/** The 0 (near) … 100 (far) scale the range uses, from a map value 0…1 (1 = nearest). */
export const depthPosition = (near: number) => 100 * (1 - near)

/**
 * A model's output (relative inverse depth: larger = nearer), scaled to 0…255 between its 0.1st and 99.9th
 * percentiles (a few stray values don't squeeze the rest). Non-finite values (fp16 overflow, ORT issue #26732) make
 * it fail: the caller retries with fp32 or reports it.
 */
export function quantizeDisparity(d: Float32Array): Uint8Array {
  const n = d.length
  for (let i = 0; i < n; i++) if (!Number.isFinite(d[i])) throw new Error('non-finite depth values')
  const sorted = Float32Array.from(d).sort()
  const lo = sorted[Math.floor((n - 1) * 0.001)]
  const hi = sorted[Math.ceil((n - 1) * 0.999)]
  const out = new Uint8Array(n)
  const k = hi > lo ? 255 / (hi - lo) : 0
  for (let i = 0; i < n; i++) out[i] = k ? Math.round(Math.min(255, Math.max(0, (d[i] - lo) * k))) : 128
  return out
}
