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
// Sharpening: the method is not settled yet (owner, 2026-10-13: a research pass compares darktable's sharpen,
// diffuse or sharpen and RawTherapee-style capture sharpening). The settings, the Lightroom fields and the masking
// preview are built so the method can be swapped (`SharpenMethod`); the interim method is darktable's unsharp mask
// (src/iop/sharpen.c) on luminance with darktable's capture-sharpening contrast mask for Masking
// (src/iop/demosaicing/capture.c `_modify_blend`). The mapping is LightBench's own.
//
// Storage: an optional `detail` field in the develop settings. An edit without it (every edit saved before this
// part, and new photos: off by default, owner's open question) has everything off and renders exactly as before;
// no process version is needed (process.ts: new tools that are off by default don't need one).

export interface SharpenSettings {
  /** Lightroom's Amount, 0…150. 0 = off. */
  amount: number
  /** Lightroom's Radius, 0.5…3.0 px. */
  radius: number
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
 * Off, with Lightroom's defaults for the dependent sliders (Radius 1.0, Detail 25, Masking 0; Luminance Detail 50,
 * Contrast 0; Color Detail 50, Smoothness 50 — Lightroom Classic's, from general knowledge, not checked in
 * Lightroom here). Lightroom itself starts RAWs at Sharpening 40 and Color 25; LightBench starts everything off
 * (the owner decides, PHASE3.md Part 13).
 */
export const DEFAULT_DETAIL: DetailSettings = {
  sharpen: { amount: 0, radius: 1, detail: 25, masking: 0 },
  noise: { luminance: 0, luminanceDetail: 50, luminanceContrast: 0, color: 0, colorDetail: 50, colorSmoothness: 50 },
}

/** Slider ranges (Lightroom's). */
export const DETAIL_RANGES = {
  amount: [0, 150],
  radius: [0.5, 3],
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

// ---- Sharpening (the method is pending; see the head of this file)

/** Which sharpening algorithm renders the Sharpening sliders. Only the interim one exists for now. */
export type SharpenMethod = 'usm-interim'
export const SHARPEN_METHOD: SharpenMethod = 'usm-interim'

/** Engine parameters of the interim method (darktable's sharpen.c on luminance, with capture.c's contrast mask). */
export interface SharpenParams {
  method: SharpenMethod
  /** Gaussian sigma in full-size pixels (darktable sharpen.c's "radius"). */
  sigma: number
  /** darktable sharpen.c's amount (detail multiplier). */
  amount: number
  /** darktable sharpen.c's threshold, as a fraction of the pixel's luminance (LightBench: scene-linear data). */
  threshold: number
  /** darktable capture.c's contrast sensitivity (`cs_thrs`, 0…1); 0 = no mask. */
  mask: number
}

/**
 * Lightroom's Sharpening → the interim method (LightBench's mapping, provisional until the method is chosen):
 * Amount / 100 is darktable's amount (Lightroom's 40 → 0.4; darktable's default 0.5), Radius is the Gaussian sigma
 * in pixels, Detail 0…100 lowers darktable's threshold from 2 % to 0 of the local luminance (higher Detail sharpens
 * finer, lower-contrast detail), and Masking / 100 is capture.c's contrast sensitivity.
 */
export function sharpenParams(s: SharpenSettings): SharpenParams {
  return { method: SHARPEN_METHOD, sigma: s.radius, amount: s.amount / 100, threshold: 0.02 * (1 - s.detail / 100), mask: s.masking / 100 }
}
