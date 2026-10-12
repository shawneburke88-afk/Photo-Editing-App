// darktable's "rotate and perspective" module (ashift): its perspective model, its selection and weighting of
// detected lines, its outlier removal, its fit and its automatic crop.
//
// Translated to TypeScript for LightBench (2026) from darktable's src/iop/ashift.c (functions named below):
//
//   This file is part of darktable,
//   Copyright (C) 2016-2026 darktable developers.
//   darktable is free software: you can redistribute it and/or modify it under the terms of the GNU General
//   Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
//   option) any later version.
//   (darktable credits the program ShiftN by Marcus Hebel as the inspiration of the module and of its model.)
//
// What changed in the translation:
// - Lines and image sizes use one unit (pixels of the full-size photo in its sensor orientation) for detection,
//   fitting and rendering. darktable detects on its preview buffer and scales the lines back to full size, but
//   passes the preview buffer's size to the fit (`nmsfit`: `fit.width = g->lines_in_width`) and to the outlier
//   removal's frame test; here the fit sees the size it is rendered with.
// - The outlier removal's random sampling uses a seeded generator, so the same photo always gives the same result
//   (darktable calls `rand()`).
// - Only the "original format" automatic crop (ASHIFT_CROP_ASPECT) is used, without darktable's clipping
//   margins: LightBench fits its whole frame inside the corrected photo with it (upright.ts).
// - Everything is in doubles (darktable's homography is in floats).

import { simplex } from './nmsimplex'

// ashift.c constants
export const ROTATION_RANGE_SOFT = 180
export const LENSSHIFT_RANGE_SOFT = 2.0
export const SHEAR_RANGE_SOFT = 0.5
export const MIN_LINE_LENGTH = 5
export const MAX_TANGENTIAL_DEVIATION = 30
export const LSD_SCALE = 0.99
export const LSD_SIGMA_SCALE = 0.6
export const LSD_QUANT = 2.0
export const LSD_ANG_TH = 22.5
export const LSD_LOG_EPS = 0.0
export const LSD_DENSITY_TH = 0.7
export const LSD_N_BINS = 1024
export const LSD_GAMMA = 0.45
const RANSAC_RUNS = 400
const RANSAC_EPSILON = 2
const RANSAC_EPSILON_STEP = 1
const RANSAC_ELIMINATION_RATIO = 60
const RANSAC_OPTIMIZATION_STEPS = 5
const RANSAC_OPTIMIZATION_DRY_RUNS = 50
const RANSAC_HURDLE = 5
export const MINIMUM_FITLINES = 2
const NMS_EPSILON = 1e-3
const NMS_SCALE = 1.0
const NMS_ITERATIONS = 400
const NMS_CROP_EPSILON = 100.0
const NMS_CROP_SCALE = 0.5
const NMS_CROP_ITERATIONS = 100
/** Focal length darktable assumes when the photo has none in its EXIF data. */
export const DEFAULT_F_LENGTH = 28.0

/** dt_iop_ashift_fitaxis_t */
export const FIT = {
  NONE: 0,
  ROTATION: 1 << 0,
  LENS_VERT: 1 << 1,
  LENS_HOR: 1 << 2,
  SHEAR: 1 << 3,
  LINES_VERT: 1 << 4,
  LINES_HOR: 1 << 5,
} as const
export const FIT_LENS_BOTH = FIT.LENS_VERT | FIT.LENS_HOR
export const FIT_LINES_BOTH = FIT.LINES_VERT | FIT.LINES_HOR
export const FIT_VERTICALLY = FIT.ROTATION | FIT.LENS_VERT | FIT.LINES_VERT
export const FIT_HORIZONTALLY = FIT.ROTATION | FIT.LENS_HOR | FIT.LINES_HOR
export const FIT_BOTH_SHEAR = FIT.ROTATION | FIT.LENS_VERT | FIT.LENS_HOR | FIT.SHEAR | FIT.LINES_VERT | FIT.LINES_HOR
export const FIT_ROTATION_VERTICAL_LINES = FIT.ROTATION | FIT.LINES_VERT
export const FIT_ROTATION_HORIZONTAL_LINES = FIT.ROTATION | FIT.LINES_HOR
export const FIT_ROTATION_BOTH_LINES = FIT.ROTATION | FIT.LINES_VERT | FIT.LINES_HOR
export const FIT_FLIP = FIT.LENS_VERT | FIT.LENS_HOR | FIT.LINES_VERT | FIT.LINES_HOR

