// Lightroom's crop, straighten, orientation, Upright and Transform fields in XMP sidecars (owner's choice, 2026-10-12:
// both directions; where the two models differ, the closest match, said so). The XMP reading and writing is in xmp.ts;
// this file holds the conversions and the rules, without any file access, so they can be unit-tested.
//
// The fields (Adobe's Camera Raw namespace `crs:` and `tiff:Orientation`):
//  - crs:HasCrop, crs:CropLeft/Top/Right/Bottom, crs:CropAngle. darktable's importer only uses the edges when HasCrop
//    is True (src/develop/lightroom.c, `_lrop`, "HasCrop"); Adobe's XMP Specification Part 2 (2008) describes the
//    edges and the angle as valid "when HasCrop is True" (quoted from memory of that document; it couldn't be fetched
//    here). LightCraft reads HasCrop False as "no crop" (crates/engine/src/crs.rs, crop block at line 436).
//  - tiff:Orientation, 1–8, as in EXIF: the photo's orientation as Lightroom shows it. Lightroom stores its rotate and
//    flip there rather than in the crop; darktable compares it with the file's own orientation (lightroom.c `_lrop`,
//    "Orientation") and applies it.
//  - crs:PerspectiveUpright and crs:PerspectiveVertical/Horizontal/Rotate/Scale/Aspect/X/Y (Upright and the
//    Transform sliders). Lightroom's solved Upright (crs:UprightVersion, UprightCenterMode/NormX/NormY,
//    UprightFocalMode/FocalLength35mm, UprightPreview, UprightTransformCount, UprightTransform_0…5,
//    UprightFourSegments_0…3/Count, the digests) is neither read nor written: its coordinate convention is not
//    documented anywhere available here, and LightCraft doesn't import it either (crs.rs `has_saved_upright_transform`).
//
// The crop convention (resolved from three sources that agree; not checked in Lightroom itself):
//  - The edges are the crop rectangle's top-left (CropLeft, CropTop) and bottom-right (CropRight, CropBottom) corners on
//    the photo AS STORED (before tiff:Orientation and before straightening), normalised to its width and height. The
//    rectangle is turned by CropAngle about the photo's centre, in pixels (so the photo's aspect matters once it turns).
//  - Lightroom's CropAngle turns the other way to LightBench's straighten angle (LightBench: clockwise +, the photo
//    turning under a level box), and a mirrored orientation reverses it once more:
//      LightBench angle = −CropAngle × det(orientation).
//  - Evidence: darktable's importer negates CropAngle (lightroom.c line 501, `data->pc.angle = -…`), turns the two
//    corners about the centre in pixels of tiff:ImageWidth × ImageLength (lines 1343–1361), then applies the stored →
//    shown orientation to them (lines 1363–1372) and negates the angle again for mirrored orientations (1374–1379), so
//    it reads the edges as stored-frame corners. LightCraft's catalog importer (crates/engine/src/lightroom_catalog.rs
//    `catalog_crop`, line 574: corners "on the stored image (before orientation and straightening)", the angle "turns
//    the other way") reproduced the aspect of all 223 straightened crops of a real catalog in Lightroom's exports
//    within 1 % (its comment) — and the aspect of a turned crop depends on the angle's sign. Both give the same map
//    (LightCraft's `rotate_about(−CropAngle)` after orienting = darktable's `rotate_xy(…, −rangle)` before it). The XMP
//    and catalog fields are the same Camera Raw settings. LightCraft's XMP path copies the edges and angle as they are
//    (crs.rs line 436), which disagrees with its own catalog path for straightened or turned photos; the catalog path
//    was checked against exports, so it is the one followed here.
//  - No real Lightroom sidecar with a crop was available here (none in the immich test assets or LightCraft's tests;
//    LightCraft's crop packets are written for its tests), so this was not checked against a file Lightroom wrote.
//
// The Upright codes follow ExifTool (lib/Image/ExifTool/XMP.pm, PerspectiveUpright, citing its forum thread 14012):
// 0 Off, 1 Auto, 2 Full, 3 Level, 4 Vertical, 5 Guided. LightCraft's table (docs/xmp-interop.md, crs.rs line 423) says
// 2 Level, 3 Vertical, 4 Full instead, without saying how it was found; ExifTool's comes from observing Lightroom
// (each code annotated with Lightroom's tooltip), so it is the one used. Not checked in Lightroom here.
//
// The Transform sliders map number for number (both are −100…100, Rotate ±10°, Scale %). Signs, from LightCraft's
// description of Lightroom (crates/pipeline/src/transform.rs `manual`: "Vertical − widens the top … Horizontal −
// enlarges the left side, Rotate + turns the image clockwise, Aspect + stretches vertically … Offset X + moves the image
// right, Offset Y + moves it up"; not checked in Lightroom): LightBench's Vertical, Horizontal and Aspect are the other
// way round, Rotate and the offsets the same way. The strength of a step differs between the two models (Lightroom's
// keystone isn't darktable's lens shift), so the numbers carry over but the look is approximate. Lightroom's Scale
// below 100 % (empty edges) becomes 100 %.

// The Detail panel's fields (Phase 3, Part 13; the same rules): crs:Sharpness, SharpenRadius, SharpenDetail,
// SharpenEdgeMasking, LuminanceSmoothing, LuminanceNoiseReductionDetail, LuminanceNoiseReductionContrast,
// ColorNoiseReduction, ColorNoiseReductionDetail, ColorNoiseReductionSmoothness (names from ExifTool's crs table and
// the owner's list). LightBench's Detail sliders have Lightroom's names and ranges, so the numbers carry over one for
// one, Radius included: LightBench's Radius (0.5–3.0, default 1.0) multiplies the photo's automatic radius, so
// Lightroom's default 1.0 is LightBench's measured radius. The algorithms differ (Lightroom's aren't public; LightBench's are darktable's), so the look is only approximately
// Lightroom's. A sidecar without these fields leaves LightBench's Detail alone, and an absent sub-field
// reads as Lightroom's default (Radius 1.0, Detail 25, Masking 0, Luminance Detail 50, Contrast 0, Color Detail 50,
// Smoothness 50; from general knowledge of Lightroom, not checked). Not checked against a sidecar Lightroom wrote.

