// Tone Curve Auto (PHASE3.md Part 21): Auto contrast and Auto colour. Both are LightBench's own methods, written for
// this tool; neither copies Adobe's or another editor's algorithm (Photoshop's Auto Contrast and Auto Color aren't
// published, and nothing here is modelled on a guess of them). They only write tone-curve settings, so an edit made
// with them renders through the existing curve stage and needs no new process version.
//
// Their input is the histogram the Tone Curve's graph already shows: the GPU's stats pass of the curve's input, on the
// curve's own axis (sRGB-encoded Rec.2020, 256 bins; `DevelopEngine.renderCurveInput`). Auto contrast reads the luma
// bins of the image before the curve (after Basic, the mixer and the grade); Auto colour reads the Red, Green and Blue
// bins after the RGB curve, which is the channel curves' input. Both are pure functions of those bins, so the same photo
// with the same settings always gives the same curve.

import { blendToneCurve, curveFunction, DEFAULT_TONE_CURVE, isLinear, LINEAR, masterFunction, normalizePoints, normalizeToneCurve, type CurvePoint, type ToneCurveSettings } from './tone-curve'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// ---- histograms

/**
 * A histogram's value at a fraction of its pixels. The stats pass bins floor(v · 255), so with n bins bin i holds values
 * from i/(n − 1) to (i + 1)/(n − 1) (the last bin: 1 and above); values are spread evenly within a bin.
 */
export function percentile(h: ArrayLike<number>, q: number): number {
  let total = 0
  for (let i = 0; i < h.length; i++) total += h[i]
  if (total <= 0) return NaN
  const target = clamp(q, 0, 1) * total
  let acc = 0
  for (let i = 0; i < h.length; i++) {
    const c = h[i]
    if (c > 0 && acc + c >= target) return Math.min(1, (i + (target - acc) / c) / (h.length - 1))
    acc += c
  }
  return 1
}

/** Mean and standard deviation of a histogram's values (bin centres, on the same axis as `percentile`). */
export function histStats(h: ArrayLike<number>): { mean: number; sd: number; total: number } {
  let n = 0
  let s = 0
  let s2 = 0
  for (let i = 0; i < h.length; i++) {
    const x = Math.min(1, (i + 0.5) / (h.length - 1))
    n += h[i]
    s += h[i] * x
    s2 += h[i] * x * x
  }
  if (!n) return { mean: NaN, sd: 0, total: 0 }
  const mean = s / n
  return { mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)), total: n }
}

/**
 * Pixels a curve sends to black or white, judged on the 8-bit histogram it is measured on (`stats.wgsl` bins
 * floor(v · 255)): a bin counts as black when the darkest value in it comes out below half a level, as white when the
 * brightest comes out at or above 254.5 levels. Bins hold values from i/255 to (i + 1)/255, so the worst case of each
 * bin is used, the same way for every curve compared.
 */
export function clipCounts(h: ArrayLike<number>, f: (x: number) => number): { black: number; white: number } {
  let black = 0
  let white = 0
  const n = h.length
  for (let i = 0; i < n; i++) {
    if (!h[i]) continue
    if (f(i / (n - 1)) < 0.5 / (n - 1)) black += h[i]
    if (f(Math.min(1, (i + 1) / (n - 1))) >= (n - 1.5) / (n - 1)) white += h[i]
  }
  return { black, white }
}

// ---- Auto contrast

/** The spread (standard deviation of the encoded luma) Auto contrast aims for; at or above it the curve stays straight. */
export const CONTRAST_TARGET_SD = 0.32
/** The steepest the S-curve gets at the middle (a gentle curve: darktable's "contrast | high" preset is about 1.18). */
export const CONTRAST_MAX_SLOPE = 1.25
/** The darkest and brightest tones kept: below the 0.5th and above the 99.5th percentile the curve never moves away from them. */
export const CONTRAST_ENDS = [0.005, 0.995] as const

export interface AutoContrast {
  /** The RGB point curve to set (null: a straight line). */
  points: CurvePoint[] | null
  /** The slope at the middle the curve was fitted for (1 = none), and how much of it was kept for clipping (0…1). */
  slope: number
  kept: number
  /** The pivot (the median tone, kept where it is) and the protected ends. */
  pivot: number
  ends: [number, number]
  /** Why the fitted curve is a straight line, when it is. */
  reason?: 'empty' | 'contrasty' | 'narrow'
}

/**
 * Auto contrast (LightBench's own method): a gentle S-curve for the RGB point curve, fitted to the luma histogram of the
 * curve's input.
 *
 * 1. The median tone m is the pivot (it stays where it is); the 0.5th and 99.5th percentiles lo and hi are the ends.
 * 2. The steepness g at m is the target spread over the photo's spread (standard deviation of the encoded luma), between
 *    1 (a photo already spread that far gets a straight line) and 1.25.
 * 3. Seven points: (0, 0), (lo, lo), a point halfway between lo and m pulled down, (m, m), a point halfway between m and
 *    hi pushed up, (hi, hi), (1, 1). The pulls are set so the spline's slope at m is g. The curve stays on or above the
 *    diagonal below lo and on or below it above hi, so the darkest and brightest tones only ever move away from black and
 *    white: the curve can't clip what wasn't clipped.
 * 4. Checked against the curve it replaces, on the same histogram (`clipCounts`, through Regions too): if the photo's
 *    current curve clipped fewer pixels (e.g. it lifts the blacks, as Fade does), the S-curve is blended towards the
 *    current curve (bisection on the blend) until it clips no more than the current one.
 */
