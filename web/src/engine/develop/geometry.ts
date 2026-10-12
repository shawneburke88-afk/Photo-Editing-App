// The geometry stage: crop, straighten, rotate 90° and flip, applied together as ONE resample.
//
// Order (darktable's pixelpipe order, src/common/iop_order.c, v5.0: lens 13 → ashift 15 → flip 16 → crop 24.5):
//   lens correction → rotate and perspective (Transform/Upright, straighten) → flip (camera orientation, the user's
//   rotate 90° and flips) → crop.
// Lens correction (engine/lens, `withLens`) and the perspective (Transform/Upright, upright.ts) included, all of them are combined into
// one map from an output pixel back to a sensor position (`resolveGeometry`), so a photo is resampled once
// whatever tools are used, never once per tool. darktable's own modules each resample (each calls
// `dt_interpolation_new(DT_INTERPOLATION_USERPREF_WARP)`); combining them is LightBench's choice.
//
// Coordinates (the convention later tools keep): the crop is stored normalised (0…1) in the "straightened
// frame": the photo after every geometry correction except the crop — after lens correction, perspective and
// straightening, in the final orientation, with the same width and height as the oriented photo. Crop
// coordinates (and later mask coordinates) therefore stay on the same content when lens or Upright settings
// change. Rotating 90° or flipping moves the crop with the photo (`rotate90`, `flip`).
//
// Resampling: when the map is a whole-pixel one (no straighten angle, no perspective and no lens correction), the
// pixels are copied exactly and nothing is resampled. Otherwise the engine warps the photo once with bicubic
// (Catmull-Rom) interpolation, darktable's default for warps (`plugins/lighttable/export/pixel_interpolator_warp`
// = bicubic in data/darktableconfig.xml.in; DT_INTERPOLATION_DEFAULT_WARP = BICUBIC in src/common/interpolation.h;
// its kernel `_maketaps_bicubic` is the a = −0.5 cubic), and caches the result.

import type { Mat3 } from '../color/matrix'
import type { LensWarp } from '../lens/correction'
import { constrained, cropFitAngle, fitAbout, fromCenter, rectCenter, rectHeight, rectWidth, scaleRect, UNIT_RECT, withAngle, type CropGeometry, type Rect } from './crop'
import { isIdentityTransform, normalizeTransform, perspectiveMap, transformKey, turnTransform, type Orient, type TransformSettings } from './upright'

export type AspectId = 'original' | '1:1' | '4:5' | '5:7' | '2:3' | '16:9' | 'custom'

/** The aspect menu (owner's list, 2026-10-12), as width : height of the landscape shape. */
export const ASPECTS: { id: AspectId; label: string; ratio?: [number, number] }[] = [
  { id: 'original', label: 'Original' },
  { id: '1:1', label: '1 : 1', ratio: [1, 1] },
  { id: '4:5', label: '4 : 5', ratio: [5, 4] },
  { id: '5:7', label: '5 : 7', ratio: [7, 5] },
  { id: '2:3', label: '2 : 3', ratio: [3, 2] },
  { id: '16:9', label: '16 : 9', ratio: [16, 9] },
  { id: 'custom', label: 'Custom' },
]

export interface GeometrySettings {
  /** Quarter turns clockwise added by the user (Rotate right/left), on top of the camera's orientation. */
  turns: 0 | 1 | 2 | 3
  /** Mirrored left-right after the turns (Flip horizontal; Flip vertical is a mirror plus two turns). */
  mirror: boolean
  /** Straighten angle in degrees, clockwise positive as seen on screen, −45…45. */
  angle: number
  /** Crop rectangle, normalised to the straightened frame (see the coordinates note above). */
  crop: Rect
  /** Aspect chosen in the crop tool. The shape (portrait or landscape) follows the crop itself. */
  aspect: AspectId
  /** Custom aspect, width : height. */
  custom: [number, number]
  /** Aspect locked: dragging keeps the crop's shape. */
  locked: boolean
  /** Transform and Upright (perspective), applied before straightening (upright.ts). Absent: none. */
  transform?: TransformSettings
}

