// Transform and Upright (perspective correction): the settings, the perspective map the geometry stage uses, and
// the Upright modes built on darktable's "rotate and perspective" (ashift.ts, lsd.ts) with LightCraft's guards
// against false corrections.
//
// Guards ported from LightCraft (https://github.com/storytold/lightcraft, commit 701f78e,
// crates/pipeline/src/upright.rs: `Segment`, `vp_error`, `smallest_eigvec`, `refine_vp`, `reliable`,
// `level_angle` and the Auto policy in `solve`), Copyright (c) 2026 ArtCraft Team and the LightCraft
// contributors, licensed under the MIT License or the Apache License 2.0 (used here under the MIT License; see
// THIRD_PARTY_NOTICES.md). Translated from Rust to TypeScript and modified for LightBench (2026): LightCraft's
// gates are applied to the lines darktable's detector and outlier removal kept, and its Auto thresholds to
// darktable's fitted model (the correction's size is measured from ashift's rotation and lens-shift angles,
// LightBench's choice, where LightCraft measures its own camera rotation).
//
// Where the transform sits: lens correction → perspective (this) → straighten → flip → crop, darktable's order
// (ashift after lens). The perspective works on the photo in its sensor orientation, as darktable's ashift does,
// so it stays on the content when the photo is turned or flipped. The settings are stored as seen on screen
// (Vertical means vertical on screen, whatever the camera's orientation) and converted to the sensor's axes when
// rendering (`perspectiveMap`); turning or flipping the photo converts them too (`turnTransform`).
//
// Constrain crop (always on): the corrected photo is fitted so its frame — the size of the photo — holds no empty
// corners. The fit is darktable's automatic crop in "original format" mode (ashift.c `do_crop`, ASHIFT_CROP_ASPECT:
// the largest rectangle of the photo's own shape inside the corrected photo). The crop then lives in that frame.
//
// Line detection input: the photo before the perspective, at most 1600 px on its long edge (LightBench's choice).
// When lens correction exists it must be the lens-corrected photo, as darktable's ashift sees it after `lens`;
// the engine's `analysisImage` is where that happens (see the note there).

import { ashiftHomography, cropFit, DEFAULT_F_LENGTH, drawnLine, FIT, FIT_BOTH_SHEAR, FIT_HORIZONTALLY, FIT_VERTICALLY, halfDiagonal2, imageEdges, LINE, LSD_ANG_TH, LSD_DENSITY_TH, LSD_GAMMA, LSD_LOG_EPS, LSD_N_BINS, LSD_QUANT, LSD_SCALE, LSD_SIGMA_SCALE, mat3inv, mat3mul, mat3mulv, nmsfit, removeOutliers, shiftAngles, classifyLines, type AshiftLens, type AshiftLine, type AshiftParams, type LineSet, type M3, type RawSegment } from './ashift'
import { lineSegmentDetection } from './lsd'

export type UprightMode = 'off' | 'auto' | 'level' | 'vertical' | 'full' | 'guided'

/** A correction in darktable ashift's units, as seen on screen: rotation (degrees, anticlockwise +), lens shifts, shear. */
export interface Perspective {
  rotation: number
  vertical: number
  horizontal: number
  shear: number
}

/** A guide line: x0, y0, x1, y1 normalised (0…1) to the photo as seen before the transform (oriented, uncorrected). */
export type Guide = [number, number, number, number]

export interface TransformSettings {
  /** The Upright mode last applied (pasting re-runs Auto, Level, Vertical and Full on each photo). */
  upright: UprightMode
  /** What Upright solved, stored so every rendering uses exactly this correction without detecting lines again. */
  solved: Perspective
  /** Guided Upright's lines (2–4). */
  guides: Guide[]
  /** Lightroom-style Transform sliders, on top of Upright: −100…100, Rotate −10…10°, Scale 100…150 %. */
  vertical: number
  horizontal: number
  rotate: number
  aspect: number
  scale: number
  offsetX: number
  offsetY: number
  /** 35 mm-equivalent focal length used by darktable's model (from EXIF; 28 mm when unknown, as darktable). */
  focal: number
}

export const ZERO_PERSPECTIVE: Perspective = { rotation: 0, vertical: 0, horizontal: 0, shear: 0 }
export const DEFAULT_TRANSFORM: TransformSettings = {
  upright: 'off',
  solved: ZERO_PERSPECTIVE,
  guides: [],
  vertical: 0,
  horizontal: 0,
  rotate: 0,
  aspect: 0,
  scale: 100,
  offsetX: 0,
  offsetY: 0,
  focal: DEFAULT_F_LENGTH,
}

