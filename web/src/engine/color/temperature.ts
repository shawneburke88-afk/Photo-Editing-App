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
 * Temperature (K) + tint → white-balance multipliers [R, G, B], normalised so green = 1.
 * `xyzToCam` is the camera's Adobe matrix (XYZ → camera RGB), as LibRaw reports it (cam_xyz).
 */
export function temperatureToMultipliers(tempK: number, tint: number, xyzToCam: Mat3): Vec3 {
  const xyz = temperatureToXYZ(tempK)
  xyz[1] /= tint
  const cam = apply(xyzToCam, xyz)
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