/** Defaults: no crop; the aspect starts locked to the photo's own (LightBench's choice; Lightroom's default not checked). */
export const DEFAULT_GEOMETRY: GeometrySettings = { turns: 0, mirror: false, angle: 0, crop: UNIT_RECT, aspect: 'original', custom: [3, 2], locked: true }

export const MAX_ANGLE = 45

const finite = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** Fills in and checks stored geometry (old edits have none: no crop, no rotation). */
export function normalizeGeometry(g: Partial<GeometrySettings> | null | undefined): GeometrySettings {
  if (!g || typeof g !== 'object') return DEFAULT_GEOMETRY
  const d = DEFAULT_GEOMETRY
  const c = (g.crop ?? d.crop) as Partial<Rect>
  const crop = { x0: finite(c.x0, 0), y0: finite(c.y0, 0), x1: finite(c.x1, 1), y1: finite(c.y1, 1) }
  const ok = crop.x1 > crop.x0 && crop.y1 > crop.y0
  const custom = Array.isArray(g.custom) && g.custom.length === 2 && g.custom.every((v) => typeof v === 'number' && v > 0 && Number.isFinite(v)) ? (g.custom as [number, number]) : d.custom
  return {
    turns: ([0, 1, 2, 3] as const).includes(g.turns as 0) ? (g.turns as GeometrySettings['turns']) : 0,
    mirror: g.mirror === true,
    angle: Math.min(MAX_ANGLE, Math.max(-MAX_ANGLE, finite(g.angle, 0))),
    crop: ok ? crop : UNIT_RECT,
    aspect: ASPECTS.some((a) => a.id === g.aspect) ? (g.aspect as AspectId) : d.aspect,
    custom,
    locked: typeof g.locked === 'boolean' ? g.locked : d.locked,
    ...withTransform(normalizeTransform(g.transform)),
  }
}

/** The transform as an optional field: left out entirely when there is none, so old edits stay as they were. */
const withTransform = (t: TransformSettings | undefined) => (t ? { transform: t } : {})

/** True when the geometry changes nothing (old edits, and every photo not cropped, turned or flipped). */
export const isIdentityGeometry = (g: GeometrySettings) =>
  g.turns === 0 && !g.mirror && g.angle === 0 && g.crop.x0 === 0 && g.crop.y0 === 0 && g.crop.x1 === 1 && g.crop.y1 === 1 && isIdentityTransform(g.transform)

/** The parts that change pixels (the aspect choice and lock are tool state). */
export const sameGeometry = (a: GeometrySettings, b: GeometrySettings) =>
  a.turns === b.turns && a.mirror === b.mirror && a.angle === b.angle &&
  a.crop.x0 === b.crop.x0 && a.crop.y0 === b.crop.y0 && a.crop.x1 === b.crop.x1 && a.crop.y1 === b.crop.y1 &&
  transformKey(a.transform) === transformKey(b.transform)

// ---- orientation: the camera's orientation and the user's turns and flips, as one of the 8 symmetries of a
// rectangle. A 2×2 integer matrix acting on coordinates centred on the image (y down); R turns clockwise.

type M2 = [number, number, number, number]
const R90: M2 = [0, -1, 1, 0]
const MIRROR: M2 = [-1, 0, 0, 1]
const I2: M2 = [1, 0, 0, 1]
const mul2 = (a: M2, b: M2): M2 => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]]
const pow2 = (m: M2, n: number): M2 => (n <= 0 ? I2 : mul2(m, pow2(m, n - 1)))
const same2 = (a: M2, b: M2) => a.every((v, i) => v === b[i])

/** Turn `turns` quarter turns clockwise, then mirror if asked. */
const orientMatrix = (turns: number, mirror: boolean): M2 => mul2(mirror ? MIRROR : I2, pow2(R90, turns))

function fromMatrix(m: M2): { turns: GeometrySettings['turns']; mirror: boolean } {
  for (const mirror of [false, true]) {
    for (const turns of [0, 1, 2, 3] as const) if (same2(orientMatrix(turns, mirror), m)) return { turns, mirror }
  }
  return { turns: 0, mirror: false }
}