export function autoContrast(luma: ArrayLike<number>, current?: ToneCurveSettings): AutoContrast {
  const base = current ?? DEFAULT_TONE_CURVE
  const st = histStats(luma)
  if (!st.total) return { points: null, slope: 1, kept: 0, pivot: 0.5, ends: [0, 1], reason: 'empty' }
  // The protected ends: the 0.5th and 99.5th percentiles, at least 2 % from black and white.
  const lo = round4(Math.max(0.02, percentile(luma, CONTRAST_ENDS[0])))
  const hi = round4(Math.min(0.98, percentile(luma, CONTRAST_ENDS[1])))
  const m = round4(clamp(percentile(luma, 0.5), lo + 0.02, hi - 0.02))
  const g = clamp(CONTRAST_TARGET_SD / Math.max(st.sd, 1e-6), 1, CONTRAST_MAX_SLOPE)
  // A straight line when there is nothing to shape: tones too close together (a nearly uniform picture), or a photo
  // already spread at least as far as the target.
  let reason: AutoContrast['reason']
  let target: CurvePoint[] | null = null
  if (hi - lo < 0.06) reason = 'narrow'
  else if (g < 1.005) reason = 'contrasty'
  else {
    target = sCurve(lo, (lo + m) / 2, m, (m + hi) / 2, hi, g)
    if (!target) reason = 'narrow'
  }
  const ends: [number, number] = [lo, hi]
  const slope = target ? g : 1
  const want = target ?? LINEAR
  // No more clipping than the curve it replaces (a straight line too: replacing a faded curve could clip the blacks).
  const before = clipCounts(luma, masterFunction(base))
  const blended = (t: number): CurvePoint[] => (t >= 1 ? want : t <= 0 ? base.rgb : (blendToneCurve(base, { ...base, rgb: want }, t) ?? DEFAULT_TONE_CURVE).rgb)
  const ok = (rgb: CurvePoint[]) => {
    const c = clipCounts(luma, masterFunction({ ...base, rgb }))
    return c.black <= before.black && c.white <= before.white
  }
  let kept = 1
  if (!ok(want)) {
    let a = 0
    let b = 1
    for (let k = 0; k < 12; k++) {
      const t = (a + b) / 2
      if (ok(blended(t))) a = t
      else b = t
    }
    kept = Math.floor(a * 100) / 100
    while (kept > 0 && !ok(blended(kept))) kept = Math.round((kept - 0.01) * 100) / 100
  }
  const rgb = kept > 0 ? blended(kept) : base.rgb
  return { points: isLinear(rgb) ? null : rgb, slope, kept, pivot: m, ends, ...(reason ? { reason } : {}) }
}

const round4 = (v: number) => Math.round(v * 10000) / 10000 + 0

/** The seven points of the S-curve (null when they can't be kept apart). */
function sCurve(lo: number, a: number, m: number, b: number, hi: number, g: number): CurvePoint[] | null {
  // The secant from each pulled point to the pivot has slope g, so the spline's tangent at m (their mean) is g.
  const ya = a - (g - 1) * (m - a)
  const yb = b + (g - 1) * (b - m)
  const pts: CurvePoint[] = [
    [0, 0],
    [lo, lo],
    [a, ya],
    [m, m],
    [b, yb],
    [hi, hi],
    [1, 1],
  ].map(([x, y]) => [round4(x), round4(y)] as CurvePoint)
  const kept = pts
  for (let i = 1; i < kept.length; i++) if (kept[i][0] - kept[i - 1][0] < 0.01 || kept[i][1] <= kept[i - 1][1]) return null
  return normalizePoints(kept)
}

// ---- Auto colour

/** Where the channels are compared: the shadows, the middle and the highlights (fractions of the pixels). */
export const COLOUR_ANCHORS = [0.02, 0.5, 0.98] as const
/** How much of each anchor's cast is taken away: all of it in the midtones, half in the shadows and highlights. */
export const COLOUR_STRENGTH = [0.5, 1, 0.5] as const
/** The most a channel's anchor moves (fractions of the axis): subtle, never a recolouring. */
export const COLOUR_LIMIT = [0.025, 0.04, 0.025] as const
/** Casts smaller than this are left alone. */
export const COLOUR_MIN_SHIFT = 0.002