export const UPRIGHT_MODES: { id: UprightMode; label: string; help: string }[] = [
  { id: 'off', label: 'Off', help: 'No Upright correction' },
  { id: 'auto', label: 'Auto', help: 'Levels the photo and corrects converging verticals, only as far as the lines found agree' },
  { id: 'guided', label: 'Guided', help: 'Draw 2–4 lines along edges that should be vertical or horizontal' },
  { id: 'level', label: 'Level', help: 'Turns the photo so its horizon and walls are level' },
  { id: 'vertical', label: 'Vertical', help: 'Levels and makes converging verticals parallel' },
  { id: 'full', label: 'Full', help: 'Corrects verticals and horizontals' },
]

/** Slider ranges (LightBench's; Lightroom's Rotate and Scale ranges are from general knowledge, not checked). */
export const SLIDER_RANGE = { vertical: 100, horizontal: 100, rotate: 10, aspect: 100, offsetX: 100, offsetY: 100 } as const
export const SCALE_RANGE: [number, number] = [100, 150]
/** Most guides Guided Upright takes (Lightroom's four, as the owner described it). */
export const MAX_GUIDES = 4

const finite = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Fills in and checks stored transform settings; undefined when there is nothing (old edits have none). */
export function normalizeTransform(t: Partial<TransformSettings> | null | undefined): TransformSettings | undefined {
  if (!t || typeof t !== 'object') return undefined
  const d = DEFAULT_TRANSFORM
  const s = (t.solved ?? {}) as Partial<Perspective>
  const guides = Array.isArray(t.guides)
    ? t.guides.filter((g): g is Guide => Array.isArray(g) && g.length === 4 && g.every((v) => typeof v === 'number' && Number.isFinite(v))).slice(0, MAX_GUIDES)
    : []
  const out: TransformSettings = {
    upright: UPRIGHT_MODES.some((m) => m.id === t.upright) ? (t.upright as UprightMode) : 'off',
    solved: {
      rotation: clamp(finite(s.rotation, 0), -180, 180),
      vertical: clamp(finite(s.vertical, 0), -2, 2),
      horizontal: clamp(finite(s.horizontal, 0), -2, 2),
      shear: clamp(finite(s.shear, 0), -0.5, 0.5),
    },
    guides,
    vertical: clamp(finite(t.vertical, 0), -100, 100),
    horizontal: clamp(finite(t.horizontal, 0), -100, 100),
    rotate: clamp(finite(t.rotate, 0), -10, 10),
    aspect: clamp(finite(t.aspect, 0), -100, 100),
    scale: clamp(finite(t.scale, 100), SCALE_RANGE[0], SCALE_RANGE[1]),
    offsetX: clamp(finite(t.offsetX, 0), -100, 100),
    offsetY: clamp(finite(t.offsetY, 0), -100, 100),
    focal: clamp(finite(t.focal, d.focal), 1, 2000),
  }
  return isIdentityTransform(out) && out.upright === 'off' && !out.guides.length ? undefined : out
}

/** True when the transform changes nothing. */
export function isIdentityTransform(t: TransformSettings | undefined): boolean {
  if (!t) return true
  const s = t.solved
  return s.rotation === 0 && s.vertical === 0 && s.horizontal === 0 && s.shear === 0 && t.vertical === 0 && t.horizontal === 0 &&
    t.rotate === 0 && t.aspect === 0 && t.scale === 100 && t.offsetX === 0 && t.offsetY === 0
}

/** The parts that change pixels, as a string (for comparing and for the warp cache). */
export function transformKey(t: TransformSettings | undefined): string {
  if (isIdentityTransform(t)) return ''
  const x = t!
  const s = x.solved
  return [s.rotation, s.vertical, s.horizontal, s.shear, x.vertical, x.horizontal, x.rotate, x.aspect, x.scale, x.offsetX, x.offsetY, x.focal].join(',')
}

// ---- orientation: screen terms ⇄ the sensor's axes

/** The photo's orientation, 2×2 row-major [a0, a1, a2, a3], mapping sensor coordinates to screen coordinates. */
export type Orient = [number, number, number, number]

const sideways = (A: Orient) => A[0] === 0

