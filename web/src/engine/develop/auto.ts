// Auto: moves the Basic-panel sliders so the developed photo meets a target "look".
//
// The solver measures the real pipeline output (via a small GPU rendering) and adjusts one slider at a
// time: Exposure → midtones, Contrast → spread, Whites/Blacks → end points, Highlights → clipping,
// Vibrance → colourfulness. Each slider minimises (miss / tolerance)² + (slider / scale)², so a slider
// moves only as far as it actually helps: when a target can't be reached (e.g. a hazy photo has no deep
// blacks for Blacks to act on) the slider stays near zero instead of running to the end of its range.
// Targets are measured in display (sRGB-encoded) luminance, 0…1.

import type { DevelopSettings } from './settings'

/** Histogram-based measurements of a developed image. */
export interface Metrics {
  /** Luminance percentiles, 0…1 (display-encoded). */
  p005: number
  p10: number
  p25: number
  median: number
  p75: number
  p995: number
  /** Fractions of pixels clipped at white / black. */
  highlightClip: number
  shadowClip: number
  /** Mean colourfulness (max − min channel), 0…1. */
  chroma: number
}

export interface StatsLike {
  luma: ArrayLike<number>
  pixels: number
  highlightClipped: number
  shadowClipped: number
  chroma: number
}

function percentile(hist: ArrayLike<number>, total: number, p: number): number {
  const goal = p * total
  let acc = 0
  for (let i = 0; i < hist.length; i++) {
    const next = acc + hist[i]
    if (next >= goal && hist[i] > 0) {
      // interpolate inside the bin
      return (i + (goal - acc) / hist[i] - 0.5) / (hist.length - 1)
    }
    acc = next
  }
  return 1
}

export function metricsFromStats(s: StatsLike): Metrics {
  const n = Math.max(1, s.pixels)
  const p = (q: number) => Math.min(1, Math.max(0, percentile(s.luma, n, q)))
  return {
    p005: p(0.005),
    p10: p(0.1),
    p25: p(0.25),
    median: p(0.5),
    p75: p(0.75),
    p995: p(0.995),
    highlightClip: s.highlightClipped / n,
    shadowClip: s.shadowClipped / n,
    chroma: s.chroma,
  }
}

/** Measures 8-bit RGBA pixels on the CPU (used for reference photos' thumbnails). */
export function statsFromPixels(rgba: Uint8ClampedArray | Uint8Array): StatsLike {
  const luma = new Uint32Array(256)
  let hi = 0
  let lo = 0
  let chroma = 0
  const pixels = rgba.length / 4
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]
    const g = rgba[i + 1]
    const b = rgba[i + 2]
    luma[Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b))]++
    if (r === 255 || g === 255 || b === 255) hi++
    if (r === 0 && g === 0 && b === 0) lo++
    chroma += (Math.max(r, g, b) - Math.min(r, g, b)) / 255
  }
  return { luma, pixels, highlightClipped: hi, shadowClipped: lo, chroma: pixels ? chroma / pixels : 0 }
}

export interface AutoTarget {
  id: string
  name: string
  /** Where the midtones should sit (median luminance). */
  median: number
  /** Black point (0.5th percentile) and white point (99.5th percentile). */
  low: number
  high: number
  /**
   * Contrast as a measured spread between the 25th and 75th percentiles (reference photos and saved
   * targets), or null to use the fixed `contrast` amount instead (built-in looks: spread depends too
   * much on the scene, e.g. a bright sky over dark land).
   */
  spread: number | null
  /** Fixed slider amounts applied by a look (built-in looks). */
  contrast?: number
  vibrance?: number
  /** Largest acceptable fraction of clipped highlights. */
  maxHighlightClip: number
  /** Target colourfulness to match with Vibrance, or null (then `vibrance`, if set, is applied as-is). */
  chroma: number | null
  builtIn?: boolean
}

/**
 * Built-in looks. Values are starting points chosen by eye for typical photos, not standards; save your
 * own targets to refine them.
 */