export interface AutoColour {
  /** The Red, Green and Blue curves (LINEAR where nothing moves). */
  red: CurvePoint[]
  green: CurvePoint[]
  blue: CurvePoint[]
  /** Each channel's anchors before (x) and the shifts applied (dy), for the readout and the tests. */
  anchors: { x: number[]; dy: number[] }[]
}

/**
 * Auto colour (LightBench's own method): small Red, Green and Blue curve moves that make the channels agree, so a colour
 * cast across the photo goes away while its colours stay.
 *
 * Each channel's histogram (the channel curves' input) gives its value at the 2nd, 50th and 98th percentile. At each of
 * these anchors the three channels' mean is the neutral target; a channel's curve moves its anchor towards it, fully in
 * the midtones (neutral midtones) and half-way in the shadows and highlights (near-neutral ends), and by at most 4 % of
 * the axis in the midtones and 2.5 % at the ends. The curve runs through (0, 0), the moved anchors and (1, 1), on the
 * same monotone spline as every curve. White balance is not touched.
 *
 * Percentiles of each channel are a summary of the whole photo, not of its grey pixels: a photo dominated by one colour
 * (a blue sky, a green field) reads as a cast and is pulled towards neutral too, within the limits. The limits are what
 * keep that subtle.
 */
export function autoColour(red: ArrayLike<number>, green: ArrayLike<number>, blue: ArrayLike<number>): AutoColour {
  const hs = [red, green, blue]
  const xs = hs.map((h) => COLOUR_ANCHORS.map((q) => percentile(h, q)))
  const empty = xs.some((r) => r.some((v) => !Number.isFinite(v)))
  const anchors = hs.map(() => ({ x: [] as number[], dy: [] as number[] }))
  const curves: CurvePoint[][] = [LINEAR, LINEAR, LINEAR]
  if (empty) return { red: LINEAR, green: LINEAR, blue: LINEAR, anchors }
  for (let c = 0; c < 3; c++) {
    const pts: CurvePoint[] = [[0, 0]]
    for (let k = 0; k < COLOUR_ANCHORS.length; k++) {
      const x = xs[c][k]
      const target = (xs[0][k] + xs[1][k] + xs[2][k]) / 3
      const dy = clamp((target - x) * COLOUR_STRENGTH[k], -COLOUR_LIMIT[k], COLOUR_LIMIT[k])
      anchors[c].x.push(x)
      // The ends only where there is room to move (not at black or white), and only casts worth correcting.
      const room = k === 1 ? x > 0.05 && x < 0.95 : x > 0.03 && x < 0.97
      if (!room || Math.abs(dy) < COLOUR_MIN_SHIFT) {
        anchors[c].dy.push(0)
        continue
      }
      anchors[c].dy.push(dy)
      pts.push([round4(x), round4(clamp(x + dy, 0.001, 0.999))])
    }
    pts.push([1, 1])
    // Anchors too close together, or out of order after moving: keep the midtone one only.
    const usable = (p: CurvePoint[]) => p.every((q, i) => i === 0 || (q[0] - p[i - 1][0] >= 0.02 && q[1] > p[i - 1][1]))
    let chosen = pts
    if (!usable(chosen)) {
      const mid = pts.find((q) => q[0] === round4(xs[c][1]))
      chosen = mid ? [[0, 0], mid, [1, 1]] : [[0, 0], [1, 1]]
      if (!usable(chosen)) chosen = [[0, 0], [1, 1]]
      anchors[c].dy = anchors[c].dy.map((d, k) => (k === 1 && mid ? d : 0))
    }
    curves[c] = chosen.length > 2 ? (normalizePoints(chosen) ?? LINEAR) : LINEAR
  }
  return { red: curves[0], green: curves[1], blue: curves[2], anchors }
}

// ---- results as tone-curve settings, and their Amount

/** The tone curve with Auto contrast's RGB curve (the rest of the curve as it was). */
export function withAutoContrast(current: ToneCurveSettings | undefined, r: AutoContrast): ToneCurveSettings | undefined {
  return normalizeToneCurve({ ...(current ?? DEFAULT_TONE_CURVE), rgb: r.points ?? LINEAR })
}

/** The tone curve with Auto colour's Red, Green and Blue curves (the rest as it was). */
export function withAutoColour(current: ToneCurveSettings | undefined, r: AutoColour): ToneCurveSettings | undefined {
  return normalizeToneCurve({ ...(current ?? DEFAULT_TONE_CURVE), red: r.red, green: r.green, blue: r.blue })
}

/**
 * An Auto result at an Amount (0…1): the curve between the one before Auto (0) and the Auto curve (1), each point curve
 * sampled at both curves' points and moved by the amount (the presets' Amount, `blendToneCurve`).
 */
export function curveAtAmount(before: ToneCurveSettings | undefined, after: ToneCurveSettings | undefined, amount: number): ToneCurveSettings | undefined {
  return blendToneCurve(before, after, clamp(amount, 0, 1))
}

/** A point curve's output at x (for the tests and the readout). */
export const curveAt = (points: readonly CurvePoint[], x: number) => curveFunction(points)(x)
