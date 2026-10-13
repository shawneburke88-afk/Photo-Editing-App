// The Detail group (Phase 3, Part 13): Lightroom's Detail panel controls — Sharpening (Amount, Radius, Detail,
// Masking) and Noise Reduction (Luminance with Detail and Contrast, Color with Detail and Smoothness) — on
// darktable's processing.
//
// Noise reduction is darktable's "denoise (profiled)" (src/iop/denoiseprofile.c) in its default mode, wavelets in
// the Y0U0V0 colour mode (`reload_defaults`, lines 2677-2690; `$DEFAULT: MODE_WAVELETS`, `MODE_Y0U0V0`), with the
// camera's noise profile (engine/detail/noiseprofiles.ts). In that mode darktable thresholds each wavelet band of
// luminance (Y0) and chroma (U0V0) separately, by a "force" curve per band (its GUI's coarse → fine curves), so
// Lightroom's Luminance and Color map onto the Y0 and U0V0 curves. **The mapping is LightBench's own**: Lightroom's
// maths isn't public. Luminance 50 / Color 50 are darktable's default curves (0.5 on every band); Detail tilts
// the finest bands, Contrast (luminance) and Smoothness (colour) the coarse ones (`denoiseCurves`).
//
// Sharpening (owner's decision, 2026-10-13, after docs/research/DETAIL_DENOISE_SHARPEN.md): capture sharpening,
// Richardson–Lucy deconvolution of luminance with a Gaussian PSF, ported from darktable's capture sharpening
// (src/iop/demosaicing/capture.c, darktable's port of RawTherapee 5.8's Capture Sharpening by Ingo Weyrich). It runs
// after the denoise (darktable runs it inside demosaic, before denoise; its manual says to denoise before
// sharpening). Lightroom's four sliders map onto it as the research proposes (`captureParams`); **the mapping is
// LightBench's own**.
//
// Storage and defaults: an optional `detail` field in the develop settings. An edit without it — every edit saved
// before this part — has everything off and renders exactly as before; no process version is needed (the settings
// say whether the photo is sharpened, as for lens corrections, PHASE3.md Part 2). New RAW photos, unedited RAWs and
// Reset get sharpening on (Amount 40, automatic radius: `RAW_DETAIL`, owner's decision 2026-10-13); JPEGs and noise
// reduction start off.

export interface SharpenSettings {
  /** Lightroom's Amount, 0…150. 0 = off. Richardson–Lucy iterations = Amount / 5. */
  amount: number
  /** The blur radius (Gaussian sigma), 0.25…1.5 px, used when `radiusAuto` is off. */
  radius: number
  /** Measure the radius from the photo (darktable's automatic radius), else use `radius`. */
  radiusAuto: boolean
  /** Lightroom's Detail, 0…100. */
  detail: number
  /** Lightroom's Masking, 0…100: 0 sharpens everything, 100 only strong edges. */
  masking: number
}

export interface NoiseSettings {
  /** Lightroom's Luminance (crs:LuminanceSmoothing), 0…100. 0 = off. */
  luminance: number
  /** Luminance Detail, 0…100 (default 50). */
  luminanceDetail: number
  /** Luminance Contrast, 0…100 (default 0). */
  luminanceContrast: number
  /** Lightroom's Color (crs:ColorNoiseReduction), 0…100. 0 = off. */
  color: number
  /** Color Detail, 0…100 (default 50). */
  colorDetail: number
  /** Color Smoothness, 0…100 (default 50). */
  colorSmoothness: number
}

export interface DetailSettings {
  sharpen: SharpenSettings
  noise: NoiseSettings
}

/**
 * Everything off, with Lightroom's defaults for the dependent sliders (Detail 25, Masking 0; Luminance Detail 50,
 * Contrast 0; Color Detail 50, Smoothness 50 — Lightroom Classic's, from general knowledge, not checked in Lightroom
 * here) and the automatic radius (0.5 px, darktable's default `cs_radius`, when set by hand). What an edit without
 * `detail` means, and JPEGs' default.
 */
export const DEFAULT_DETAIL: DetailSettings = {
  sharpen: { amount: 0, radius: 0.5, radiusAuto: true, detail: 25, masking: 0 },
  noise: { luminance: 0, luminanceDetail: 50, luminanceContrast: 0, color: 0, colorDetail: 50, colorSmoothness: 50 },
}

/**
 * New RAW photos (owner's decision, 2026-10-13): sharpening Amount 40 (Lightroom's RAW default; 8 iterations,
 * darktable's default), automatic radius, Detail 25 and Masking 0 (Lightroom's defaults; with LightBench's mapping
 * Masking 0 still keeps darktable's automatic noise threshold). Noise reduction off.
 */
export const RAW_DETAIL: DetailSettings = { ...DEFAULT_DETAIL, sharpen: { ...DEFAULT_DETAIL.sharpen, amount: 40 } }

/**
 * Above this ISO new RAW photos get a lighter default sharpening (owner's decision, 2026-10-13): at ISO 6400 Amount
 * 40 raised the noise of a plain wall by 11 % (PHASE3.md Part 13), and darktable's manual calls auto-applying capture
 * sharpening safe below ISO 1000.
 */
