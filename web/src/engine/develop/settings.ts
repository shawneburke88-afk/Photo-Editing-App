// Develop settings: Lightroom-style controls on top of darktable modules.
//
// Each slider is translated into parameters of a darktable module (white balance → temperature,
// exposure → exposure, contrast → sigmoid, highlights/shadows/whites/blacks → tone equalizer bands).
// Vibrance and saturation use a simple chroma scaling for now; darktable's colour balance rgb is
// planned for Phase 3.

import { SIGMOID_DEFAULTS, sigmoidCurve, type SigmoidCurve } from '../color/sigmoid'
import { toneEqualizerFactors } from '../color/tone-equalizer'
import type { AutoRecord } from './auto'

export interface DevelopSettings {
  version: 1
  whiteBalance: { mode: 'as-shot' | 'custom'; temperature: number; tint: number }
  /** EV, on top of darktable's scene-referred base exposure. */
  exposure: number
  /** −100…100 each. */
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  vibrance: number
  saturation: number
  /** darktable module settings exposed under "Advanced". */
  advanced: {
    /** darktable scene-referred default: +0.7 EV. */
    baseExposure: number
    /** Sigmoid skew (−1…1), target white/black (%). */
    skew: number
    whiteTarget: number
    blackTarget: number
    /** Sigmoid hue preservation, 0…100 %. */
    huePreservation: number
    /** Highlight reconstruction (darktable "inpaint opposed") and its clipping threshold. */
    highlightReconstruction: boolean
    highlightClip: number
    demosaic: 'rcd' | 'bilinear'
  }
  /**
   * Set when the tone sliders came from Auto (cleared when one of its sliders is then moved by hand), so pasting
   * can re-run Auto on each photo rather than copying the numbers.
   */
  auto?: AutoRecord | null
}

export const DEFAULT_SETTINGS: DevelopSettings = {
  version: 1,
  whiteBalance: { mode: 'as-shot', temperature: 5000, tint: 1 },
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  vibrance: 0,
  saturation: 0,
  advanced: {
    baseExposure: 0.7,
    skew: SIGMOID_DEFAULTS.skew,
    whiteTarget: SIGMOID_DEFAULTS.whiteTarget,
    blackTarget: SIGMOID_DEFAULTS.blackTarget,
    huePreservation: 100,
    highlightReconstruction: true,
    highlightClip: 1,
    demosaic: 'rcd',
  },
}

/** What kind of source a photo is: camera RAW, or an already-rendered (display-referred) RGB image. */
export type SourceKind = 'raw' | 'rgb'

/**
 * Defaults for display-referred images (JPEG, later PNG/TIFF). Like darktable, a JPEG gets no +0.7 EV base
 * exposure. Hue preservation is 0 so that the pipeline's inverse tone mapping at load is exact and an
 * unedited JPEG looks exactly as shot (see engine/gpu/rgb-input.wgsl).
 */
export const DEFAULT_RGB_SETTINGS: DevelopSettings = {
  ...DEFAULT_SETTINGS,
  advanced: { ...DEFAULT_SETTINGS.advanced, baseExposure: 0, huePreservation: 0 },
}

export const defaultsFor = (kind: SourceKind) => (kind === 'rgb' ? DEFAULT_RGB_SETTINGS : DEFAULT_SETTINGS)

/** Fills in missing fields (e.g. from older saved edits) with the defaults for this kind of photo. */
export function normalizeSettings(s: Partial<DevelopSettings> | null | undefined, kind: SourceKind = 'raw'): DevelopSettings {
  const d = defaultsFor(kind)
  return {
    ...d,
    ...s,
    whiteBalance: { ...d.whiteBalance, ...s?.whiteBalance },
    advanced: { ...d.advanced, ...s?.advanced },
    version: 1,
  }
}

/** Lightroom-style tint slider (−150 green … +150 magenta) ⇄ darktable tint (1 = neutral, >1 greener). */
export const tintFromSlider = (slider: number, asShot: number) => asShot * 2 ** (-slider * 0.006)
export const sliderFromTint = (tint: number, asShot: number) => -Math.log2(tint / asShot) / 0.006

/** Contrast slider → darktable sigmoid contrast (default 1.5). */
export const sigmoidContrast = (slider: number) => 1.5 * 2 ** ((slider / 100) * 0.6)

/** Max tone-equalizer gain at full slider travel, in EV. */
const TONE_RANGE = 1.5

/**
 * How strongly each slider moves each tone-equalizer band (−8 … 0 EV of pixel brightness after
 * exposure; with the +0.7 EV default, middle grey sits near −1.8 EV and clipped white above 0).
 */
const BAND_WEIGHTS = {
  blacks: [1, 1, 0.5, 0.1, 0, 0, 0, 0, 0],
  shadows: [0, 0.1, 0.3, 0.8, 1, 0.5, 0.1, 0, 0],
  highlights: [0, 0, 0, 0, 0, 0.1, 0.5, 1, 0.4],
  whites: [0, 0, 0, 0, 0, 0, 0, 0.35, 1],
} as const

export function toneBands(s: Pick<DevelopSettings, 'highlights' | 'shadows' | 'whites' | 'blacks'>): number[] {
  return Array.from({ length: 9 }, (_, i) =>
    (['blacks', 'shadows', 'highlights', 'whites'] as const).reduce(
      (ev, k) => ev + (s[k] / 100) * TONE_RANGE * BAND_WEIGHTS[k][i],
      0,
    ),
  )
}

/** Everything the display shader needs, derived from the settings. */
export interface DisplayUniforms {
  exposureGain: number
  toneFactors: number[]
  toneEnabled: boolean
  vibrance: number
  saturation: number
  sigmoid: SigmoidCurve
  huePreservation: number
}

export function displayUniforms(s: DevelopSettings): DisplayUniforms {
  const bands = toneBands(s)
  return {
    exposureGain: 2 ** (s.advanced.baseExposure + s.exposure),
    toneFactors: toneEqualizerFactors(bands),
    toneEnabled: bands.some((b) => Math.abs(b) > 1e-6),
    vibrance: s.vibrance / 100,
    saturation: s.saturation / 100,
    sigmoid: sigmoidCurve({
      contrast: sigmoidContrast(s.contrast),
      skew: s.advanced.skew,
      whiteTarget: s.advanced.whiteTarget,
      blackTarget: s.advanced.blackTarget,
    }),
    huePreservation: Math.min(1, Math.max(0, s.advanced.huePreservation / 100)),
  }
}