/** LibRaw's `flip` (the camera's orientation) as quarter turns clockwise: 0 none, 3 half turn, 5 left, 6 right. */
export const EXIF_TURNS: Record<number, number> = { 0: 0, 3: 2, 5: 3, 6: 1 }

/** The full orientation: the camera's, then the user's. */
const totalOrientation = (g: GeometrySettings, exifFlip: number) => mul2(orientMatrix(g.turns, g.mirror), orientMatrix(EXIF_TURNS[exifFlip] ?? 0, false))

/** The full orientation as a 2×2 matrix from sensor to screen coordinates (for Upright). */
export const orientationOf = (g: GeometrySettings, exifFlip: number): Orient => totalOrientation(g, exifFlip)

/** Size of the straightened frame (the oriented photo) for a sensor of sw × sh. */
export function frameSize(g: GeometrySettings, sw: number, sh: number, exifFlip: number): [number, number] {
  const m = totalOrientation(g, exifFlip)
  return m[0] === 0 ? [sh, sw] : [sw, sh]
}

// ---- edits (the crop moves with the photo)

/** Turns the photo a quarter turn clockwise (dir 1) or anticlockwise (dir −1); the crop turns with it. */
export function rotate90(g: GeometrySettings, dir: 1 | -1): GeometrySettings {
  const { turns, mirror } = fromMatrix(mul2(dir === 1 ? R90 : pow2(R90, 3), orientMatrix(g.turns, g.mirror)))
  const c = g.crop
  const crop = dir === 1 ? { x0: 1 - c.y1, y0: c.x0, x1: 1 - c.y0, y1: c.x1 } : { x0: c.y0, y0: 1 - c.x1, x1: c.y1, y1: 1 - c.x0 }
  return { ...g, turns, mirror, crop, ...withTransform(turnTransform(g.transform, dir === 1 ? R90 : pow2(R90, 3))) }
}

/** Flips the photo left-right ('h') or top-bottom ('v'); the crop and the straighten angle are mirrored with it. */
export function flip(g: GeometrySettings, axis: 'h' | 'v'): GeometrySettings {
  const m: M2 = axis === 'h' ? MIRROR : [1, 0, 0, -1]
  const { turns, mirror } = fromMatrix(mul2(m, orientMatrix(g.turns, g.mirror)))
  const c = g.crop
  const crop = axis === 'h' ? { ...c, x0: 1 - c.x1, x1: 1 - c.x0 } : { ...c, y0: 1 - c.y1, y1: 1 - c.y0 }
  return { ...g, turns, mirror, crop, angle: g.angle === 0 ? 0 : -g.angle, ...withTransform(turnTransform(g.transform, m)) }
}

/** Sets the user's orientation (Paste), turning and flipping step by step so the crop follows the photo. */
export function withOrientation(g: GeometrySettings, turns: GeometrySettings['turns'], mirror: boolean): GeometrySettings {
  let out = g
  if (out.mirror !== mirror) out = flip(out, 'h')
  for (let i = 0; i < 4 && out.turns !== turns; i++) out = rotate90(out, 1)
  return out
}

const cropOf = (g: GeometrySettings): CropGeometry => ({ rect: g.crop, angle: g.angle })
const withCrop = (g: GeometrySettings, c: CropGeometry): GeometrySettings => ({ ...g, crop: c.rect, angle: c.angle })

/** The straighten angle changed: the crop is kept when it still fits, else shrunk about its centre (crop.ts `withAngle`). */
export function setAngle(g: GeometrySettings, angle: number, fw: number, fh: number): GeometrySettings {
  const a = Math.round(Math.min(MAX_ANGLE, Math.max(-MAX_ANGLE, angle)) * 100) / 100
  return withCrop(g, withAngle(cropOf(g), a, fw, fh))
}

/**
 * The angle that levels a line drawn on the photo (from `a` to `b`, in straightened-frame pixels, as seen):
 * nearly horizontal lines become horizontal, nearly vertical ones vertical (Lightroom's Straighten tool).
 * Null for a line too short to tell.
 */
