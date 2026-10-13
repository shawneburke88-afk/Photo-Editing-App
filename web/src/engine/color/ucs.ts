// darktable Uniform Color Space 2022 ("darktable UCS 22", © Aurélien Pierre; GPL-3.0-or-later as part of darktable):
// the perceptual space darktable's color equalizer works in. Translated from darktable's source at commit 6271f53:
// src/common/colorspaces_inline_conversions.h (lines 1353-1528: `Y_to_dt_UCS_L_star`, `dt_UCS_L_star_to_Y`,
// `xyY_to_dt_UCS_UV`, `dt_UCS_LUV_to_JCH`, `dt_UCS_JCH_to_xyY`, `dt_UCS_JCH_to_HSB`, `dt_UCS_HSB_to_JCH`; lines 246-280:
// `dt_D65_XYZ_to_xyY`, `dt_xyY_to_XYZ`) and src/common/darktable_ucs_22_helpers.h (`dt_UCS_22_build_gamut_LUT`,
// `lookup_gamut`, `soft_clip`, `gamut_map_HSB`). The theory: https://eng.aurelienpierre.com/2022/02/color-saturation-control-for-the-21th-century/
//
// Coordinates:
//  - L* (lightness, 0 … 2.0989), U*′V*′ (chromaticity; neutral D65 is the origin), from xyY D65;
//  - JCH: J = L*/L*white, C (chroma), H (hue angle, radians, −π…π, atan2);
//  - HSB: hue, saturation S = C/B and brightness B = J·(C^1.3365 + 1) (the Helmholtz–Kohlrausch-corrected brightness).
// darktable's own working space is linear Rec.2020, as LightBench's; the matrix here is LightBench's Rec.2020 → XYZ
// (D65, engine/color/matrix.ts), where darktable goes through its ICC profile's D50 matrix and CAT16 back to D65
// (colorequal.c `process`, STEP 0). The difference is a rounding of the chromatic adaptation.

import { REC2020_TO_XYZ, XYZ_TO_REC2020, type Vec3 } from './matrix'

/** darktable's D65 white chromaticity (src/common/colorspaces.h, `D65xyY`). */
export const D65_XY: [number, number] = [0.31271, 0.32902]
/** darktable's NORM_MIN, 2^-16 (src/common/math.h). */
export const NORM_MIN = 1.52587890625e-5

const L_STAR_RANGE = 2.098883786377
const L_STAR_UPPER = 2.09885

export function yToLStar(y: number): number {
  const yh = Math.pow(Math.max(y, 0), 0.631651345306265)
  return (L_STAR_RANGE * yh) / (yh + 1.12426773749357)
}

export function lStarToY(l: number): number {
  return Math.pow((1.12426773749357 * l) / (L_STAR_RANGE - l), 1.5831518565279648)
}

/** XYZ D65 → xyY (negative XYZ clipped to 0; black reads as D65's chromaticity), darktable `dt_D65_XYZ_to_xyY`. */
export function xyzToXyY(xyz: readonly number[]): Vec3 {
  const x = Math.max(xyz[0], 0)
  const y = Math.max(xyz[1], 0)
  const z = Math.max(xyz[2], 0)
  const sum = x + y + z
  return sum > 0 ? [x / sum, y / sum, y] : [D65_XY[0], D65_XY[1], y]
}

export function xyYToXyz(xyY: readonly number[]): Vec3 {
  if (xyY[1] === 0) return [0, 0, 0]
  return [(xyY[2] * xyY[0]) / xyY[1], xyY[2], (xyY[2] * (1 - xyY[0] - xyY[1])) / xyY[1]]
}

const FLT_MIN = 1.17549435e-38

/** xy (D65) → U*′V*′, darktable `xyY_to_dt_UCS_UV`. */
export function xyToUv(x: number, y: number): [number, number] {
  let u = -0.783941002840055 * x + 0.277512987809202 * y + 0.153836578598858
  let v = 0.745273540913283 * x - 0.205375866083878 * y - 0.165478376301988
  const d = 0.318707282433486 * x + 2.16743692732158 * y + 0.291320554395942
  const div = d >= 0 ? Math.max(FLT_MIN, d) : Math.min(-FLT_MIN, d)
  u /= div
  v /= div
  const us = (1.39656225667 * u) / (Math.abs(u) + 1.49217352929)
  const vs = (1.4513954287 * v) / (Math.abs(v) + 1.52488637914)
  return [-1.124983854323892 * us - 0.980483721769325 * vs, 1.86323315098672 * us + 1.971853092390862 * vs]
}

