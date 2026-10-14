// The culling analysis of one photo's camera preview (docs/PHASE3.md Part 18): sharpness and motion (sharpness.ts),
// exposure (the histogram code Auto uses, engine/develop/auto.ts) and perceptual hashes (hash.ts). Runs on the CPU in
// the probe worker, on the upright preview scaled to ANALYSIS_EDGE pixels on its long side. Pure: no DOM, no GPU.

import { metricsFromStats, statsFromPixels } from '../develop/auto'
import { grayFromRgba, half } from './gray'
import { dHash, pHash } from './hash'
import { measureSharpness, type Box } from './sharpness'

/** Bumped whenever the measures change, so older results are made again in the background (library/analysis-pass.ts). */
export const ANALYSIS_ALGO = 1
/** Long side of the image measured, in pixels (smaller previews are measured as they are). */
export const ANALYSIS_EDGE = 1536

export interface ImageAnalysis {
  /** Size of the preview measured (before scaling to ANALYSIS_EDGE) and of the image measured. */
  srcW: number
  srcH: number
  w: number
  h: number
  sharpPeak: number
  sharpSubject: number
  acuity: number
  noiseFloor: number
  motion: number
  motionSubject: number
  motionAngle: number
  textured: number
  /** Where the subject came from: the camera's AF point / EXIF SubjectArea, or the sharpest tiles. */
  subjectFrom: 'af' | 'subjectarea' | 'peak'
  subjectBox: Box | null
  /** Where Z zooms to in culling (normalised, upright). */
  focusU: number
  focusV: number
  /** Fractions of pixels with a channel at 255 / all channels at 0, and luminance percentiles (0–1). */
  clipHi: number
  clipLo: number
  median: number
  p005: number
  p995: number
  dhash: string
  phash: string
}

/**
 * Measures 8-bit RGBA pixels of an upright preview. `af` is the camera's focus box (normalised, upright) and where
 * it was read from.
 */
export function analyzePixels(
  rgba: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  src: { w: number; h: number },
  af?: (Box & { from: 'af' | 'subjectarea' }) | null,
): ImageAnalysis {
  const g = grayFromRgba(rgba, w, h)
  const s = measureSharpness(g, af)
  // Exposure on every other pixel of every other row (the histogram's shape and clipped shares hardly change, at a
  // quarter of the time); the hashes from a quarter-size image (area averaging again, so the same hashes in practice).
  const m = metricsFromStats(statsFromPixels(subsample(rgba, w, h)))
  const q = half(half(g))
  const r = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d
  return {
    srcW: src.w,
    srcH: src.h,
    w,
    h,
    sharpPeak: r(s.peak, 3),
    sharpSubject: r(s.subject, 3),
    acuity: r(s.acuity),
    noiseFloor: r(s.noiseFloor, 2),
    motion: r(s.motion),
    motionSubject: r(s.motionSubject),
    motionAngle: Math.round(s.motionAngle),
    textured: r(s.textured, 3),
    subjectFrom: s.subjectFrom === 'af' && af ? af.from : 'peak',
    subjectBox: s.subjectBox && { x: r(s.subjectBox.x), y: r(s.subjectBox.y), w: r(s.subjectBox.w), h: r(s.subjectBox.h) },
    focusU: r(s.focus.u),
    focusV: r(s.focus.v),
    clipHi: r(m.highlightClip, 5),
    clipLo: r(m.shadowClip, 5),
    median: r(m.median),
    p005: r(m.p005),
    p995: r(m.p995),
    dhash: dHash(q),
    phash: pHash(q),
  }
}

/** Every other pixel of every other row. */
function subsample(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(Math.ceil(w / 2) * Math.ceil(h / 2) * 4)
  let o = 0
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = 4 * (y * w + x)
      out[o++] = rgba[i]
      out[o++] = rgba[i + 1]
      out[o++] = rgba[i + 2]
      out[o++] = 255
    }
  }
  return out
}

/** The size to measure a w × h preview at. */
export function analysisSize(w: number, h: number): { w: number; h: number } {
  const k = Math.min(1, ANALYSIS_EDGE / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}
