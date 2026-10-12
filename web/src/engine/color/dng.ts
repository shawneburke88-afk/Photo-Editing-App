// The DNG colour model (Adobe DNG Specification 1.7, chapter 6, "Mapping Camera Color Space to CIE XYZ Space"):
//  - ColorMatrix1/2 (XYZ → reference camera), CameraCalibration1/2 and ForwardMatrix1/2 are interpolated between the
//    two calibration illuminants by the inverse correlated colour temperature of the white point;
//  - XYZtoCamera = AnalogBalance · CameraCalibration · ColorMatrix;
//  - white balance multipliers are the reciprocal of the camera neutral for the chosen white;
//  - camera → XYZ (D50) goes through ForwardMatrix when the file has one, otherwise through the inverse of XYZtoCamera
//    followed by a Bradford adaptation from the white to D50;
//  - the as-shot white comes from AsShotWhiteXY, or from AsShotNeutral by the specification's iteration.
//
// Ported from LightCraft, crates/raw/src/color.rs (lines 1-236: illuminant_temperature, illuminant_weight,
// xyz_to_camera, camera_neutral, neutral_to_xy, as_shot_white, camera_to_xyz_d50, camera_transform_of) and
// crates/color/src/cct.rs (lines 16-111: the Kim et al. Planckian locus and xy → temperature) and lib.rs (bradford,
// lines 153-165), commit 701f78e. Copyright (c) 2026 ArtCraft Team and the LightCraft contributors, MIT OR
// Apache-2.0 (see THIRD_PARTY_NOTICES.md). Changes: TypeScript; row-major Mat3 from ./matrix; the working space's D65
// is LightBench's Rec.2020 white; xy → temperature searches the same mired range but returns only the temperature.
//
// darktable instead uses one matrix, the one whose illuminant is closest to D65, without interpolating
// (src/common/exif.cc, lines 2647-2709, with its "FIXME interpolate the matrixes"), and ForwardMatrix only when the
// file has no usable ColorMatrix or the user picks it (src/iop/colorin.c, lines 1544-1556 and 2141-2144).

import { apply, invert, mul, REC2020_TO_XYZ, XYZ_TO_REC2020, type Mat3, type Vec3 } from './matrix'

export type Xy = [number, number]

/** The colour tags of a DNG that the colour model uses (read by engine/raw/dng-tags.ts). */
export interface DngColor {
  /** CalibrationIlluminant1/2 (Exif LightSource codes; 0 = absent). */
  illuminant: [number, number]
  /** ColorMatrix1/2: XYZ → reference camera. */
  colorMatrix: [Mat3 | null, Mat3 | null]
  /** CameraCalibration1/2: reference camera → this camera. */
  cameraCalibration: [Mat3 | null, Mat3 | null]
  /** ForwardMatrix1/2: white-balanced camera → XYZ (D50). */
  forwardMatrix: [Mat3 | null, Mat3 | null]
  analogBalance: Vec3 | null
  asShotNeutral: Vec3 | null
  asShotWhiteXY: Xy | null
  /** BaselineExposure in EV (read, not applied: darktable doesn't apply it either). */
  baselineExposure: number
}

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const diag = (a: number, b: number, c: number): Mat3 => [a, 0, 0, 0, b, 0, 0, 0, c]

export function xyToXyz([x, y]: Xy): Vec3 {
  return [x / y, 1, (1 - x - y) / y]
}

export function xyzToXy([X, Y, Z]: Vec3): Xy {
  const s = X + Y + Z
  return s > 0 ? [X / s, Y / s] : D65_XY
}

/** The working space's white (LightBench's linear Rec.2020, D65). */
export const D65_XY: Xy = xyzToXy(apply(REC2020_TO_XYZ, [1, 1, 1]))
export const D50_XY: Xy = [0.3457, 0.3585]

const BRADFORD: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296]
const BRADFORD_INV = invert(BRADFORD)

/** Bradford chromatic adaptation (XYZ → XYZ) from white `src` to white `dst`. */
export function bradford(src: Xy, dst: Xy): Mat3 {
  if (src[0] === dst[0] && src[1] === dst[1]) return IDENTITY
  const s = apply(BRADFORD, xyToXyz(src))
  const d = apply(BRADFORD, xyToXyz(dst))
  return mul(mul(BRADFORD_INV, diag(d[0] / s[0], d[1] / s[1], d[2] / s[2])), BRADFORD)
}

// ---------------------------------------------------------------- correlated colour temperature (cct.rs)

const MIN_K = 1667
const MAX_K = 25000