// The Colour Mixer's bands (Phase 3, Part 15; the same rules): crs:HueAdjustment<Band>, SaturationAdjustment<Band> and
// LuminanceAdjustment<Band> for Lightroom's eight bands Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta (the names
// darktable's Lightroom importer reads: src/develop/lightroom.c lines 621-764, commit 6271f53). Both have −100…100 sliders
// with these names, so the numbers carry over one for one; Lightroom's band centres, widths and scales aren't public, so
// the look is only approximately Lightroom's (closest match). Absent fields read as 0; a sidecar with none of the 24
// leaves the mixer alone. Positive values are written with a sign ("+13"), as LightCraft's test sidecar has them; not
// checked against a sidecar Lightroom wrote. Point Color (crs:PointColors) isn't read or written: its format isn't
// documented anywhere available here (only LightCraft's tests name the field, with an "empty" slot of four −1 values).

// Colour Grading (Phase 3, Part 17; the same rules). Lightroom's XMP is a hybrid (ExifTool 3.79, lib/Image/ExifTool/XMP.pm,
// whose notes say the SplitToning fields are "also used for newer ColorGrade settings"): Shadows and Highlights keep the old
// crs:SplitToningShadowHue/Saturation and SplitToningHighlightHue/Saturation, Balance is crs:SplitToningBalance, and the rest
// is crs:ColorGradeShadowLum, ColorGradeMidtoneHue/Sat/Lum, ColorGradeHighlightLum, ColorGradeGlobalHue/Sat/Lum and
// ColorGradeBlending (there is no ColorGradeShadowHue). LightBench's wheels have Lightroom's names and ranges, so the numbers
// carry over one for one (closest match: the engines differ). Saturation 0–100, Luminance −100…100 and Blending 0–100
// (default 50) are Adobe's (its 2020-10-20 launch post); hue as degrees 0–360 and Balance as −100…100 are assumptions
// that no Adobe text or Lightroom-written sidecar here confirms (darktable's importer divides the hues by 255, which isn't
// copied). A sidecar with Split Toning fields and no crs:ColorGradeBlending reads as Blending 100: Adobe says Split Toning
// "always used what we now call Blending = 100" and that old images look the same; that an absent field means 100 is
// inferred, not documented. Lum and Balance are written with a sign ("+13", as the HSL fields), hue, saturation and Blending
// without; none of this was checked against a sidecar Lightroom wrote. darktable's settings under Advanced aren't exchanged.

import { composeOrientation, normalizeGeometry, orientationMatrix, orientationParts, setLocked, withOrientation, type GeometrySettings } from '../engine/develop/geometry'
import { fromPoints, UNIT_RECT, withAngle, type Rect } from '../engine/develop/crop'
import { DEFAULT_TRANSFORM, normalizeTransform, SCALE_RANGE, ZERO_PERSPECTIVE, type Orient, type TransformSettings, type UprightMode } from '../engine/develop/upright'
import { DEFAULT_DETAIL, normalizeDetail, type DetailSettings } from '../engine/detail/settings'
import { BAND_NAMES, DEFAULT_COLOUR_MIXER, normalizeColourMixer, withPoints, type ColourMixerSettings } from '../engine/develop/colour-mixer'
import { DEFAULT_GRADING, normalizeColourGrading, WHEEL_KEYS, type ColourGradingSettings } from '../engine/develop/colour-grading'

export const NS_CRS = 'http://ns.adobe.com/camera-raw-settings/1.0/'
export const NS_TIFF = 'http://ns.adobe.com/tiff/1.0/'

/** Lightroom's geometry fields as a sidecar states them; absent fields are undefined. */
export interface LrFields {
  /** tiff:Orientation, 1–8. */
  orientation?: number
  hasCrop?: boolean
  cropLeft?: number
  cropTop?: number
  cropRight?: number
  cropBottom?: number
  cropAngle?: number
  /** crs:PerspectiveUpright, 0–5. */
  upright?: number
  vertical?: number
  horizontal?: number
  rotate?: number
  scale?: number
  aspect?: number
  x?: number
  y?: number
  /** Guided Upright's lines in the sidecar (crs:UprightFourSegmentsCount, or how many UprightFourSegments_N). */
  guides?: number
  /** The Detail panel (Part 13). */
  sharpness?: number
  sharpenRadius?: number
  sharpenDetail?: number
  sharpenEdgeMasking?: number
  luminanceSmoothing?: number
  luminanceDetail?: number
  luminanceContrast?: number
  colorNoiseReduction?: number
  colorDetail?: number
  colorSmoothness?: number
  /** The Colour Mixer's 24 fields in LR_HSL_FIELDS order (undefined where absent), when any is present. */
  hsl?: (number | undefined)[]
  /** Colour Grading's 14 fields in LR_GRADE_FIELDS order (undefined where absent), when any is present. */
  grade?: (number | undefined)[]
}

/** The Colour Mixer's crs: fields: Hue, then Saturation, then Luminance, each for Lightroom's eight bands. */
export const LR_HSL_FIELDS: string[] = ['HueAdjustment', 'SaturationAdjustment', 'LuminanceAdjustment'].flatMap((k) => BAND_NAMES.map((b) => `${k}${b}`))

/**
 * Colour Grading's crs: fields: Shadows (hue, saturation, luminance), Midtones, Highlights, Global, then Blending and
 * Balance. Shadows' and Highlights' hue and saturation are Lightroom's old Split Toning fields.
 */
