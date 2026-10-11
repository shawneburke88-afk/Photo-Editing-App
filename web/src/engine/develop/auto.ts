// Auto: moves the Basic-panel sliders so the developed photo meets a target "look".
//
// The solver measures the real pipeline output (via a small GPU rendering) and adjusts one slider at a
// time with bisection: Exposure → midtones, Contrast → spread, Whites/Blacks → end points, Highlights →
// clipping, Vibrance → colourfulness. Targets are measured in display (sRGB-encoded) luminance, 0…1.

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
  /** Contrast: luminance spread between the 25th and 75th percentiles. */
  spread: number
  /** Largest acceptable fraction of clipped highlights. */
  maxHighlightClip: number
  /** Target colourfulness, or null to leave Vibrance alone. */
  chroma: number | null
  builtIn?: boolean
}

/**
 * Built-in looks. Values are starting points chosen by eye for typical photos, not standards; save your
 * own targets to refine them.
 */
export const BUILT_IN_TARGETS: AutoTarget[] = [
  { id: 'natural', name: 'Natural', median: 0.45, low: 0.03, high: 0.95, spread: 0.3, maxHighlightClip: 0.002, chroma: null, builtIn: true },
  { id: 'vivid', name: 'Vivid', median: 0.46, low: 0.02, high: 0.97, spread: 0.36, maxHighlightClip: 0.003, chroma: 0.24, builtIn: true },
  { id: 'landscape', name: 'Landscape', median: 0.44, low: 0.025, high: 0.96, spread: 0.34, maxHighlightClip: 0.002, chroma: 0.2, builtIn: true },
  { id: 'portrait', name: 'Portrait', median: 0.5, low: 0.05, high: 0.94, spread: 0.26, maxHighlightClip: 0.001, chroma: 0.13, builtIn: true },
  { id: 'low-key', name: 'Low-key (dark, moody)', median: 0.26, low: 0.01, high: 0.9, spread: 0.3, maxHighlightClip: 0.001, chroma: null, builtIn: true },
  { id: 'high-key', name: 'High-key (bright, airy)', median: 0.66, low: 0.1, high: 0.985, spread: 0.22, maxHighlightClip: 0.01, chroma: null, builtIn: true },
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

type Key = 'exposure' | 'contrast' | 'highlights' | 'whites' | 'blacks' | 'vibrance'

const RANGES: Record<Key, [number, number]> = {
  exposure: [-4, 4],
  contrast: [-100, 100],
  highlights: [-100, 0],
  whites: [-100, 100],
  blacks: [-100, 100],
  vibrance: [-100, 100],
}

export interface AutoResult {
  settings: DevelopSettings
  /** Number of measurements taken (for diagnostics). */
  measurements: number
  final: Metrics
}

/**
 * Finds slider values that bring the measured image close to `target`.
 * `measure` develops the image with the given settings and returns its metrics.
 */
export async function solveAuto(
  start: DevelopSettings,
  target: AutoTarget,
  measure: (s: DevelopSettings) => Promise<Metrics>,
  iterations = 7,
): Promise<AutoResult> {
  let count = 0
  const m = async (s: DevelopSettings) => {
    count++
    return measure(s)
  }
  // Start from neutral tone settings so repeated Auto presses give the same result.
  let s: DevelopSettings = { ...start, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0 }

  /** Bisection on one slider, assuming the measured value rises with the slider. */
  const fit = async (key: Key, read: (x: Metrics) => number, goal: number) => {
    let [lo, hi] = RANGES[key]
    const at = async (v: number) => read(await m({ ...s, [key]: v }))
    if ((await at(hi)) <= goal) {
      s = { ...s, [key]: hi }
      return
    }
    if ((await at(lo)) >= goal) {
      s = { ...s, [key]: lo }
      return
    }
    for (let i = 0; i < iterations; i++) {
      const mid = (lo + hi) / 2
      if ((await at(mid)) < goal) lo = mid
      else hi = mid
    }
    s = { ...s, [key]: key === 'exposure' ? Math.round(((lo + hi) / 2) * 100) / 100 : Math.round((lo + hi) / 2) }
  }

  for (let pass = 0; pass < 2; pass++) {
    await fit('exposure', (x) => x.median, target.median)
    await fit('contrast', (x) => x.p75 - x.p25, target.spread)
    await fit('whites', (x) => x.p995, target.high)
    await fit('blacks', (x) => x.p005, target.low)
  }
  // Pull back highlights only if too much is still clipped.
  const now = await m(s)
  if (now.highlightClip > target.maxHighlightClip) {
    // Clipping grows as the Highlights slider rises, so bisect for the slider value at the limit.
    await fit('highlights', (x) => x.highlightClip, target.maxHighlightClip)
  }
  if (target.chroma !== null) await fit('vibrance', (x) => x.chroma, target.chroma)
  return { settings: s, measurements: count, final: await m(s) }
}