/** The correction as seen on screen → darktable's parameters in the sensor's axes. */
export function toSensorParams(p: Perspective, A: Orient): AshiftParams {
  const det = A[0] * A[3] - A[1] * A[2]
  const shearSign = A[0] * A[3] + A[1] * A[2]
  // Screen +y is sensor (A[2], A[3]); screen +x is sensor (A[0], A[1]). A positive lens shift narrows the far
  // (positive) end of its axis, so its sign follows the axis.
  return sideways(A)
    ? { rotation: det * p.rotation, lensshiftV: A[1] * p.horizontal, lensshiftH: A[2] * p.vertical, shear: shearSign * p.shear }
    : { rotation: det * p.rotation, lensshiftV: A[3] * p.vertical, lensshiftH: A[0] * p.horizontal, shear: shearSign * p.shear }
}

/** darktable's parameters in the sensor's axes → as seen on screen (the inverse of `toSensorParams`). */
export function toScreenParams(p: AshiftParams, A: Orient): Perspective {
  const det = A[0] * A[3] - A[1] * A[2]
  const shearSign = A[0] * A[3] + A[1] * A[2]
  return sideways(A)
    ? { rotation: det * p.rotation, vertical: A[2] * p.lensshiftH, horizontal: A[1] * p.lensshiftV, shear: shearSign * p.shear }
    : { rotation: det * p.rotation, vertical: A[3] * p.lensshiftV, horizontal: A[0] * p.lensshiftH, shear: shearSign * p.shear }
}

/**
 * The transform after the user turns or flips the photo by `R` (screen' = R · screen): the same correction on the
 * same content. Guides move with the photo like the crop does.
 */
export function turnTransform(t: TransformSettings | undefined, R: Orient): TransformSettings | undefined {
  if (!t) return t
  const I: Orient = [1, 0, 0, 1]
  // Values in R's "sensor" (the screen before the turn) stay; read them back on the new screen.
  const along = (p: Perspective) => toScreenParams(toSensorParams(p, I), R)
  const manual = along({ rotation: t.rotate, vertical: t.vertical / 100, horizontal: t.horizontal / 100, shear: 0 })
  const solved = along(t.solved)
  const sw = sideways(R)
  // Offsets are a direction on screen (X + right, Y + up): turn it with the photo.
  const [ox, oy] = [R[0] * t.offsetX - R[1] * t.offsetY, -(R[2] * t.offsetX - R[3] * t.offsetY)]
  const pt = (x: number, y: number): [number, number] => {
    const cx = x - 0.5
    const cy = y - 0.5
    return [R[0] * cx + R[1] * cy + 0.5, R[2] * cx + R[3] * cy + 0.5]
  }
  // A rotation is clockwise-positive on screen for the slider, anticlockwise-positive for darktable: the sign rule
  // is the same either way.
  return {
    ...t,
    solved,
    rotate: manual.rotation,
    vertical: Math.round(manual.vertical * 100 * 1e6) / 1e6,
    horizontal: Math.round(manual.horizontal * 100 * 1e6) / 1e6,
    aspect: sw ? -t.aspect : t.aspect,
    offsetX: ox,
    offsetY: oy,
    guides: t.guides.map((g) => [...pt(g[0], g[1]), ...pt(g[2], g[3])] as Guide),
  }
}

// ---- the perspective map

/** Upright's result and the Transform sliders together, in darktable's units, as seen on screen. */
function totalScreen(t: TransformSettings): Perspective {
  return {
    // Rotate is clockwise-positive like the Straighten angle; darktable's rotation turns anticlockwise.
    rotation: t.solved.rotation - t.rotate,
    vertical: t.solved.vertical + t.vertical / 100,
    horizontal: t.solved.horizontal + t.horizontal / 100,
    shear: t.solved.shear,
  }
}

const lensOf = (t: TransformSettings, A: Orient): AshiftLens => ({
  fLengthKb: t.focal,
  // darktable's "lens dependence" slider at its default (100 %), used with its "specific" lens model.
  orthocorr: 100,
  aspect: 2 ** ((sideways(A) ? -1 : 1) * (t.aspect / 100)),
})

const fitCache = new Map<string, { center: [number, number]; d2: number } | null>()

/**
 * The perspective as a 3×3 map from a point of the (fitted) frame, centred and in sensor-oriented pixels, to the
 * photo, centred and in sensor pixels; null when there is no transform. `A` is the photo's total orientation.
 */
