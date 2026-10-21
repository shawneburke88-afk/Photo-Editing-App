// The Tone Curve (owner's decisions, 2026-10-13; docs/research/TONE_CURVE.md and docs/PHASE3.md Part 12).
//
// Where it acts: after Contrast (the sigmoid display transform), on the tones you see, like Lightroom's curve
// (option B of the research's §2.0). darktable's own rgb curve sits before its sigmoid (src/common/iop_order.c, v5.0
// order: rgbcurve 42.0, sigmoid 45.3, lines 383 and 388); its tone curve sits after it (tonecurve 48.0, line 394),
// and darktable's Lightroom importer puts Lightroom's curve there (src/develop/lightroom.c lines 1468-1533). The
// curve's axes are LightBench's histogram's: sRGB-encoded values (the sRGB transfer function), so a neutral grey
// sits on the graph where the histogram shows it. The curve works on the display-referred linear Rec.2020 values the
// sigmoid puts out (the pipeline's working primaries; the histogram's primaries are sRGB, which only matters for
// coloured pixels, not for where a grey sits).
//
// What it is made of, in the order applied:
//  1. The point curve (RGB), then
//  2. Regions (Lightroom's parametric curve, renamed): Shadows, Darks, Lights and Highlights with three split points.
//     Lightroom's formula isn't public; this one is LightBench's own, tuned by eye (`regionPoints`). Then
//  3. the Red, Green and Blue point curves. Lightroom applies the RGB curve and then the channel curves; darktable's rgb
//     curve has either linked or independent channels, never both (src/iop/rgbcurve.c `process`, lines 1904-1939), so
//     applying both is LightBench's design.
//
// The point curves use darktable's monotone cubic Hermite spline (src/common/curve_tools.c `monotone_hermite_set`,
// lines 393-452, evaluated as `catmull_rom_val`, lines 527-561), flat before the first point and after the last and
// clamped to 0…1 (`CurveDataSample`, lines 716-738). LightBench adds the step of Fritsch and Carlson's method that
// darktable leaves out (the Wikipedia article darktable cites at line 384): where the curve turns (a peak or a dip),
// the point's tangent is flat. With it, every segment stays between its two points, so the curve never overshoots.
//
// Colour (owner's decision 3): the RGB curve and Regions change brightness with the hue kept; steepening the curve
// also makes colours stronger, like Lightroom, by as much as Adobe's hue-keeping method would (the curve applied to the
// largest and smallest channel; RawTherapee ships it as "Film-like", rtengine/curves.h `AdobeToneCurve::RGBTone`,
// research §1). The Refine Saturation slider (Lightroom's name for its curve's slider; 100 % = that, 0 % = brightness
// only) takes it back. How brightness is measured is darktable's "preserve colors" norms (src/common/rgb_norms.h,
// lines 22-71), each scaled so a neutral grey reads its own value (darktable's sum and Euclidean norm read it 3× and √3×
// brighter). "max RGB" (Largest channel) is the default (owner's decision, 2026-10-13): with Refine Saturation at 100 %
// the result is then exactly Adobe's method. "Per channel (classic RGB)" applies the curve to R, G and B separately.

/** A point of a point curve: input and output, 0…1 on the sRGB-encoded axis. */
export type CurvePoint = [x: number, y: number]

export type CurveChannel = 'rgb' | 'red' | 'green' | 'blue'
export const CURVE_CHANNELS: CurveChannel[] = ['rgb', 'red', 'green', 'blue']

/** How the RGB curve measures a pixel's brightness (darktable's preserve-colors norms, normalised), or per channel. */
export type CurveNorm = 'power' | 'luminance' | 'max' | 'average' | 'norm' | 'channels'
export const CURVE_NORMS: { id: CurveNorm; label: string; help: string }[] = [
  { id: 'max', label: 'Largest channel', help: 'The brightest of red, green and blue (default): with Refine Saturation at 100 % this is a film-like, hue-keeping curve. Never pushes a colour out of range; can darken saturated blues.' },
  { id: 'power', label: 'Balanced (power)', help: 'Weighted towards the brightest channel. Keeps hue; a compromise for skies and skin.' },
  { id: 'luminance', label: 'Luminance', help: 'Saturated reds and blues read dark, so a contrast curve crushes them.' },
  { id: 'average', label: 'Average', help: 'The average of red, green and blue.' },
  { id: 'norm', label: 'Euclidean norm', help: 'The length of the red, green and blue values, scaled so a grey reads its own value.' },
  { id: 'channels', label: 'Per channel (classic RGB)', help: 'The curve on R, G and B separately, as most editors once did: hues shift (orange towards yellow, sky towards cyan) and colours get stronger.' },
]