/** dt_iop_ashift_linetype_t */
export const LINE = { IRRELEVANT: 0, RELEVANT: 1, DIRVERT: 2, SELECTED: 4 } as const
const LINE_MASK = LINE.RELEVANT | LINE.DIRVERT | LINE.SELECTED
export const LINE_VERTICAL_SELECTED = LINE.RELEVANT | LINE.DIRVERT | LINE.SELECTED
export const LINE_HORIZONTAL_SELECTED = LINE.RELEVANT | LINE.SELECTED

export type Vec3 = [number, number, number]
/** Row-major 3×3. */
export type M3 = number[]

/** dt_iop_ashift_line_t */
export interface AshiftLine {
  p1: Vec3
  p2: Vec3
  length: number
  width: number
  weight: number
  type: number
  /** Homogeneous line through p1 and p2, normalised so L[0]² + L[1]² = 1. */
  L: Vec3
}

/** The fitted model: darktable's rotation (degrees), vertical and horizontal lens shift and shear. */
export interface AshiftParams {
  rotation: number
  lensshiftV: number
  lensshiftH: number
  shear: number
}

/** The lens part of the model: 35 mm-equivalent focal length, "lens dependence" (%) and aspect adjust. */
export interface AshiftLens {
  fLengthKb: number
  orthocorr: number
  aspect: number
}

// ---- small vector helpers (vec3prodn, vec3norm, vec3lnorm, vec3scalar, vec3isnull)

export function vec3prodn(v1: Vec3, v2: Vec3): Vec3 {
  const l1 = v1[1] * v2[2] - v1[2] * v2[1]
  const l2 = v1[2] * v2[0] - v1[0] * v2[2]
  const l3 = v1[0] * v2[1] - v1[1] * v2[0]
  const sq = Math.sqrt(l1 * l1 + l2 * l2 + l3 * l3)
  const f = sq > 0 ? 1 / sq : 1
  return [l1 * f, l2 * f, l3 * f]
}
const vec3norm = (v: Vec3): Vec3 => {
  const sq = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
  const f = sq > 0 ? 1 / sq : 1
  return [v[0] * f, v[1] * f, v[2] * f]
}
export const vec3lnorm = (v: Vec3): Vec3 => {
  const sq = Math.hypot(v[0], v[1])
  const f = sq > 0 ? 1 / sq : 1
  return [v[0] * f, v[1] * f, v[2] * f]
}
const vec3scalar = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const vec3isnull = (v: Vec3) => Math.abs(v[0]) < 1e-10 && Math.abs(v[1]) < 1e-10 && Math.abs(v[2]) < 1e-10

export const mat3mul = (a: M3, b: M3): M3 => {
  const o = new Array<number>(9).fill(0)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]
  return o
}
export const mat3mulv = (m: M3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
]
export function mat3inv(m: M3): M3 | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) return null
  const k = 1 / det
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k]
}