/** L*, U*′V*′ → JCH (cz = 1), darktable `dt_UCS_LUV_to_JCH`. */
export function luvToJch(l: number, lWhite: number, u: number, v: number): Vec3 {
  const m2 = u * u + v * v
  return [l / lWhite, (15.932993652962535 * Math.pow(l, 0.6523997524738018) * Math.pow(m2, 0.6007557017508491)) / lWhite, Math.atan2(v, u)]
}

/** JCH → xyY, darktable `dt_UCS_JCH_to_xyY`. */
export function jchToXyY(j: number, c: number, h: number, lWhite: number): Vec3 {
  const l = Math.min(Math.max(j * lWhite, 0), L_STAR_UPPER)
  const m = l !== 0 ? Math.pow((c * lWhite) / (15.932993652962535 * Math.pow(l, 0.6523997524738018)), 0.8322850678616855) : 0
  const up = m * Math.cos(h)
  const vp = m * Math.sin(h)
  const us = -5.037522385190711 * up - 2.504856328185843 * vp
  const vs = 4.760029407436461 * up + 2.874012963239247 * vp
  const u = (-1.49217352929 * us) / (Math.abs(us) - 1.39656225667)
  const v = (-1.52488637914 * vs) / (Math.abs(vs) - 1.4513954287)
  const x = 0.167171472114775 * u + 0.141299802443708 * v - 0.00801531300850582
  const y = -0.150959086409163 * u - 0.155185060382272 * v - 0.00843312433578007
  const d = 0.940254742367256 * u + 1.0 * v - 0.0256325967652889
  const div = d >= 0 ? Math.max(FLT_MIN, d) : Math.min(-FLT_MIN, d)
  return [x / div, y / div, lStarToY(l)]
}

export function jchToHsb(j: number, c: number, h: number): Vec3 {
  const b = j * (Math.pow(c, 1.33654221029386) + 1)
  return [h, b > 0 ? c / b : 0, b]
}

export function hsbToJch(h: number, s: number, b: number): Vec3 {
  const c = s * b
  return [b / (Math.pow(c, 1.33654221029386) + 1), c, h]
}

/** L* of the white level (darktable's "white level" in EV: Y_white = 2^EV; default +1 EV). */
export const whiteLStar = (whiteEv: number) => yToLStar(2 ** whiteEv)

const mat = (m: readonly number[], v: readonly number[]): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]

/** Linear Rec.2020 → [L*, U*′, V*′]. */
export function rec2020ToLuv(c: readonly number[]): Vec3 {
  const xyY = xyzToXyY(mat(REC2020_TO_XYZ, c))
  const [u, v] = xyToUv(xyY[0], xyY[1])
  return [yToLStar(xyY[2]), u, v]
}

/** Linear Rec.2020 → HSB (darktable's hue in radians). */
export function rec2020ToHsb(c: readonly number[], lWhite: number): Vec3 {
  const [l, u, v] = rec2020ToLuv(c)
  const [j, ch, h] = luvToJch(l, lWhite, u, v)
  return jchToHsb(j, ch, h)
}

/** HSB → linear Rec.2020. */
export function hsbToRec2020(hsb: readonly number[], lWhite: number): Vec3 {
  const [j, c, h] = hsbToJch(hsb[0], hsb[1], hsb[2])
  return mat(XYZ_TO_REC2020, xyYToXyz(jchToXyY(j, c, h, lWhite)))
}

// ---- the gamut boundary (darktable_ucs_22_helpers.h)

/** darktable's LUT_ELEM (src/common/math.h): hue tables have 512 entries over [−π, π). */
export const LUT_ELEM = 512

function deltaH(a: number, b: number): number {
  let d = a - b
  if (d < -Math.PI) d += 2 * Math.PI
  if (d > Math.PI) d -= 2 * Math.PI
  return d
}

/**
 * The gamut boundary of an RGB space as the square of the colourfulness M² of its boundary per hue (512 entries over
 * [−π, π)), darktable `dt_UCS_22_build_gamut_LUT`: the triangle of the primaries in xy is marched in 0.02° steps.
 */