export interface CurveRegions {
  /** −100…100 each. */
  shadows: number
  darks: number
  lights: number
  highlights: number
  /** The three split points, 0…100 (Lightroom's defaults 25, 50, 75). */
  splits: [number, number, number]
}

export interface ToneCurveSettings {
  regions: CurveRegions
  /** Point curves; each has at least two points, sorted by x. */
  rgb: CurvePoint[]
  red: CurvePoint[]
  green: CurvePoint[]
  blue: CurvePoint[]
  /**
   * Refine Saturation (Lightroom's name; the stored key stays `saturation`): how much stronger colours get where the
   * curve steepens, 0…100 %, default 100 (like Lightroom).
   */
  saturation: number
  norm: CurveNorm
}

export const LINEAR: CurvePoint[] = [
  [0, 0],
  [1, 1],
]
export const DEFAULT_SPLITS: [number, number, number] = [25, 50, 75]
export const DEFAULT_REGIONS: CurveRegions = { shadows: 0, darks: 0, lights: 0, highlights: 0, splits: DEFAULT_SPLITS }
export const DEFAULT_TONE_CURVE: ToneCurveSettings = {
  regions: DEFAULT_REGIONS,
  rgb: LINEAR,
  red: LINEAR,
  green: LINEAR,
  blue: LINEAR,
  saturation: 100,
  norm: 'max',
}

/** Most points per curve (sources disagree whether Lightroom allows 14 or 16; darktable allows 20). */
export const MAX_POINTS = 16
/** Closest two points may be in x (darktable rgbcurve.c line 36, DT_IOP_RGBCURVE_MIN_X_DISTANCE). */
export const MIN_DX = 0.0025
/** Splits stay this far apart and from the ends (LightBench's choice). */
export const SPLIT_GAP = 5
/** Size of the lookup table built for the GPU. */
export const LUT_SIZE = 4096

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const round4 = (v: number) => Math.round(v * 10000) / 10000 + 0

// ---- the spline (darktable src/common/curve_tools.c)

/** darktable's EPSILON (2 · FLT_MIN). */
const EPSILON = 2 * 1.1754943508222875e-38

/**
 * Tangents of the monotone cubic Hermite spline through the points (darktable `monotone_hermite_set`), plus the zero
 * tangent where the slope changes sign (LightBench's addition, see the top of this file). Null for fewer than two
 * points or x not strictly increasing, as darktable.
 */
export function monotoneTangents(x: readonly number[], y: readonly number[]): number[] | null {
  const n = x.length
  if (n <= 1) return null
  for (let i = 0; i < n - 1; i++) if (x[i + 1] <= x[i]) return null
  const delta = new Array<number>(n).fill(0)
  const m = new Array<number>(n + 1).fill(0)
  for (let i = 0; i < n - 1; i++) delta[i] = (y[i + 1] - y[i]) / (x[i + 1] - x[i])
  delta[n - 1] = delta[n - 2]
  m[0] = delta[0]
  m[n - 1] = delta[n - 1]
  for (let i = 1; i < n - 1; i++) m[i] = (delta[i - 1] + delta[i]) * 0.5
  // LightBench: Fritsch–Carlson's step 3 — at a local peak or dip the tangent is flat, so the curve can't overshoot it.
  for (let i = 1; i < n - 1; i++) if (delta[i - 1] * delta[i] <= 0) m[i] = 0
  for (let i = 0; i < n; i++) {
    if (Math.abs(delta[i]) < EPSILON) {
      m[i] = 0
      m[i + 1] = 0
    } else {
      const alpha = m[i] / delta[i]
      const beta = m[i + 1] / delta[i]
      const tau = alpha * alpha + beta * beta
      if (tau > 9) {
        m[i] = (3 * alpha * delta[i]) / Math.sqrt(tau)
        m[i + 1] = (3 * beta * delta[i]) / Math.sqrt(tau)
      }
    }
  }
  return m.slice(0, n)
}