export function perspectiveMap(t: TransformSettings | undefined, A: Orient, sw: number, sh: number): M3 | null {
  if (!t || isIdentityTransform(t)) return null
  const H = ashiftHomography(toSensorParams(totalScreen(t), A), lensOf(t, A), sw, sh)
  const Hinv = mat3inv(H)
  if (!Hinv) return null
  const key = `${sw}x${sh}/${H.join(',')}`
  let fit = fitCache.get(key)
  if (fit === undefined) {
    fit = cropFit(H, sw, sh)
    if (fitCache.size > 32) fitCache.delete(fitCache.keys().next().value!)
    fitCache.set(key, fit)
  }
  const edges = imageEdges(H, sw, sh)
  const alpha = Math.atan2(sh, sw)
  // When darktable's fit fails, the photo's own centre is used.
  let center: [number, number]
  let d2: number
  if (fit) {
    center = fit.center
    d2 = fit.d2
  } else {
    const c = mat3mulv(H, [sw / 2, sh / 2, 1])
    center = [c[0] / c[2], c[1] / c[2]]
    d2 = halfDiagonal2(center, alpha, edges)
  }
  // Offsets move the frame inside the corrected photo (±100 = a quarter of the photo; LightBench's choice), and the
  // frame shrinks to stay inside; Offset X + moves the photo right, Offset Y + moves it up.
  if (t.offsetX || t.offsetY) {
    const sx = -t.offsetX / 100 * 0.25
    const sy = t.offsetY / 100 * 0.25
    // screen → sensor axes (A is orthogonal: its transpose undoes it), in pixels of the corrected photo
    const dx = (A[0] * sx * (sideways(A) ? sh : sw) + A[2] * sy * (sideways(A) ? sw : sh))
    const dy = (A[1] * sx * (sideways(A) ? sh : sw) + A[3] * sy * (sideways(A) ? sw : sh))
    const minD2 = d2 * 0.01
    let f = 1
    for (let i = 0; i < 30; i++) {
      const c: [number, number] = [center[0] + dx * f, center[1] + dy * f]
      const nd = halfDiagonal2(c, alpha, edges)
      if (nd >= minD2 && insideQuad(c, edges)) {
        center = c
        d2 = nd
        break
      }
      f *= 0.8
    }
  }
  if (!(d2 > 0)) return null
  const diag = Math.hypot(sw, sh)
  const k = (2 * Math.sqrt(d2)) / diag / (t.scale / 100)
  // frame point q → corrected point center + k·q → photo (Hinv) → centred
  return mat3mul(mat3mul([1, 0, -sw / 2, 0, 1, -sh / 2, 0, 0, 1], Hinv), [k, 0, center[0], 0, k, center[1], 0, 0, 1])
}

function insideQuad(p: [number, number], edges: number[][]): boolean {
  const s = edges.map((e) => e[0] * p[0] + e[1] * p[1] + e[2])
  return s.every((v) => v >= 0) || s.every((v) => v <= 0)
}

// ---- line detection

/** What the detector found on a photo, in pixels of the full-size photo in its sensor orientation. */
export interface Detection {
  segments: RawSegment[]
  /** Size of the analysed image and its scale over the full photo. */
  width: number
  height: number
  scale: number
}

/**
 * darktable's `line_detect` before the selection: gamma 0.45 for scene-linear data (darktable applies it to RAW
 * input; LightBench's JPEGs are made scene-linear too, so they get it as well), grey = 0.3 R + 0.59 G + 0.11 B
 * scaled to 0…256, then LSD with darktable's parameters. `rgb` is interleaved RGB (3 floats per pixel).
 */
export function detectSegments(rgb: Float32Array, width: number, height: number): RawSegment[] {
  const grey = new Float64Array(width * height)
  const g = (v: number) => (v > 0 ? Math.pow(v, LSD_GAMMA) : 0)
  for (let i = 0; i < width * height; i++) grey[i] = (0.3 * g(rgb[3 * i]) + 0.59 * g(rgb[3 * i + 1]) + 0.11 * g(rgb[3 * i + 2])) * 256.0
  return lineSegmentDetection(grey, width, height, LSD_SCALE, LSD_SIGMA_SCALE, LSD_QUANT, LSD_ANG_TH, LSD_LOG_EPS, LSD_DENSITY_TH, LSD_N_BINS)
    .map((s) => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, width: s.width, p: s.p }))
}

// ---- LightCraft's guards (upright.rs)

