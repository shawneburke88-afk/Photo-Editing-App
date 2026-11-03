// Lens Blur (docs/PHASE3.md Part 32): a shallow depth of field drawn from the photo's depth map (the Depth Anything V2
// Small map of Part 24, kept in the edit). This file holds the settings as the edit stores them and the renderer's plan
// (pure maths, unit-tested); the GPU work is engine/gpu/lens-blur-stage.ts and lens-blur.wgsl.
//
// The design (scratchpad LENS_BLUR_DESIGN.md, chosen by the owner, 2026-10-26 and 2026-11-03):
//  - Depth: the stored map, upsampled to the working size with a guided filter that uses the photo's log luminance as
//    its guide (the maths of mask Refine, mask.wgsl `coef`/`upRefine`), then a small "nearer wins" maximum so edge pixels
//    fall into the nearer slice. One depth per pixel; no blur value per pixel is formed; no segmentation mask goes in.
//  - Slices: evenly spaced in disparity, one centred on the focus depth, with triangular memberships that sum to 1.
//    Each slice gets ONE radius from its centre depth (`r = K·|d − d_f|`, K = Blur amount, × Blur in front on the near
//    side) and is blurred on its own with one fixed disc kernel, at the pyramid level that keeps the disc within
//    LEVEL_TEXELS texels.
//  - Composite: back to front, each slice over the result so far using only its own blurred alpha; the sum is normalised
//    by the accumulated alpha. Nothing is applied to other slices' pixels while a slice is blurred.
//  - Hidden background: a slice is extended, with its own colours (a normalised box spread of its own pixels) or with the
//    optional AI fill of the original photo, into the pixels the depth map says are in front of it, within the widest blur
//    radius of the slices in front of it.
//  - Highlight boost (owner, 2026-11-03; the design's H-b): a threshold-only gain on scene-linear values above a fixed
//    threshold, applied in the blurred slices away from the focus slice. No gradient or edge filter, no highlight mask
//    intersection, no guide image.
//  - Noise matching: each slice's fixed kernel removes a known share of white noise (1 − Σw²); seeded noise of the
//    photo's own measured level (`fitNoise`) is added back in that share.
//  - Keep sharp: an existing mask, composited over the result after the blur (`out = mix(blurred, photo, m·(1 − a_near))`).
//
// Old edits: no `lensBlur` key means nothing is drawn differently. Lightroom's crs:LensBlur is neither read nor written.

import type { RasterData } from './depth-map'

export const LENS_BLUR_VERSION = 1

/** The depth map Lens Blur uses: its own copy of a Depth range's (Part 24), same model fields and encoding. */
export interface LensBlurDepth {
  model: string
  modelVersion: string
  runtime?: string
  raster: RasterData
}

/**
 * The optional AI fill (design 5(b)): the ORIGINAL photo (before any blur) with the background behind near edges
 * drawn by the AI Remove model, at most PLATE_LONG pixels on its long side, in the sensor frame. Only its `region`
 * (255 = filled) is used, and only for the hidden background of the slices behind those edges.
 */
export interface LensBlurPlate {
  model: string
  modelVersion: string
  runtime: string
  seed: number
  steps: number
  strength: number
  guidance: number
  /** The exposure the model saw (stored values are sRGB-encoded linear sRGB × gain), as AI Remove's patches. */
  gain: number
  width: number
  height: number
  encoding: string
  data: string
  /** Which pixels were filled (8 bits, the depth map's encoding), the plate's size. */
  region: RasterData
}

export interface LensBlurSettings {
  v: 1
  /** The Apply box: off keeps the settings and the depth map, and draws nothing. */
  on: boolean
  /** Blur amount, 0…100. */
  amount: number
  /** Blur in front: how much of the blur the parts nearer than the focus get, 0…100 %. */
  front: number
  /** The focus: the clicked point (sensor uv) and the depth there (the stored 0…255 scale, 255 nearest). */
  focus: { pt: [number, number]; depth: number }
  /** Highlight boost, 0…100. */
  boost: number
  /** Keep noise (on by default), and the pattern's seed (each photo its own, as Grain's). */
  noise: { keep: boolean; seed: number }
  /** Keep sharp: an existing mask of this edit, composited over the result after the blur. */
  keepSharp?: { maskId: string }
  /** Use the AI fill behind near edges (when the edit has one). */
  aiFill: boolean
  depth?: LensBlurDepth
  plate?: LensBlurPlate
}

export const DEFAULT_LENS_BLUR: Omit<LensBlurSettings, 'focus' | 'noise'> = { v: 1, on: true, amount: 50, front: 100, boost: 0, aiFill: false }