export function levelAngle(current: number, a: { x: number; y: number }, b: { x: number; y: number }): number | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.hypot(dx, dy) < 1e-9) return null
  let tilt = (Math.atan2(dy, dx) * 180) / Math.PI
  // Fold to −90…90 (the direction of drawing doesn't matter), then to the nearest of horizontal or vertical.
  if (tilt > 90) tilt -= 180
  if (tilt < -90) tilt += 180
  if (tilt > 45) tilt -= 90
  else if (tilt < -45) tilt += 90
  const next = current - tilt
  return Math.abs(next) <= MAX_ANGLE + 1e-9 ? Math.round(next * 100) / 100 : null
}

/** The locked width/height ratio in pixels (null when the aspect is free), in the crop's current shape. */
export function lockedRatio(g: GeometrySettings, fw: number, fh: number): number | null {
  if (!g.locked) return null
  const pair = g.aspect === 'original' ? [fw, fh] : g.aspect === 'custom' ? g.custom : ASPECTS.find((a) => a.id === g.aspect)?.ratio ?? [fw, fh]
  const long = Math.max(pair[0], pair[1])
  const short = Math.min(pair[0], pair[1])
  const wpx = rectWidth(g.crop) * fw
  const hpx = rectHeight(g.crop) * fh
  return wpx >= hpx ? long / short : short / long
}

/** Picks an aspect (and locks it): the largest crop of that shape that fits, centred where the crop was. */
export function setAspect(g: GeometrySettings, aspect: AspectId, fw: number, fh: number, custom?: [number, number]): GeometrySettings {
  const next = { ...g, aspect, custom: custom ?? g.custom, locked: true }
  return refit(next, lockedRatio(next, fw, fh)!, fw, fh)
}

/** The largest crop of ratio `r` at the current angle, moved to the current crop's centre (as far as it fits). */
function refit(g: GeometrySettings, r: number, fw: number, fh: number): GeometrySettings {
  const best = cropFitAngle(fw, fh, g.angle, r)
  const c = rectCenter(g.crop)
  const moved = { rect: fromCenter(c, rectWidth(best.rect), rectHeight(best.rect)), angle: g.angle }
  return withCrop(g, constrained(moved, fw, fh))
}

/** Locks or unlocks the aspect. Locking keeps the crop's current shape (as Custom, unless it is one of the menu's). */
export function setLocked(g: GeometrySettings, locked: boolean, fw: number, fh: number): GeometrySettings {
  if (!locked) return { ...g, locked }
  const w = rectWidth(g.crop) * fw
  const h = rectHeight(g.crop) * fh
  const r = Math.max(w, h) / Math.min(w, h)
  const close = (x: number) => Math.abs(x / r - 1) < 0.005
  const preset = ASPECTS.find((a) => (a.id === 'original' ? close(Math.max(fw, fh) / Math.min(fw, fh)) : a.ratio && close(a.ratio[0] / a.ratio[1])))
  if (preset) return { ...g, locked, aspect: preset.id }
  const k = 1000 / Math.min(w, h)
  return { ...g, locked, aspect: 'custom', custom: [Math.round(Math.max(w, h) * k) / 1000, 1] }
}

/** X: portrait ⇄ landscape about the crop's centre, shrunk to fit if needed. */
export function swapAspect(g: GeometrySettings, fw: number, fh: number): GeometrySettings {
  const c = rectCenter(g.crop)
  const wpx = rectWidth(g.crop) * fw
  const hpx = rectHeight(g.crop) * fh
  const swapped = { rect: fromCenter(c, hpx / fw, wpx / fh), angle: g.angle }
  const fitted = fitAbout(swapped, fw, fh) ?? constrained(swapped, fw, fh)
  return withCrop(g, constrained(fitted, fw, fh))
}