interface Seg {
  a: [number, number]
  b: [number, number]
}
const segLen = (s: Seg) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1])
const segMid = (s: Seg): [number, number] => [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm3 = (a: number[]) => {
  const n = Math.max(Math.hypot(a[0], a[1], a[2]), 1e-300)
  return [a[0] / n, a[1] / n, a[2] / n]
}
function segLine(s: Seg): number[] {
  const l = cross([s.a[0], s.a[1], 1], [s.b[0], s.b[1], 1])
  const n = Math.max(Math.hypot(l[0], l[1]), 1e-12)
  return [l[0] / n, l[1] / n, l[2] / n]
}

/** Angular error (radians) between a segment and the direction from its midpoint to the point `v`. */
function vpError(s: Seg, v: number[]): number {
  const m = segMid(s)
  const dx = v[0] - m[0] * v[2]
  const dy = v[1] - m[1] * v[2]
  const sx = s.b[0] - s.a[0]
  const sy = s.b[1] - s.a[1]
  const d = Math.hypot(dx, dy)
  if (d < 1e-12) return 0
  return Math.acos(Math.min(1, Math.abs((dx * sx + dy * sy) / (d * Math.max(Math.hypot(sx, sy), 1e-12)))))
}

/** Smallest eigenvector of a symmetric 3×3 matrix (Jacobi rotations). */
function smallestEigvec(m: number[][]): number[] {
  const a = m.map((r) => [...r])
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let it = 0; it < 50; it++) {
    let p = 0
    let q = 1
    let big = 0
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (Math.abs(a[i][j]) > big) [big, p, q] = [Math.abs(a[i][j]), i, j]
    if (big < 1e-15) break
    const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
    let t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
    if (theta === 0) t = 1
    const c = 1 / Math.sqrt(t * t + 1)
    const s = t * c
    for (let k = 0; k < 3; k++) {
      const [akp, akq] = [a[k][p], a[k][q]]
      a[k][p] = c * akp - s * akq
      a[k][q] = s * akp + c * akq
    }
    for (let k = 0; k < 3; k++) {
      const [apk, aqk] = [a[p][k], a[q][k]]
      a[p][k] = c * apk - s * aqk
      a[q][k] = s * apk + c * aqk
    }
    for (const row of v) {
      const [vp, vq] = [row[p], row[q]]
      row[p] = c * vp - s * vq
      row[q] = s * vp + c * vq
    }
  }
  let i = 0
  for (let k = 1; k < 3; k++) if (a[k][k] < a[i][i]) i = k
  return norm3([v[0][i], v[1][i], v[2][i]])
}

/** Least-squares vanishing point of segments (weights = lengths). */
function refineVp(segs: Seg[]): number[] {
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (const s of segs) {
    const l = segLine(s)
    const w = segLen(s)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] += w * l[i] * l[j]
  }
  return smallestEigvec(m)
}

/**
 * LightCraft's `reliable`: a family's vanishing point is backed by real structure — at least three inlier
 * segments, a total inlier length of a quarter of the long edge, inliers spread across a fifth of the long edge,
 * 60 % of the family's length agreeing, and a vanishing point well outside the frame (inside or near it, it is a
 * road or sun rays, not camera tilt). Segments are in centred units of half the long edge.
 */
function reliable(segs: Seg[], v: number[], vertical: boolean): boolean {
  const thr = (3 * Math.PI) / 180
  const inl = segs.filter((s) => vpError(s, v) < thr)
  const total = inl.reduce((n, s) => n + segLen(s), 0)
  const across = inl.map((s) => (vertical ? segMid(s)[0] : segMid(s)[1]))
  const spread = across.length ? Math.max(...across) - Math.min(...across) : 0
  const family = segs.reduce((n, s) => n + segLen(s), 0)
  if (Math.abs(v[2]) > 1e-9 && Math.hypot(v[0] / v[2], v[1] / v[2]) < 2) return false
  return inl.length >= 3 && total >= 0.5 && spread >= 0.4 && total >= 0.6 * family
}

/**
 * LightCraft's `level_angle`: the rotation (degrees, clockwise +) that levels the dominant lines, or null when
 * less than half of their length agrees within 2° (then the "lines" are scene texture, not a horizon or walls).
 */
export function levelConsensus(vert: Seg[], horiz: Seg[]): number | null {
  const dev = (s: Seg, vertical: boolean) => {
    const dx = s.b[0] - s.a[0]
    const dy = s.b[1] - s.a[1]
    let a = ((vertical ? Math.atan2(dx, dy) : Math.atan2(dy, dx)) * 180) / Math.PI
    if (a > 90) a -= 180
    else if (a < -90) a += 180
    return vertical ? -a : a
  }
  const lh = horiz.reduce((n, s) => n + segLen(s), 0)
  const lv = vert.reduce((n, s) => n + segLen(s), 0)
  const [set, vertical] = lh >= lv * 0.5 && lh > 0 ? [horiz, false] : [vert, true]
  if (!set.length) return null
  const v = set.map((s) => [dev(s, vertical), segLen(s)]).sort((a, b) => a[0] - b[0])
  const total = v.reduce((n, x) => n + x[1], 0)
  let acc = 0
  const median = v.find((x) => (acc += x[1]) >= total / 2)
  if (!median) return null
  const agree = v.filter((x) => Math.abs(x[0] - median[0]) <= 2).reduce((n, x) => n + x[1], 0)
  return agree >= 0.5 * total ? -median[0] : null
}

