// Develop settings: Lightroom-style controls on top of darktable modules.
//
// Each slider is translated into parameters of a darktable module (white balance → temperature,
// exposure → exposure, contrast → sigmoid, highlights/shadows/whites/blacks → tone equalizer bands).
// Vibrance and saturation use a simple chroma scaling for now; darktable's colour balance rgb is
// planned for Phase 3.

import { SIGMOID_DEFAULTS, sigmoidCurve, type SigmoidCurve } from '../color/sigmoid'
import { toneEqualizerFactors } from '../color/tone-equalizer'
import type { AutoRecord } from './auto'
import { DEFAULT_LENS, LEGACY_LENS, normalizeLens, type LensSettings } from '../lens/correction'
import { DEFAULT_GEOMETRY, normalizeGeometry, type GeometrySettings } from './geometry'
import { CURRENT_PROCESS, processParams, validProcess, type ToneMask } from './process'

export interface DevelopSettings {
  /** Layout of this settings object (the JSON schema), not the rendering: see `process`. */
  version: 1
  /**
   * Process version: which generation of LightBench's rendering these settings are rendered with (process.ts).
   * Edits saved before it existed are version 1; new edits get the current version.
   */
  process: number
  /** Crop, straighten, rotate and flip: one geometry stage (geometry.ts). */
  geometry: GeometrySettings
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
  /**
   * Lens corrections (engine/lens/correction.ts). Edits saved before they existed have none and read as off, so
   * they render as before; new edits get Auto.
   */
  lens: LensSettings
}

export const DEFAULT_SETTINGS: DevelopSettings = {
  version: 1,
  process: CURRENT_PROCESS,
  geometry: DEFAULT_GEOMETRY,
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
  lens: DEFAULT_LENS,
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

/**
 * Fills in missing fields (e.g. from older saved edits) with the defaults for this kind of photo. A saved edit
 * without a process version is version 1 (the rendering it was made with), and one without geometry has none.
 */
export function normalizeSettings(s: Partial<DevelopSettings> | null | undefined, kind: SourceKind = 'raw'): DevelopSettings {
  const d = defaultsFor(kind)
  return {
    ...d,
    ...s,
    whiteBalance: { ...d.whiteBalance, ...s?.whiteBalance },
    advanced: { ...d.advanced, ...s?.advanced },
    lens: normalizeLens(s?.lens),
    version: 1,
    process: validProcess(s?.process),
    geometry: normalizeGeometry(s?.geometry),
  }
}

/** Lightroom-style tint slider (−150 green … +150 magenta) ⇄ darktable tint (1 = neutral, >1 greener). */
export const tintFromSlider = (slider: number, asShot: number) => asShot * 2 ** (-slider * 0.006)
export const sliderFromTint = (tint: number, asShot: number) => -Math.log2(tint / asShot) / 0.006

/** Contrast slider → darktable sigmoid contrast (default 1.5); the spread depends on the process version. */
export const sigmoidContrast = (slider: number, process = CURRENT_PROCESS) => 1.5 * 2 ** ((slider / 100) * processParams(process).contrastSpread)

/** Tone-equalizer band gains (EV) of the four tone sliders, with the process version's weights. */
export function toneBands(s: Pick<DevelopSettings, 'highlights' | 'shadows' | 'whites' | 'blacks'> & { process?: number }): number[] {
  const { toneRange, bandWeights } = processParams(s.process ?? CURRENT_PROCESS)
  return Array.from({ length: 9 }, (_, i) =>
    (['blacks', 'shadows', 'highlights', 'whites'] as const).reduce(
      (ev, k) => ev + (s[k] / 100) * toneRange * bandWeights[k][i],
      0,
    ),
  )
}

/** Everything the display shader needs, derived from the settings. */
export interface DisplayUniforms {
  /** Lens corrections; the engine resolves them against the photo's metadata and size. */
  lens: LensSettings
  exposureGain: number
  toneFactors: number[]
  toneEnabled: boolean
  /** How the tone equalizer measures brightness (the process version's). */
  toneMask: ToneMask
  vibrance: number
  saturation: number
  sigmoid: SigmoidCurve
  huePreservation: number
  /** Crop, straighten, rotate and flip; the engine resolves it against the photo's size. */
  geometry: GeometrySettings
}

export function displayUniforms(s: DevelopSettings): DisplayUniforms {
  const bands = toneBands(s)
  return {
    lens: s.lens ?? LEGACY_LENS,
    exposureGain: 2 ** (s.advanced.baseExposure + s.exposure),
    toneFactors: toneEqualizerFactors(bands),
    toneEnabled: bands.some((b) => Math.abs(b) > 1e-6),
    toneMask: processParams(s.process).toneMask,
    vibrance: s.vibrance / 100,
    saturation: s.saturation / 100,
    sigmoid: sigmoidCurve({
      contrast: sigmoidContrast(s.contrast, s.process),
      skew: s.advanced.skew,
      whiteTarget: s.advanced.whiteTarget,
      blackTarget: s.advanced.blackTarget,
    }),
    huePreservation: Math.min(1, Math.max(0, s.advanced.huePreservation / 100)),
    geometry: s.geometry ?? DEFAULT_GEOMETRY,
  }
}