// ---- constants of the renderer (resolution-free: radii are fractions of the working image's long side)

/** The blur radius at Blur amount 100 for a depth difference of the whole map (0 → 255), over the long side. */
export const R_MAX = 0.05
/** The largest radius step between neighbouring slices, over the long side (sets how many slices there are). */
export const STEP_MAX = 0.0016
export const MIN_INTERVALS = 4
export const MAX_INTERVALS = 32
/** A slice's disc is blurred at the level that keeps its radius within this many texels. */
export const LEVEL_TEXELS = 10
export const MAX_LEVEL = 6
/** Hidden-background spreads are made at the level that keeps their radius within this many texels. */
export const SPREAD_TEXELS = 8
/** The widest hidden-background extension, over the long side. */
export const EXT_MAX = 0.08
/** "Nearer wins": the maximum filter's radius over the long side (at least one pixel). */
export const NEAR_WINS = 0.001
/** Highlight boost: scene values (× the photo's exposure) above this get the gain; the gain at Boost 100. */
export const BOOST_THRESHOLD = 0.9
export const BOOST_GAIN = 4
/** The guided filter's box radius on its reduced grid, and its regularisation (mask Refine's ε). */
export const GF_RADIUS = 2
export const GF_EPS = 1e-3

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** A seed for a new noise pattern (1 … 2³¹ − 1). */
export function newNoiseSeed(rand: () => number = Math.random): number {
  return 1 + Math.floor(rand() * 2147483646)
}

/** Settings for a photo turning Lens Blur on: focus at `focus`, a new noise seed. */
export function newLensBlur(focus: LensBlurSettings['focus'], depth: LensBlurDepth | undefined, rand: () => number = Math.random): LensBlurSettings {
  return { ...DEFAULT_LENS_BLUR, focus, noise: { keep: true, seed: newNoiseSeed(rand) }, ...(depth ? { depth } : {}) }
}

function normalizeRasterLike(v: unknown, maxSide: number, maxChars: number, encoding: string): RasterData | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Partial<RasterData>
  const okSide = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= maxSide
  if (!okSide(r.width) || !okSide(r.height) || r.width * r.height > maxSide * maxSide) return null
  if (r.encoding !== encoding || typeof r.data !== 'string' || !r.data.length || r.data.length > maxChars || !/^[A-Za-z0-9+/]*={0,2}$/.test(r.data)) return null
  return { width: r.width, height: r.height, encoding: r.encoding, data: r.data }
}

export const PLATE_LONG = 1024
const DEPTH_ENCODING = 'u8-med-deflate-b64'
const PATCH_ENCODING = 'rgb8-med-deflate-b64'

function normalizeDepth(v: unknown): LensBlurDepth | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Partial<LensBlurDepth>
  const raster = normalizeRasterLike(o.raster, 2048, 8 << 20, DEPTH_ENCODING)
  if (!raster) return undefined
  return { model: str(o.model, 80) || 'unknown', modelVersion: str(o.modelVersion, 80), ...(o.runtime ? { runtime: str(o.runtime, 80) } : {}), raster }
}

function normalizePlate(v: unknown): LensBlurPlate | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Partial<LensBlurPlate>
  const rgb = normalizeRasterLike({ width: o.width, height: o.height, encoding: o.encoding, data: o.data }, PLATE_LONG, 8 << 20, PATCH_ENCODING)
  const region = normalizeRasterLike(o.region, PLATE_LONG, 4 << 20, DEPTH_ENCODING)
  if (!rgb || !region || region.width !== rgb.width || region.height !== rgb.height) return undefined
  if (!finite(o.gain) || o.gain <= 0 || o.gain > 1e4) return undefined
  return {
    model: str(o.model, 64),
    modelVersion: str(o.modelVersion, 64),
    runtime: str(o.runtime, 80),
    seed: finite(o.seed) ? Math.abs(Math.floor(o.seed)) % 2 ** 31 : 0,
    steps: finite(o.steps) ? clamp(Math.round(o.steps), 1, 1000) : 20,
    strength: finite(o.strength) ? clamp(o.strength, 0, 1) : 1,
    guidance: finite(o.guidance) ? clamp(o.guidance, 0, 50) : 1,
    gain: o.gain,
    width: rgb.width,
    height: rgb.height,
    encoding: rgb.encoding,
    data: rgb.data,
    region,
  }
}

const num = (v: unknown, lo: number, hi: number, d: number) => (finite(v) ? clamp(Math.round(v), lo, hi) : d)