// ---- solving

export type SolveResult =
  | { ok: true; solved: Perspective; mode: UprightMode; note?: string; lines: { vertical: number; horizontal: number } }
  | { ok: false; message: string; lines?: { vertical: number; horizontal: number } }

/** The analysed lines (darktable's selection and outlier removal) in sensor pixels, plus screen families. */
interface Analysis {
  set: LineSet
  /** Selected lines that are vertical / horizontal on screen. */
  vertical: AshiftLine[]
  horizontal: AshiftLine[]
}

function analyse(det: Detection, A: Orient, sw: number, sh: number): Analysis {
  const set = removeOutliers(classifyLines(det.segments, det.width, det.height, det.scale), sw, sh)
  const selected = set.lines.filter((l) => (l.type & LINE.RELEVANT) && (l.type & LINE.SELECTED))
  const sensorVert = selected.filter((l) => l.type & LINE.DIRVERT)
  const sensorHor = selected.filter((l) => !(l.type & LINE.DIRVERT))
  return sideways(A) ? { set, vertical: sensorHor, horizontal: sensorVert } : { set, vertical: sensorVert, horizontal: sensorHor }
}

/** Lines in centred units of half the long edge, as seen on screen (LightCraft's coordinates). */
function screenSegs(lines: AshiftLine[], A: Orient, sw: number, sh: number): Seg[] {
  const half = Math.max(sw, sh) / 2
  const map = (p: number[]): [number, number] => {
    const x = p[0] - sw / 2
    const y = p[1] - sh / 2
    return [(A[0] * x + A[1] * y) / half, (A[2] * x + A[3] * y) / half]
  }
  return lines.map((l) => ({ a: map(l.p1), b: map(l.p2) }))
}

/** The correction's size in degrees: darktable's rotation and the tilts its lens shifts stand for, combined. */
export function correctionDegrees(p: AshiftParams, lens: AshiftLens, sw: number, sh: number): number {
  const [av, ah] = shiftAngles(p, lens, sw, sh).map((a) => (a * 180) / Math.PI)
  return Math.hypot(p.rotation, av, ah)
}

const NO_LINES = 'Not enough straight lines were found to correct this photo.'

/**
 * Upright: Level, Vertical, Full or Auto from the detected lines. `A` is the photo's total orientation, `sw × sh`
 * its sensor size, `focal` the 35 mm-equivalent focal length.
 */
