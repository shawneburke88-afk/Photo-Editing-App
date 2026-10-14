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
import { normalizeDetail, RAW_DETAIL, rawDetailFor, type DetailSettings } from '../detail/settings'
import { normalizeToneCurve, toneCurveGpu, type ToneCurveGpu, type ToneCurveSettings } from './tone-curve'
import { normalizeSpots, type Spot } from './spots'
import { colourMixerGpu, normalizeColourMixer, type ColourMixerGpu, type ColourMixerSettings } from './colour-mixer'
import { colourGradingGpu, normalizeColourGrading, type ColourGradingGpu, type ColourGradingSettings } from './colour-grading'
import { normalizeMasks, type LocalMask } from './masks'
import type { BandWeights, MaskParams } from './process'

/**
 * The demosaic method (Develop › Advanced). The stored value names the method for the photo's sensor as darktable
 * pairs them: 'rcd' is RCD on Bayer sensors and Markesteijn 1-pass on X-Trans (darktable's defaults); 'markesteijn3'
 * is darktable's Markesteijn 3-pass on X-Trans (offered only there; on a Bayer photo it means RCD, as darktable maps
 * an X-Trans method on a Bayer photo); 'bilinear' is the fast preview (linear interpolation on X-Trans).
 */
export type DemosaicMethod = 'rcd' | 'bilinear' | 'markesteijn3'

/** The algorithm a stored method runs on a sensor layout (darktable src/iop/demosaic.c lines 1503-1506). */
export function demosaicAlgorithm(layout: 'bayer' | 'xtrans', method: DemosaicMethod): 'rcd' | 'bilinear' | 'markesteijn1' | 'markesteijn3' | 'linear' {
  if (layout === 'xtrans') return method === 'bilinear' ? 'linear' : method === 'markesteijn3' ? 'markesteijn3' : 'markesteijn1'
  return method === 'bilinear' ? 'bilinear' : 'rcd'
}

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
    demosaic: DemosaicMethod
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
  /**
   * The Detail group: Sharpening and Noise Reduction (engine/detail/settings.ts). Absent = all off: every edit saved
   * before it existed reads so and renders as before. New RAW edits get sharpening on (`rawDetailFor`: Amount 40, 25
   * above ISO 1000), JPEGs none.
   */
  detail?: DetailSettings
  /**
   * The Tone Curve (tone-curve.ts): Regions, the RGB curve and the Red, Green and Blue curves, after Contrast. Absent
   * when untouched or reset, so such an edit is exactly one made before the Tone Curve existed (and renders as one).
   */
  toneCurve?: ToneCurveSettings
  /**
   * The Colour Mixer and Point Color (colour-mixer.ts; PHASE3.md Part 15), before the sigmoid. Absent when untouched or
   * reset, so such an edit is exactly one made before the mixer existed (and renders as one).
   */
  colourMixer?: ColourMixerSettings
  /**
   * Colour Grading (colour-grading.ts; PHASE3.md Part 17): the Shadows, Midtones, Highlights and Global wheels, Blending
   * and Balance, on darktable's color balance rgb before the sigmoid, after the Colour Mixer. Absent when untouched or
   * reset, so such an edit is exactly one made before Colour Grading existed (and renders as one).
   */
  colourGrading?: ColourGradingSettings
  /**
   * Remove, Heal and Clone spots (spots.ts), in the order they were made. Optional: edits without spots have no
   * such field at all, so they stay exactly as they were (and render byte-identically).
   */
  spots?: Spot[]
  /**
   * Masks and their local adjustments (masks.ts; PHASE3.md Part 23). Optional: edits without masks have no such field at
   * all, so they stay exactly as they were (and render byte-identically).
   */
  masks?: LocalMask[]
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
  // New RAW photos are sharpened (capture sharpening, Amount 40, automatic radius; owner's decision 2026-10-13).
  // `defaultsFor` lowers it to 25 above ISO 1000.
  detail: RAW_DETAIL,
}

/** What kind of source a photo is: camera RAW, or an already-rendered (display-referred) RGB image. */
export type SourceKind = 'raw' | 'rgb'

/**
 * Defaults for display-referred images (JPEG, later PNG/TIFF). Like darktable, a JPEG gets no +0.7 EV base
 * exposure. Hue preservation is 0 so that the pipeline's inverse tone mapping at load is exact and an
 * unedited JPEG looks exactly as shot (see engine/gpu/rgb-input.wgsl).
 */
export const DEFAULT_RGB_SETTINGS: DevelopSettings = (() => {
  // JPEGs start unsharpened (Lightroom's JPEG default too, from general knowledge): no `detail`.
  const { detail: _raw, ...rest } = DEFAULT_SETTINGS
  void _raw
  return { ...rest, advanced: { ...DEFAULT_SETTINGS.advanced, baseExposure: 0, huePreservation: 0 } }
})()

