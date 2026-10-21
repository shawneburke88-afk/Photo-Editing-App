// Process versions (owner's decision, 2026-10-12; Lightroom works this way): every edit records the version of
// LightBench's rendering it was made with, so a later change to the rendering never silently changes an
// existing edit. Rendering code reads the version's parameters (`processParams`) instead of fixed constants.
//
// What a version covers: everything that turns the same settings into different pixels — the RAW stage
// (white level choice, highlight reconstruction, demosaic), colour (camera matrix → Rec.2020, white balance
// maths), the slider mappings (exposure, the contrast → sigmoid mapping, the tone-equalizer bands behind
// Highlights/Shadows/Whites/Blacks, Vibrance/Saturation), the display transform, and the geometry stage (crop
// rounding and the warp kernel). A change to any of them that would alter a saved edit's pixels needs a new
// version; bug fixes that only affect broken output and new tools that are off by default don't.
//
// This is separate from `DevelopSettings.version`, which numbers the settings' JSON layout (the schema).
//
// Edits saved before process versions existed are version 1 (that rendering). New edits get the current
// version. An edit from a newer LightBench (a version this build doesn't know) is rendered with the newest
// version known here and is never changed unless the user asks.
//
// Formats added later that couldn't be developed before (Fujifilm X-Trans, linear DNGs, Bayer DNGs that LibRaw
// has no colour matrix for; PHASE3.md Part 5) render with version 1 too: no saved edit could change. Changing how
// they render from now on needs a new version like any other rendering change.

/** Tone-equalizer band weights of the four tone sliders (−8 … 0 EV, 9 bands). */
export interface BandWeights {
  blacks: readonly number[]
  shadows: readonly number[]
  highlights: readonly number[]
  whites: readonly number[]
}

/**
 * How the tone equalizer behind Highlights/Shadows/Whites/Blacks measures each pixel's brightness (its "mask";
 * darktable src/iop/toneequal.c, `compute_luminance_mask`).
 *
 * - Version 1: the RGB average of the pixel itself, no filter (darktable's "RGB average" estimator with "preserve
 *   details: no").
 * - Version 2: darktable's defaults (toneequal.c, lines 184-192): the RGB Euclidean norm, refined by the
 *   exposure-independent guided filter (EIGF, src/common/eigf.h), so a pixel is corrected by the brightness of
 *   its surroundings except across strong edges: fewer haloes, and local contrast is kept. The other values are
 *   darktable's defaults too, and the only values the engine implements (engine/color/tone-mask.ts).
 */
export type ToneMask =
  | { estimator: 'mean'; filter: 'none' }
  | {
      estimator: 'norm2'
      filter: 'eigf'
      /** "smoothing diameter": the filter's diameter in % of the photo's largest dimension (darktable: 5). */
      blending: number
      /** "edges refinement/feathering" (darktable: 1); the filter's regularisation is its inverse. */
      feathering: number
      /** "filter diffusion" (darktable: 1), "mask quantization" (0), "mask contrast/exposure compensation" (0 EV). */
      iterations: 1
      quantization: 0
      contrastBoost: 0
      exposureBoost: 0
    }

export interface ProcessParams {
  /** Max tone-equalizer gain at full slider travel, in EV. */
  toneRange: number
  /** How the tone equalizer measures pixel brightness. */
  toneMask: ToneMask
  /**
   * How strongly each slider moves each tone-equalizer band (−8 … 0 EV of pixel brightness after exposure; with
   * the +0.7 EV default, middle grey sits near −1.8 EV and clipped white above 0).
   */
  bandWeights: BandWeights
  /** Contrast slider → sigmoid contrast: 1.5 × 2^(slider/100 × spread). */
  contrastSpread: number
  /**
   * The mask maths (PHASE3.md Part 23). Masks are a new tool, so adding them needed no new version; once released their
   * maths is part of the version: a change that would alter a saved mask's pixels needs a new one. Both versions so far
   * share these numbers (an edit made with version 1 and masks uses them with version 1's tone weights).
   */
  masks: MaskParams
  /**
   * The Effects maths (PHASE3.md Part 25): Post-crop Vignette, Grain, Texture, Clarity, Dehaze and Glow. They are new
   * tools, off by default, so adding them needed no new version; once released their maths is part of the version (a
   * change that would alter a saved edit's pixels needs a new one). Both versions so far share these numbers.
   */
  effects: EffectsParams
}