export const BUILT_IN_TARGETS: AutoTarget[] = [
  { id: 'natural', name: 'Natural', median: 0.45, low: 0.03, high: 0.95, spread: null, contrast: 0, maxHighlightClip: 0.002, chroma: null, builtIn: true },
  { id: 'vivid', name: 'Vivid', median: 0.46, low: 0.02, high: 0.97, spread: null, contrast: 25, vibrance: 35, maxHighlightClip: 0.003, chroma: null, builtIn: true },
  { id: 'landscape', name: 'Landscape', median: 0.44, low: 0.025, high: 0.96, spread: null, contrast: 15, vibrance: 25, maxHighlightClip: 0.002, chroma: null, builtIn: true },
  { id: 'portrait', name: 'Portrait', median: 0.5, low: 0.05, high: 0.94, spread: null, contrast: -10, vibrance: 10, maxHighlightClip: 0.001, chroma: null, builtIn: true },
  { id: 'low-key', name: 'Low-key (dark, moody)', median: 0.26, low: 0.01, high: 0.9, spread: null, contrast: 10, maxHighlightClip: 0.001, chroma: null, builtIn: true },
  { id: 'high-key', name: 'High-key (bright, airy)', median: 0.66, low: 0.1, high: 0.985, spread: null, contrast: -15, maxHighlightClip: 0.01, chroma: null, builtIn: true },
]

/** A target that reproduces how a given image looks (for "match a reference photo" and saved targets). */
export function targetFromMetrics(id: string, name: string, m: Metrics): AutoTarget {
  return {
    id,
    name,
    median: m.median,
    low: m.p005,
    high: m.p995,
    spread: m.p75 - m.p25,
    maxHighlightClip: Math.max(0.001, m.highlightClip),
    chroma: m.chroma,
  }
}

/** Sliders Auto can set. */
export type AutoKey = 'exposure' | 'contrast' | 'highlights' | 'whites' | 'blacks' | 'vibrance'
type Key = AutoKey

export const AUTO_SLIDERS: { key: AutoKey; label: string }[] = [
  { key: 'exposure', label: 'Exposure' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'whites', label: 'Whites' },
  { key: 'blacks', label: 'Blacks' },
  { key: 'vibrance', label: 'Vibrance' },
]

/** Options the user sets on Auto (owner's decision after the round-2 research: tunable, not a black box). */
export interface AutoOptions {
  /** Sliders Auto may change; the others keep their current values. Default: all. */
  sliders?: AutoKey[]
  /** 0…1.5: how far Auto moves the sliders from 0 (1 = its full result). */
  strength?: number
}

/** What a photo's Auto was, so pasting can re-run it on each photo instead of copying its numbers. */
export interface AutoRecord {
  target: AutoTarget
  sliders: AutoKey[]
  strength: number
}

/** Search range and "cost scale" of each slider: moving it by `scale` costs as much as missing by one tolerance. */
const SLIDERS: Record<Key, { range: [number, number]; scale: number; step: number }> = {
  exposure: { range: [-4, 4], scale: 6, step: 0.01 },
  contrast: { range: [-100, 100], scale: 100, step: 1 },
  highlights: { range: [-100, 0], scale: 100, step: 1 },
  whites: { range: [-100, 100], scale: 100, step: 1 },
  blacks: { range: [-100, 100], scale: 100, step: 1 },
  vibrance: { range: [-100, 100], scale: 100, step: 1 },
}

/** Tolerances: how big a miss counts as "one unit" of error. */
const LUMA_TOL = 0.02
const CLIP_TOL = 0.002
const CHROMA_TOL = 0.01

/**
 * Acceptable ranges (± around the target) inside which a measurement counts as on target, so Auto only
 * moves a slider to fix something that is off. Looks get wider ranges than a reference photo.
 */
const BANDS = {
  look: { median: 0.04, low: 0.02, high: 0.025, spread: 0.06, chroma: 0.03 },
  match: { median: 0.02, low: 0.01, high: 0.015, spread: 0.03, chroma: 0.015 },
}

/** Distance outside [goal − band, goal + band]. */
const outside = (v: number, goal: number, band: number) => Math.max(0, Math.abs(v - goal) - band)

export interface AutoResult {
  settings: DevelopSettings
  /** Number of measurements taken (for diagnostics). */
  measurements: number
  final: Metrics
}

const GOLDEN = (Math.sqrt(5) - 1) / 2