/** The cubic Hermite through the points with tangents `m` (darktable `catmull_rom_val`). */
export function hermiteAt(x: readonly number[], y: readonly number[], m: readonly number[], xv: number): number {
  const n = x.length
  let i = n - 2
  for (let k = 0; k < n - 2; k++) {
    if (xv < x[k + 1]) {
      i = k
      break
    }
  }
  const h = x[i + 1] - x[i]
  const t = (xv - x[i]) / h
  const t2 = t * t
  const t3 = t * t2
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2
  return h00 * y[i] + h10 * h * m[i] + h01 * y[i + 1] + h11 * h * m[i + 1]
}

/** A point curve as a function of 0…1: the spline, flat beyond the end points, clamped to 0…1 (darktable `CurveDataSample`). */
export function curveFunction(points: readonly CurvePoint[]): (x: number) => number {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const n = points.length
  const m = monotoneTangents(xs, ys)
  if (!m) return (v) => clamp(v, 0, 1)
  return (v) => {
    if (v <= xs[0]) return clamp(ys[0], 0, 1)
    if (v >= xs[n - 1]) return clamp(ys[n - 1], 0, 1)
    return clamp(hermiteAt(xs, ys, m, v), 0, 1)
  }
}

export const isLinear = (p: readonly CurvePoint[]) => p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 1 && p[1][1] === 1

// ---- Regions (LightBench's own parametric curve)

export const REGION_KEYS = ['shadows', 'darks', 'lights', 'highlights'] as const
export type RegionKey = (typeof REGION_KEYS)[number]
export const REGION_NAMES: Record<RegionKey, string> = { shadows: 'Shadows', darks: 'Darks', lights: 'Lights', highlights: 'Highlights' }

/** The largest move of a region's middle at ±100 (LightBench's, tuned by eye). */
const REGION_REACH = 0.75
const REGION_MAX = 0.12

export const regionsAreZero = (r: CurveRegions) => REGION_KEYS.every((k) => r[k] === 0)

/**
 * The Regions curve as points: one in the middle of each region (where darktable's Lightroom importer puts them,
 * lightroom.c lines 1494-1505) moved up or down by its slider, plus the two ends, through the same monotone spline.
 * A region at ±100 moves its middle by 3/4 of the distance to the nearer neighbouring point, at most 0.12 (LightBench's
 * choice, by eye); the points are then kept in order, so the curve never folds over. The ends stay put.
 */
export function regionPoints(r: CurveRegions): CurvePoint[] {
  const [s, mid, h] = r.splits.map((v) => v / 100)
  const xs = [0, s / 2, (s + mid) / 2, (mid + h) / 2, (h + 1) / 2, 1]
  const values = [0, r.shadows, r.darks, r.lights, r.highlights, 0]
  const ys = xs.map((x, i) => {
    if (i === 0 || i === 5) return x
    const reach = Math.min(x - xs[i - 1], xs[i + 1] - x)
    return x + (values[i] / 100) * Math.min(REGION_MAX, REGION_REACH * reach)
  })
  // Keep the points rising: each at least a tenth of its gap above the one before, and below the one after.
  for (let i = 1; i < 5; i++) ys[i] = Math.max(ys[i], ys[i - 1] + 0.1 * (xs[i] - xs[i - 1]))
  for (let i = 4; i >= 1; i--) ys[i] = Math.min(ys[i], ys[i + 1] - 0.1 * (xs[i + 1] - xs[i]))
  return xs.map((x, i) => [x, clamp(ys[i], 0, 1)])
}

/** Which region an input tone (0…1) is in. */
export function regionAt(x: number, splits: readonly number[]): RegionKey {
  const v = x * 100
  return v < splits[0] ? 'shadows' : v < splits[1] ? 'darks' : v < splits[2] ? 'lights' : 'highlights'
}