/** Crop changed by another photo's settings (Paste): its rectangle, kept to a locked aspect on this photo's shape. */
export function pasteCrop(target: GeometrySettings, source: GeometrySettings, fw?: number, fh?: number): GeometrySettings {
  let out: GeometrySettings = { ...target, crop: source.crop, aspect: source.aspect, custom: source.custom, locked: source.locked }
  if (!fw || !fh) return out
  // A locked aspect (e.g. 1:1) stays that shape on a photo of other proportions: the largest rectangle of the
  // ratio inside the pasted one, about its centre (LightBench's choice). A free crop is copied proportionally.
  const r = lockedRatio(out, fw, fh)
  if (r) {
    const px = scaleRect(out.crop, fw, fh)
    const w = rectWidth(px)
    const h = rectHeight(px)
    const [nw, nh] = w / h > r ? [h * r, h] : [w, w / r]
    out = { ...out, crop: scaleRect(fromCenter(rectCenter(px), nw, nh), 1 / fw, 1 / fh) }
  }
  const fitted = fitAbout(cropOf(out), fw, fh) ?? constrained(cropOf(out), fw, fh)
  return withCrop(out, constrained(fitted, fw, fh))
}

/** Puts a crop back inside the photo at its angle (after Paste of the angle alone, or of a crop without a size). */
export const fitGeometry = (g: GeometrySettings, fw: number, fh: number) => setAngle(g, g.angle, fw, fh)

// ---- the map used for rendering

/** Row-major 3×3, acting on column vectors (x, y, 1); projective so that perspective can join later. */
const mat3 = (m: number[]): Mat3 => m as Mat3
const mul3 = (a: Mat3, b: Mat3): Mat3 => {
  const o = new Array<number>(9).fill(0)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]
  return mat3(o)
}
const translate = (x: number, y: number) => mat3([1, 0, x, 0, 1, y, 0, 0, 1])
const scale = (x: number, y: number) => mat3([x, 0, 0, 0, y, 0, 0, 0, 1])
const linear = (m: M2) => mat3([m[0], m[1], 0, m[2], m[3], 0, 0, 0, 1])
const transpose2 = (m: M2): M2 => [m[0], m[2], m[1], m[3]]
function rotation(deg: number): Mat3 {
  const a = (deg * Math.PI) / 180
  return mat3([Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1])
}

/** Applies a 3×3 map to a point. */
export function applyMap(m: Mat3, x: number, y: number): [number, number] {
  const w = m[6] * x + m[7] * y + m[8]
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]
}

export const IDENTITY_MAP: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export interface ResolvedGeometry {
  /** Straightened frame (the oriented photo) in pixels. */
  frame: [number, number]
  /** Output size in pixels (the crop, rounded inwards to whole pixels). */
  size: [number, number]
  /** Crop in frame pixels (whole numbers). */
  cropPx: Rect
  /** Output pixel position → sensor pixel position (continuous coordinates, pixel i covers [i, i+1)). */
  toSensor: Mat3
  /** The same map from output uv (0…1) to sensor uv. */
  uvToSensor: Mat3
  /** True when the map copies whole pixels (no resampling needed). */
  exact: boolean
  /** Identifies the map, for caching a warped image. */
  key: string
  /**
   * Lens correction (Part 2, `withLens`): when set, `toSensor` ends in the corrected image (sensor orientation,
   * the sensor's size) and this function takes that position to the sensor; `uvToSensor` ignores it.
   */
  lens?: LensWarp
}

/**
 * Resolves the geometry for a sensor image of sw × sh with the camera orientation `exifFlip` (LibRaw codes).
 * With `whole`, the crop is ignored and the whole straightened frame is shown (the crop tool's view).
 */