export function solveUpright(mode: Exclude<UprightMode, 'off' | 'guided'>, det: Detection, A: Orient, sw: number, sh: number, focal: number): SolveResult {
  const an = analyse(det, A, sw, sh)
  const lines = { vertical: an.vertical.length, horizontal: an.horizontal.length }
  const lens: AshiftLens = { fLengthKb: focal, orthocorr: 100, aspect: 1 }
  const vSegs = screenSegs(an.vertical, A, sw, sh)
  const hSegs = screenSegs(an.horizontal, A, sw, sh)
  const vReliable = vSegs.length >= 2 && reliable(vSegs, refineVp(vSegs), true)
  const hReliable = hSegs.length >= 2 && reliable(hSegs, refineVp(hSegs), false)
  const flipped = sideways(A)
  const fit = (dir: number) => nmsfit(an.set, sw, sh, lens, dir, flipped)
  const done = (p: AshiftParams, m: UprightMode, note?: string): SolveResult => ({ ok: true, solved: toScreenParams(p, A), mode: m, note, lines })
  const failed = (message: string): SolveResult => ({ ok: false, message, lines })
  // Rotation only, from the screen-horizontal lines when there are enough, else from the verticals (both when both).
  const level = (): SolveResult => {
    if (levelConsensus(vSegs, hSegs) === null) return failed(lines.vertical + lines.horizontal < 3 ? NO_LINES : 'The lines found don’t agree on a level, so the photo was left as it is.')
    const hv = an.horizontal.length >= 2
    const vv = an.vertical.length >= 2
    const screenDir = (hv ? FIT.LINES_HOR : 0) | (vv ? FIT.LINES_VERT : 0)
    // rotation-only fits are not swapped by darktable's `isflipped` rule, so swap the line directions here
    const dir = FIT.ROTATION | (flipped ? ((screenDir & FIT.LINES_HOR ? FIT.LINES_VERT : 0) | (screenDir & FIT.LINES_VERT ? FIT.LINES_HOR : 0)) : screenDir)
    const r = fit(dir)
    return r.ok ? done(r.params, 'level') : failed(NO_LINES)
  }
  const vertical = (): SolveResult | null => {
    if (!vReliable) return null
    const r = fit(FIT_VERTICALLY)
    return r.ok ? done(r.params, 'vertical') : null
  }
  const full = (): SolveResult | null => {
    if (!vReliable || !hReliable) return null
    const r = fit(FIT_BOTH_SHEAR)
    return r.ok ? done(r.params, 'full') : null
  }
  if (lines.vertical + lines.horizontal < 2) return failed(NO_LINES)
  const size = (r: SolveResult | null) => (r && r.ok ? correctionDegrees(toSensorParams(r.solved, A), lens, sw, sh) : Infinity)
  switch (mode) {
    case 'level':
      return level()
    case 'vertical':
      return vertical() ?? failed(lines.vertical < 3 ? 'Not enough vertical lines were found to correct this photo.' : 'The vertical lines found don’t meet in one point outside the photo, so they were left alone.')
    case 'full': {
      const f = full()
      if (f) return f
      const v = vertical()
      if (v && v.ok) return { ...v, note: 'Not enough reliable horizontal lines: only the verticals were corrected.' }
      return failed('Not enough reliable vertical and horizontal lines were found to correct this photo.')
    }
    case 'auto': {
      // LightCraft: a roll implied by the verticals must be confirmed by the horizontals (a real roll tilts both).
      let useVerticals = vReliable
      if (vReliable) {
        const v = refineVp(vSegs)
        const [x, y] = v[1] < 0 ? [-v[0], -v[1]] : [v[0], v[1]]
        const roll = (Math.atan2(x, y) * 180) / Math.PI
        const h = levelConsensus([], hSegs)
        if (!(Math.abs(roll) <= 3 || (h !== null && Math.abs(h - roll) <= 3))) useVerticals = false
      }
      // Balanced: full correction only when moderate, else vertical, else only small horizon fixes.
      if (useVerticals) {
        const f = full()
        if (f && size(f) < 20) return { ...f, mode: 'auto' } as SolveResult
        const v = vertical()
        if (v && size(v) < 25) return { ...v, mode: 'auto' } as SolveResult
      }
      const l = level()
      if (l.ok && size(l) <= 5) return { ...l, mode: 'auto' }
      if (!l.ok) return l
      return failed('The lines found suggest a large correction, which is usually intended or scene structure, so Auto left the photo as it is.')
    }
  }
}

/** Guides (normalised to the oriented, uncorrected photo) in sensor pixels. */
export function guidesToSensor(guides: Guide[], A: Orient, sw: number, sh: number): [number, number, number, number][] {
  const [fw, fh] = sideways(A) ? [sh, sw] : [sw, sh]
  const back = (u: number, v: number): [number, number] => {
    const x = u * fw - fw / 2
    const y = v * fh - fh / 2
    // A is orthogonal: its transpose undoes it
    return [A[0] * x + A[2] * y + sw / 2, A[1] * x + A[3] * y + sh / 2]
  }
  return guides.map((g) => [...back(g[0], g[1]), ...back(g[2], g[3])] as [number, number, number, number])
}

/** Sensor pixels → normalised to the oriented, uncorrected photo (the inverse of `guidesToSensor` for a point). */
export function sensorToGuide(x: number, y: number, A: Orient, sw: number, sh: number): [number, number] {
  const [fw, fh] = sideways(A) ? [sh, sw] : [sw, sh]
  const cx = x - sw / 2
  const cy = y - sh / 2
  return [(A[0] * cx + A[1] * cy + fw / 2) / fw, (A[2] * cx + A[3] * cy + fh / 2) / fh]
}

/** Whether a guide is closer to vertical than horizontal on screen. */
export const guideIsVertical = (g: Guide, fw: number, fh: number) => Math.abs((g[2] - g[0]) * fw) <= Math.abs((g[3] - g[1]) * fh)

/**
 * Guided Upright: darktable's drawn-lines fit. Two or more vertical guides fix the verticals (rotation and
 * vertical lens shift), two or more horizontal ones the horizontals; both kinds, everything with shear (darktable's
 * "fit both" button). darktable needs at least two lines in each direction it fits (MINIMUM_FITLINES).
 */