export const HIGH_ISO = 1000
/** New RAW photos above ISO 1000: Amount 25, the rest as `RAW_DETAIL`. */
export const RAW_DETAIL_HIGH_ISO: DetailSettings = { ...RAW_DETAIL, sharpen: { ...RAW_DETAIL.sharpen, amount: 25 } }

/** A new RAW photo's Detail settings for its EXIF ISO (unknown or 0: as at low ISO, Amount 40). */
export const rawDetailFor = (iso: number | null | undefined): DetailSettings => (iso && iso > HIGH_ISO ? RAW_DETAIL_HIGH_ISO : RAW_DETAIL)

/** Slider ranges (Lightroom's). */
export const DETAIL_RANGES = {
  amount: [0, 150],
  radius: [0.25, 1.5],
  detail: [0, 100],
  masking: [0, 100],
  luminance: [0, 100],
  luminanceDetail: [0, 100],
  luminanceContrast: [0, 100],
  color: [0, 100],
  colorDetail: [0, 100],
  colorSmoothness: [0, 100],
} as const

const num = (v: unknown, d: number, [lo, hi]: readonly [number, number]) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)

/** Fills in stored detail settings; none at all reads as `undefined` (off), so old edits gain no key. */
export function normalizeDetail(d: unknown): DetailSettings | undefined {
  if (!d || typeof d !== 'object') return undefined
  const x = d as Partial<{ sharpen: Partial<SharpenSettings>; noise: Partial<NoiseSettings> }>
  const s = x.sharpen ?? {}
  const n = x.noise ?? {}
  const D = DEFAULT_DETAIL
  const R = DETAIL_RANGES
  return {
    sharpen: {
      amount: num(s.amount, D.sharpen.amount, R.amount),
      radius: num(s.radius, D.sharpen.radius, R.radius),
      radiusAuto: typeof s.radiusAuto === 'boolean' ? s.radiusAuto : D.sharpen.radiusAuto,
      detail: num(s.detail, D.sharpen.detail, R.detail),
      masking: num(s.masking, D.sharpen.masking, R.masking),
    },
    noise: {
      luminance: num(n.luminance, D.noise.luminance, R.luminance),
      luminanceDetail: num(n.luminanceDetail, D.noise.luminanceDetail, R.luminanceDetail),
      luminanceContrast: num(n.luminanceContrast, D.noise.luminanceContrast, R.luminanceContrast),
      color: num(n.color, D.noise.color, R.color),
      colorDetail: num(n.colorDetail, D.noise.colorDetail, R.colorDetail),
      colorSmoothness: num(n.colorSmoothness, D.noise.colorSmoothness, R.colorSmoothness),
    },
  }
}

/**
 * Settings with these Detail settings; all at their defaults leaves no `detail` key, so an edit whose Detail is reset
 * (or pasted from an edit without it) is stored as it was before.
 */
export function withDetail<T extends { detail?: DetailSettings }>(s: T, d: DetailSettings | undefined): T {
  const { detail: _old, ...rest } = s
  void _old
  return !d || JSON.stringify(d) === JSON.stringify(DEFAULT_DETAIL) ? (rest as T) : ({ ...rest, detail: d } as T)
}

export const sharpenOn = (d: DetailSettings | undefined | null): boolean => !!d && d.sharpen.amount > 0
export const noiseOn = (d: DetailSettings | undefined | null): boolean => !!d && (d.noise.luminance > 0 || d.noise.color > 0)
/** True when the Detail group changes the picture at all. */
export const detailOn = (d: DetailSettings | undefined | null): boolean => sharpenOn(d) || noiseOn(d)

// ---- Noise reduction: Lightroom's sliders → darktable denoise (profiled) parameters (LightBench's mapping)

/** darktable's DT_IOP_DENOISE_PROFILE_BANDS: force curves have 7 points, band 0 the coarsest, band 6 the finest. */
export const DENOISE_BANDS = 7

/** How much of a band counts as "fine" (for Detail) and "coarse" (for Contrast/Smoothness); x = 0 coarse … 1 fine. */
const fineWeight = (x: number) => Math.max(0, (x - 0.5) / 0.5) ** 2
const coarseWeight = (x: number) => (1 - x) ** 2
const contrastWeight = (x: number) => 1 - x