/**
 * Checks stored Lens Blur settings; undefined when there are none or they can't be used (an unknown version is kept out:
 * a later renderer's settings are not drawn by this one's maths).
 */
export function normalizeLensBlur(raw: unknown): LensBlurSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  if (o.v !== LENS_BLUR_VERSION) return undefined
  const f = o.focus as { pt?: unknown; depth?: unknown } | undefined
  const pt = Array.isArray(f?.pt) && f.pt.length === 2 && f.pt.every(finite) ? ([clamp(f.pt[0] as number, 0, 1), clamp(f.pt[1] as number, 0, 1)] as [number, number]) : ([0.5, 0.5] as [number, number])
  const depth = finite(f?.depth) ? clamp(f.depth, 0, 255) : 128
  const n = o.noise as { keep?: unknown; seed?: unknown } | undefined
  const out: LensBlurSettings = {
    v: 1,
    on: o.on !== false,
    amount: num(o.amount, 0, 100, DEFAULT_LENS_BLUR.amount),
    front: num(o.front, 0, 100, DEFAULT_LENS_BLUR.front),
    focus: { pt, depth: Math.round(depth * 100) / 100 },
    boost: num(o.boost, 0, 100, 0),
    noise: { keep: n?.keep !== false, seed: finite(n?.seed) ? Math.abs(Math.floor(n.seed)) % 2 ** 31 || 1 : 1 },
    aiFill: o.aiFill === true,
  }
  const ks = o.keepSharp as { maskId?: unknown } | undefined
  if (ks && typeof ks.maskId === 'string' && ks.maskId) out.keepSharp = { maskId: ks.maskId.slice(0, 64) }
  const d = normalizeDepth(o.depth)
  if (d) out.depth = d
  const p = normalizePlate(o.plate)
  if (p) out.plate = p
  return out
}

/** Settings with this Lens Blur (the key removed for none). */
export function withLensBlur<S extends { lensBlur?: LensBlurSettings }>(s: S, lb: LensBlurSettings | undefined): S {
  const n = normalizeLensBlur(lb)
  if (JSON.stringify(n) === JSON.stringify(s.lensBlur) && (n !== undefined || !('lensBlur' in s))) return s
  const { lensBlur: _old, ...rest } = s
  void _old
  return (n ? { ...rest, lensBlur: n } : rest) as S
}

/** Lens Blur changes the photo: on, an amount, and a depth map. */
export const lensBlurActive = (lb: LensBlurSettings | undefined): lb is LensBlurSettings & { depth: LensBlurDepth } => !!lb && lb.on && lb.amount > 0 && !!lb.depth

/** The same settings without what belongs to one photo (paste, presets): the depth map, the AI fill, the Keep sharp mask. */
export function lensBlurForOtherPhoto(lb: LensBlurSettings, rand: () => number = Math.random): LensBlurSettings {
  const { depth: _d, plate: _p, keepSharp: _k, ...rest } = lb
  void _d
  void _p
  void _k
  return { ...rest, noise: { ...lb.noise, seed: newNoiseSeed(rand) } }
}

/** In words (paste checklist). */
export function describeLensBlur(lb: LensBlurSettings | undefined): string {
  if (!lb) return 'none'
  if (!lb.on) return 'off'
  const parts = [`Blur amount ${lb.amount}`]
  if (lb.front !== 100) parts.push(`Blur in front ${lb.front} %`)
  if (lb.boost) parts.push(`Highlight boost ${lb.boost}`)
  if (!lb.noise.keep) parts.push('noise not kept')
  parts.push('focus at the same place')
  return parts.join(', ')
}

// ---- focus

/**
 * The focus depth for a click at sensor uv (u, v): the median of the stored map (0…255) in a small window around it
 * (BokehMe's rule for a box: "the median value of the disparity map within the bounding box").
 */
export function focusDepthAt(px: Uint8Array, w: number, h: number, u: number, v: number): number {
  const r = Math.max(2, Math.round(0.01 * Math.max(w, h)))
  const cx = clamp(Math.floor(u * w), 0, w - 1)
  const cy = clamp(Math.floor(v * h), 0, h - 1)
  const vals: number[] = []
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) vals.push(px[y * w + x])
  vals.sort((a, b) => a - b)
  const m = vals.length >> 1
  return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2
}

/** Focus distance as the slider shows it: 0 nearest … 100 farthest (the Depth range's scale). */
export const focusDistance = (depth: number) => Math.round(((255 - depth) / 255) * 1000) / 10
export const depthFromDistance = (dist: number) => clamp(255 - (dist / 100) * 255, 0, 255)