/** Kim et al. (2002) cubic approximation of the Planckian locus. */
function kimXy(tIn: number): Xy {
  const t = Math.min(MAX_K, Math.max(MIN_K, tIn))
  const t2 = t * t
  const t3 = t2 * t
  const x = t <= 4000
    ? -0.2661239e9 / t3 - 0.2343589e6 / t2 + 0.8776956e3 / t + 0.17991
    : -3.0258469e9 / t3 + 2.1070379e6 / t2 + 0.2226347e3 / t + 0.24039
  const x2 = x * x
  const x3 = x2 * x
  const y = t <= 2222
    ? -1.1063814 * x3 - 1.3481102 * x2 + 2.18555832 * x - 0.20219683
    : t <= 4000
      ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
      : 3.081758 * x3 - 5.8733867 * x2 + 3.75112997 * x - 0.37001483
  return [x, y]
}

function xyToUv([x, y]: Xy): [number, number] {
  const d = -2 * x + 12 * y + 3
  return [(4 * x) / d, (6 * y) / d]
}

/** Planckian locus in CIE 1960 (u, v), extended linearly in mired space outside the approximation's range. */
function locusUv(tIn: number): [number, number] {
  const t = Math.max(1000, tIn)
  if (t >= MIN_K && t <= MAX_K) return xyToUv(kimXy(t))
  const [a, b] = t < MIN_K ? [MIN_K, MIN_K + 50] : [MAX_K - 500, MAX_K]
  const [ua, va] = xyToUv(kimXy(a))
  const [ub, vb] = xyToUv(kimXy(b))
  const s = (1e6 / t - 1e6 / a) / (1e6 / b - 1e6 / a)
  return [ua + (ub - ua) * s, va + (vb - va) * s]
}

/** Correlated colour temperature (K) of a chromaticity: the nearest point of the locus, searched in mired space. */
export function xyToTemperature(p: Xy): number {
  const [u, v] = xyToUv(p)
  const dist = (m: number) => {
    const [lu, lv] = locusUv(1e6 / m)
    return (u - lu) ** 2 + (v - lv) ** 2
  }
  // coarse scan, then golden-section refinement, over 20…1000 mired (50000 K … 1000 K)
  let best = 20
  let bd = Infinity
  for (let m = 20; m <= 1000; m += 5) {
    const d = dist(m)
    if (d < bd) {
      bd = d
      best = m
    }
  }
  let a = Math.max(20, best - 5)
  let b = Math.min(1000, best + 5)
  const g = 0.61803398875
  for (let i = 0; i < 60; i++) {
    const c = b - g * (b - a)
    const d = a + g * (b - a)
    if (dist(c) < dist(d)) b = d
    else a = c
  }
  return 1e6 / ((a + b) / 2)
}

/** A chromaticity on the Planckian locus (for tests and defaults). */
export function temperatureToLocusXy(t: number): Xy {
  const [u, v] = locusUv(t)
  const d = 2 * u - 8 * v + 4
  return [(3 * u) / d, (2 * v) / d]
}

// ---------------------------------------------------------------- the DNG model (color.rs)

/** Correlated colour temperature (K) of an Exif LightSource / DNG CalibrationIlluminant code. */
export function illuminantTemperature(code: number): number | null {
  switch (code) {
    case 1: case 4: case 9: return 5500 // daylight, flash, fine weather
    case 2: case 14: return 4150 // fluorescent, cool white fluorescent
    case 3: return 2850 // tungsten
    case 10: return 6500 // cloudy
    case 11: return 7500 // shade
    case 12: return 6430 // daylight fluorescent
    case 13: return 5000 // day white fluorescent
    case 15: return 3450 // white fluorescent
    case 16: return 2940 // warm white fluorescent
    case 17: return 2856 // standard light A
    case 18: return 4874 // standard light B
    case 19: return 6774 // standard light C
    case 20: return 5503 // D55
    case 21: return 6504 // D65
    case 22: return 7504 // D75
    case 23: return 5003 // D50
    case 24: return 3200 // ISO studio tungsten
    default: return null
  }
}

function lerp(a: Mat3, b: Mat3, g: number): Mat3 {
  return a.map((v, i) => g * v + (1 - g) * b[i]) as Mat3
}

/** Weight of calibration 1 for white `xy` (1 = matrix 1 only), linear in inverse temperature. */
export function illuminantWeight(c: DngColor, white: Xy): number {
  const t = xyToTemperature(white)
  const t1 = illuminantTemperature(c.illuminant[0]) ?? 2856
  const t2 = illuminantTemperature(c.illuminant[1]) ?? 6504
  if (Math.abs(t1 - t2) < 1) return 1
  const g = (1 / t - 1 / t2) / (1 / t1 - 1 / t2)
  return Math.min(1, Math.max(0, g))
}

function interp(pair: [Mat3 | null, Mat3 | null], g: number): Mat3 | null {
  const [a, b] = pair
  if (a && b) return lerp(a, b, g)
  return a ?? b ?? null
}

/** AnalogBalance · CameraCalibration, interpolated with weight g. */
function abCc(c: DngColor, g: number): Mat3 {
  const ab = c.analogBalance ? diag(...c.analogBalance) : IDENTITY
  return mul(ab, interp(c.cameraCalibration, g) ?? IDENTITY)
}

