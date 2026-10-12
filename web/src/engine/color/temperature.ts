// White balance: colour temperature + tint ⇄ camera RGB multipliers.
//
// Translated from darktable's src/iop/temperature.c (darktable developers, GPL-3.0-or-later):
// _spd_blackbody, _spd_daylight, _spectrum_to_XYZ, _temperature_to_XYZ, _temp2mul / _xyz2mul and
// _mul2temp / _XYZ_to_temperature, including darktable's tint convention (XYZ.Y divided by tint).
// The daylight-locus formula (temperature → xy) is the standard CIE one, as used by lcms2's
// cmsWhitePointFromTemp, which darktable calls.

import { CIE_1931_OBSERVER, CIE_DAYLIGHT_COMPONENTS } from './cie-tables'
import { apply, invert, type Mat3, type Vec3 } from './matrix'

export const LOWEST_TEMPERATURE = 1901
export const HIGHEST_TEMPERATURE = 25000
export const LOWEST_TINT = 0.135
export const HIGHEST_TINT = 2.326
const INITIAL_BLACKBODY_TEMPERATURE = 4000

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Bruce Lindbloom, "Spectral Power Distribution of a Blackbody Radiator". */
function spdBlackbody(wavelength: number, tempK: number): number {
  const lambda = wavelength * 1e-9
  const c1 = 3.741771524664128e-16 // 2πhc²
  const c2 = 0.014387769599838156 // hc/k
  return c1 / (lambda ** 5 * (Math.exp(c2 / (lambda * tempK)) - 1))
}

/** CIE daylight locus: correlated colour temperature (4000–25000 K) → chromaticity xy. */
export function daylightXy(tempK: number): [number, number] {
  const t = clamp(tempK, 4000, 25000)
  const t2 = t * t
  const t3 = t2 * t
  const x = t <= 7000
    ? -4.607e9 / t3 + 2.9678e6 / t2 + 0.09911e3 / t + 0.244063
    : -2.0064e9 / t3 + 1.9018e6 / t2 + 0.24748e3 / t + 0.23704
  const y = -3.0 * x * x + 2.87 * x - 0.275
  return [x, y]
}

/** Bruce Lindbloom, "Spectral Power Distribution of a CIE D-Illuminant". */
function spdDaylight(wavelength: number, tempK: number): number {
  const [x, y] = daylightXy(tempK)
  const M = 0.0241 + 0.2562 * x - 0.7341 * y
  const m1 = (-1.3515 - 1.7703 * x + 5.9114 * y) / M
  const m2 = (0.03 - 31.4424 * x + 30.0717 * y) / M
  const step = CIE_DAYLIGHT_COMPONENTS[1][0] - CIE_DAYLIGHT_COMPONENTS[0][0]
  const j = Math.floor((wavelength - CIE_DAYLIGHT_COMPONENTS[0][0]) / step)
  const [, s0, s1, s2] = CIE_DAYLIGHT_COMPONENTS[j]
  return s0 + m1 * s1 + m2 * s2
}

/** Bruce Lindbloom, "Computing XYZ From Spectral Data (Emissive Case)", normalised to max 1. */
function spectrumToXYZ(tempK: number, spd: (wl: number, t: number) => number): Vec3 {
  let X = 0
  let Y = 0
  let Z = 0
  for (const [wl, xb, yb, zb] of CIE_1931_OBSERVER) {
    const p = spd(wl, tempK)
    X += p * xb
    Y += p * yb
    Z += p * zb
  }
  const max = Math.max(X, Y, Z)
  return [X / max, Y / max, Z / max]
}

export function temperatureToXYZ(tempK: number): Vec3 {
  const t = clamp(tempK, LOWEST_TEMPERATURE, HIGHEST_TEMPERATURE)
  return spectrumToXYZ(t, t < INITIAL_BLACKBODY_TEMPERATURE ? spdBlackbody : spdDaylight)
}

/**
 * How far apart a JPEG's white-balance multipliers may be: none more than 8× another. The size is darktable's range
 * for the coefficients, 0…8 relative to green (temperature.c: `dt_iop_temperature_params_t` red/green/blue
 * `$MAX: 8.0`, and the spot picker's `fminf(8.0f, …)` in `color_picker_apply`); applying it between every pair of
 * channels, so both ends of the Tint slider stop alike, is LightBench's choice.
 */
export const RGB_MULTIPLIER_LIMIT = 8

/**
 * The same limit for RAW files: only a guard against the singularity (see temperatureToMultipliers). A sensor's
 * native gamut is far wider than any illuminant's white; for the D700 tested, every Temp × Tint setting that gave
 * positive multipliers stays within it except at 1901 K with Tint far to the green side.
 */
export const RAW_MULTIPLIER_LIMIT = 64

/** Every multiplier (green / channel) positive and within [1/limit, limit] of green. */
const withinLimit = (cam: Vec3, limit: number) =>
  cam[1] > 0 && limit * cam[0] >= cam[1] && limit * cam[2] >= cam[1] && limit * cam[1] >= cam[0] && limit * cam[1] >= cam[2]

/**
 * Moves a white in camera RGB straight towards the camera's neutral (equal channels) until its weakest channel is
 * 1/limit of its strongest (no multiplier more than `limit` times another); a white already within that is returned
 * as it is. The last resort of temperatureToMultipliers (and a guard against rounding at the limit).
 */