// ---- the plan

export interface Slice {
  /** The slice's centre on the 0…1 disparity scale (1 nearest). */
  c: number
  /** Its blur radius in working pixels. */
  r: number
  /** The level it is blurred at (radius ÷ 2^level ≤ LEVEL_TEXELS), and the radius in that level's texels. */
  level: number
  rho: number
  /** Nearer than the focus (counts as "in front" for Keep sharp). */
  near: boolean
  /** Highlight boost applies (a blurred slice at least two slices from the focus slice). */
  boost: boolean
  /** The widest radius of the slices in front of it (working pixels; 0: no hidden background to fill). */
  ext: number
  /** The level its hidden-background spread is made at, and the spread's radius in that level's texels. */
  extLevel: number
  extRadius: number
  /** The share of white noise its kernel keeps (Σw², about 1 / (1 + π r²)). */
  sw2: number
}

export interface LensBlurPlan {
  /** Slice spacing on the 0…1 scale; the focus depth (0…1). */
  delta: number
  df: number
  /** Blur radius per unit of disparity in working pixels (K). */
  k: number
  /** Slices from far to near (the composite's order); empty ones left out. */
  slices: Slice[]
  /** Highlight boost's gain on the excess above the threshold. */
  boostGain: number
}

const levelFor = (r: number, texels: number) => (r <= texels ? 0 : Math.min(MAX_LEVEL, Math.ceil(Math.log2(r / texels))))

/**
 * The slices for these settings on a working image whose long side is `long` pixels. `hist` (256 bins of the stored
 * map) leaves out slices no pixel can fall in (with a margin for the guided filter and the nearer-wins maximum).
 */
export function lensBlurPlan(lb: Pick<LensBlurSettings, 'amount' | 'front' | 'focus' | 'boost'>, long: number, hist?: ArrayLike<number>): LensBlurPlan {
  const df = clamp(lb.focus.depth / 255, 0, 1)
  const kRel = (R_MAX * lb.amount) / 100
  const intervals = clamp(Math.ceil(kRel / STEP_MAX), MIN_INTERVALS, MAX_INTERVALS)
  const delta = 1 / intervals
  const k = kRel * long
  const front = clamp(lb.front / 100, 0, 1)
  const kMin = -Math.ceil(df / delta - 1e-9)
  const kMax = Math.ceil((1 - df) / delta - 1e-9)
  const occupied = (c: number) => {
    if (!hist) return true
    const margin = 4 / 255
    const lo = Math.max(0, Math.floor((c - delta - margin) * 255))
    const hi = Math.min(255, Math.ceil((c + delta + margin) * 255))
    for (let i = lo; i <= hi; i++) if (hist[i]) return true
    return false
  }
  const raw: Omit<Slice, 'ext' | 'extLevel' | 'extRadius'>[] = []
  for (let i = kMin; i <= kMax; i++) {
    const c = df + i * delta
    if (!occupied(c)) continue
    const near = i > 0
    const r = k * Math.abs(c - df) * (near ? front : 1)
    const level = r < 0.5 ? 0 : levelFor(r, LEVEL_TEXELS)
    raw.push({ c, r: r < 0.5 ? 0 : r, level, rho: r < 0.5 ? 0 : r / 2 ** level, near, boost: Math.abs(i) >= 2 && r >= 0.5, sw2: r < 0.5 ? 1 : 1 / (1 + Math.PI * r * r) })
  }
  const extCap = EXT_MAX * long
  const slices: Slice[] = raw.map((s) => {
    let ext = 0
    for (const o of raw) if (o.c >= s.c + delta - 1e-9) ext = Math.max(ext, o.r)
    ext = ext >= 1 ? Math.min(extCap, ext) : 0
    const extLevel = ext ? Math.max(s.level, levelFor(ext, SPREAD_TEXELS)) : 0
    return { ...s, ext, extLevel, extRadius: ext ? Math.max(1, Math.ceil(ext / 2 ** extLevel)) : 0 }
  })
  return { delta, df, k, slices, boostGain: (BOOST_GAIN * lb.boost) / 100 }
}

/** A slice's membership of a disparity d (0…1): triangular, the memberships of all slices summing to 1. */
export const membership = (d: number, c: number, delta: number) => Math.max(0, 1 - Math.abs(d - c) / delta)

/**
 * Highlight boost on one scene colour (Rec.2020, linear): the luminance's excess above `threshold` multiplied by
 * (1 + gain), the colour scaled with it. Below the threshold nothing changes.
 */