/**
 * Finds slider values that bring the measured image close to `target`.
 * `measure` develops the image with the given settings and returns its metrics.
 */
export async function solveAuto(
  start: DevelopSettings,
  target: AutoTarget,
  measure: (s: DevelopSettings) => Promise<Metrics>,
  iterations = 12,
  options: AutoOptions = {},
): Promise<AutoResult> {
  let count = 0
  const allowed = new Set<AutoKey>(options.sliders ?? AUTO_SLIDERS.map((x) => x.key))
  const strength = Math.max(0, Math.min(1.5, options.strength ?? 1))
  // Start from neutral values for the sliders Auto may change, so repeated presses give the same result.
  // Shadows has no Auto rule; a full Auto resets it with the others, as before. With a choice of sliders, the
  // unticked ones and Shadows keep their values.
  let s: DevelopSettings = allowed.size === AUTO_SLIDERS.length ? { ...start, shadows: 0 } : start
  for (const k of allowed) s = { ...s, [k]: 0 }

  /** Golden-section search for the slider value with the lowest cost. */
  const fit = async (key: Key, miss: (x: Metrics) => number) => {
    if (!allowed.has(key)) return
    const { range, scale, step } = SLIDERS[key]
    const cache = new Map<number, number>()
    const cost = async (v: number) => {
      const q = Math.round(v / step) * step
      let c = cache.get(q)
      if (c === undefined) {
        count++
        c = miss(await measure({ ...s, [key]: q })) ** 2 + (q / scale) ** 2
        cache.set(q, c)
      }
      return c
    }
    let [a, b] = range
    let x1 = b - GOLDEN * (b - a)
    let x2 = a + GOLDEN * (b - a)
    let f1 = await cost(x1)
    let f2 = await cost(x2)
    for (let i = 0; i < iterations; i++) {
      if (f1 <= f2) {
        b = x2
        x2 = x1
        f2 = f1
        x1 = b - GOLDEN * (b - a)
        f1 = await cost(x1)
      } else {
        a = x1
        x1 = x2
        f1 = f2
        x2 = a + GOLDEN * (b - a)
        f2 = await cost(x2)
      }
    }
    const best = Math.round((a + b) / 2 / step) * step
    // Prefer leaving the slider at 0 when that's at least as good.
    const v = (await cost(0)) <= (await cost(best)) ? 0 : best
    s = { ...s, [key]: Math.round(v / step) * step }
  }

  const band = target.builtIn ? BANDS.look : BANDS.match
  // A look's fixed amounts are applied first; the solver works around them.
  if (target.contrast !== undefined && allowed.has('contrast')) s = { ...s, contrast: target.contrast }
  if (target.vibrance !== undefined && allowed.has('vibrance')) s = { ...s, vibrance: target.vibrance }
  const spread = target.spread
  for (let pass = 0; pass < 2; pass++) {
    await fit('exposure', (x) => outside(x.median, target.median, band.median) / LUMA_TOL)
    if (spread !== null) await fit('contrast', (x) => outside(x.p75 - x.p25, spread, band.spread) / LUMA_TOL)
    await fit('whites', (x) => outside(x.p995, target.high, band.high) / LUMA_TOL)
    await fit('blacks', (x) => outside(x.p005, target.low, band.low) / LUMA_TOL)
  }
  // Pull back highlights only if too much is still clipped.
  count++
  if ((await measure(s)).highlightClip > target.maxHighlightClip) {
    await fit('highlights', (x) => Math.max(0, x.highlightClip - target.maxHighlightClip) / CLIP_TOL)
  }
  const chroma = target.chroma
  if (chroma !== null) await fit('vibrance', (x) => outside(x.chroma, chroma, band.chroma) / CHROMA_TOL)
  if (strength !== 1) {
    for (const k of allowed) {
      const { step, range } = SLIDERS[k]
      s = { ...s, [k]: Math.min(range[1], Math.max(range[0], Math.round((s[k] * strength) / step) * step)) }
    }
  }
  count++
  const auto: AutoRecord = { target, sliders: [...allowed], strength }
  return { settings: { ...s, auto }, measurements: count, final: await measure(s) }
}