export const LR_GRADE_FIELDS = [
  'SplitToningShadowHue', 'SplitToningShadowSaturation', 'ColorGradeShadowLum',
  'ColorGradeMidtoneHue', 'ColorGradeMidtoneSat', 'ColorGradeMidtoneLum',
  'SplitToningHighlightHue', 'SplitToningHighlightSaturation', 'ColorGradeHighlightLum',
  'ColorGradeGlobalHue', 'ColorGradeGlobalSat', 'ColorGradeGlobalLum',
  'ColorGradeBlending', 'SplitToningBalance',
] as const
/** Index of crs:ColorGradeBlending in LR_GRADE_FIELDS. */
export const LR_BLENDING = 12
/** The fields written with a sign (Luminance and Balance). */
const LR_GRADE_SIGNED = new Set([2, 5, 8, 11, 13])

/** The Detail fields in LrState order, with their crs: names and Lightroom's defaults. */
export const LR_DETAIL_FIELDS = [
  ['sharpness', 'Sharpness', 0],
  ['sharpenRadius', 'SharpenRadius', 1],
  ['sharpenDetail', 'SharpenDetail', 25],
  ['sharpenEdgeMasking', 'SharpenEdgeMasking', 0],
  ['luminanceSmoothing', 'LuminanceSmoothing', 0],
  ['luminanceDetail', 'LuminanceNoiseReductionDetail', 50],
  ['luminanceContrast', 'LuminanceNoiseReductionContrast', 0],
  ['colorNoiseReduction', 'ColorNoiseReduction', 0],
  ['colorDetail', 'ColorNoiseReductionDetail', 50],
  ['colorSmoothness', 'ColorNoiseReductionSmoothness', 50],
] as const

/** What a sidecar says about Lightroom's geometry. */
export interface LrRead {
  fields: LrFields
  /** crs:ProcessVersion is present: Lightroom or Camera Raw has develop settings in this file. */
  processVersion: boolean
  /** crs:AlreadyApplied is True: the pixels already contain these settings (e.g. an exported file). */
  applied: boolean
  /** lightbench:LightroomGeometry: the Lightroom geometry LightBench was last in step with (see `planLightroomWrite`). */
  marker?: string
}

/** Lightroom's geometry with every field resolved (what Lightroom would show). */
export interface LrState {
  /** tiff:Orientation, 1–8 (the file's own orientation when the sidecar doesn't say). */
  orientation: number
  /** [left, top, right, bottom, angle] when HasCrop is True, else null. */
  crop: [number, number, number, number, number] | null
  /** crs:PerspectiveUpright, 0–5 (0 when absent). */
  upright: number
  /** Vertical, Horizontal, Rotate, Scale, Aspect, X, Y (Lightroom's defaults when absent). */
  sliders: [number, number, number, number, number, number, number]
  /**
   * The Detail panel in LR_DETAIL_FIELDS order; null (or absent, in keys stored before Part 13) when the sidecar has
   * none of Sharpness, LuminanceSmoothing and ColorNoiseReduction: unknown, so never counted as a difference.
   */
  detail?: number[] | null
  /** The Colour Mixer's 24 numbers (LR_HSL_FIELDS order); null (or absent) when the sidecar has none of them. */
  hsl?: number[] | null
  /** Colour Grading's 14 numbers (LR_GRADE_FIELDS order); null (or absent) when the sidecar has none of them. */
  grade?: number[] | null
}

export type LrGroup = 'orientation' | 'crop' | 'transform' | 'detail' | 'hsl' | 'grade'
export const LR_GROUPS: LrGroup[] = ['orientation', 'crop', 'transform', 'detail', 'hsl', 'grade']

/** Colour Grading as Lightroom's 14 numbers (none = the defaults: wheels 0, Blending 50, Balance 0). */
export function gradingToLr(g: ColourGradingSettings | undefined): number[] {
  const x = g ?? DEFAULT_GRADING
  return [...WHEEL_KEYS.flatMap((k) => [x[k].hue, x[k].sat, x[k].lum]), x.blending, x.balance]
}

/** Whether Lightroom's 14 numbers grade nothing (every wheel's saturation and luminance 0). */
const gradeNeutral = (v: number[]) => [1, 2, 4, 5, 7, 8, 10, 11].every((i) => Math.abs(v[i]) < 0.5)

/**
 * Lightroom's 14 numbers as LightBench's grade, keeping the photo's darktable settings (Advanced). A grade that changes
 * nothing leaves no trace: its hues, Blending and Balance render nothing, so they aren't kept (e.g. the Split Toning
 * fields at 0 that many sidecars carry).
 */
export function gradingFromLr(current: ColourGradingSettings | undefined, v: number[]): ColourGradingSettings | undefined {
  const adv = current?.advanced ? { advanced: current.advanced } : {}
  if (gradeNeutral(v)) return normalizeColourGrading({ ...DEFAULT_GRADING, ...adv })
  const w = (i: number) => ({ hue: v[i], sat: v[i + 1], lum: v[i + 2] })
  return normalizeColourGrading({ shadows: w(0), midtones: w(3), highlights: w(6), global: w(9), blending: v[12], balance: v[13], ...adv })
}

/**
 * Two lists of Lightroom's 14 numbers grade the same way: equal where it matters (a hue counts only with its saturation;
 * Blending and Balance only when some wheel grades), or both grading nothing.
 */
function sameGrade(a: number[], b: number[]): boolean {
  const na = gradeNeutral(a)
  const nb = gradeNeutral(b)
  if (na || nb) return na && nb
  for (let i = 0; i < 14; i++) if (gradeFieldDiffers(a, b, i)) return false
  return true
}