/** Whether the file carries a usable colour matrix. */
export function hasColorMatrix(c: DngColor | null | undefined): c is DngColor {
  return !!c && c.colorMatrix.some((m) => m !== null)
}

/** XYZtoCamera for white `xy`. Requires a colour matrix (see hasColorMatrix). */
export function xyzToCamera(c: DngColor, white: Xy): Mat3 {
  const g = illuminantWeight(c, white)
  const cm = interp(c.colorMatrix, g)
  if (!cm) throw new Error('This DNG has no colour matrix')
  return mul(abCc(c, g), cm)
}

/** Camera neutral (camera values of a neutral surface lit by white `xy`), largest = 1. */
export function cameraNeutral(c: DngColor, white: Xy): Vec3 {
  const n = apply(xyzToCamera(c, white), xyToXyz(white))
  const mx = Math.max(...n)
  return mx > 0 ? (n.map((v) => v / mx) as Vec3) : [1, 1, 1]
}

/** The white xy whose camera neutral is `neutral` (DNG specification's iteration, starting at D50). */
export function neutralToXy(c: DngColor, neutral: Vec3): Xy {
  let xy: Xy = D50_XY
  for (let i = 0; i < 50; i++) {
    let inv: Mat3
    try {
      inv = invert(xyzToCamera(c, xy))
    } catch {
      return xy
    }
    const next = xyzToXy(apply(inv, neutral))
    if (!(Number.isFinite(next[0]) && Number.isFinite(next[1])) || next[1] <= 0) return xy
    const clamped: Xy = [Math.min(0.7, Math.max(0.1, next[0])), Math.min(0.7, Math.max(0.1, next[1]))]
    const done = Math.abs(clamped[0] - xy[0]) < 1e-9 && Math.abs(clamped[1] - xy[1]) < 1e-9
    xy = clamped
    if (done) break
  }
  return xy
}

/** The as-shot white: AsShotWhiteXY, else AsShotNeutral, else the camera's multipliers, else D65. */
export function asShotWhite(c: DngColor, multipliers?: Vec3): Xy {
  if (c.asShotWhiteXY) return c.asShotWhiteXY
  if (c.asShotNeutral) return neutralToXy(c, c.asShotNeutral)
  if (multipliers && multipliers.every((v) => v > 0 && Number.isFinite(v))) {
    return neutralToXy(c, multipliers.map((v) => 1 / v) as Vec3)
  }
  return D65_XY
}

/** Camera (raw, not white balanced) → XYZ relative to D50, for scene white `xy`. */
export function cameraToXyzD50(c: DngColor, white: Xy): Mat3 {
  const g = illuminantWeight(c, white)
  const fm = interp(c.forwardMatrix, g)
  if (fm) {
    try {
      const abccInv = invert(abCc(c, g))
      const rn = apply(abccInv, cameraNeutral(c, white))
      if (rn.every((v) => v > 1e-9)) return mul(mul(fm, diag(1 / rn[0], 1 / rn[1], 1 / rn[2])), abccInv)
    } catch {
      // fall through to the colour matrix
    }
  }
  return mul(bradford(white, D50_XY), invert(xyzToCamera(c, white)))
}

/**
 * White balance multipliers for white `xy` (reciprocal camera neutral), green = 1 as LightBench's other multipliers.
 * (LightCraft normalises the smallest to 1; only the scale differs.)
 */
export function dngMultipliers(c: DngColor, white: Xy): Vec3 {
  const n = cameraNeutral(c, white)
  const m = n.map((v) => (v > 1e-9 ? 1 / v : 1))
  return [m[0] / m[1], 1, m[2] / m[1]]
}

/**
 * White-balanced camera RGB → linear Rec.2020 (D65) for scene white `xy`, scaled so that (1, 1, 1) maps to white
 * (1, 1, 1), as LibRaw's rgb_cam maps it for other raws. `wb` is the multipliers the camera values were scaled by.
 */
export function dngCameraToRec2020(c: DngColor, white: Xy, wb: Vec3): Mat3 {
  const toD50 = cameraToXyzD50(c, white)
  const m = mul(mul(mul(XYZ_TO_REC2020, bradford(D50_XY, D65_XY)), toD50), diag(1 / wb[0], 1 / wb[1], 1 / wb[2]))
  const w = apply(m, [1, 1, 1])
  const k = (w[0] + w[1] + w[2]) / 3
  return Math.abs(k) > 1e-12 ? (m.map((v) => v / k) as Mat3) : m
}

/**
 * Everything the pipeline needs for white balance multipliers `wb` (camera RGB, green = 1): the white they
 * neutralise, the camera → Rec.2020 matrix for that white, and XYZtoCamera there (for temperature and tint).
 */
export function dngTransform(c: DngColor, wb: Vec3): { white: Xy; camToRec2020: Mat3; xyzToCam: Mat3 } {
  const white = neutralToXy(c, wb.map((v) => 1 / v) as Vec3)
  return { white, camToRec2020: dngCameraToRec2020(c, white, wb), xyzToCam: xyzToCamera(c, white) }
}