/** The constants of the Effects maths (engine/develop/effects.ts explains each and names its source). */
export interface EffectsParams {
  /** Texture and Clarity (darktable contrast & texture): slider ±100 → darktable gain ±this (coarse + medium; fine). */
  clarityGain: number
  textureGain: number
  /** Clarity's mid-tone weight (LightCraft): 1 − floor at this log2 distance from grey … (see effects.ts `midtoneWeight`). */
  midGrey: number
  midWidth: number
  midFloor: number
  /** Dehaze (darktable haze removal): the guided filter's constant regularisation (darktable √0.025, squared). */
  dehazeEps: number
  /** The long edge (px) of the rendering the ambient light and the maximum depth are measured on. */
  dehazeRefSize: number
  /** Vignette: Amount → darktable brightness (darktable's Lightroom importer table, `lr2dt_vignette_gain`). */
  vignetteAmount: readonly (readonly [number, number])[]
  /** Midpoint 0…100 → the fall-off's middle (distance units: 1 at the frame's edge), base + span × Midpoint/100. */
  vignetteMidBase: number
  vignetteMidSpan: number
  /** Feather 0…100 → the fall-off's width: max(min, span × Feather/100). */
  vignetteWidthMin: number
  vignetteWidthSpan: number
  /** Highlight Priority: brightness ±1 = ±this many EV at the corners (scene-linear, before the sigmoid). */
  vignetteEv: number
  /** Roundness −100: darktable's shape × (1 − this) (squarer). */
  vignetteSquare: number
  /** Highlights protection: scene EV above grey (Highlight Priority) and display luminance (Colour Priority) ramps. */
  vignetteProtectEv: readonly [number, number]
  vignetteProtectDisplay: readonly [number, number]
  /** Grain: darktable's octaves (`_simplex_2d_noise`), LightBench's fourth, finer octave for Roughness. */
  grainFreqs: readonly [number, number, number, number]
  grainAmps: readonly [number, number, number, number]
  /** Roughness ±50 tilts the octaves' amplitudes by 2^(±1 × (octave − 1)). */
  grainTilt: number
  /** Size 25 → darktable's default coarseness 1600; ±37.5 doubles or halves it. */
  grainCoarseness: number
  grainSizePerDoubling: number
  /** Amount → darktable strength (its importer's table: 25 → 20, 50 → 40, 100 → 80). */
  grainStrengthPerAmount: number
  /** darktable's GRAIN_LIGHTNESS_STRENGTH_SCALE and GRAIN_RGB_STRENGTH_SCALE. */
  grainLightnessScale: number
  grainRgbScale: number
  /** Glow: the blur scales as fractions of the long edge, and the soft threshold's half width (EV). */
  glowSigmas: readonly number[]
  glowSoft: number
  /** The threshold (EV above grey) at Range 0 and 100: Bloom and Halation, Diffusion. */
  glowThreshold: readonly [number, number]
  glowThresholdDiffusion: readonly [number, number]
  /** Bloom's and Halation's gains, Diffusion's largest mix. */
  glowBloomGain: number
  glowHalationGain: number
  glowDiffusionMix: number
  /** Warmth ±100 → the tint's red and blue gains 2^(±this). */
  glowWarmth: number
}

/** The Effects maths of process versions 1 and 2 (the tools arrived after both; neither changed it). */
export const EFFECTS_V1: EffectsParams = {
  clarityGain: 1,
  textureGain: 1,
  midGrey: 0.18,
  midWidth: 3.2,
  midFloor: 0.35,
  dehazeEps: 0.025,
  dehazeRefSize: 1024,
  vignetteAmount: [[-100, -1], [-50, -0.7], [0, 0], [50, 0.5], [100, 1]],
  vignetteMidBase: 0.25,
  vignetteMidSpan: 1.05,
  vignetteWidthMin: 0.02,
  vignetteWidthSpan: 1.2,
  vignetteEv: 3,
  vignetteSquare: 0.6,
  vignetteProtectEv: [0.5, 3],
  vignetteProtectDisplay: [0.35, 0.9],
  grainFreqs: [0.491, 0.9441, 1.728, 3.1104],
  grainAmps: [0.234, 0.785, 1.215, 0.91125],
  grainTilt: 1,
  grainCoarseness: 1600,
  grainSizePerDoubling: 37.5,
  grainStrengthPerAmount: 0.8,
  grainLightnessScale: 0.15,
  grainRgbScale: 0.25,
  glowSigmas: [0.0025, 0.005, 0.01, 0.02, 0.04],
  glowSoft: 1,
  glowThreshold: [3.5, 0],
  glowThresholdDiffusion: [1, -4],
  glowBloomGain: 1,
  glowHalationGain: 1.5,
  glowDiffusionMix: 0.6,
  glowWarmth: 0.6,
}

/** The constants of the mask maths (engine/develop/mask-math.ts explains each). */
export interface MaskParams {
  /** Feather 100 = a Gaussian of this fraction of the drawn photo's long edge (σ). */
  featherMax: number
  /** Refine 100 = a guided filter of this radius, as a fraction of the long edge. */
  refineMax: number
  /** The guided filter's regularisation on the 0…1 log-luminance guide. */
  refineEps: number
  /** The linear gradient's erf profile: 0.5 + 0.5·erf(k·s) / erf(k) over s = −1…1 (darktable's sigmoidal gradient). */
  gradientK: number
  /** Local Temp and Tint: log2 gain per slider unit on red and blue (Temp), green (Tint). */
  tempPerUnit: number
  tintPerUnit: number
  /** Local Contrast: the grey it pivots on (darktable color balance rgb's fulcrum, 18.45 %). */
  contrastFulcrum: number
  /** Colour range tolerance in OkLab ΔE at Refine 0 and 100, and the weight of lightness in the distance. */
  colourTolMin: number
  colourTolMax: number
  colourLightness: number
}