/** One of the 14 numbers differs (a hue: only with a saturation, and modulo 360). */
function gradeFieldDiffers(a: number[], b: number[], i: number): boolean {
  if (i < 12 && i % 3 === 0) {
    if (Math.abs(a[i + 1]) < 0.5 && Math.abs(b[i + 1]) < 0.5) return false
    const d = Math.abs((((a[i] - b[i]) % 360) + 540) % 360 - 180)
    return d > 0.05
  }
  return Math.abs(a[i] - b[i]) > 0.05
}

/** The Colour Mixer's bands as Lightroom's 24 numbers (none = all 0). */
export function mixerToLr(m: ColourMixerSettings | undefined): number[] {
  const x = m ?? DEFAULT_COLOUR_MIXER
  return [...x.hue, ...x.saturation, ...x.luminance]
}

/** Lightroom's 24 numbers as the mixer's bands, keeping the photo's Point Color and darktable settings. */
export function mixerFromLr(current: ColourMixerSettings | undefined, v: number[]): ColourMixerSettings | undefined {
  const base = withPoints(current, current?.points)
  return normalizeColourMixer({ ...base, hue: v.slice(0, 8), saturation: v.slice(8, 16), luminance: v.slice(16, 24) })
}

/** The Colour Mixer of develop settings saved as JSON (none for missing or damaged settings). */
export function mixerOf(develop: string | null | undefined): ColourMixerSettings | undefined {
  try {
    if (develop) return normalizeColourMixer((JSON.parse(develop) as { colourMixer?: unknown }).colourMixer)
  } catch {
    // damaged settings: none
  }
  return undefined
}

/** The Detail settings as Lightroom's ten numbers. */
export function detailToLr(d: DetailSettings | undefined): number[] {
  const x = d ?? DEFAULT_DETAIL
  return [x.sharpen.amount, x.sharpen.radius, x.sharpen.detail, x.sharpen.masking, x.noise.luminance, x.noise.luminanceDetail, x.noise.luminanceContrast, x.noise.color, x.noise.colorDetail, x.noise.colorSmoothness]
}

/** Lightroom's ten numbers as Detail settings (clamped to the sliders' ranges). */
export function detailFromLr(v: number[]): DetailSettings {
  return normalizeDetail({
    sharpen: { amount: v[0], radius: v[1], detail: v[2], masking: v[3] },
    noise: { luminance: v[4], luminanceDetail: v[5], luminanceContrast: v[6], color: v[7], colorDetail: v[8], colorSmoothness: v[9] },
  })!
}

/** The Detail settings of develop settings saved as JSON (none for missing or damaged settings). */
export function detailOf(develop: string | null | undefined): DetailSettings | undefined {
  try {
    if (develop) return normalizeDetail((JSON.parse(develop) as { detail?: unknown }).detail)
  } catch {
    // damaged settings: none
  }
  return undefined
}

/** The photo as Lightroom stores it: its width and height, and the file's own orientation (EXIF code 1–8). */
export interface LrFrame {
  stored: [number, number]
  camera: number
}

/** The Upright codes (ExifTool's table, see above). */
export const UPRIGHT_CODE: Record<UprightMode, number> = { off: 0, auto: 1, full: 2, level: 3, vertical: 4, guided: 5 }
export const UPRIGHT_FROM_CODE: Record<number, UprightMode> = { 0: 'off', 1: 'auto', 2: 'full', 3: 'level', 4: 'vertical', 5: 'guided' }

/** EXIF orientation codes as quarter turns clockwise, then a mirror (the order LightBench's geometry uses). */
const EXIF_PARTS: Record<number, [number, boolean]> = {
  1: [0, false],
  2: [0, true],
  3: [2, false],
  4: [2, true],
  5: [1, true],
  6: [1, false],
  7: [3, true],
  8: [3, false],
}

/** LibRaw's orientation codes (the catalog's `orientation`) as EXIF codes. */
const FLIP_TO_EXIF: Record<number, number> = { 0: 1, 3: 3, 5: 8, 6: 6 }

export const exifMatrix = (code: number): Orient => orientationMatrix(...(EXIF_PARTS[code] ?? EXIF_PARTS[1]))

export function exifCode(m: Orient): number {
  for (const [code, parts] of Object.entries(EXIF_PARTS)) {
    const x = orientationMatrix(...parts)
    if (x.every((v, i) => v === m[i])) return Number(code)
  }
  return 1
}

/** The frame for a photo of the catalog (its size as LibRaw or the JPEG's EXIF gives it, and its orientation code). */
export function lrFrame(photo: { width: number; height: number; orientation: number }): LrFrame {
  const ok = photo.width > 0 && photo.height > 0
  return { stored: ok ? [photo.width, photo.height] : [3, 2], camera: FLIP_TO_EXIF[photo.orientation] ?? 1 }
}

const transpose = (m: Orient): Orient => [m[0], m[2], m[1], m[3]]
const det = (m: Orient) => m[0] * m[3] - m[1] * m[2]
const apply = (m: Orient, x: number, y: number): [number, number] => [m[0] * x + m[1] * y, m[2] * x + m[3] * y]
function turn([x, y]: [number, number], deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
}
const swaps = (m: Orient) => m[0] === 0
const round = (v: number, digits = 6) => {
  const k = 10 ** digits
  return Math.round(v * k) / k + 0
}
const finite = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Lightroom's fields resolved: what Lightroom shows for them (absent orientation = the file's own). */
export function lrState(f: LrFields | undefined, frame: LrFrame): LrState {
  const x = f ?? {}
  const crop: LrState['crop'] =
    x.hasCrop === true
      ? [x.cropLeft ?? 0, x.cropTop ?? 0, x.cropRight ?? 1, x.cropBottom ?? 1, x.cropAngle ?? 0].map((v) => (finite(v) ? v : 0)) as LrState['crop']
      : null
  return {
    orientation: x.orientation && EXIF_PARTS[x.orientation] ? x.orientation : frame.camera,
    crop,
    upright: x.upright !== undefined && UPRIGHT_FROM_CODE[x.upright] ? x.upright : 0,
    sliders: [x.vertical ?? 0, x.horizontal ?? 0, x.rotate ?? 0, x.scale ?? 100, x.aspect ?? 0, x.x ?? 0, x.y ?? 0].map((v) => (finite(v) ? v : 0)) as LrState['sliders'],
    detail:
      x.sharpness === undefined && x.luminanceSmoothing === undefined && x.colorNoiseReduction === undefined
        ? null
        : LR_DETAIL_FIELDS.map(([k, , d]) => (finite(x[k]) ? x[k]! : d)),
    hsl: x.hsl && x.hsl.some((v) => finite(v)) ? x.hsl.map((v) => (finite(v) ? v : 0)) : null,
    grade: x.grade && x.grade.some((v) => finite(v)) ? gradeState(x.grade) : null,
  }
}

