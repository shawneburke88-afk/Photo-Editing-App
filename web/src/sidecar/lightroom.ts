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

import { composeOrientation, normalizeGeometry, orientationMatrix, orientationParts, setLocked, withOrientation, type GeometrySettings } from '../engine/develop/geometry'
import { fromPoints, UNIT_RECT, withAngle, type Rect } from '../engine/develop/crop'
import { DEFAULT_TRANSFORM, normalizeTransform, SCALE_RANGE, ZERO_PERSPECTIVE, type Orient, type TransformSettings, type UprightMode } from '../engine/develop/upright'

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
}

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
}

export type LrGroup = 'orientation' | 'crop' | 'transform'
export const LR_GROUPS: LrGroup[] = ['orientation', 'crop', 'transform']

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
  }
}

/** A stable text form, for remembering and comparing (sidecar/changes.ts, the marker). */
export function lrKey(s: LrState): string {
  return JSON.stringify({ o: s.orientation, c: s.crop && s.crop.map((v) => round(v)), u: s.upright, t: s.sliders.map((v) => round(v, 3)) })
}

export function parseLrKey(key: string | null | undefined): LrState | null {
  if (!key) return null
  try {
    const j = JSON.parse(key) as { o: number; c: LrState['crop']; u: number; t: LrState['sliders'] }
    if (typeof j.o !== 'number' || typeof j.u !== 'number' || !Array.isArray(j.t) || j.t.length !== 7) return null
    if (j.c !== null && (!Array.isArray(j.c) || j.c.length !== 5)) return null
    return { orientation: j.o, crop: j.c, upright: j.u, sliders: j.t }
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

/** What Lightroom's fields would be for LightBench's geometry. */
export function toLightroom(g: GeometrySettings, frame: LrFrame): LrState {
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
  }
}

// ---- Lightroom → LightBench

export interface FromLightroom {
  geometry: GeometrySettings
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
export function fromLightroom(current: GeometrySettings, s: LrState, frame: LrFrame): FromLightroom {
  const ours = toLightroom(current, frame)
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
  return { geometry: g, changed, rerun }
}

/** Whether Lightroom's fields would change LightBench's geometry. */
export const lrDiffers = (current: GeometrySettings, s: LrState, frame: LrFrame) => !sameState(toLightroom(current, frame), s)

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
export function planLightroomWrite(file: LrRead | undefined, fileDevelop: GeometrySettings | null, ours: GeometrySettings, frame: LrFrame): LrWritePlan {
  const state = toLightroom(ours, frame)
  if (!file || !file.processVersion || file.applied) return { groups: [], state }
  const theirs = lrState(file.fields, frame)
  // What LightBench's geometry was when this file was last written (or read): its own settings in the file, none if
  // it has none yet.
  const before = toLightroom(fileDevelop ?? normalizeGeometry(null), frame)
  const marker = parseLrKey(file.marker)
  const groups = LR_GROUPS.filter((g) => !sameGroup(state, theirs, g) && (!sameGroup(state, before, g) || (!!marker && !sameGroup(marker, theirs, g))))
  const after: LrState = {
    orientation: groups.includes('orientation') ? state.orientation : theirs.orientation,
    crop: groups.includes('crop') ? state.crop : theirs.crop,
    upright: groups.includes('transform') ? state.upright : theirs.upright,
    sliders: groups.includes('transform') ? state.sliders : theirs.sliders,
  }
  return { groups, state, marker: sameState(after, state) ? lrKey(after) : undefined }
}

/** The values written for a group, as Lightroom-style text (tiff:Orientation is in the TIFF namespace). */
export function lrValues(s: LrState, g: LrGroup): [ns: string, local: string, value: string][] {
  const num = (v: number, digits: number) => String(round(v, digits))
  if (g === 'orientation') return [[NS_TIFF, 'Orientation', String(s.orientation)]]
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
