/**
 * Clipping indicator settings, following darktable's two indicators and their defaults:
 *  - display clipping, darktable `overexposed` (src/iop/overexposed.c, darkroom.c, darktableconfig.xml.in);
 *  - sensor clipping, darktable `rawoverexposed` (src/iop/rawoverexposed.c).
 * These are viewing aids, not edits: they are kept per browser, like darktable's global preferences.
 */
import type { SensorData } from '../raw/types'

export type ClipMode = 'anyrgb' | 'luminance' | 'saturation' | 'gamut'
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
}

/**
 * LightBench uses "any RGB channel" as its default mode, which is closest to Lightroom's J overlay.
 * darktable's own default is "full gamut", which also flags very saturated colours. All four
 * darktable modes are available.
 */
export const DEFAULT_CLIP: ClipSettings = { mode: 'anyrgb', upperPercent: 99.99, lowerEv: -12.69, scheme: 1 }
export const DEFAULT_RAW_CLIP: RawClipSettings = { mode: 'cfa', threshold: 1, colour: 'red' }

export const CLIP_MODE_LABELS: Record<ClipMode, string> = {
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

const CLIP_MODE_CODE: Record<ClipMode, number> = { anyrgb: 1, luminance: 2, saturation: 3, gamut: 4 }
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