export function resolveGeometry(g: GeometrySettings, sw: number, sh: number, exifFlip: number, whole = false): ResolvedGeometry {
  const A = totalOrientation(g, exifFlip)
  const [fw, fh] = A[0] === 0 ? [sh, sw] : [sw, sh]
  const det = A[0] * A[3] - A[1] * A[2]
  // A crop outside the turned photo (e.g. pasted where the photo's size wasn't known) is pulled inside first, so no
  // pixel is ever read from outside the photo. Inward rounding then keeps a turned crop strictly inside the photo
  // (and a full crop exactly the photo).
  const c = whole ? UNIT_RECT : withAngle({ rect: g.crop, angle: g.angle }, g.angle, fw, fh).rect
  let x0 = Math.min(fw - 1, Math.max(0, Math.ceil(c.x0 * fw - 1e-6)))
  let y0 = Math.min(fh - 1, Math.max(0, Math.ceil(c.y0 * fh - 1e-6)))
  let x1 = Math.min(fw, Math.max(x0 + 1, Math.floor(c.x1 * fw + 1e-6)))
  let y1 = Math.min(fh, Math.max(y0 + 1, Math.floor(c.y1 * fh + 1e-6)))
  if (whole) [x0, y0, x1, y1] = [0, 0, fw, fh]
  // A locked aspect gets the whole-pixel size nearest to it inside the rounded crop (a 1:1 crop exports square),
  // centred in it. A crop already of that shape (e.g. no crop at all) is left as it is.
  const ratio = whole ? null : lockedRatio({ ...g, crop: c }, fw, fh)
  if (ratio) {
    const aw = x1 - x0
    const ah = y1 - y0
    let [nw, nh] = [aw, ah]
    if (aw / ah > ratio) nw = Math.max(1, Math.min(aw, Math.round(ah * ratio)))
    else nh = Math.max(1, Math.min(ah, Math.round(aw / ratio)))
    x0 += Math.floor((aw - nw) / 2)
    y0 += Math.floor((ah - nh) / 2)
    x1 = x0 + nw
    y1 = y0 + nh
  }
  const w = x1 - x0
  const h = y1 - y0
  // Straightening is applied before flip, as darktable's rotate-and-perspective (ashift) comes before flip; an
  // angle seen clockwise on screen is anticlockwise on the sensor when the orientation mirrors.
  const sensorAngle = det * g.angle
  // Transform / Upright: a perspective in the sensor's axes, before straightening (upright.ts `perspectiveMap`).
  const perspective = perspectiveMap(g.transform, A, sw, sh) as Mat3 | null
  const exact = g.angle === 0 && !perspective
  let uvToSensor: Mat3
  if (exact) {
    // Built in uv units so a photo without crop gets exactly the orientation map it had before (0, 1 and −1 entries).
    const crop = mul3(translate(x0 / fw, y0 / fh), scale(w / fw, h / fh))
    uvToSensor = mul3(mul3(translate(0.5, 0.5), linear(transpose2(A))), mul3(translate(-0.5, -0.5), crop))
  } else {
    uvToSensor = IDENTITY_MAP // replaced below
  }
  // Output pixel → frame pixel → (inverse flip) sensor-oriented pixel about the centre → (inverse straighten) sensor pixel.
  // The perspective (Upright) comes last in this map; lens correction follows it, outside the 3×3 map (`withLens`).
  const toSensor = mul3(
    mul3(perspective ? mul3(translate(sw / 2, sh / 2), perspective) : translate(sw / 2, sh / 2), rotation(-sensorAngle)),
    mul3(mul3(linear(transpose2(A)), translate(-fw / 2, -fh / 2)), translate(x0, y0)),
  )
  if (!exact) uvToSensor = mul3(mul3(scale(1 / sw, 1 / sh), toSensor), scale(w, h))
  return {
    frame: [fw, fh],
    size: [w, h],
    cropPx: { x0, y0, x1, y1 },
    toSensor,
    uvToSensor,
    exact,
    key: `${sw}x${sh}/${exifFlip}/${g.turns}/${g.mirror}/${g.angle}/${x0},${y0},${x1},${y1}${perspective ? `/t${transformKey(g.transform)}` : ''}`,
  }
}

/**
 * Lens correction joins the map (Phase 3, Part 2; engine/lens/correction.ts): darktable's lens module comes first
 * in the pipe, so in the inverse map (output → sensor) it comes last, after the 3×3 map above, which then ends in
 * the corrected image. The corrected image has the sensor image's size (the automatic scale keeps it filled), so
 * crops stay where they are. Still one resample (engine/gpu/warp.wgsl); the map is no longer whole-pixel.
 */
export function withLens(r: ResolvedGeometry, lens: LensWarp | null, lensKey: string): ResolvedGeometry {
  if (!lens) return r
  return { ...r, exact: false, lens, key: `${r.key}/lens:${lensKey}` }
}

export type { Rect } from './crop'