/**
 * Colour Grading's fields resolved: absent ones 0, except Blending: 100 for a sidecar with Split Toning fields and no
 * crs:ColorGradeBlending (Adobe: Split Toning always used Blending 100; that an absent field means it is inferred),
 * otherwise Lightroom's default 50.
 */
function gradeState(f: (number | undefined)[]): number[] {
  const splitToning = [0, 1, 6, 7, 13].some((i) => finite(f[i]))
  return LR_GRADE_FIELDS.map((_, i) => (finite(f[i]) ? f[i]! : i === LR_BLENDING ? (splitToning ? 100 : 50) : 0))
}

/** A stable text form, for remembering and comparing (sidecar/changes.ts, the marker). */
export function lrKey(s: LrState): string {
  return JSON.stringify({ o: s.orientation, c: s.crop && s.crop.map((v) => round(v)), u: s.upright, t: s.sliders.map((v) => round(v, 3)), ...(s.detail ? { d: s.detail.map((v) => round(v, 2)) } : {}), ...(s.hsl ? { h: s.hsl.map((v) => round(v, 2)) } : {}), ...(s.grade ? { g: s.grade.map((v) => round(v, 2)) } : {}) })
}

export function parseLrKey(key: string | null | undefined): LrState | null {
  if (!key) return null
  try {
    const j = JSON.parse(key) as { o: number; c: LrState['crop']; u: number; t: LrState['sliders']; d?: number[]; h?: number[]; g?: number[] }
    if (typeof j.o !== 'number' || typeof j.u !== 'number' || !Array.isArray(j.t) || j.t.length !== 7) return null
    if (j.c !== null && (!Array.isArray(j.c) || j.c.length !== 5)) return null
    const detail = Array.isArray(j.d) && j.d.length === LR_DETAIL_FIELDS.length ? j.d : null
    const hsl = Array.isArray(j.h) && j.h.length === LR_HSL_FIELDS.length ? j.h : null
    const grade = Array.isArray(j.g) && j.g.length === LR_GRADE_FIELDS.length ? j.g : null
    return { orientation: j.o, crop: j.c, upright: j.u, sliders: j.t, ...(detail ? { detail } : {}), ...(hsl ? { hsl } : {}), ...(grade ? { grade } : {}) }
  } catch {
    return null
  }
}

/** Whether one group of two states is the same (within what the sidecar's six decimals keep). */
export function sameGroup(a: LrState, b: LrState, g: LrGroup): boolean {
  if (g === 'orientation') return a.orientation === b.orientation
  if (g === 'crop') {
    if (!a.crop || !b.crop) return !a.crop && !b.crop
    return a.crop.every((v, i) => Math.abs(v - b.crop![i]) <= (i === 4 ? 1e-3 : 1e-5))
  }
  if (g === 'detail') return !a.detail || !b.detail || a.detail.every((v, i) => Math.abs(v - b.detail![i]) <= 0.05)
  if (g === 'hsl') return !a.hsl || !b.hsl || a.hsl.every((v, i) => Math.abs(v - b.hsl![i]) <= 0.05)
  if (g === 'grade') return !a.grade || !b.grade || sameGrade(a.grade, b.grade)
  return a.upright === b.upright && a.sliders.every((v, i) => Math.abs(v - b.sliders[i]) <= 0.05)
}

export const sameState = (a: LrState, b: LrState) => LR_GROUPS.every((g) => sameGroup(a, b, g))

/** Two keys (lrKey) describe the same geometry; unreadable keys count as different. */
export function sameLrKey(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === b) return true
  const x = parseLrKey(a)
  const y = parseLrKey(b)
  return !!x && !!y && sameState(x, y)
}

// ---- LightBench → Lightroom

/** The photo's whole orientation (the file's, then LightBench's turns and flips) as a 2×2 matrix. */
const totalOrientation = (g: GeometrySettings, frame: LrFrame) => composeOrientation(orientationMatrix(g.turns, g.mirror), exifMatrix(frame.camera))

/** The size of LightBench's straightened frame for an orientation. */
const frameSize = (o: Orient, frame: LrFrame): [number, number] => (swaps(o) ? [frame.stored[1], frame.stored[0]] : frame.stored)

/**
 * What Lightroom's fields would be for LightBench's geometry (and Detail settings: none = all off; the Colour Mixer: none
 * = 0; Colour Grading: none = the defaults).
 */