/** Splits kept in order, SPLIT_GAP apart and away from the ends; `moved` (0–2) keeps its place and pushes the others. */
export function fixSplits(splits: readonly number[], moved = 1): [number, number, number] {
  const s = splits.map((v) => (finite(v) ? v : 50))
  s[moved] = clamp(s[moved], SPLIT_GAP * (moved + 1), 100 - SPLIT_GAP * (3 - moved))
  for (let i = moved + 1; i < 3; i++) s[i] = clamp(s[i], s[i - 1] + SPLIT_GAP, 100 - SPLIT_GAP * (3 - i))
  for (let i = moved - 1; i >= 0; i--) s[i] = clamp(s[i], SPLIT_GAP * (i + 1), s[i + 1] - SPLIT_GAP)
  return s.map((v) => Math.round(v * 10) / 10) as [number, number, number]
}

// ---- the whole curve

/**
 * The RGB (master) curve: the RGB point curve, then Regions. The order is LightBench's (Lightroom's isn't documented):
 * so a point's input is the tone a pixel has, which the targeted adjustment tool and the graph's hover marker show.
 */
export function masterFunction(tc: ToneCurveSettings): (x: number) => number {
  const point = curveFunction(tc.rgb)
  if (regionsAreZero(tc.regions)) return point
  const regions = curveFunction(regionPoints(tc.regions))
  return (x) => regions(point(x))
}

/** Whether the RGB curve (with Regions) and the channel curves change anything. */
export function curveParts(tc: ToneCurveSettings | undefined): { master: boolean; channels: boolean } {
  if (!tc) return { master: false, channels: false }
  return { master: !isLinear(tc.rgb) || !regionsAreZero(tc.regions), channels: !isLinear(tc.red) || !isLinear(tc.green) || !isLinear(tc.blue) }
}

export const curveActive = (tc: ToneCurveSettings | undefined) => {
  const p = curveParts(tc)
  return p.master || p.channels
}

/**
 * The lookup table for the GPU: LUT_SIZE entries per curve, input i / (LUT_SIZE − 1), interleaved as RGBA =
 * the Red, Green, Blue and RGB (master) curves, sRGB-encoded output.
 */
export function buildLut(tc: ToneCurveSettings, size = LUT_SIZE): Float32Array<ArrayBuffer> {
  const out = new Float32Array(size * 4)
  const fns = [curveFunction(tc.red), curveFunction(tc.green), curveFunction(tc.blue), masterFunction(tc)]
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1)
    for (let c = 0; c < 4; c++) out[i * 4 + c] = fns[c](x)
  }
  return out
}

/** The LUT's value with linear interpolation, as the shader reads it; slope 1 above white (`c`: 0–2 R, G, B, 3 RGB). */
export function lutAt(lut: Float32Array, c: number, x: number): number {
  const n = lut.length / 4
  const p = clamp(x, 0, 1) * (n - 1)
  const i = Math.floor(p)
  const j = Math.min(i + 1, n - 1)
  const t = p - i
  const y = lut[i * 4 + c] + (lut[j * 4 + c] - lut[i * 4 + c]) * t
  return x > 1 ? y + (x - 1) : y
}

/** sRGB transfer function (the axis of the curve and of the histogram). */
export const encode = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)
export const decode = (e: number) => (e <= 0.04045 ? e / 12.92 : Math.pow((e + 0.055) / 1.055, 2.4))

export const NORM_CODE: Record<CurveNorm, number> = { power: 0, luminance: 1, max: 2, average: 3, norm: 4, channels: 5 }
const REC2020_Y = [0.2627002, 0.6779981, 0.0593017]

/** A pixel's brightness for the curve (linear), every norm scaled so a neutral grey reads its own value. */
export function brightness(c: readonly number[], norm: CurveNorm): number {
  const [r, g, b] = c
  switch (norm) {
    case 'luminance':
      return REC2020_Y[0] * r + REC2020_Y[1] * g + REC2020_Y[2] * b
    case 'max':
      return Math.max(r, g, b)
    case 'average':
      return (r + g + b) / 3
    case 'norm':
      return Math.sqrt(r * r + g * g + b * b) / Math.sqrt(3)
    default: {
      const s2 = r * r + g * g + b * b
      return s2 > 0 ? (r * r * r + g * g * g + b * b * b) / s2 : 0
    }
  }
}