/**
 * The Y0 (luminance) and U0V0 (chroma) force curves of darktable's denoise (profiled), one value per band (band 0
 * coarsest … 6 finest, darktable's `x` = k / 6). darktable's default is 0.5 on every band; a band's threshold is
 * multiplied by (2 · force)² (denoiseprofile.c `variance_stabilizing_xform`, lines 1391-1414), so 0 leaves that band
 * alone and 1 quadruples the threshold.
 *
 * LightBench's mapping (not Lightroom's maths, which isn't public):
 *  - Luminance L → every Y0 band at L / 100 (Luminance 50 = darktable's default strength on luminance);
 *  - Luminance Detail D: the finest bands × 2^(−(D − 50) / 50 · w), w = 1 on the finest band, 0.44, 0.11, then 0
 *    (higher keeps more fine detail, lower removes more fine noise);
 *  - Luminance Contrast K: bands × 2^(−1.5 · K / 100 · (1 − x)), strongest on the coarse bands (higher keeps more
 *    low-frequency contrast and texture, at the risk of mottling);
 *  - Color C → every U0V0 band at C / 100 (Color 50 = darktable's default strength on chroma);
 *  - Color Detail: like Luminance Detail on U0V0 (higher protects thin colour edges, lower removes more speckles);
 *  - Color Smoothness S: coarse U0V0 bands × 2^((S − 50) / 50 · (1 − x)²) (higher removes larger colour blotches).
 * Forces above 1 are allowed (darktable's GUI stops at 1 but its maths doesn't).
 */
export function denoiseCurves(n: NoiseSettings): { y0: number[]; uv: number[] } {
  const y0: number[] = []
  const uv: number[] = []
  for (let k = 0; k < DENOISE_BANDS; k++) {
    const x = k / (DENOISE_BANDS - 1)
    const lDetail = 2 ** ((-(n.luminanceDetail - 50) / 50) * fineWeight(x))
    const lContrast = 2 ** (-1.5 * (n.luminanceContrast / 100) * contrastWeight(x))
    const cDetail = 2 ** ((-(n.colorDetail - 50) / 50) * fineWeight(x))
    const cSmooth = 2 ** (((n.colorSmoothness - 50) / 50) * coarseWeight(x))
    y0.push((n.luminance / 100) * lDetail * lContrast)
    uv.push((n.color / 100) * cDetail * cSmooth)
  }
  return { y0, uv }
}

// ---- Sharpening: Lightroom's sliders → darktable's capture sharpening (LightBench's mapping)

/**
 * The capture-sharpening parameters of the four sliders (docs/research/DETAIL_DENOISE_SHARPEN.md section 4.3):
 *  - Amount → Richardson–Lucy iterations = Amount / 5 (40 → 8, darktable's default; 150 → 30), fractional counts
 *    interpolated between ⌊n⌋ and ⌈n⌉ iterations so the slider is smooth;
 *  - Radius → the Gaussian PSF's sigma: measured from the photo when automatic (darktable `_calc_auto_radius`), else
 *    the slider (0.25–1.5 px; darktable's range is 0–1.5);
 *  - Detail → halo suppression: the result's overshoot beyond the original pixel's 3 × 3 neighbourhood range is kept
 *    in proportion Detail / 100 (100 = the deconvolution unchanged, 0 = no overshoot at all);
 *  - Masking → darktable's contrast sensitivity: auto + Masking / 100 · (1 − auto), where auto is darktable's
 *    estimate from the ISO and the raw bit depth (`_get_variance_threshold`), so Masking 0 still keeps flat, noisy
 *    areas protected (unlike Lightroom, where 0 sharpens everything).
 */
export function captureParams(s: SharpenSettings, autoThreshold: number): { iterations: number; halo: number; threshold: number } {
  return {
    iterations: s.amount / 5,
    halo: s.detail / 100,
    threshold: autoThreshold + (s.masking / 100) * (1 - autoThreshold),
  }
}

/**
 * TEST ONLY, not user-visible and not stored: switches the sharpening sliders to the research proposal's mapping so
 * it can be measured against the built one (docs/research/DETAIL_MAPPING_BRIEF.md). Always false in the app.
 */
export const mappingForTests = { research: false, separable: false }

/**
 * The research proposal (LightBench's own invention, not Lightroom's or darktable's): Amount → a gain on the
 * deconvolution's change, Amount / 40 (40 = darktable's result at full strength); Detail → iterations
 * 4 + round(Detail × 0.16) (25 → 8); no halo limit; Masking as built. Radius (a multiplier of the automatic radius)
 * is applied by the caller.
 */
export function researchCaptureParams(s: SharpenSettings, autoThreshold: number): { iterations: number; halo: number; threshold: number; gain: number } {
  return {
    iterations: 4 + Math.round(s.detail * 0.16),
    halo: 1,
    threshold: autoThreshold + (s.masking / 100) * (1 - autoThreshold),
    gain: s.amount / 40,
  }
}

/**
 * darktable's automatic contrast threshold (capture.c `_get_variance_threshold`, lines 49-77, and `_capture_noise`,
 * line 785: truncated to 0.01): 0.4, less for raws with more than 12 and 14 bits, and less at low ISO.
 */
export function autoThreshold(whitePoint: number, iso: number): number {
  // In float, as darktable computes it (the truncation to 0.01 depends on it).
  const f = Math.fround
  let t = f(0.4)
  if (whitePoint > 4096) t = f(t - f(0.07))
  if (whitePoint > 14000) t = f(t - f(0.01))
  const isoFactor = f(f(600 - Math.min(1000, Math.max(100, Math.trunc(iso)))) / 100)
  t = f(t - f(f(0.012) * isoFactor))
  return 0.01 * Math.trunc(f(100 * t))
}