export function toLightroom(g: GeometrySettings, frame: LrFrame, detail?: DetailSettings, mixer?: ColourMixerSettings, grading?: ColourGradingSettings): LrState {
  const o = totalOrientation(g, frame)
  const [W, H] = frame.stored
  const [fw, fh] = frameSize(o, frame)
  // The crop as rendered: one found outside the turned photo is pulled inside first (as resolveGeometry does).
  const rect = withAngle({ rect: g.crop, angle: g.angle }, g.angle, fw, fh).rect
  const whole = Math.abs(rect.x0) < 1e-9 && Math.abs(rect.y0) < 1e-9 && Math.abs(rect.x1 - 1) < 1e-9 && Math.abs(rect.y1 - 1) < 1e-9
  let crop: LrState['crop'] = null
  if (!whole || g.angle !== 0) {
    const ot = transpose(o)
    // Frame corners, centred, in pixels; their place on the stored photo without and with the straightening.
    const corners: [number, number][] = [
      [rect.x0, rect.y0],
      [rect.x1, rect.y0],
      [rect.x1, rect.y1],
      [rect.x0, rect.y1],
    ].map(([u, v]) => [(u - 0.5) * fw, (v - 0.5) * fh])
    const level = corners.map(([x, y]) => apply(ot, x, y))
    // Lightroom's top-left corner is the one at the top left of the rectangle as stored (before it is turned).
    let tl = 0
    for (let i = 1; i < 4; i++) if (level[i][0] <= level[tl][0] + 1e-9 && level[i][1] <= level[tl][1] + 1e-9) tl = i
    const br = (tl + 2) % 4
    const stored = (i: number): [number, number] => {
      const [x, y] = apply(ot, ...turn(corners[i], -g.angle))
      return [x / W + 0.5, y / H + 0.5]
    }
    const [l, t] = stored(tl)
    const [r, b] = stored(br)
    crop = [l, t, r, b, -g.angle * det(o) + 0]
  }
  const t = g.transform
  return {
    orientation: exifCode(o),
    crop,
    upright: UPRIGHT_CODE[t?.upright ?? 'off'],
    sliders: t ? [-t.vertical + 0, -t.horizontal + 0, t.rotate, t.scale, -t.aspect + 0, t.offsetX, t.offsetY] : [0, 0, 0, 100, 0, 0, 0],
    detail: detailToLr(detail),
    hsl: mixerToLr(mixer),
    grade: gradingToLr(grading),
  }
}

// ---- Lightroom → LightBench

export interface FromLightroom {
  geometry: GeometrySettings
  /** Detail settings read from Lightroom, when that group was taken. */
  detail?: DetailSettings
  /** The Colour Mixer's 24 numbers read from Lightroom (`mixerFromLr`), when that group was taken. */
  hsl?: number[]
  /** Colour Grading's 14 numbers read from Lightroom (`gradingFromLr`), when that group was taken. */
  grade?: number[]
  /** The groups that were taken from Lightroom (the others already matched). */
  changed: LrGroup[]
  /** The Upright mode read must be solved again on the photo (Auto, Level, Vertical, Full). */
  rerun: boolean
}

/**
 * LightBench's geometry with Lightroom's fields applied. Only the groups that differ from what LightBench has are
 * taken, so the parts Lightroom can't describe (the aspect lock, a Guided correction drawn in LightBench) stay when
 * nothing changed there.
 */
export function fromLightroom(current: GeometrySettings, s: LrState, frame: LrFrame, currentDetail?: DetailSettings, currentMixer?: ColourMixerSettings, currentGrading?: ColourGradingSettings): FromLightroom {
  const ours = toLightroom(current, frame, currentDetail, currentMixer, currentGrading)
  const changed = LR_GROUPS.filter((g) => !sameGroup(ours, s, g))
  let g = current
  if (changed.includes('orientation')) {
    // LightBench's turns and flips are on top of the file's orientation; the crop and transform turn with the photo.
    const user = composeOrientation(exifMatrix(s.orientation), transpose(exifMatrix(frame.camera)))
    const { turns, mirror } = orientationParts(user)
    g = withOrientation(g, turns, mirror)
  }
  if (changed.includes('crop')) {
    if (!s.crop) {
      g = { ...g, crop: UNIT_RECT, angle: 0, aspect: 'original', locked: true }
    } else {
      const o = exifMatrix(s.orientation)
      const [W, H] = frame.stored
      const [fw, fh] = frameSize(o, frame)
      const [l, t, r, b, lrAngle] = s.crop
      const angle = clamp(-lrAngle * det(o) + 0, -45, 45)
      const toFrame = (x: number, y: number) => {
        const [u, v] = turn(apply(o, (x - 0.5) * W, (y - 0.5) * H), angle)
        return { x: u / fw + 0.5, y: v / fh + 0.5 }
      }
      const rect: Rect = fromPoints(toFrame(l, t), toFrame(r, b))
      // The aspect is left unlocked, so the crop keeps Lightroom's exact shape; the menu shows the nearest named one.
      const named = setLocked({ ...g, crop: rect, angle }, true, fw, fh)
      g = { ...g, crop: rect, angle, aspect: named.aspect, custom: named.custom, locked: false }
    }
  }
  let rerun = false
  if (changed.includes('transform')) {
    const mode = UPRIGHT_FROM_CODE[s.upright] ?? 'off'
    const before: TransformSettings = { ...DEFAULT_TRANSFORM, ...g.transform }
    const [v, h, rot, scale, aspect, x, y] = s.sliders
    let next: TransformSettings = {
      ...before,
      vertical: clamp(-v + 0, -100, 100),
      horizontal: clamp(-h + 0, -100, 100),
      rotate: clamp(rot, -10, 10),
      scale: clamp(scale, SCALE_RANGE[0], SCALE_RANGE[1]),
      aspect: clamp(-aspect + 0, -100, 100),
      offsetX: clamp(x, -100, 100),
      offsetY: clamp(y, -100, 100),
    }
    if (mode !== before.upright) {
      // A new mode: LightBench solves it again on the photo (Guided: Lightroom's lines can't be read).
      next = { ...next, upright: mode, solved: ZERO_PERSPECTIVE, guides: [], lightroom: mode === 'off' ? undefined : mode }
      rerun = mode !== 'off' && mode !== 'guided'
    }
    const nt = normalizeTransform(next)
    const { transform: _old, ...rest } = g
    void _old
    g = nt ? { ...rest, transform: nt } : rest
  }
  const detail = changed.includes('detail') && s.detail ? detailFromLr(s.detail) : undefined
  const hsl = changed.includes('hsl') && s.hsl ? s.hsl : undefined
  const grade = changed.includes('grade') && s.grade ? s.grade : undefined
  return { geometry: g, changed, rerun, ...(detail ? { detail } : {}), ...(hsl ? { hsl } : {}), ...(grade ? { grade } : {}) }
}