/**
 * The RGB curve on one pixel (linear Rec.2020, display-referred, as the sigmoid puts it out): the CPU twin of
 * develop-display.wgsl `applyMaster`, for tests and for the targeted adjustment tool. `f` is the curve on linear
 * values (decode ∘ curve ∘ encode).
 */
export function applyMaster(c: readonly number[], f: (v: number) => number, norm: CurveNorm, saturation: number): [number, number, number] {
  const p = c.map((v) => Math.max(v, 0)) as [number, number, number]
  const s = clamp(saturation, 0, 1)
  const n = brightness(p, norm === 'channels' ? 'power' : norm)
  if (!(n > 1e-9)) return norm === 'channels' ? (p.map(f) as [number, number, number]) : p
  const n2 = f(n)
  const r = n2 / n
  if (norm === 'channels') {
    return p.map((v) => v * r + s * (f(v) - v * r)) as [number, number, number]
  }
  const mx = Math.max(...p)
  const mn = Math.min(...p)
  // Adobe's method would spread the largest and smallest channel to f(max) and f(min); relative to the brightness
  // change that is this much more (or less) colour.
  const spread = mx - mn > 1e-6 ? (f(mx) - f(mn)) / (mx - mn) / r : 1
  let k = 1 + s * (Math.max(spread, 0) - 1)
  // Keep every channel within 0…max(1, the brightest input): less colour rather than a clipped, shifted hue.
  const upper = Math.max(1, mx)
  for (const v of p) {
    const d = v * r - n2
    if (d < -1e-12) k = Math.min(k, n2 / -d)
    else if (d > 1e-12 && n2 < upper) k = Math.min(k, (upper - n2) / d)
  }
  k = Math.max(k, 0)
  return p.map((v) => n2 + k * (v * r - n2)) as [number, number, number]
}

/** The whole curve on one pixel, with the GPU's LUT (linear in, linear out). */
export function applyToneCurve(c: readonly number[], tc: ToneCurveSettings, lut: Float32Array): [number, number, number] {
  const parts = curveParts(tc)
  let o: [number, number, number] = [c[0], c[1], c[2]]
  if (parts.master) o = applyMaster(o, (v) => decode(lutAt(lut, 3, encode(Math.max(v, 0)))), tc.norm, tc.saturation / 100)
  if (parts.channels) o = o.map((v, i) => decode(lutAt(lut, i, encode(Math.max(v, 0))))) as [number, number, number]
  return o
}

/** The input tone (0…1, on the curve's axis) of a pixel, for a channel's graph: what the targeted adjustment tool picks. */
export function toneOf(c: readonly number[], tc: ToneCurveSettings, channel: CurveChannel, lut?: Float32Array): number {
  const p = c.map((v) => Math.max(v, 0))
  if (channel === 'rgb') {
    if (tc.norm === 'channels') return encode(brightness(p, 'power'))
    return encode(brightness(p, tc.norm))
  }
  const i = channel === 'red' ? 0 : channel === 'green' ? 1 : 2
  const after = curveParts(tc).master ? applyToneCurve(p, { ...tc, red: LINEAR, green: LINEAR, blue: LINEAR }, lut ?? buildLut(tc)) : p
  return encode(Math.max(after[i], 0))
}

// ---- presets (Point mode's menu)

const DT_X = [0, 0.08, 0.17, 0.5, 0.83, 0.92, 1]
const DT_MEDIUM = [0, -0.02, -0.03, 0, 0.03, 0.02, 0]
/**
 * Linear, and Medium and Strong contrast from darktable's rgb curve presets "contrast | medium (linear)" and "contrast |
 * high (linear)" (src/iop/rgbcurve.c lines 189-217; darktable defines them on its L* graph scale, "compensate middle
 * gray", line 160; here they are used on the sRGB-encoded axis, which is close to it). Lightroom's own preset points
 * are Adobe's and aren't used. Fade (lifted blacks) is LightBench's own.
 */
export const CURVE_PRESETS: { id: string; name: string; points: CurvePoint[] }[] = [
  { id: 'linear', name: 'Linear', points: LINEAR },
  { id: 'medium', name: 'Medium Contrast', points: DT_X.map((x, i) => [x, round4(x + DT_MEDIUM[i])]) },
  { id: 'strong', name: 'Strong Contrast', points: DT_X.map((x, i) => [x, round4(x + 2 * DT_MEDIUM[i])]) },
  {
    id: 'fade',
    name: 'Fade',
    points: [
      [0, 0.08],
      [0.3, 0.32],
      [1, 1],
    ],
  },
]