/** The mask maths of process versions 1 and 2 (masks arrived after both; neither changed it). */
export const MASKS_V1: MaskParams = {
  featherMax: 0.02,
  refineMax: 0.02,
  refineEps: 1e-3,
  gradientK: 2,
  tempPerUnit: 0.005,
  tintPerUnit: 0.005,
  contrastFulcrum: 0.1845,
  colourTolMin: 0.03,
  colourTolMax: 0.25,
  colourLightness: 0.5,
}

export interface ProcessVersion {
  version: number
  /** What changed in this version, in plain words. */
  summary: string
  params: ProcessParams
}

const V1: ProcessParams = {
  toneRange: 1.5,
  toneMask: { estimator: 'mean', filter: 'none' },
  bandWeights: {
    blacks: [1, 1, 0.5, 0.1, 0, 0, 0, 0, 0],
    shadows: [0, 0.1, 0.3, 0.8, 1, 0.5, 0.1, 0, 0],
    highlights: [0, 0, 0, 0, 0, 0.1, 0.5, 1, 0.4],
    whites: [0, 0, 0, 0, 0, 0, 0, 0.35, 1],
  },
  contrastSpread: 0.6,
  masks: MASKS_V1,
  effects: EFFECTS_V1,
}

/**
 * The tone equalizer as darktable's defaults (PHASE3.md Part 10). Its number lives here only, so it can be
 * renumbered if another version lands first.
 */
export const TONE_EQ_PROCESS = 2

/**
 * Band weights of version 2. The Euclidean norm of a neutral pixel is √3 × its RGB average (+0.79 EV; more for
 * saturated colours), so version 1's weights would act about 0.8 EV lower down the tones (Highlights would darken
 * the mid-tones). Blacks and Shadows are version 1's weights moved up by 0.79 EV (linear interpolation between
 * bands); Highlights and Whites were tuned by hand and then by eye (PHASE3.md Part 10) because everything from
 * 0.79 EV below the top band up shares the top band (darktable clamps the mask to −8…0 EV), so the top can't follow
 * version 1 exactly: Highlights now peaks lower (1.2 EV instead of 1.5 EV at +100) and keeps more on the brightest
 * tones, Whites reaches a little further down.
 */
const V2_BAND_WEIGHTS: BandWeights = {
  blacks: [1, 1, 0.9, 0.42, 0.08, 0, 0, 0, 0],
  shadows: [0, 0.02, 0.14, 0.4, 0.84, 0.9, 0.42, 0.08, 0],
  highlights: [0, 0, 0, 0, 0, 0.02, 0.18, 0.7, 0.8],
  whites: [0, 0, 0, 0, 0, 0, 0, 0.1, 1],
}

const V2: ProcessParams = {
  ...V1,
  toneMask: { estimator: 'norm2', filter: 'eigf', blending: 5, feathering: 1, iterations: 1, quantization: 0, contrastBoost: 0, exposureBoost: 0 },
  bandWeights: V2_BAND_WEIGHTS,
}

export const PROCESS_VERSIONS: ProcessVersion[] = [
  {
    version: 1,
    summary: 'LightBench’s first rendering (0.1.0 until process version 2).',
    params: V1,
  },
  {
    version: TONE_EQ_PROCESS,
    summary:
      'Highlights, Shadows, Whites and Blacks: each area is brightened or darkened as a whole, judged by its surroundings, so fine detail and local contrast stay and there are fewer haloes along edges. Photos whose four tone sliders are at 0 look the same.',
    params: V2,
  },
]

// Test scaffolding, development server only: `?simulateProcess=N` (N above the newest version) adds a copy of the
// newest version under that number, so the "Update to current process" offer can be tried without a new rendering.
// Production builds drop this (import.meta.env.DEV is false there).
if (import.meta.env.DEV && typeof location !== 'undefined') {
  const n = Number(new URLSearchParams(location.search).get('simulateProcess'))
  const last = PROCESS_VERSIONS[PROCESS_VERSIONS.length - 1]
  if (Number.isInteger(n) && n > last.version) PROCESS_VERSIONS.push({ version: n, summary: 'Simulated for testing (same rendering as the previous version).', params: last.params })
}

/** The version of edits saved before process versions existed. */
export const LEGACY_PROCESS = 1

/** The version new edits get. */
export const CURRENT_PROCESS = PROCESS_VERSIONS[PROCESS_VERSIONS.length - 1].version

/** A stored version, or the legacy one when missing or malformed. */
export const validProcess = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : LEGACY_PROCESS)

/** The rendering parameters of a version (a newer, unknown version uses the newest known). */
export function processParams(version: number): ProcessParams {
  let best = PROCESS_VERSIONS[0]
  for (const p of PROCESS_VERSIONS) if (p.version <= version) best = p
  return best.params
}

/** How a photo's version compares with this build's. */
export function processStatus(version: number): 'current' | 'older' | 'newer' {
  return version === CURRENT_PROCESS ? 'current' : version < CURRENT_PROCESS ? 'older' : 'newer'
}