export function solveGuided(guides: Guide[], A: Orient, sw: number, sh: number, focal: number): SolveResult {
  const [fw, fh] = sideways(A) ? [sh, sw] : [sw, sh]
  const usable = guides.filter((g) => Math.hypot((g[2] - g[0]) * fw, (g[3] - g[1]) * fh) > 4)
  const nv = usable.filter((g) => guideIsVertical(g, fw, fh)).length
  const nh = usable.length - nv
  const lines = { vertical: nv, horizontal: nh }
  if (nv < 2 && nh < 2) return { ok: false, message: nv + nh === 0 ? 'Draw a line along an edge that should be vertical or horizontal.' : 'Draw one more line in the same direction.', lines }
  const ls = guidesToSensor(usable, A, sw, sh).map((g) => drawnLine(...g))
  const set: LineSet = {
    lines: ls,
    verticalCount: ls.filter((l) => l.type & LINE.DIRVERT).length,
    horizontalCount: ls.filter((l) => !(l.type & LINE.DIRVERT)).length,
    verticalWeight: 0,
    horizontalWeight: 0,
  }
  const dir = nv >= 2 && nh >= 2 ? FIT_BOTH_SHEAR : nv >= 2 ? FIT_VERTICALLY : FIT_HORIZONTALLY
  const r = nmsfit(set, sw, sh, { fLengthKb: focal, orthocorr: 100, aspect: 1 }, dir, sideways(A))
  if (!r.ok) return { ok: false, message: r.reason === 'not-enough-lines' ? 'Draw one more line in the same direction.' : 'These lines can’t be corrected; try moving them.', lines }
  return { ok: true, solved: toScreenParams(r.params, A), mode: 'guided', lines }
}

/**
 * Auto straighten (the crop tool): the angle that levels the photo as it is seen (after the transform, before
 * straightening), from darktable's rotation-only fit on the detected lines, used only when LightCraft's level
 * consensus agrees. `toFrame` maps a sensor pixel to the frame. Returns the straighten angle (clockwise +) or a
 * message.
 */
export function autoStraighten(det: Detection, toFrame: (x: number, y: number) => [number, number], fw: number, fh: number): { ok: true; angle: number } | { ok: false; message: string } {
  const segs: RawSegment[] = det.segments.map((s) => {
    const a = toFrame(s.x1 / det.scale, s.y1 / det.scale)
    const b = toFrame(s.x2 / det.scale, s.y2 / det.scale)
    return { x1: a[0], y1: a[1], x2: b[0], y2: b[1], width: s.width / det.scale, p: s.p }
  })
  const set = removeOutliers(classifyLines(segs, fw, fh, 1), fw, fh)
  const selected = set.lines.filter((l) => (l.type & LINE.RELEVANT) && (l.type & LINE.SELECTED))
  const I: Orient = [1, 0, 0, 1]
  const v = screenSegs(selected.filter((l) => l.type & LINE.DIRVERT), I, fw, fh)
  const h = screenSegs(selected.filter((l) => !(l.type & LINE.DIRVERT)), I, fw, fh)
  if (v.length + h.length < 2) return { ok: false, message: NO_LINES }
  if (levelConsensus(v, h) === null) return { ok: false, message: 'The lines found don’t agree on a level, so the angle was left as it is.' }
  const dir = FIT.ROTATION | (set.horizontalCount >= 2 ? FIT.LINES_HOR : 0) | (set.verticalCount >= 2 ? FIT.LINES_VERT : 0)
  const r = nmsfit(set, fw, fh, { fLengthKb: DEFAULT_F_LENGTH, orthocorr: 100, aspect: 1 }, dir, false)
  if (!r.ok) return { ok: false, message: NO_LINES }
  // darktable's rotation turns the photo anticlockwise; the straighten angle is clockwise-positive.
  return { ok: true, angle: -r.params.rotation }
}

/** How far each family of lines is from vertical / horizontal (mean absolute degrees, length-weighted). */
export function measureTilt(segs: { a: [number, number]; b: [number, number] }[]): { vertical: number; horizontal: number; nv: number; nh: number } {
  let sv = 0
  let wv = 0
  let sh = 0
  let wh = 0
  let nv = 0
  let nh = 0
  for (const s of segs) {
    const dx = s.b[0] - s.a[0]
    const dy = s.b[1] - s.a[1]
    const len = Math.hypot(dx, dy)
    const fromV = (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI
    if (fromV < 30) {
      sv += fromV * len
      wv += len
      nv++
    } else if (fromV > 60) {
      sh += (90 - fromV) * len
      wh += len
      nh++
    }
  }
  return { vertical: wv ? sv / wv : 0, horizontal: wh ? sh / wh : 0, nv, nh }
}