/** The preset a point curve matches, if any. */
export function presetOf(points: readonly CurvePoint[]): string | null {
  const p = CURVE_PRESETS.find((x) => x.points.length === points.length && x.points.every((q, i) => Math.abs(q[0] - points[i][0]) < 1e-4 && Math.abs(q[1] - points[i][1]) < 1e-4))
  return p ? p.id : null
}

// ---- storing

/** Points as stored: finite, within 0…1, sorted, MIN_DX apart, at most MAX_POINTS (the ends kept); null when unusable. */
export function normalizePoints(raw: unknown): CurvePoint[] | null {
  if (!Array.isArray(raw)) return null
  const pts = raw
    .filter((p): p is [number, number] => Array.isArray(p) && finite(p[0]) && finite(p[1]))
    .map(([x, y]) => [round4(clamp(x, 0, 1)), round4(clamp(y, 0, 1))] as CurvePoint)
    .sort((a, b) => a[0] - b[0])
  const out: CurvePoint[] = []
  for (const p of pts) if (!out.length || p[0] - out[out.length - 1][0] >= MIN_DX - 1e-9) out.push(p)
  if (out.length < 2) return null
  if (out.length > MAX_POINTS) return [...out.slice(0, MAX_POINTS - 1), out[out.length - 1]]
  return out
}

const samePoints = (a: readonly CurvePoint[], b: readonly CurvePoint[]) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1])

export function isDefaultToneCurve(tc: ToneCurveSettings): boolean {
  const d = DEFAULT_TONE_CURVE
  return (
    regionsAreZero(tc.regions) &&
    tc.regions.splits.every((v, i) => v === d.regions.splits[i]) &&
    CURVE_CHANNELS.every((c) => samePoints(tc[c], d[c])) &&
    tc.saturation === d.saturation &&
    tc.norm === d.norm
  )
}

/**
 * A tone curve as stored in the develop settings, or undefined when it is absent or at its defaults: an untouched (or
 * reset) curve leaves no trace, so the edit equals one made before the Tone Curve existed.
 */
export function normalizeToneCurve(raw: unknown): ToneCurveSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const t = raw as Partial<Omit<ToneCurveSettings, 'regions'>> & { regions?: Partial<CurveRegions> }
  const r: Partial<CurveRegions> = t.regions ?? {}
  const value = (v: unknown) => (finite(v) ? Math.round(clamp(v, -100, 100) * 10) / 10 + 0 : 0)
  const splits = Array.isArray(r.splits) && r.splits.length === 3 ? fixSplits(r.splits as number[], 1) : DEFAULT_SPLITS
  const tc: ToneCurveSettings = {
    regions: { shadows: value(r.shadows), darks: value(r.darks), lights: value(r.lights), highlights: value(r.highlights), splits },
    rgb: normalizePoints(t.rgb) ?? LINEAR,
    red: normalizePoints(t.red) ?? LINEAR,
    green: normalizePoints(t.green) ?? LINEAR,
    blue: normalizePoints(t.blue) ?? LINEAR,
    saturation: finite(t.saturation) ? Math.round(clamp(t.saturation, 0, 100)) : 100,
    norm: CURVE_NORMS.some((n) => n.id === t.norm) ? (t.norm as CurveNorm) : DEFAULT_TONE_CURVE.norm,
  }
  return isDefaultToneCurve(tc) ? undefined : tc
}

/** Settings with a tone curve set, or without the key when it is at its defaults. */
export function withToneCurve<S extends { toneCurve?: ToneCurveSettings }>(s: S, tc: ToneCurveSettings | undefined): S {
  const n = normalizeToneCurve(tc)
  // Unchanged: the same object, so comparisons (Auto Sync, history) see no change.
  if (JSON.stringify(n) === JSON.stringify(s.toneCurve) && (n !== undefined || !('toneCurve' in s))) return s
  const { toneCurve: _old, ...rest } = s
  void _old
  return (n ? { ...rest, toneCurve: n } : rest) as S
}