export function buildGamutLut(rgbToXyz: readonly number[] = REC2020_TO_XYZ): Float64Array {
  const lut = new Float64Array(LUT_ELEM)
  const count = new Float64Array(LUT_ELEM)
  const prim = [0, 1, 2].map((i) => xyzToXyY(mat(rgbToXyz, [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0])))
  const [red, green, blue] = prim
  const [wx, wy] = D65_XY
  const hRed = Math.atan2(red[1] - wy, red[0] - wx)
  const hGreen = Math.atan2(green[1] - wy, green[0] - wx)
  const hBlue = Math.atan2(blue[1] - wy, blue[0] - wx)
  const steps = 50 * LUT_ELEM
  for (let i = 0; i < steps; i++) {
    const angle = -Math.PI + (i / steps) * 2 * Math.PI
    const tan = Math.tan(angle)
    const t1 = deltaH(angle, hBlue) / deltaH(hRed, hBlue)
    const t2 = deltaH(angle, hRed) / deltaH(hGreen, hRed)
    const t3 = deltaH(angle, hGreen) / deltaH(hBlue, hGreen)
    let xt = 0
    let yt = 0
    const edge = (a: Vec3, b: Vec3) => {
      const t = (wy - a[1] + tan * (a[0] - wx)) / (b[1] - a[1] + tan * (a[0] - b[0]))
      xt = a[0] + t * (b[0] - a[0])
      yt = a[1] + t * (b[1] - a[1])
    }
    if (t1 >= 0 && t1 <= 1) edge(blue, red)
    else if (t2 >= 0 && t2 <= 1) edge(red, green)
    else if (t3 >= 0 && t3 <= 1) edge(green, blue)
    const [u, v] = xyToUv(xt, yt)
    const hue = Math.atan2(v, u)
    let index = Math.round(((LUT_ELEM - 1) * (hue + Math.PI)) / (2 * Math.PI))
    if (index < 0) index += LUT_ELEM
    if (index >= LUT_ELEM) index -= LUT_ELEM
    lut[index] += u * u + v * v
    count[index] += 1
  }
  for (let k = 0; k < LUT_ELEM; k++) lut[k] /= Math.max(1, count[k])
  return lut
}

/** A hue table at a hue angle (radians, −π…π), linearly interpolated and periodic: darktable `lookup_gamut`. */
export function lookupHue(lut: ArrayLike<number>, hue: number): number {
  const x = (LUT_ELEM * (hue + Math.PI)) / (2 * Math.PI)
  const x0 = Math.floor(x)
  const x1 = Math.ceil(x)
  const i0 = x0 & (LUT_ELEM - 1)
  const i1 = x1 & (LUT_ELEM - 1)
  const y0 = lut[i0]
  return y0 + (i0 !== i1 ? (x - x0) * (lut[i1] - y0) : 0)
}

/** darktable `soft_clip`: exponential roll-off above `soft`, approaching `hard`. */
export function softClip(x: number, soft: number, hard: number): number {
  const norm = hard - soft
  return x > soft ? soft + (1 - Math.exp(-(x - soft) / norm)) * norm : x
}

/** The saturation of the gamut boundary at a pixel's hue and brightness (darktable `gamut_map_HSB`'s first half). */
export function boundarySaturation(hsb: readonly number[], gamut: ArrayLike<number>, lWhite: number): number {
  const [j, , h] = hsbToJch(hsb[0], hsb[1], hsb[2])
  const m2 = lookupHue(gamut, h)
  const maxC = (15.932993652962535 * Math.pow(Math.max(j * lWhite, 0), 0.6523997524738018) * Math.pow(m2, 0.6007557017508491)) / lWhite
  return jchToHsb(j, maxC, h)[1]
}

/** darktable `gamut_map_HSB`: saturation soft-clipped at constant brightness between 80 % and 100 % of the boundary. */
export function gamutMapHsb(hsb: readonly number[], gamut: ArrayLike<number>, lWhite: number): Vec3 {
  const m = boundarySaturation(hsb, gamut, lWhite)
  return [hsb[0], softClip(hsb[1], 0.8 * m, m), hsb[2]]
}
