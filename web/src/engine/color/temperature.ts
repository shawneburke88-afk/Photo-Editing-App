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
 * The most one white-balance multiplier may be of another (6 EV). LightBench's own limit, not darktable's: see
 * fitWhite.
 */
export const MAX_MULTIPLIER_RATIO = 64

const withinLimit = (cam: Vec3) => {
  const hi = Math.max(cam[0], cam[1], cam[2])
  return hi > 0 && Math.min(cam[0], cam[1], cam[2]) * MAX_MULTIPLIER_RATIO >= hi
}

/**
 * Moves a white in camera RGB straight towards the camera's neutral (equal channels) until its weakest channel is
 * 1/MAX_MULTIPLIER_RATIO of its strongest; a white already within that is returned as it is. The last resort of
 * temperatureToMultipliers (and a guard against rounding at the limit).
 */
export function fitWhite(cam: Vec3): Vec3 {
  const hi = Math.max(cam[0], cam[1], cam[2])
  if (!(hi > 0)) return [1, 1, 1]
  const lo = Math.min(cam[0], cam[1], cam[2])
  const floor = hi / MAX_MULTIPLIER_RATIO
  if (lo >= floor) return cam
  const a = (floor - lo) / (hi - lo)
  return [cam[0] + a * (hi - cam[0]), cam[1] + a * (hi - cam[1]), cam[2] + a * (hi - cam[2])]
}

/**
 * The range of 1/tint (darktable's tint divides XYZ.Y) for which the white of `a + u·b` in camera RGB stays within
 * MAX_MULTIPLIER_RATIO; null when no tint does. Every condition `RATIO·cam_i ≥ cam_j` is linear in u, so the
 * allowed values form one interval.
 */
function allowedInverseTint(a: Vec3, b: Vec3): [number, number] | null {
  let lo = 0
  let hi = Infinity
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      // f(u) = c0 + u·c1 ≥ 0
      const c0 = MAX_MULTIPLIER_RATIO * a[i] - a[j]
      const c1 = MAX_MULTIPLIER_RATIO * b[i] - b[j]
      if (c1 > 0) lo = Math.max(lo, -c0 / c1)
      else if (c1 < 0) hi = Math.min(hi, -c0 / c1)
      else if (c0 < 0) return null
    }
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
 * darktable has no guard for this: temperature.c `_xyz2mul` takes 1 / CAM as it is, and for non-raw input uses sRGB
 * as the "camera" (`_prepare_matrices`). LightBench's own, smallest fix: the tint is limited to where no multiplier
 * is more than MAX_MULTIPLIER_RATIO times another, so the slider stops getting stronger at that edge instead of
 * turning back; if no tint fits at that temperature, the white is fitted in camera RGB (fitWhite). Settings already
 * within the limit are computed exactly as before.
 */
export function temperatureToMultipliers(tempK: number, tint: number, xyzToCam: Mat3): Vec3 {
  const xyz = temperatureToXYZ(tempK)
  const [X, Y, Z] = xyz
  xyz[1] /= tint
  let cam = apply(xyzToCam, xyz)
  if (!withinLimit(cam)) {
    const a = apply(xyzToCam, [X, 0, Z])
    const b = apply(xyzToCam, [0, Y, 0])
    const range = allowedInverseTint(a, b)
    const u = range ? Math.min(range[1], Math.max(range[0], 1 / tint)) : 1
    cam = fitWhite([a[0] + u * b[0], a[1] + u * b[1], a[2] + u * b[2]])
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