/** The key of the curves' shape (not Refine Saturation or the norm, which are uniforms): the LUT is rebuilt when it changes. */
export const lutKey = (tc: ToneCurveSettings) => JSON.stringify([tc.regions, tc.rgb, tc.red, tc.green, tc.blue])

// ---- presets' Amount

/** Points of one curve between two curves: each x of both, the output moved from `a` towards `b` by t (0…2). */
function blendPoints(a: readonly CurvePoint[], b: readonly CurvePoint[], t: number): CurvePoint[] {
  const fa = curveFunction(a)
  const fb = curveFunction(b)
  let xs = [...new Set([...b.map((p) => p[0]), ...a.map((p) => p[0])])].sort((p, q) => p - q)
  const fromB = new Set(b.map((p) => p[0]))
  // Too many: drop the before-curve's own x positions first (the preset's points shape the curve).
  while (xs.length > MAX_POINTS) {
    const i = xs.findIndex((x, k) => k > 0 && k < xs.length - 1 && !fromB.has(x))
    xs.splice(i > 0 ? i : 1, 1)
  }
  const pts = xs.map((x) => [x, clamp(fa(x) + t * (fb(x) - fa(x)), 0, 1)] as CurvePoint)
  return normalizePoints(pts) ?? LINEAR
}

/**
 * A preset's Amount on the tone curve: the curve's change from `before` (the photo's own, or linear) scaled by
 * `amount` — 0 is the photo as it was, 1 the preset's curve, 2 twice its deviation. Regions and Refine Saturation move the
 * same way; the brightness measure follows the preset whenever the amount is above 0.
 */
export function blendToneCurve(before: ToneCurveSettings | undefined, after: ToneCurveSettings | undefined, amount: number): ToneCurveSettings | undefined {
  if (!before && !after) return undefined
  const a = before ?? DEFAULT_TONE_CURVE
  const b = after ?? DEFAULT_TONE_CURVE
  if (amount === 1) return after
  if (amount === 0) return before
  const lerp = (x: number, y: number) => x + (y - x) * amount
  const reg = (k: RegionKey) => Math.round(clamp(lerp(a.regions[k], b.regions[k]), -100, 100))
  const tc: ToneCurveSettings = {
    regions: {
      shadows: reg('shadows'),
      darks: reg('darks'),
      lights: reg('lights'),
      highlights: reg('highlights'),
      splits: fixSplits(a.regions.splits.map((v, i) => clamp(lerp(v, b.regions.splits[i]), SPLIT_GAP, 100 - SPLIT_GAP)), 1),
    },
    rgb: samePoints(a.rgb, b.rgb) ? b.rgb : blendPoints(a.rgb, b.rgb, amount),
    red: samePoints(a.red, b.red) ? b.red : blendPoints(a.red, b.red, amount),
    green: samePoints(a.green, b.green) ? b.green : blendPoints(a.green, b.green, amount),
    blue: samePoints(a.blue, b.blue) ? b.blue : blendPoints(a.blue, b.blue, amount),
    saturation: Math.round(clamp(lerp(a.saturation, b.saturation), 0, 100)),
    norm: amount > 0 ? b.norm : a.norm,
  }
  return normalizeToneCurve(tc)
}

// ---- for the GPU

export interface ToneCurveGpu {
  /** lutKey: the engine uploads the table again only when it changes. */
  key: string
  lut: Float32Array<ArrayBuffer>
  /** Bit 1: the RGB curve (with Regions) is on; bit 2: the channel curves are. */
  flags: number
  norm: number
  /** 0…1. */
  saturation: number
}

let lastLut: { key: string; lut: Float32Array<ArrayBuffer> } | null = null

/** What the display shader needs, or null when the curve changes nothing (the shader then skips it). */
export function toneCurveGpu(tc: ToneCurveSettings | undefined): ToneCurveGpu | null {
  const parts = curveParts(tc)
  if (!tc || (!parts.master && !parts.channels)) return null
  const key = lutKey(tc)
  if (lastLut?.key !== key) lastLut = { key, lut: buildLut(tc) }
  return { key, lut: lastLut.lut, flags: (parts.master ? 1 : 0) | (parts.channels ? 2 : 0), norm: NORM_CODE[tc.norm], saturation: tc.saturation / 100 }
}