// ---- the model (_homography)

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * darktable's `_homography`, forward direction: maps an input pixel (x, y) of a width × height image to the
 * corrected output (darktable's Step 10 shifts the output so no coordinate is negative).
 */
export function ashiftHomography(p: AshiftParams, lens: AshiftLens, width: number, height: number): M3 {
  const u = width
  const v = height
  const phi = (p.rotation * Math.PI) / 180
  const cosi = Math.cos(phi)
  const sini = Math.sin(phi)
  const ascale = Math.sqrt(lens.aspect)
  const fGlobal = lens.fLengthKb
  const horifac = 1 - lens.orthocorr / 100
  const exppaV = Math.exp(p.lensshiftV)
  const fdbV = fGlobal / (14.4 + (v / u - 1) * 7.2)
  const radV = (fdbV * (exppaV - 1)) / (exppaV + 1)
  const alphaV = clamp(Math.atan(radV), -1.5, 1.5)
  const rtV = Math.sin(0.5 * alphaV)
  const rV = Math.max(0.1, 2 * (horifac - 1) * rtV * rtV + 1)
  const vertifac = 1 - lens.orthocorr / 100
  const exppaH = Math.exp(p.lensshiftH)
  const fdbH = fGlobal / (14.4 + (u / v - 1) * 7.2)
  const radH = (fdbH * (exppaH - 1)) / (exppaH + 1)
  const alphaH = clamp(Math.atan(radH), -1.5, 1.5)
  const rtH = Math.sin(0.5 * alphaH)
  const rH = Math.max(0.1, 2 * (vertifac - 1) * rtH * rtH + 1)

  // Step 1: flip x and y coordinates
  let m: M3 = [0, 1, 0, 1, 0, 0, 0, 0, 1]
  // Step 2: rotation of image around its center
  m = mat3mul([cosi, -sini, -0.5 * v * cosi + 0.5 * u * sini + 0.5 * v, sini, cosi, -0.5 * v * sini - 0.5 * u * cosi + 0.5 * u, 0, 0, 1], m)
  // Step 3: shearing
  m = mat3mul([1, p.shear, 0, p.shear, 1, 0, 0, 0, 1], m)
  // Step 4: vertical lens shift effect
  m = mat3mul([exppaV, 0, 0, (0.5 * ((exppaV - 1) * u)) / v, (2 * exppaV) / (exppaV + 1), (-0.5 * ((exppaV - 1) * u)) / (exppaV + 1), (exppaV - 1) / v, 0, 1], m)
  // Step 5: horizontal compression
  m = mat3mul([1, 0, 0, 0, rV, 0.5 * u * (1 - rV), 0, 0, 1], m)
  // Step 6: flip x and y back again
  m = mat3mul([0, 1, 0, 1, 0, 0, 0, 0, 1], m)
  // Step 7: horizontal lens shift
  m = mat3mul([exppaH, 0, 0, (0.5 * ((exppaH - 1) * v)) / u, (2 * exppaH) / (exppaH + 1), (-0.5 * ((exppaH - 1) * v)) / (exppaH + 1), (exppaH - 1) / u, 0, 1], m)
  // Step 8: vertical compression
  m = mat3mul([1, 0, 0, 0, rH, 0.5 * v * (1 - rH), 0, 0, 1], m)
  // Step 9: aspect ratio scaling
  m = mat3mul([ascale, 0, 0, 0, 1 / ascale, 0, 0, 0, 1], m)
  // Step 10: x/y offsets so that no negative coordinates occur in the output
  let umin = Infinity
  let vmin = Infinity
  for (const y of [0, height - 1]) {
    for (const x of [0, width - 1]) {
      const po = mat3mulv(m, [x, y, 1])
      umin = Math.min(umin, po[0] / po[2])
      vmin = Math.min(vmin, po[1] / po[2])
    }
  }
  return mat3mul([1, 0, -umin, 0, 1, -vmin, 0, 0, 1], m)
}

/** The tilt angles (radians) the vertical and horizontal lens shifts stand for (`alpha_v`, `alpha_h` above). */
export function shiftAngles(p: AshiftParams, lens: AshiftLens, width: number, height: number): [number, number] {
  const a = (s: number, ratio: number) => {
    const e = Math.exp(s)
    return clamp(Math.atan(((lens.fLengthKb / (14.4 + (ratio - 1) * 7.2)) * (e - 1)) / (e + 1)), -1.5, 1.5)
  }
  return [a(p.lensshiftV, height / width), a(p.lensshiftH, width / height)]
}

// ---- line selection and weighting (line_detect, after LSD)

/** A segment from LSD (or drawn by the user), in pixels of the full-size photo in its sensor orientation. */
export interface RawSegment {
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
  /** LSD's angle precision p (1 for drawn lines). */
  p: number
}

export interface LineSet {
  lines: AshiftLine[]
  verticalCount: number
  horizontalCount: number
  verticalWeight: number
  horizontalWeight: number
}

/**
 * darktable's `line_detect` after the detector: drops lines along the image border, builds homogeneous lines,
 * weights each by length × width × precision and sorts them into (mostly) vertical and horizontal, relevant ones.
 * `width`, `height` are the analysed image's size; `scale` its size over the full photo's.
 */
export function classifyLines(segs: RawSegment[], width: number, height: number, scale: number): LineSet {
  const lines: AshiftLine[] = []
  let verticalCount = 0
  let horizontalCount = 0
  let verticalWeight = 0
  let horizontalWeight = 0
  for (const s of segs) {
    const { x1, y1, x2, y2 } = s
    if ((Math.abs(x1 - x2) < 1 && Math.max(x1, x2) < 2) || (Math.abs(x1 - x2) < 1 && Math.min(x1, x2) > width - 3) ||
      (Math.abs(y1 - y2) < 1 && Math.max(y1, y2) < 2) || (Math.abs(y1 - y2) < 1 && Math.min(y1, y2) > height - 3)) continue
    const px1 = x1 / scale
    const py1 = y1 / scale
    const px2 = x2 / scale
    const py2 = y2 / scale
    const p1: Vec3 = [px1, py1, 1]
    const p2: Vec3 = [px2, py2, 1]
    const L = vec3lnorm(vec3prodn(p1, p2))
    const length = Math.sqrt((px2 - px1) ** 2 + (py2 - py1) ** 2)
    const w = s.width / scale
    const weight = length * w * s.p
    const angle = (Math.atan2(py2 - py1, px2 - px1) * 180) / Math.PI
    const vertical = Math.abs(Math.abs(angle) - 90) < MAX_TANGENTIAL_DEVIATION
    const horizontal = Math.abs(Math.abs(Math.abs(angle) - 90) - 90) < MAX_TANGENTIAL_DEVIATION
    const relevant = length > MIN_LINE_LENGTH
    let type: number = LINE.IRRELEVANT
    if (vertical && relevant) {
      type = LINE_VERTICAL_SELECTED
      verticalCount++
      verticalWeight += weight
    } else if (horizontal && relevant) {
      type = LINE_HORIZONTAL_SELECTED
      horizontalCount++
      horizontalWeight += weight
    }
    lines.push({ p1, p2, length, width: w, weight, type, L })
  }
  return { lines, verticalCount, horizontalCount, verticalWeight, horizontalWeight }
}

/** A line drawn by the user (darktable's `_draw_basic_line` and `_draw_retrieve_line_type`). */
export function drawnLine(x1: number, y1: number, x2: number, y2: number): AshiftLine {
  const p1: Vec3 = [x1, y1, 1]
  const p2: Vec3 = [x2, y2, 1]
  return {
    p1,
    p2,
    L: vec3lnorm(vec3prodn(p1, p2)),
    length: Math.hypot(x2 - x1, y2 - y1),
    width: 1,
    weight: 1,
    type: Math.abs(x1 - x2) > Math.abs(y1 - y2) ? LINE_HORIZONTAL_SELECTED : LINE_VERTICAL_SELECTED,
  }
}

// ---- outlier removal (ransac, _remove_outliers)

/** A small seeded generator (mulberry32) standing in for C's rand(). */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const fact = (n: number): number => (n === 1 ? 1 : n * fact(n - 1))

function ransac(lines: AshiftLine[], indexSet: number[], inoutSet: number[], setCount: number, totalWeight: number, xmin: number, xmax: number, ymin: number, ymax: number) {
  if (setCount < 3) return
  const rand = rng(0x5eed + setCount)
  let bestSet = indexSet.slice(0, setCount)
  let bestInout = new Array<number>(setCount).fill(0)
  let bestQuality = 0
  let epsilon = Math.pow(10, -RANSAC_EPSILON)
  let epsilonStep = RANSAC_EPSILON_STEP
  let linesEliminated = 0
  let validRuns = 0
  const optiruns = RANSAC_OPTIMIZATION_STEPS * RANSAC_OPTIMIZATION_DRY_RUNS
  const riter = setCount > RANSAC_HURDLE ? RANSAC_RUNS : fact(setCount)
  const perm = Array.from({ length: setCount + 1 }, (_, n) => n)
  let piter = 1
  const inout = new Array<number>(setCount).fill(0)
  const swap = (a: number[], i: number, j: number) => {
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  const quickperm = () => {
    if (piter >= setCount) return false
    perm[piter]--
    const j = piter % 2 === 1 ? perm[piter] : 0
    swap(indexSet, j, piter)
    piter = 1
    while (perm[piter] === 0) {
      perm[piter] = piter
      piter++
    }
    return true
  }
  for (let r = 0; r < optiruns + riter; r++) {
    if (setCount > RANSAC_HURDLE || r < optiruns) {
      for (let i = 0; i < setCount; i++) swap(indexSet, i + Math.floor(rand() * (setCount - i)), i)
    } else quickperm()
    let quality = 0
    const L1 = lines[indexSet[0]].L
    const L2 = lines[indexSet[1]].L
    let V = vec3prodn(L1, L2)
    if (vec3isnull(V) || (Math.abs(V[2]) > 0 && V[0] / V[2] >= xmin && V[1] / V[2] >= ymin && V[0] / V[2] <= xmax && V[1] / V[2] <= ymax)) {
      quality = 0
    } else {
      V = vec3norm(V)
      inout[0] = 1
      inout[1] = 1
      for (let n = 2; n < setCount; n++) {
        const L3 = lines[indexSet[n]].L
        const d = Math.abs(vec3scalar(V, L3))
        inout[n] = d < epsilon ? 1 : 0
        let q: number
        if (inout[n] === 1) {
          const w = lines[indexSet[n]].weight
          q = 0.33 / setCount + (0.33 * w) / totalWeight + (0.33 * (1 - d / epsilon) * setCount * w) / totalWeight
        } else {
          q = 0
          linesEliminated++
        }
        quality += q
      }
      validRuns++
    }
    if (r < optiruns) {
      if (r % RANSAC_OPTIMIZATION_DRY_RUNS === RANSAC_OPTIMIZATION_DRY_RUNS - 1 && validRuns > 0) {
        const ratio = (100 * linesEliminated) / (setCount * validRuns)
        if (ratio < RANSAC_ELIMINATION_RATIO) epsilon = Math.pow(10, Math.log10(epsilon) - epsilonStep)
        else if (ratio > RANSAC_ELIMINATION_RATIO) epsilon = Math.pow(10, Math.log10(epsilon) + epsilonStep)
        epsilonStep /= 2
        linesEliminated = 0
        validRuns = 0
      }
    } else if (quality > bestQuality) {
      bestSet = indexSet.slice(0, setCount)
      bestInout = inout.slice(0, setCount)
      bestQuality = quality
    }
  }
  for (let i = 0; i < setCount; i++) {
    indexSet[i] = bestSet[i]
    inoutSet[i] = bestInout[i]
  }
}

/** darktable's `_remove_outliers`: RANSAC per direction keeps the lines that meet in one vanishing point. */
export function removeOutliers(set: LineSet, width: number, height: number): LineSet {
  const lines = set.lines.map((l) => ({ ...l }))
  const out = { ...set, lines }
  for (const vertical of [true, false]) {
    const want = vertical ? LINE_VERTICAL_SELECTED : LINE_HORIZONTAL_SELECTED
    const idx: number[] = []
    for (let n = 0; n < lines.length; n++) if ((lines[n].type & LINE_MASK) === want) idx.push(n)
    const inout = new Array<number>(idx.length).fill(0)
    if (idx.length > 2) ransac(lines, idx, inout, idx.length, vertical ? set.verticalWeight : set.horizontalWeight, 0, width, 0, height)
    let count = 0
    for (let n = 0; n < idx.length; n++) {
      const m = idx[n]
      if (inout[n] === 1) {
        lines[m].type |= LINE.SELECTED
        count++
      } else lines[m].type &= ~LINE.SELECTED
    }
    if (vertical) out.verticalCount = count
    else out.horizontalCount = count
  }
  return out
}

// ---- the fit (model_fitness, nmsfit)

const logit = (x: number, min: number, max: number) => {
  const eps = 1e-6
  const p = clamp((x - min) / (max - min), eps, 1 - eps)
  return 2 * Math.atanh(2 * p - 1)
}
const ilogit = (L: number, min: number, max: number) => 0.5 * (1 + Math.tanh(0.5 * L)) * (max - min) + min

interface FitData {
  lines: AshiftLine[]
  width: number
  height: number
  lens: AshiftLens
  fixed: { rotation: number | null; lensshiftV: number | null; lensshiftH: number | null; shear: number | null }
  linetype: number
  linemask: number
}

function paramsFrom(x: number[], fit: FitData): AshiftParams {
  let k = 0
  const f = fit.fixed
  return {
    rotation: f.rotation ?? ilogit(x[k++], -ROTATION_RANGE_SOFT, ROTATION_RANGE_SOFT),
    lensshiftV: f.lensshiftV ?? ilogit(x[k++], -LENSSHIFT_RANGE_SOFT, LENSSHIFT_RANGE_SOFT),
    lensshiftH: f.lensshiftH ?? ilogit(x[k++], -LENSSHIFT_RANGE_SOFT, LENSSHIFT_RANGE_SOFT),
    shear: f.shear ?? ilogit(x[k++], -SHEAR_RANGE_SOFT, SHEAR_RANGE_SOFT),
  }
}

/** darktable's `model_fitness`: how far the selected lines are from vertical / horizontal after the model. */
function modelFitness(x: number[], fit: FitData): number {
  const H = ashiftHomography(paramsFrom(x, fit), fit.lens, fit.width, fit.height)
  const Av: Vec3 = [1, 0, 0]
  const Ah: Vec3 = [0, 1, 0]
  let sumsqV = 0
  let sumsqH = 0
  let weightV = 0
  let weightH = 0
  let countV = 0
  let countH = 0
  let count = 0
  for (const line of fit.lines) {
    if ((line.type & fit.linemask) !== fit.linetype) continue
    const isvertical = (line.type & LINE.DIRVERT) !== 0
    const A = isvertical ? Ah : Av
    const L = vec3lnorm(vec3prodn(mat3mulv(H, line.p1), mat3mulv(H, line.p2)))
    const s = vec3scalar(L, A)
    if (isvertical) {
      sumsqV += s * s * line.weight
      weightV += line.weight
      countV++
    } else {
      sumsqH += s * s * line.weight
      weightH += line.weight
      countH++
    }
    count++
  }
  const v = weightV > 0 && count > 0 ? ((sumsqV / weightV) * countV) / count : 0
  const h = weightH > 0 && count > 0 ? ((sumsqH / weightH) * countH) / count : 0
  return Math.sqrt(1 - (1 - v) * (1 - h)) * 1e6
}

export type FitResult = { ok: true; params: AshiftParams; iterations: number } | { ok: false; reason: 'not-enough-lines' | 'did-not-converge' | 'insane' }

/**
 * darktable's `nmsfit`. `dir` is a FIT_* combination in the photo's sensor orientation; `isflipped` (the photo is
 * shown turned a quarter) swaps a one-direction fit, as darktable does. `start` holds the values kept fixed.
 */
export function nmsfit(set: LineSet, width: number, height: number, lens: AshiftLens, dir: number, isflipped: boolean, start: AshiftParams = { rotation: 0, lensshiftV: 0, lensshiftH: 0, shear: 0 }): FitResult {
  if (!set.lines.length) return { ok: false, reason: 'not-enough-lines' }
  let mdir = dir
  if ((mdir & FIT_LENS_BOTH) !== FIT_LENS_BOTH && (mdir & FIT_LENS_BOTH) !== 0) {
    mdir ^= isflipped ? FIT_FLIP : 0
    mdir |= (mdir & FIT_LINES_BOTH) === 0 ? FIT_LINES_BOTH : 0
  }
  const x: number[] = []
  const fixed: FitData['fixed'] = { rotation: start.rotation, lensshiftV: start.lensshiftV, lensshiftH: start.lensshiftH, shear: start.shear }
  if (mdir & FIT.ROTATION) {
    x.push(logit(start.rotation, -ROTATION_RANGE_SOFT, ROTATION_RANGE_SOFT))
    fixed.rotation = null
  }
  if (mdir & FIT.LENS_VERT) {
    x.push(logit(start.lensshiftV, -LENSSHIFT_RANGE_SOFT, LENSSHIFT_RANGE_SOFT))
    fixed.lensshiftV = null
  }
  if (mdir & FIT.LENS_HOR) {
    x.push(logit(start.lensshiftH, -LENSSHIFT_RANGE_SOFT, LENSSHIFT_RANGE_SOFT))
    fixed.lensshiftH = null
  }
  if (mdir & FIT.SHEAR) {
    x.push(logit(start.shear, -SHEAR_RANGE_SOFT, SHEAR_RANGE_SOFT))
    fixed.shear = null
  }
  let linetype: number = LINE.RELEVANT | LINE.SELECTED
  let linemask: number = LINE_MASK
  let enough = true
  if (mdir & FIT.LINES_VERT) {
    linetype |= LINE.DIRVERT
    enough = enough && set.verticalCount >= MINIMUM_FITLINES
  }
  if (mdir & FIT.LINES_HOR) enough = enough && set.horizontalCount >= MINIMUM_FITLINES
  if ((mdir & FIT_LINES_BOTH) === FIT_LINES_BOTH) {
    linetype = LINE.RELEVANT | LINE.SELECTED
    linemask = LINE.RELEVANT | LINE.SELECTED
  }
  if (!enough) return { ok: false, reason: 'not-enough-lines' }
  if (!x.length) return { ok: true, params: start, iterations: 0 }
  const fit: FitData = { lines: set.lines, width, height, lens, fixed, linetype, linemask }
  const iterations = simplex((p) => modelFitness(p, fit), x, x.length, NMS_EPSILON, NMS_SCALE, NMS_ITERATIONS)
  if (iterations >= NMS_ITERATIONS) return { ok: false, reason: 'did-not-converge' }
  const params = paramsFrom(x, fit)
  // Sanity check: a result that more than quadruples the image's area is degenerate.
  const H = ashiftHomography(params, lens, width, height)
  let xm = Infinity
  let xM = -Infinity
  let ym = Infinity
  let yM = -Infinity
  for (const yy of [0, height - 1]) {
    for (const xx of [0, width - 1]) {
      const po = mat3mulv(H, [xx, yy, 1])
      xm = Math.min(xm, po[0] / po[2])
      ym = Math.min(ym, po[1] / po[2])
      xM = Math.max(xM, po[0] / po[2])
      yM = Math.max(yM, po[1] / po[2])
    }
  }
  if (!((xM - xm) * (yM - ym) <= 4 * width * height)) return { ok: false, reason: 'insane' }
  return { ok: true, params, iterations }
}

// ---- automatic crop (crop_fitness, do_crop with ASHIFT_CROP_ASPECT)

/** The four edges of the corrected image (lines through its corners), from a forward homography. */
export function imageEdges(H: M3, width: number, height: number): Vec3[] {
  const Vc: Vec3[] = [[0, 0, 1], [0, height, 1], [width, height, 1], [width, 0, 1]]
  const V = Vc.map((c) => {
    const p = mat3mulv(H, c)
    return [p[0] / p[2], p[1] / p[2], 1] as Vec3
  })
  return V.map((v, n) => vec3prodn(v, V[(n + 1) % 4]))
}

/**
 * The squared half-diagonal of the largest rectangle with aspect angle `alpha` (atan2(height, width)) centred on
 * the output point P that fits inside the edges (the inner part of darktable's `crop_fitness`).
 */
export function halfDiagonal2(P: [number, number], alpha: number, edges: Vec3[]): number {
  const p: Vec3 = [P[0], P[1], 1]
  const Pa: Vec3[] = [
    [P[0] + 10 * Math.cos(alpha), P[1] + 10 * Math.sin(alpha), 1],
    [P[0] + 10 * Math.cos(alpha), P[1] - 10 * Math.sin(alpha), 1],
  ]
  const D = [vec3prodn(p, Pa[0]), vec3prodn(p, Pa[1])]
  let d2min = Number.MAX_VALUE
  for (let k = 0; k < 4; k++) {
    for (let l = 0; l < 2; l++) {
      const I = vec3prodn(edges[k], D[l])
      if (vec3isnull(I)) return 0
      if (I[2] === 0) continue
      const ix = I[0] / I[2]
      const iy = I[1] / I[2]
      d2min = Math.min(d2min, (P[0] - ix) ** 2 + (P[1] - iy) ** 2)
    }
  }
  return d2min
}

/**
 * darktable's `do_crop` in "original format" mode: the centre (in output coordinates) and squared half-diagonal of
 * the largest rectangle of the image's own aspect inside the corrected image. Null when the fit fails.
 */
export function cropFit(H: M3, width: number, height: number): { center: [number, number]; d2: number } | null {
  const edges = imageEdges(H, width, height)
  const alpha = Math.atan2(height, width)
  const toOut = (x: number, y: number): [number, number] => {
    const P = mat3mulv(H, [x * width, y * height, 1])
    return [P[0] / P[2], P[1] / P[2]]
  }
  // crop_constraint
  const constrain = (p: number[], n: number) => {
    for (let i = 0; i < Math.min(n, 2); i++) {
      p[i] = Math.abs(p[i])
      if (p[i] > 1) p[i] = 1 - p[i]
    }
  }
  const fitness = (p: number[]) => {
    const d2 = halfDiagonal2(toOut(p[0], p[1]), alpha, edges)
    return -2 * d2 * Math.sin(2 * alpha)
  }
  const params = [0.5, 0.5]
  const iter = simplex(fitness, params, 2, NMS_CROP_EPSILON, NMS_CROP_SCALE, NMS_CROP_ITERATIONS, constrain)
  if (iter >= NMS_CROP_ITERATIONS) return null
  const A = Math.abs(fitness(params))
  if (!(A > 0)) return null
  const center = toOut(params[0], params[1])
  return { center, d2: halfDiagonal2(center, alpha, edges) }
}