/** Whether Lightroom's fields would change LightBench's geometry, Detail settings, Colour Mixer or Colour Grading. */
export const lrDiffers = (current: GeometrySettings, s: LrState, frame: LrFrame, detail?: DetailSettings, mixer?: ColourMixerSettings, grading?: ColourGradingSettings) =>
  !sameState(toLightroom(current, frame, detail, mixer, grading), s)

// ---- writing

/** The geometry of develop settings saved as JSON (none for missing or damaged settings). */
export function geometryOf(develop: string | null | undefined): GeometrySettings {
  try {
    if (develop) return normalizeGeometry((JSON.parse(develop) as { geometry?: Partial<GeometrySettings> }).geometry)
  } catch {
    // damaged settings: no geometry
  }
  return normalizeGeometry(null)
}

export interface LrWritePlan {
  /** The groups to write, with LightBench's values (`state`). */
  groups: LrGroup[]
  state: LrState
  /**
   * The marker to store (lightbench:LightroomGeometry): set when LightBench and Lightroom's fields agree after the
   * write, so a later import or check can tell Lightroom's own later changes from LightBench's. Undefined: leave it.
   */
  marker?: string
  /**
   * The Detail fields to write (indices into LR_DETAIL_FIELDS): only those LightBench changed, so turning on noise
   * reduction in LightBench never resets Lightroom's sharpening it didn't touch.
   */
  detailFields?: number[]
  /** The same for the Colour Mixer's fields (indices into LR_HSL_FIELDS). */
  hslFields?: number[]
  /** The same for Colour Grading's fields (indices into LR_GRADE_FIELDS). */
  gradeFields?: number[]
}

/**
 * Which of Lightroom's geometry fields LightBench writes into an existing sidecar.
 *
 * Only into a sidecar that already has Lightroom or Camera Raw settings (crs:ProcessVersion): a sidecar with a few
 * crs: fields and no process version might make Lightroom treat the photo as having settings of its oldest process
 * (not checked; LightBench doesn't decide Lightroom's process version), and nothing is written into an
 * already-applied (rendered) file's settings. A group is written only when LightBench's geometry differs from what
 * the fields say, and LightBench itself changed it since this file was last written: the file's own
 * lightbench:Develop (none when it has no LightBench settings yet) shows a different geometry, or the fields no longer
 * match the marker (the user chose Ignore after Lightroom changed them). So opening a Lightroom-cropped photo never
 * rewrites the crop (not even before LightBench has read it, or when reading it failed), and an edit made before this
 * version, where LightBench didn't read Lightroom's crop, is only written once its geometry is changed in LightBench.
 */
export function planLightroomWrite(
  file: LrRead | undefined,
  fileDevelop: GeometrySettings | null,
  ours: GeometrySettings,
  frame: LrFrame,
  fileDetail?: DetailSettings,
  oursDetail?: DetailSettings,
  fileMixer?: ColourMixerSettings,
  oursMixer?: ColourMixerSettings,
  fileGrading?: ColourGradingSettings,
  oursGrading?: ColourGradingSettings,
): LrWritePlan {
  const state = toLightroom(ours, frame, oursDetail, oursMixer, oursGrading)
  if (!file || !file.processVersion || file.applied) return { groups: [], state }
  const theirs = lrState(file.fields, frame)
  // What LightBench's geometry was when this file was last written (or read): its own settings in the file, none if
  // it has none yet.
  const before = toLightroom(fileDevelop ?? normalizeGeometry(null), frame, fileDevelop ? fileDetail : undefined, fileDevelop ? fileMixer : undefined, fileDevelop ? fileGrading : undefined)
  const marker = parseLrKey(file.marker)
  const groups = LR_GROUPS.filter((g) => !sameGroup(state, theirs, g) && (!sameGroup(state, before, g) || (!!marker && !sameGroup(marker, theirs, g))))
  // Detail, field by field: those LightBench changed (or all, after Ignore), where they differ from the file's.
  const ignored = !!marker && !sameGroup(marker, theirs, 'detail')
  const od = state.detail!
  const detailFields = groups.includes('detail') && theirs.detail
    ? od.map((_, i) => i).filter((i) => Math.abs(od[i] - theirs.detail![i]) > 0.05 && (ignored || Math.abs(od[i] - before.detail![i]) > 0.05))
    : []
  if (groups.includes('detail') && !detailFields.length) groups.splice(groups.indexOf('detail'), 1)
  // The Colour Mixer, field by field the same way. A sidecar without any of its fields is left without them.
  const hslIgnored = !!marker && !sameGroup(marker, theirs, 'hsl')
  const oh = state.hsl!
  const hslFields = groups.includes('hsl') && theirs.hsl
    ? oh.map((_, i) => i).filter((i) => Math.abs(oh[i] - theirs.hsl![i]) > 0.05 && (hslIgnored || Math.abs(oh[i] - before.hsl![i]) > 0.05))
    : []
  if (groups.includes('hsl') && !hslFields.length) groups.splice(groups.indexOf('hsl'), 1)
  // Colour Grading, field by field the same way (a hue counts with its saturation: a changed saturation writes its hue
  // too). A sidecar without any of its fields is left without them. A sidecar with Split Toning but no ColorGradeBlending
  // (read as 100) gets ColorGradeBlending written with the first change, so the file keeps saying what LightBench read.
  const gradeIgnored = !!marker && !sameGroup(marker, theirs, 'grade')
  const og = state.grade!
  const bg = before.grade!
  const tg = theirs.grade
  const isHue = (i: number) => i < 12 && i % 3 === 0
  const changedHere = (x: number[], y: number[], i: number) => gradeFieldDiffers(x, y, i) || (isHue(i) && gradeFieldDiffers(x, y, i + 1) && Math.abs(x[i + 1]) >= 0.5)
  const gradeFields = groups.includes('grade') && tg
    ? og.map((_, i) => i).filter((i) => changedHere(og, tg, i) && (gradeIgnored || changedHere(og, bg, i)))
    : []
  if (gradeFields.length && file.fields.grade?.[LR_BLENDING] === undefined && !gradeFields.includes(LR_BLENDING)) gradeFields.push(LR_BLENDING)
  if (groups.includes('grade') && !gradeFields.length) groups.splice(groups.indexOf('grade'), 1)
  const after: LrState = {
    orientation: groups.includes('orientation') ? state.orientation : theirs.orientation,
    crop: groups.includes('crop') ? state.crop : theirs.crop,
    upright: groups.includes('transform') ? state.upright : theirs.upright,
    sliders: groups.includes('transform') ? state.sliders : theirs.sliders,
    detail: groups.includes('detail') && theirs.detail ? theirs.detail.map((v, i) => (detailFields.includes(i) ? od[i] : v)) : theirs.detail,
    hsl: groups.includes('hsl') && theirs.hsl ? theirs.hsl.map((v, i) => (hslFields.includes(i) ? oh[i] : v)) : theirs.hsl,
    grade: groups.includes('grade') && tg ? tg.map((v, i) => (gradeFields.includes(i) ? og[i] : v)) : tg,
  }
  return {
    groups,
    state,
    marker: sameState(after, state) ? lrKey(after) : undefined,
    ...(detailFields.length ? { detailFields } : {}),
    ...(hslFields.length ? { hslFields } : {}),
    ...(gradeFields.length ? { gradeFields } : {}),
  }
}

