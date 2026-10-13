// Output sharpening for exports, after Lightroom's Export dialog choices (Sharpen for Screen / Matte paper /
// Glossy paper, Amount Low / Standard / High). Lightroom's own algorithm (from PixelGenius PhotoKit) isn't
// public, so this doesn't try to match it. The sharpening is darktable's unsharp mask (src/iop/sharpen.c:
// a Gaussian blur of Lab L, a soft threshold on the difference, L + amount · detail, a and b kept), applied by
// export.wgsl to the final, resized output. The parameter table below is LightBench's own, checked by eye
// (docs/PHASE3.md, Part 8).

export type SharpenMedium = 'screen' | 'matte' | 'glossy'
export type SharpenAmount = 'low' | 'standard' | 'high'

export interface OutputSharpening {
  on: boolean
  medium: SharpenMedium
  amount: SharpenAmount
}

/** Off by default, as in Lightroom; Screen / Standard when first switched on. */
export const DEFAULT_OUTPUT_SHARPENING: OutputSharpening = { on: false, medium: 'screen', amount: 'standard' }

/** Print resolution written into the files and used for paper sharpening (the 300 ppi LightBench always wrote). */
export const DEFAULT_PPI = 300
export const MIN_PPI = 72
export const MAX_PPI = 1200

/** Clamps a typed resolution to a whole number of pixels per inch in the accepted range. */
export function clampPpi(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_PPI
  return Math.min(MAX_PPI, Math.max(MIN_PPI, Math.round(v)))
}

/**
 * darktable's sharpen parameters for one choice:
 *  - `sigma`: the Gaussian's standard deviation (darktable's “radius” slider is this sigma: sharpen.c
 *    multiplies it by 2.5 for the window and divides by 2.5 again for sigma). For screen it is in output
 *    pixels at 100 % size (scaled down with the export, see `screenSigma`); for paper it is in millimetres on
 *    the print (converted with the resolution, see `printSigma`).
 *  - `amount`: darktable's amount (detail multiplier; darktable's default is 0.5).
 *  - `threshold`: darktable's threshold in L units (0–100); differences below it are not sharpened and it is
 *    subtracted from larger ones (darktable's default is 0.5).
 */
export interface SharpenRow {
  sigma: number
  amount: number
  threshold: number
}

/** LightBench's table (chosen by LightBench and checked by eye; not Lightroom's numbers). */
export const SHARPEN_TABLE: Record<SharpenMedium, Record<SharpenAmount, SharpenRow>> = {
  // sigma in output pixels at full size (0.5 px when heavily downsized)
  screen: {
    low: { sigma: 0.78, amount: 0.35, threshold: 0.5 },
    standard: { sigma: 0.78, amount: 0.6, threshold: 0.5 },
    high: { sigma: 0.78, amount: 0.9, threshold: 0.5 },
  },
  // sigma in millimetres on the paper (0.075 mm = 0.89 px at 300 ppi)
  glossy: {
    low: { sigma: 0.075, amount: 0.5, threshold: 0.5 },
    standard: { sigma: 0.075, amount: 0.85, threshold: 0.5 },
    high: { sigma: 0.075, amount: 1.25, threshold: 0.5 },
  },
  // sigma in millimetres on the paper (0.095 mm = 1.12 px at 300 ppi)
  matte: {
    low: { sigma: 0.095, amount: 0.65, threshold: 0.5 },
    standard: { sigma: 0.095, amount: 1.1, threshold: 0.5 },
    high: { sigma: 0.095, amount: 1.6, threshold: 0.5 },
  },
}

/** Screen: sigma for a fully downsized export (where the resize alone leaves the photo crisp). */
export const SCREEN_BASE_SIGMA = 0.5
/** Screen: the softness left from the lens and demosaic at 100 % (it shrinks with the export's scale). */
export const SCREEN_CAPTURE_SIGMA = 0.6

/** darktable's kernel limit: the window is ceil(2.5 · sigma) pixels each side, at most 12 (MAXR). */
export const MAX_RADIUS = 12
export const MIN_SIGMA = 0.25
export const MAX_SIGMA = MAX_RADIUS / 2.5

/**
 * Halo limit: the sharpened L may overshoot the lightest/darkest L of the pixel's 3 × 3 neighbourhood by at most
 * this fraction of their difference (LightBench's addition; darktable's sharpen has no limit).
 */
export const HALO_LIMIT = 0.25

/**
 * Screen sigma in output pixels: the photo's own softness (SCREEN_CAPTURE_SIGMA at 100 %) shrinks with the
 * export's scale (output / original pixels), and the base sigma stays, combined as Gaussians add:
 * √(base² + (capture · scale)²) = 0.78 px at full size, 0.52 px at a quarter. Enlargements count as 100 %.
 */
export function screenSigma(scale: number): number {
  const s = Math.min(1, Math.max(0, Number.isFinite(scale) ? scale : 1))
  return Math.hypot(SCREEN_BASE_SIGMA, SCREEN_CAPTURE_SIGMA * s)
}

/** Paper sigma in output pixels: millimetres on the print × pixels per millimetre. */
export function printSigma(mm: number, ppi: number): number {
  return (mm * clampPpi(ppi)) / 25.4
}

/** What export.wgsl needs: Gaussian sigma and window in output pixels, amount, threshold and halo limit. */
export interface SharpenParams {
  sigma: number
  /** Window half-width: ceil(2.5 · sigma), 1…MAX_RADIUS (darktable's `rad`). */
  radius: number
  amount: number
  threshold: number
  halo: number
}

/**
 * The sharpening for an export, or null when it is off. `scale` is output / original pixels (from
 * `outputSize`), `ppi` the resolution written into the file.
 */
export function sharpenParams(o: OutputSharpening | undefined, scale: number, ppi: number): SharpenParams | null {
  if (!o?.on) return null
  const medium = SHARPEN_TABLE[o.medium] ? o.medium : 'screen'
  const row = SHARPEN_TABLE[medium][SHARPEN_TABLE[medium][o.amount] ? o.amount : 'standard']
  const raw = medium === 'screen' ? screenSigma(scale) * (row.sigma / screenSigma(1)) : printSigma(row.sigma, ppi)
  const sigma = Math.min(MAX_SIGMA, Math.max(MIN_SIGMA, raw))
  return {
    sigma,
    radius: Math.min(MAX_RADIUS, Math.max(1, Math.ceil(2.5 * sigma))),
    amount: row.amount,
    threshold: row.threshold,
    halo: HALO_LIMIT,
  }
}

/** One-line description of what the choice does for the first photo (shown under the menus). */
export function describeSharpening(p: SharpenParams | null, medium: SharpenMedium, ppi: number): string {
  if (!p) return ''
  const where = medium === 'screen' ? 'for screens' : `for ${medium === 'matte' ? 'matte' : 'glossy'} paper at ${clampPpi(ppi)} ppi`
  return `Radius ${p.sigma.toFixed(2)} px, amount ${p.amount} ${where}`
}