export function fitWhite(cam: Vec3, limit: number): Vec3 {
  const hi = Math.max(cam[0], cam[1], cam[2])
  if (!(hi > 0)) return [1, 1, 1]
  if (withinLimit(cam, limit)) return cam
  // Each condition c_i ≥ 0 is linear in a (0 = as asked, 1 = neutral, which always fits): c0 + a·c1 ≥ 0.
  const d = [hi - cam[0], hi - cam[1], hi - cam[2]]
  let a = 0
  const need = (c0: number, c1: number) => {
    if (c0 < 0 && c1 > 0) a = Math.max(a, -c0 / c1)
  }
  for (const i of [0, 2]) {
    need(limit * cam[i] - cam[1], limit * d[i] - d[1])
    need(limit * cam[1] - cam[i], limit * d[1] - d[i])
  }
  a = Math.min(1, a)
  return [cam[0] + a * d[0], cam[1] + a * d[1], cam[2] + a * d[2]]
}

/**
 * The range of 1/tint (darktable's tint divides XYZ.Y) for which the white `a + u·b` in camera RGB keeps every
 * channel within `limit` of every other; null when no tint does. Every condition `limit·cam_i ≥ cam_j` is linear in
 * u, so the allowed values form one interval.
 */
function allowedInverseTint(a: Vec3, b: Vec3, limit: number): [number, number] | null {
  let lo = 0
  let hi = Infinity
  // f(u) = c0 + u·c1 ≥ 0, for limit·cam_i ≥ cam_g and limit·cam_g ≥ cam_i (i = red, blue).
  const conditions: [number, number][] = []
  for (const i of [0, 2]) {
    conditions.push([limit * a[i] - a[1], limit * b[i] - b[1]], [limit * a[1] - a[i], limit * b[1] - b[i]])
  }
  for (const [c0, c1] of conditions) {
    if (c1 > 0) lo = Math.max(lo, -c0 / c1)
    else if (c1 < 0) hi = Math.min(hi, -c0 / c1)
    else if (c0 < 0) return null
  }
  return lo <= hi && hi > 0 ? [lo, hi] : null
}

/**
 * Temperature (K) + tint → white-balance multipliers [R, G, B], normalised so green = 1.
 * `xyzToCam` is the camera's Adobe matrix (XYZ → camera RGB), as LibRaw reports it (cam_xyz).
 *
 * Extreme settings can ask for a white the camera (or a JPEG's colour space) can't hold: a channel of its camera RGB
 * reaches zero, so that multiplier (1 / the channel) grows without bound and then turns negative, inverting the
 * colours. E.g. an sRGB JPEG at 6500 K with Tint +150 (red about −7.9), or at 1901 K with Tint 0 (blue about 4800).
 * darktable has no guard here: temperature.c `_xyz2mul` takes 1 / CAM as it is, and for non-raw input uses sRGB as
 * the "camera" (`_prepare_matrices`); only its spot picker clamps the coefficients to 0…8. LightBench's own, smallest
 * fix: the tint is limited to where every multiplier stays positive and none is more than `limit` times another
 * (RGB_MULTIPLIER_LIMIT for JPEGs, from darktable's range; RAW_MULTIPLIER_LIMIT for RAWs), so the slider stops at
 * that edge instead of turning back;
 * if no tint fits at that temperature, the white is fitted in camera RGB (fitWhite). Settings within the limit are
 * computed exactly as before.
 */
export function temperatureToMultipliers(tempK: number, tint: number, xyzToCam: Mat3, limit = RAW_MULTIPLIER_LIMIT): Vec3 {
  const xyz = temperatureToXYZ(tempK)
  const [X, Y, Z] = xyz
  xyz[1] /= tint
  let cam = apply(xyzToCam, xyz)
  if (!withinLimit(cam, limit)) {
    const a = apply(xyzToCam, [X, 0, Z])
    const b = apply(xyzToCam, [0, Y, 0])
    const range = allowedInverseTint(a, b, limit)
    const u = range ? Math.min(range[1], Math.max(range[0], 1 / tint)) : 1
    cam = fitWhite([a[0] + u * b[0], a[1] + u * b[1], a[2] + u * b[2]], limit)
  }
  const mul: Vec3 = [1 / cam[0], 1 / cam[1], 1 / cam[2]]
  return [mul[0] / mul[1], 1, mul[2] / mul[1]]
}

/** Inverse of temperatureToMultipliers by binary search, as darktable does for as-shot white balance. */
export function multipliersToTemperature(mul: Vec3, xyzToCam: Mat3): { temperature: number; tint: number } {
  const camToXyz = invert(xyzToCam)
  const XYZ = apply(camToXyz, [1 / mul[0], 1 / mul[1], 1 / mul[2]])
  let max = HIGHEST_TEMPERATURE
  let min = LOWEST_TEMPERATURE
  let t = (max + min) / 2
  let xyz = temperatureToXYZ(t)
  while (max - min > 1) {
    xyz = temperatureToXYZ(t)
    if (xyz[2] / xyz[0] > XYZ[2] / XYZ[0]) max = t
    else min = t
    t = (max + min) / 2
  }
  const tint = xyz[1] / xyz[0] / (XYZ[1] / XYZ[0])
  return { temperature: clamp(t, LOWEST_TEMPERATURE, HIGHEST_TEMPERATURE), tint: clamp(tint, LOWEST_TINT, HIGHEST_TINT) }
}