export function boostColour(c: readonly [number, number, number], threshold: number, gain: number): [number, number, number] {
  const y = 0.2627002 * c[0] + 0.6779981 * c[1] + 0.0593017 * c[2]
  if (!(gain > 0) || y <= threshold) return [c[0], c[1], c[2]]
  const k = 1 + (gain * (y - threshold)) / y
  return [c[0] * k, c[1] * k, c[2] * k]
}

// ---- noise

/** A noise model per colour channel: variance = a · signal + b. */
export type NoiseModel = [number, number][]

/**
 * The photo's own noise, measured on samples of it (linear RGBA, as the working image holds it): per 8 × 8 block and
 * channel, the mean and the variance of the second difference across (white noise of variance σ² gives 1.5 σ²); the
 * blocks binned by their mean, the flattest tenth of each bin taken as noise (texture only adds), then variance = a ·
 * signal + b fitted by least squares (a, b ≥ 0).
 */
export function fitNoise(tiles: { rgba: Float32Array; w: number; h: number }[]): NoiseModel {
  const B = 8
  const out: NoiseModel = []
  for (let ch = 0; ch < 3; ch++) {
    const pts: [number, number][] = []
    for (const t of tiles) {
      for (let by = 0; by + B <= t.h; by += B) {
        for (let bx = 0; bx + B <= t.w; bx += B) {
          let s = 0
          let v = 0
          let n = 0
          for (let y = by; y < by + B; y++) {
            for (let x = bx; x < bx + B; x++) {
              const p = t.rgba[(y * t.w + x) * 4 + ch]
              s += p
              if (x > bx && x < bx + B - 1) {
                const r = p - (t.rgba[(y * t.w + x - 1) * 4 + ch] + t.rgba[(y * t.w + x + 1) * 4 + ch]) / 2
                v += r * r
                n++
              }
            }
          }
          const mean = s / (B * B)
          if (n && Number.isFinite(mean) && Number.isFinite(v)) pts.push([mean, v / n / 1.5])
        }
      }
    }
    out.push(fitLine(pts))
  }
  return out
}

function fitLine(pts: [number, number][]): [number, number] {
  if (pts.length < 8) return [0, 0]
  pts.sort((a, b) => a[0] - b[0])
  const bins = Math.min(16, Math.max(1, Math.floor(pts.length / 16)))
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < bins; i++) {
    const part = pts.slice(Math.floor((i * pts.length) / bins), Math.floor(((i + 1) * pts.length) / bins))
    if (!part.length) continue
    const vs = part.map((p) => p[1]).sort((a, b) => a - b)
    xs.push(part.reduce((a, p) => a + p[0], 0) / part.length)
    ys.push(vs[Math.floor(vs.length * 0.1)])
  }
  const n = xs.length
  if (n < 2) return [0, Math.max(0, ys[0] ?? 0)]
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
  }
  let a = sxx > 0 ? sxy / sxx : 0
  let b = my - a * mx
  if (a < 0) {
    a = 0
    b = my
  }
  if (b < 0) {
    b = 0
    const sx2 = xs.reduce((s, x) => s + x * x, 0)
    a = sx2 > 0 ? Math.max(0, xs.reduce((s, x, i) => s + x * ys[i], 0) / sx2) : 0
  }
  return [a, b]
}

// ---- the AI fill's region

/**
 * Where the AI fill draws (design 5(b)), from the depth map alone: pixels nearer, by more than `jump` on the 0…1 scale,
 * than something within `radius` (over the map's long side) of them — the near side of depth edges, whose background
 * a blur in front can reveal. Returned at the map's size (255 = fill). It doesn't depend on the focus or the amount, so
 * one fill serves every setting.
 */
export function fillRegion(px: Uint8Array, w: number, h: number, radius = 0.03, jump = 0.08): Uint8Array {
  const r = Math.max(1, Math.round(radius * Math.max(w, h)))
  // Minimum over a square window (separable): the farthest value near each pixel.
  const tmp = new Uint8Array(w * h)
  const mins = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 255
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.min(m, px[y * w + k])
      tmp[y * w + x] = m
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 255
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.min(m, tmp[k * w + x])
      mins[y * w + x] = m
    }
  }
  const out = new Uint8Array(w * h)
  const j = jump * 255
  for (let i = 0; i < w * h; i++) out[i] = px[i] - mins[i] > j ? 255 : 0
  return out
}

/** A histogram of a stored map (256 bins). */
export function depthHistogram(px: Uint8Array): Uint32Array {
  const h = new Uint32Array(256)
  for (let i = 0; i < px.length; i++) h[px[i]]++
  return h
}