/** The values written for a group, as Lightroom-style text (tiff:Orientation is in the TIFF namespace). */
export function lrValues(s: LrState, g: LrGroup, detailFields?: number[], hslFields?: number[], gradeFields?: number[]): [ns: string, local: string, value: string][] {
  const num = (v: number, digits: number) => String(round(v, digits))
  if (g === 'orientation') return [[NS_TIFF, 'Orientation', String(s.orientation)]]
  if (g === 'grade') {
    const v = s.grade ?? gradingToLr(undefined)
    // Integers; Luminance and Balance with a sign ("+13"), as the HSL fields (not checked against a file Lightroom wrote).
    const all = LR_GRADE_FIELDS.map((name, i): [string, string, string] => {
      const n = Math.round(v[i]) + 0
      return [NS_CRS, name, LR_GRADE_SIGNED.has(i) && n > 0 ? `+${n}` : String(n)]
    })
    return gradeFields ? all.filter((_, i) => gradeFields.includes(i)) : all
  }
  if (g === 'hsl') {
    const h = s.hsl ?? mixerToLr(undefined)
    // Integers, positive ones with a sign ("+13", as LightCraft's test sidecar writes them; not checked against Lightroom).
    const all = LR_HSL_FIELDS.map((name, i): [string, string, string] => [NS_CRS, name, h[i] > 0 ? `+${Math.round(h[i])}` : String(Math.round(h[i]) + 0)])
    return hslFields ? all.filter((_, i) => hslFields.includes(i)) : all
  }
  if (g === 'detail') {
    const d = s.detail ?? detailToLr(undefined)
    // Lightroom writes the radius with a sign and one decimal ("+1.0", as ExifTool shows it; not checked against a file
    // Lightroom wrote here), the others as integers.
    const all = LR_DETAIL_FIELDS.map(([, name], i): [string, string, string] => [NS_CRS, name, i === 1 ? `+${d[i].toFixed(1)}` : String(Math.round(d[i]))])
    return detailFields ? all.filter((_, i) => detailFields.includes(i)) : all
  }
  if (g === 'crop') {
    const c = s.crop ?? [0, 0, 1, 1, 0]
    return [
      [NS_CRS, 'CropTop', c[1].toFixed(6)],
      [NS_CRS, 'CropLeft', c[0].toFixed(6)],
      [NS_CRS, 'CropBottom', c[3].toFixed(6)],
      [NS_CRS, 'CropRight', c[2].toFixed(6)],
      [NS_CRS, 'CropAngle', num(c[4], 6)],
      [NS_CRS, 'HasCrop', s.crop ? 'True' : 'False'],
    ]
  }
  const [v, h, rot, scale, aspect, x, y] = s.sliders
  return [
    [NS_CRS, 'PerspectiveUpright', String(s.upright)],
    [NS_CRS, 'PerspectiveVertical', num(v, 0)],
    [NS_CRS, 'PerspectiveHorizontal', num(h, 0)],
    [NS_CRS, 'PerspectiveRotate', rot.toFixed(1)],
    [NS_CRS, 'PerspectiveScale', num(scale, 0)],
    [NS_CRS, 'PerspectiveAspect', num(aspect, 0)],
    [NS_CRS, 'PerspectiveX', x.toFixed(1)],
    [NS_CRS, 'PerspectiveY', y.toFixed(1)],
  ]
}

/** The note shown in the Transform section for an Upright read from Lightroom (null when there is none). */
export function lightroomNote(t: TransformSettings | undefined): string | null {
  if (!t?.lightroom || t.lightroom !== t.upright) return null
  if (t.lightroom === 'guided') return 'Lightroom’s Guided Upright wasn’t imported: its guide lines can’t be read. Draw guides here to correct the photo.'
  const name = t.lightroom[0].toUpperCase() + t.lightroom.slice(1)
  return `Upright ${name} came from Lightroom’s settings. LightBench ran its own Upright, so the result may differ slightly from Lightroom’s.`
}
