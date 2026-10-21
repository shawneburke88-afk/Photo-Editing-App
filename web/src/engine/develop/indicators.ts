/**
 * Clipping indicator settings, following darktable's two indicators and their defaults:
 *  - display clipping, darktable `overexposed` (src/iop/overexposed.c, darkroom.c, darktableconfig.xml.in);
 *  - sensor clipping, darktable `rawoverexposed` (src/iop/rawoverexposed.c).
 * These are viewing aids, not edits: they are kept per browser, like darktable's global preferences.
 */
import type { SensorData } from '../raw/types'
import type { ProofLut } from '../proof/lut'

export type ClipMode = 'lost' | 'anyrgb' | 'luminance' | 'saturation' | 'gamut'
export type RawClipMode = 'cfa' | 'solid' | 'false'
export type RawClipColour = 'red' | 'green' | 'blue' | 'black'

export interface ClipSettings {
  mode: ClipMode
  /** Upper threshold in % of display white (darktable default 99.99 %, range 0–100). */
  upperPercent: number
  /** Lower threshold in EV (darktable default −12.69 EV, range −32…−4). */
  lowerEv: number
  /** 0 black & white, 1 red & blue (darktable default), 2 purple & green. */
  scheme: 0 | 1 | 2
}

export interface RawClipSettings {
  mode: RawClipMode
  /** 1 = the sensor's white level, 0 = black level (darktable default 1, range 0–2). */
  threshold: number
  colour: RawClipColour
}

export interface Indicators {
  clip: ClipSettings
  showClip: boolean
  raw: RawClipSettings
  showRaw: boolean
  /**
   * Soft proofing (docs/PHASE3.md Part 20): Develop's canvas and its histogram only. Absent everywhere else (Export,
   * thumbnails, Auto, the background developer), so those never see it.
   */
  proof?: ProofDraw
  /** The selected mask shown over the photo (docs/PHASE3.md Part 23): Develop's canvas only, a view. */
  maskOverlay?: MaskOverlayDraw
}

/** Lightroom's six overlay modes, in its menu's order (Adobe's masking page). */
export const OVERLAY_MODES = ['Color Overlay', 'Color Overlay on B&W', 'Image on B&W', 'Image on Black', 'Image on White', 'White on Black'] as const

/** A mask overlay to draw: the mask, the mode (1–6 in OVERLAY_MODES' order), its colour (sRGB 0…1) and opacity (0…1). */
export interface MaskOverlayDraw {
  id: string
  mode: number
  colour: [number, number, number]
  opacity: number
  /** Show the mask's depth map itself instead of the mask (a Depth range; PHASE3.md Part 24), with mode 6 (White on Black). */
  depthMap?: boolean
}

/** A soft proof to draw: the table (engine/proof/lut.ts) and the warnings shown. */
export interface ProofDraw {
  /** The table's cache key (engine/proof/settings.ts `proofKey`): uploaded to the GPU again only when it changes. */
  key: string
  lut: Pick<ProofLut, 'size' | 'data' | 'device' | 'paper'>
  /** Destination gamut warning (Shift+S). */
  destWarning: boolean
  /** Screen gamut warning (against the canvas's sRGB or Display P3). */
  screenWarning: boolean
}

/**
 * LightBench's default mode is "lost detail" (owner's decision, 2026-10-11): a pixel is marked when the
 * sensor clipped there (any photosite of its 2×2 CFA tile at the raw threshold, as darktable's
 * rawoverexposed tests) or when any RGB channel is at the display limit (darktable overexposed "any RGB").
 * darktable's sigmoid rolls highlights off and rarely reaches the display limit, so darktable's display
 * test alone seldom shows anything; adding the sensor test makes the warning behave like Lightroom's J.
 * darktable's own four modes stay available; its default is "full gamut".
 */
export const DEFAULT_CLIP: ClipSettings = { mode: 'lost', upperPercent: 99.99, lowerEv: -12.69, scheme: 1 }
export const DEFAULT_RAW_CLIP: RawClipSettings = { mode: 'cfa', threshold: 1, colour: 'red' }

export const CLIP_MODE_LABELS: Record<ClipMode, string> = {
  lost: 'Lost detail (sensor or screen)',
  anyrgb: 'Any RGB channel',
  luminance: 'Luminance only',
  saturation: 'Saturation only',
  gamut: 'Full gamut',
}
export const RAW_MODE_LABELS: Record<RawClipMode, string> = {
  cfa: 'Mark with sensor colour',
  solid: 'Mark with solid colour',
  false: 'False colour',
}
export const SCHEME_LABELS = ['Black & white', 'Red & blue', 'Purple & green'] as const

/** darktable dt_iop_overexposed_colors: [over, under] per scheme. */
export const SCHEME_COLOURS: [[number, number, number], [number, number, number]][] = [
  [[0, 0, 0], [1, 1, 1]],
  [[1, 0, 0], [0, 0, 1]],
  [[0.371, 0.434, 0.934], [0.512, 0.934, 0.371]],
]

/** darktable rawoverexposed: solid colours. */
export const RAW_COLOURS: Record<RawClipColour, [number, number, number]> = {
  red: [1, 0, 0],
  green: [0, 1, 0],
  blue: [0, 0, 1],
  black: [0, 0, 0],
}

const CLIP_MODE_CODE: Record<ClipMode, number> = { anyrgb: 1, luminance: 2, saturation: 3, gamut: 4, lost: 5 }
const RAW_MODE_CODE: Record<RawClipMode, number> = { cfa: 1, solid: 2, false: 3 }

/** Shader values for the display clipping test (darktable overexposed.c process()). */
export function clipUniforms(c: ClipSettings) {
  return {
    mode: CLIP_MODE_CODE[c.mode],
    upper: c.upperPercent / 100,
    lower: 2 ** Math.min(c.lowerEv, -4),
    upperColour: SCHEME_COLOURS[c.scheme][0],
    lowerColour: SCHEME_COLOURS[c.scheme][1],
  }
}

/**
 * Raw value per CFA position at or above which a photosite counts as clipped
 * (darktable rawoverexposed.c: threshold · (white − black) + black).
 */
export function rawThresholds(sensor: Pick<SensorData, 'black' | 'white'>, threshold: number): [number, number, number, number] {
  return sensor.black.map((b) => Math.floor(threshold * (sensor.white - b) + b)) as [number, number, number, number]
}

export function rawModeCode(m: RawClipMode): number {
  return RAW_MODE_CODE[m]
}