/**
 * The defaults for a new photo of this kind. A RAW's default sharpening depends on its EXIF ISO (Amount 40, or 25
 * above ISO 1000; `rawDetailFor`); without an ISO it is 40 (`DEFAULT_SETTINGS`).
 */
export function defaultsFor(kind: SourceKind, iso?: number | null): DevelopSettings {
  if (kind === 'rgb') return DEFAULT_RGB_SETTINGS
  const detail = rawDetailFor(iso)
  return detail === DEFAULT_SETTINGS.detail ? DEFAULT_SETTINGS : { ...DEFAULT_SETTINGS, detail }
}

/**
 * Fills in missing fields (e.g. from older saved edits) with the defaults for this kind of photo. A saved edit
 * without a process version is version 1 (the rendering it was made with), and one without geometry has none.
 */
export function normalizeSettings(s: Partial<DevelopSettings> | null | undefined, kind: SourceKind = 'raw'): DevelopSettings {
  const d = defaultsFor(kind)
  // Detail comes only from the stored edit: an edit without it is off (old edits render as before).
  const { detail: _dd, ...base } = d
  void _dd
  const out: DevelopSettings = {
    ...base,
    ...s,
    whiteBalance: { ...d.whiteBalance, ...s?.whiteBalance },
    advanced: { ...d.advanced, ...s?.advanced },
    lens: normalizeLens(s?.lens),
    version: 1,
    process: validProcess(s?.process),
    geometry: normalizeGeometry(s?.geometry),
  }
  // No Detail settings stay none (no key is added to older edits).
  const detail = normalizeDetail(s?.detail)
  if (detail) out.detail = detail
  else delete out.detail
  // The tone curve is only kept when it isn't at its defaults (an edit without one has no key at all).
  const tc = normalizeToneCurve(s?.toneCurve)
  if (tc) out.toneCurve = tc
  else delete out.toneCurve
  // The same for the Colour Mixer.
  const cm = normalizeColourMixer(s?.colourMixer)
  if (cm) out.colourMixer = cm
  else delete out.colourMixer
  // And for Colour Grading.
  const cg = normalizeColourGrading(s?.colourGrading)
  if (cg) out.colourGrading = cg
  else delete out.colourGrading
  const spots = normalizeSpots(s?.spots)
  if (spots) out.spots = spots
  else delete out.spots
  // Masks: the same (no key unless there are masks; caps and the range/shape rule enforced, masks.ts).
  const masks = normalizeMasks(s?.masks)
  if (masks) out.masks = masks
  else delete out.masks
  return out
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
  /** Sharpening and noise reduction (absent = off); the engine resolves them against the photo (its noise profile). */
  detail?: DetailSettings
  /** Show Sharpening's mask instead of the photo (Masking preview, a view only). */
  detailMask?: boolean
  /** The Tone Curve's lookup table and options, or null when it changes nothing (the shader skips it). */
  toneCurve: ToneCurveGpu | null
  /** The Colour Mixer's tables and parameters, or null when it changes nothing (the shader skips it). */
  colourMixer: ColourMixerGpu | null
  /**
   * The mixer's visualize view (a view only, like `detailMask`): 1–8 shows a band's colours and greys the rest, 9–16 a
   * Point Color sample's range.
   */
  mixerVisualize?: number
  /** Colour Grading's parameters, or null when it changes nothing (the shader skips it). */
  colourGrading: ColourGradingGpu | null
  /** Remove, Heal and Clone spots; absent when there are none. */
  spots?: Spot[]
  /** Masks and what the shader needs for their local sliders; absent when there are none. */
  masks?: MasksGpu
}

/** The masks of an edit with the process version's numbers their local sliders use (PHASE3.md Part 23). */
export interface MasksGpu {
  list: LocalMask[]
  params: MaskParams
  /** The global tone equalizer bands (EV), the band weights and range of the process version, the contrast spread. */
  bands: number[]
  weights: BandWeights
  toneRange: number
  contrastSpread: number
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
    ...(s.detail ? { detail: s.detail } : {}),
    toneCurve: toneCurveGpu(s.toneCurve),
    colourMixer: colourMixerGpu(s.colourMixer),
    colourGrading: colourGradingGpu(s.colourGrading),
    ...(s.spots?.length ? { spots: s.spots } : {}),
    ...(s.masks?.length ? { masks: masksGpu(s, bands) } : {}),
  }
}

function masksGpu(s: DevelopSettings, bands: number[]): MasksGpu {
  const p = processParams(s.process)
  return { list: s.masks!, params: p.masks, bands, weights: p.bandWeights, toneRange: p.toneRange, contrastSpread: p.contrastSpread }
}
