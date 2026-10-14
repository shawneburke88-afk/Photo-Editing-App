// Colour Grading (owner's decisions, 2026-10-14; docs/research/COLOUR_GRADING.md and docs/PHASE3.md Part 17).
//
// Lightroom's Color Grading controls (Shadows, Midtones, Highlights and Global wheels, each with a hue, a saturation and a
// luminance; Blending; Balance) on darktable's **color balance rgb** (src/iop/colorbalancergb.c, commit 6271f53; © the
// darktable developers, GPL-3.0-or-later), translated to WGSL (engine/gpu/colour-grading.wgsl); this file is its CPU twin
// and holds the settings. It runs on the scene-referred image before the sigmoid, after the Colour Mixer (darktable's
// v5.0 order: colorequal 41.2, colorbalancergb 41.5, sigmoid 45.3; src/common/iop_order.c lines 380-388).
//
// The colour spaces are darktable's: CIE 2006 LMS, Kirk's Filmlight Yrg / "grading RGB" (colorbalancergb.c `process`,
// src/common/colorspaces_inline_conversions.h lines 1082-1330), and darktable UCS 22 for the perceptual saturation and
// brilliance and the gamut mapping (engine/color/ucs.ts).
//
// The wheels drive darktable's "4 ways" tab (owner's decision 1):
//  - Shadows → shadows lift, Highlights → highlights gain: per-channel slopes 1 + tint + luminance under darktable's
//    shadows and highlights masks.
//  - Midtones → power: per-channel exponents 1 / (1 + tint), and luminance as the Y power, normalised by the white fulcrum
//    (unmasked, as darktable's).
//  - Global → darktable's global offset (tint + white × luminance), **added in proportion to each pixel's own luminance**
//    (owner's decision 2: an even tint over all tones; LightBench's change, see `resolveGrading`).
//  - Blending → both masks' fall-off; Balance → the masks' middle-grey fulcrum (LightBench's mapping, below).
// The rest of darktable's module (hue shift, vibrance, contrast, linear chroma, perceptual saturation and brilliance per
// range, separate fall-offs, white and contrast fulcrums) is under Advanced.
//
// LightBench's changes to darktable's maths (each in Part 17):
//  - A grade that changes nothing is not run at all (`gradingActive`), so an edit without one renders exactly as before.
//  - The stage adds only what the grade changes: the pixel plus (graded − graded with neutral settings). darktable's
//    module changes colours merely by being enabled (its gamut mapping is always on, it clips negative values, and its
//    saturation step soft-limits very saturated colours: its manual says so). Subtracting the same steps run with
//    neutral settings means those steps apply only as much as the grade adds: a neutral grade is exactly no change and a
//    tiny change makes a tiny difference.
//  - The pipeline's Rec.2020 → XYZ matrix is LightBench's (D65), where darktable goes through its ICC profile's D50 matrix
//    and CAT16; the Yrg white point (darktable's constants 0.21902143, 0.54371398, sRGB's white through that D50 path) is
//    computed from the same matrices, so a grey is exactly neutral in Yrg.
//  - darktable's LMS ↔ XYZ and LMS ↔ grading RGB pairs are written to 6–8 digits; the inverses are computed here, so a
//    round trip is exact.
//  - Hues are Lightroom-style (the hue of an sRGB colour, 0 red, 120 green, 240 blue), turned into Yrg angles through the
//    sRGB colour at that hue (HSV saturation 50 %, as the Colour Mixer's band centres; LightBench's choice).

import { apply, invert, REC2020_TO_XYZ, SRGB_TO_REC2020, XYZ_TO_REC2020, type Mat3, type Vec3 } from '../color/matrix'
import { jchToXyY, lookupHue, luvToJch, xyToUv, xyYToXyz, xyzToXyY, yToLStar } from '../color/ucs'
import { gamutLut, hsvLinear } from './colour-mixer'

export const WHEEL_KEYS = ['shadows', 'midtones', 'highlights', 'global'] as const
export type WheelKey = (typeof WHEEL_KEYS)[number]
export const WHEEL_NAMES: Record<WheelKey, string> = { shadows: 'Shadows', midtones: 'Midtones', highlights: 'Highlights', global: 'Global' }

/** One wheel: hue 0…359 (degrees, Lightroom-style), saturation 0…100, luminance −100…100. */
export interface GradingWheel {
  hue: number
  sat: number
  lum: number
}

/** darktable's settings under Advanced, LightBench's units (darktable's in brackets). Per-range lists: global, shadows, midtones, highlights. */
export interface GradingAdvanced {
  /** "hue shift", degrees −180…180. */
  hueShift: number
  /** "global vibrance", −100…100 % (−1…1). */
  vibrance: number
  /** "contrast", −100…100 % (−1…1). */
  contrast: number
  /** "linear chroma" global, shadows, mid-tones, highlights, −100…100 % (−1…1). */
  chroma: number[]
  /** "perceptual saturation", the same. */
  saturation: number[]
  /** "perceptual brilliance", the same. */
  brilliance: number[]
  /** "shadows fall-off" and "highlights fall-off" (0…3); absent = from Blending. */
  shadowsFalloff?: number
  highlightsFalloff?: number
  /** "white fulcrum", EV −16…16 (0). */
  whiteFulcrum: number
  /** "contrast gray fulcrum", % 1…100 (18.45). */
  contrastFulcrum: number
}

export interface ColourGradingSettings {
  shadows: GradingWheel
  midtones: GradingWheel
  highlights: GradingWheel
  global: GradingWheel
  /** 0…100 (50): how much the shadows and highlights ranges overlap. */
  blending: number
  /** −100…100 (0): positive moves the split towards the shadows, so the highlights' tint reaches further down. */
  balance: number
  /** darktable's settings; absent at their defaults. */
  advanced?: GradingAdvanced
}

const ZERO_WHEEL: GradingWheel = { hue: 0, sat: 0, lum: 0 }
/** Blending 50 and Balance 0: Lightroom's defaults according to the brief's sources [unverified against Adobe]. */
export const DEFAULT_GRADING: ColourGradingSettings = { shadows: ZERO_WHEEL, midtones: ZERO_WHEEL, highlights: ZERO_WHEEL, global: ZERO_WHEEL, blending: 50, balance: 0 }
export const DEFAULT_GRADING_ADVANCED: GradingAdvanced = { hueShift: 0, vibrance: 0, contrast: 0, chroma: [0, 0, 0, 0], saturation: [0, 0, 0, 0], brilliance: [0, 0, 0, 0], whiteFulcrum: 0, contrastFulcrum: 18.45 }
/** Range names for the Advanced lists (darktable's order there: global, shadows, mid-tones, highlights). */
export const RANGE_NAMES = ['Global', 'Shadows', 'Mid-tones', 'Highlights'] as const

// ---- scales (LightBench's: Lightroom's aren't public; owner's decision 4, tuned by eye on test photos, Part 17)

/** darktable chroma (Yrg) at Saturation 100, per wheel. darktable's own sliders reach 1.0, which is far stronger. */
export const CHROMA_AT_100: Record<WheelKey, number> = { shadows: 0.1, midtones: 0.08, highlights: 0.12, global: 0.08 }
/** darktable luminance at Luminance ±100, per wheel (darktable's sliders run −1…1). */
export const LUM_AT_100: Record<WheelKey, number> = { shadows: 0.5, midtones: 0.25, highlights: 0.5, global: 0.4 }
/** Balance ±100 moves the masks' middle-grey fulcrum by ∓ this many EV (positive Balance favours the highlights). */
export const BALANCE_EV = 2
/** The HSV saturation of the sRGB colour whose Yrg hue a wheel's hue stands for (as the Colour Mixer's band centres). */
export const HUE_HSV_SATURATION = 0.5

/** Blending → darktable's fall-off (both masks): 0 → 3 (hardest), 50 → 1 (darktable's default), 100 → 0 (softest). */
export function falloffOf(blending: number): number {
  const b = clamp(blending, 0, 100)
  return b >= 50 ? 1 - (b - 50) / 50 : 1 + ((50 - b) / 50) * 2
}

// ---- darktable's colour spaces

/** darktable's CIE 1931 XYZ D65 → CIE 2006 LMS D65 (Kirk 2019), rows. */
export const XYZ_TO_LMS: Mat3 = [0.257085, 0.859943, -0.031061, -0.394427, 1.1758, 0.106423, 0.064856, -0.07625, 0.559067]
export const LMS_TO_XYZ = invert(XYZ_TO_LMS)
/** darktable's Filmlight grading RGB → LMS (`filmlightRGB_D65_to_LMS_D65_trans`, as rows). */
export const GRADING_TO_LMS: Mat3 = [0.95, 0.38, 0, 0.05, 0.62, 0.03, 0, 0, 0.97]
export const LMS_TO_GRADING = invert(GRADING_TO_LMS)
const mul3 = (a: Mat3, b: Mat3): Mat3 => {
  const o = new Array(9).fill(0) as number[]
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[3 * r + c] += a[3 * r + k] * b[3 * k + c]
  return o as Mat3
}
/** Linear Rec.2020 → LMS. */
export const REC2020_TO_LMS = mul3(XYZ_TO_LMS, REC2020_TO_XYZ)
/** darktable's luminance weights of L and M (`LMS_to_Yrg`). */
const Y_L = 0.68990272
const Y_M = 0.34832189

function lmsToYrg(lms: readonly number[]): Vec3 {
  const y = Y_L * lms[0] + Y_M * lms[1]
  const a = lms[0] + lms[1] + lms[2]
  const n = a === 0 ? [0, 0, 0] : [lms[0] / a, lms[1] / a, lms[2] / a]
  const rgb = apply(LMS_TO_GRADING, n as Vec3)
  return [y, rgb[0], rgb[1]]
}

function yrgToLms(yrg: readonly number[]): Vec3 {
  const lms = apply(GRADING_TO_LMS, [yrg[1], yrg[2], 1 - yrg[1] - yrg[2]])
  const d = Y_L * lms[0] + Y_M * lms[1]
  const a = d === 0 ? 0 : yrg[0] / d
  return [lms[0] * a, lms[1] * a, lms[2] * a]
}

/** The Yrg chromaticity of white (Rec.2020 1, 1, 1 through LightBench's matrices): darktable's D65_r, D65_g. */
export const WHITE_RG: [number, number] = (() => {
  const yrg = lmsToYrg(apply(REC2020_TO_LMS, [1, 1, 1]))
  return [yrg[1], yrg[2]]
})()

/** Ych: luminance, chroma, cos and sin of the hue (darktable `Yrg_to_Ych`, `make_Ych`). */
type Ych = [number, number, number, number]

const ychToYrg = (y: Ych): Vec3 => [y[0], y[1] * y[2] + WHITE_RG[0], y[1] * y[3] + WHITE_RG[1]]

/** darktable `Ych_to_gradingRGB`. */
const ychToGrading = (y: Ych): Vec3 => apply(LMS_TO_GRADING, yrgToLms(ychToYrg(y)))

/** A linear Rec.2020 colour's Yrg luminance, chroma and hue angle (radians), as the grade sees it. */
export function yrgOf(c: readonly number[]): Vec3 {
  const yrg = lmsToYrg(apply(REC2020_TO_LMS, [c[0], c[1], c[2]]))
  const r = yrg[1] - WHITE_RG[0]
  const g = yrg[2] - WHITE_RG[1]
  return [yrg[0], Math.hypot(r, g), Math.atan2(g, r)]
}

/** The Yrg hue angle (radians) of a Lightroom-style hue (degrees): the hue of the sRGB colour at that hue. */
export function yrgHueOf(hue: number): number {
  const h = ((hue % 360) + 360) % 360
  const yrg = lmsToYrg(apply(REC2020_TO_LMS, apply(SRGB_TO_REC2020, hsvLinear(h, HUE_HSV_SATURATION))))
  return Math.atan2(yrg[2] - WHITE_RG[1], yrg[1] - WHITE_RG[0])
}

/** darktable's GUI hue (red near 0°: the Yrg angle + 30°) of a Lightroom-style hue, for Advanced's notes. */
export const darktableHueOf = (hue: number) => {
  const d = (yrgHueOf(hue) * 180) / Math.PI + 30
  return ((d % 360) + 360) % 360
}

// ---- resolved parameters (what the shader's Grade uniform holds)

export interface GradingResolved {
  /** RGB offset added × the pixel's Yrg luminance (darktable's global offset; LightBench's luminance scaling). */
  global: Vec3
  shadows: Vec3
  highlights: Vec3
  /** Per-channel exponents and the luminance exponent. */
  midtones: Vec3
  midtonesY: number
  /** darktable's mask weights (2 + 2 fall-off) and the mid-tones' weight; the mask fulcrum (already ^0.41). */
  shadowsWeight: number
  highlightsWeight: number
  midtonesWeight: number
  maskFulcrum: number
  /** Per range: shadows, mid-tones, highlights; and the global values. */
  chroma: Vec3
  chromaGlobal: number
  saturation: Vec3
  saturationGlobal: number
  brilliance: Vec3
  brillianceGlobal: number
  vibrance: number
  /** 1 + contrast. */
  contrast: number
  greyFulcrum: number
  whiteFulcrum: number
  lWhite: number
  hueCos: number
  hueSin: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const DEG = Math.PI / 180
/** darktable: the masks are measured on Y^0.41012, which puts middle grey at 50 %. */
export const MASK_POWER = 0.4101205819200422
export const MIDDLE_GREY = 0.1845

const wheelOf = (g: ColourGradingSettings, k: WheelKey) => g[k]
/** The wheel's colour in grading RGB at luminance 1 (darktable `make_Ych` + `Ych_to_gradingRGB`). */
const wheelRgb = (w: GradingWheel, k: WheelKey): Vec3 => {
  const c = (clamp(w.sat, 0, 100) / 100) * CHROMA_AT_100[k]
  const h = yrgHueOf(w.hue)
  return ychToGrading([1, c, Math.cos(h), Math.sin(h)])
}

/**
 * darktable's `commit_params`, from LightBench's settings. The per-pixel maths is darktable's; how a wheel becomes its
 * parameters is LightBench's closest match (owner's decision 4), so that a grey takes the wheel's colour:
 *  - darktable turns a wheel's (hue, chroma) into the colour T (grading RGB at luminance 1) and uses T − white as the
 *    tint: slopes 1 + (T − white), exponents 1 / (1 + T − white), offset T − white. Grading RGB's white isn't (1, 1, 1),
 *    so a slope or a power tints a grey towards another hue than T's, by an amount that depends on the hue (Part 17).
 *  - LightBench: slopes T / white (a grey in the shadows becomes exactly T, times its luminance); exponents chosen so
 *    that middle grey becomes T (p = ln(T·x₀) / ln(white·x₀), x₀ = middle grey over the white fulcrum); the offset is
 *    darktable's (T − white, which already turns a grey into T).
 */
export function resolveGrading(g: ColourGradingSettings): GradingResolved {
  const adv = g.advanced ?? DEFAULT_GRADING_ADVANCED
  const norm = ychToGrading([1, 0, 1, 0])
  const lum = (k: WheelKey) => (clamp(wheelOf(g, k).lum, -100, 100) / 100) * LUM_AT_100[k]
  const tg = wheelRgb(g.global, 'global')
  const ts = wheelRgb(g.shadows, 'shadows')
  const th = wheelRgb(g.highlights, 'highlights')
  const tm = wheelRgb(g.midtones, 'midtones')
  const whiteFulcrum = 2 ** clamp(adv.whiteFulcrum, -16, 16)
  const x0 = Math.min(0.9, MIDDLE_GREY / whiteFulcrum)
  const exponent = (c: number) => Math.log(Math.max(1e-6, tm[c] * x0)) / Math.log(norm[c] * x0)
  const f = falloffOf(g.blending)
  const sw = 2 + 2 * clamp(adv.shadowsFalloff ?? f, 0, 3)
  const hw = 2 + 2 * clamp(adv.highlightsFalloff ?? f, 0, 3)
  const pct = (v: number) => clamp(v, -100, 100) / 100
  const hue = clamp(adv.hueShift, -180, 180) * DEG
  return {
    global: [0, 1, 2].map((c) => tg[c] - norm[c] + norm[c] * lum('global')) as Vec3,
    shadows: [0, 1, 2].map((c) => ts[c] / norm[c] + lum('shadows')) as Vec3,
    highlights: [0, 1, 2].map((c) => th[c] / norm[c] + lum('highlights')) as Vec3,
    midtones: [0, 1, 2].map((c) => exponent(c)) as Vec3,
    midtonesY: 1 / Math.max(0.05, 1 + lum('midtones')),
    shadowsWeight: sw,
    highlightsWeight: hw,
    midtonesWeight: (sw * sw * hw * hw) / (sw * sw + hw * hw),
    maskFulcrum: Math.pow(MIDDLE_GREY * 2 ** ((-clamp(g.balance, -100, 100) / 100) * BALANCE_EV), MASK_POWER),
    chroma: [pct(adv.chroma[1]), pct(adv.chroma[2]), pct(adv.chroma[3])],
    chromaGlobal: pct(adv.chroma[0]),
    saturation: [pct(adv.saturation[1]), pct(adv.saturation[2]), pct(adv.saturation[3])],
    saturationGlobal: pct(adv.saturation[0]),
    brilliance: [pct(adv.brilliance[1]), pct(adv.brilliance[2]), pct(adv.brilliance[3])],
    brillianceGlobal: pct(adv.brilliance[0]),
    vibrance: pct(adv.vibrance),
    contrast: 1 + pct(adv.contrast),
    greyFulcrum: clamp(adv.contrastFulcrum, 1, 100) / 100,
    whiteFulcrum,
    lWhite: yToLStar(whiteFulcrum),
    hueCos: Math.cos(hue),
    hueSin: Math.sin(hue),
  }
}


/** darktable `opacity_masks`: shadows, mid-tones and highlights opacities at x = Y^0.41 (exp's argument kept within ±80). */
export function opacityMasks(x: number, r: Pick<GradingResolved, 'shadowsWeight' | 'highlightsWeight' | 'midtonesWeight' | 'maskFulcrum'>): Vec3 {
  const off = x - r.maskFulcrum
  const n = off / r.maskFulcrum
  const alpha = 1 / (1 + Math.exp(clamp(n * r.shadowsWeight, -80, 80)))
  const beta = 1 / (1 + Math.exp(clamp(-n * r.highlightsWeight, -80, 80)))
  const gamma = Math.exp((-off * off * r.midtonesWeight) / 4) * (1 - alpha) * (1 - alpha) * (1 - beta) * (1 - beta) * 8
  return [alpha, gamma, beta]
}

/** The masks at a scene luminance (linear Y), for the panel's and the tests' use. */
export const masksAt = (y: number, g: ColourGradingSettings = DEFAULT_GRADING) => opacityMasks(cgPow(Math.max(y, 0), MASK_POWER), resolveGrading(g))

const dot3 = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
/** x^y for x ≥ 0, 0 at 0 (the shader's `cgPow`). */
const cgPow = (x: number, y: number) => (x > 0 ? Math.pow(x, y) : 0)
/** darktable `soft_clip`, guarded where its range is empty (the shader's `cgSoftClip`). */
function cgSoftClip(x: number, soft: number, hard: number): number {
  if (!(x > soft) || !(hard > soft)) return x > hard ? hard : x
  const norm = hard - soft
  return soft + (1 - Math.exp(-(x - soft) / norm)) * norm
}

/**
 * darktable's color balance rgb on a pixel (colorbalancergb.c `process`, darktable UCS saturation formula), linear
 * Rec.2020. `neutral` runs the same steps with nothing changed: what `gradePixel` subtracts (see the header). The steps
 * follow colour-grading.wgsl `gradeSteps` line for line.
 */
export function gradeSteps(c: readonly number[], r: GradingResolved, neutral = false): Vec3 {
  const yrg0 = lmsToYrg(apply(REC2020_TO_LMS, [Math.max(c[0], 0), Math.max(c[1], 0), Math.max(c[2], 0)]))
  const r0 = yrg0[1] - WHITE_RG[0]
  const g0 = yrg0[2] - WHITE_RG[1]
  let ch = Math.hypot(g0, r0)
  let hc = 1
  let hs = 0
  if (ch !== 0) {
    hc = r0 / ch
    hs = g0 / ch
  }
  const lumY = Math.max(yrg0[0], 0)
  const masks = opacityMasks(cgPow(lumY, MASK_POWER), r)
  if (!neutral) {
    // Hue shift, then linear chroma and vibrance.
    const c2 = r.hueCos * hc - r.hueSin * hs
    const s2 = r.hueSin * hc + r.hueCos * hs
    hc = c2
    hs = s2
    const boost = r.chromaGlobal + dot3(masks, r.chroma)
    const vib = r.vibrance !== 0 ? r.vibrance * (1 - cgPow(ch, Math.abs(r.vibrance))) : 0
    ch *= Math.max(1 + boost + vib, 0)
  }
  // darktable `gamut_check_Yrg`.
  const yr = ch * hc + WHITE_RG[0]
  const yg = ch * hs + WHITE_RG[1]
  if (yr < 0) ch = Math.min(-WHITE_RG[0] / hc, ch)
  if (yg < 0) ch = Math.min(-WHITE_RG[1] / hs, ch)
  if (yr + yg > 1) ch = Math.min((1 - WHITE_RG[0] - WHITE_RG[1]) / (hc + hs), ch)
  let rgb = apply(LMS_TO_GRADING, yrgToLms([lumY, ch * hc + WHITE_RG[0], ch * hs + WHITE_RG[1]]))
  const wf = r.whiteFulcrum
  let yrg: Vec3
  if (neutral) {
    yrg = lmsToYrg(apply(GRADING_TO_LMS, rgb))
    yrg[0] = Math.max(yrg[0], 0)
  } else {
    // Global offset (× the pixel's luminance), lift and gain under the masks, then the power.
    const [a, , b] = masks
    rgb = [0, 1, 2].map((k) => (rgb[k] + r.global[k] * lumY) * ((1 - b) * (1 - a + a * r.shadows[k]) + b * r.highlights[k])) as Vec3
    rgb = [0, 1, 2].map((k) => (rgb[k] < 0 ? -1 : 1) * cgPow(Math.abs(rgb[k]) / wf, r.midtones[k]) * wf) as Vec3
    yrg = lmsToYrg(apply(GRADING_TO_LMS, rgb))
    yrg[0] = cgPow(Math.max(yrg[0] / wf, 0), r.midtonesY) * wf
    yrg[0] = r.greyFulcrum * cgPow(yrg[0] / r.greyFulcrum, r.contrast)
  }
  const xyz = apply(LMS_TO_XYZ, yrgToLms(yrg))
  // Perceptual saturation and brilliance (darktable UCS), then darktable's gamut mapping.
  const lw = r.lWhite
  const xyY = xyzToXyY(xyz)
  const [u, v] = xyToUv(xyY[0], xyY[1])
  const jch = luvToJch(yToLStar(xyY[2]), lw, u, v)
  const hue = jch[2]
  const C = jch[1]
  const B = jch[0] * (cgPow(C, 1.33654221029386) + 1)
  const radius = Math.hypot(C, B)
  const sinT = radius > 0 ? C / radius : 0
  const cosT = radius > 0 ? B / radius : 0
  const P = C
  const W = sinT * C + cosT * B
  let sa = 1
  let sb = 1
  if (!neutral) {
    sa = Math.max(1 + r.saturationGlobal + dot3(masks, r.saturation), 0)
    sb = Math.max(1 + r.brillianceGlobal + dot3(masks, r.brilliance), 0)
  }
  // darktable divides by max(FLT_MIN, C); for a grey the clip changes nothing, so it is skipped there.
  if (P > 1e-9) {
    const maxA = Math.hypot(P, W) / P
    sa = cgSoftClip(sa, 0.5 * maxA, maxA)
  }
  const P2 = (sa - 1) * P
  const W2 = Math.sqrt(Math.max(P * P * (1 - sa * sa) + W * W, 0)) * sb
  const C2 = Math.max(cosT * P2 + sinT * W2, 0)
  const B2 = Math.max(-sinT * P2 + cosT * W2, 0)
  const J2 = B2 / (cgPow(C2, 1.33654221029386) + 1)
  // darktable_ucs_22_helpers.h `gamut_map_HSB`: saturation soft-clipped at constant brightness.
  const maxChroma = (15.932993652962535 * cgPow(Math.max(J2 * lw, 0), 0.6523997524738018) * cgPow(lookupHue(gamutLut(), hue), 0.6007557017508491)) / lw
  const bb = J2 * (cgPow(maxChroma, 1.33654221029386) + 1)
  const boundS = bb > 0 ? maxChroma / bb : 0
  const S = cgSoftClip(B2 > 0 ? C2 / B2 : 0, 0.8 * boundS, boundS)
  const c3 = S * B2
  const j3 = B2 / (cgPow(c3, 1.33654221029386) + 1)
  const out = apply(XYZ_TO_REC2020, xyYToXyz(jchToXyY(j3, c3, hue, lw)))
  return [Math.max(out[0], 0), Math.max(out[1], 0), Math.max(out[2], 0)]
}

/** The grade on one pixel: the pixel plus what the grade changes (see the header). */
export function gradePixel(c: readonly number[], r: GradingResolved): Vec3 {
  const g = gradeSteps(c, r)
  const z = gradeSteps(c, r, true)
  return [c[0] + g[0] - z[0], c[1] + g[1] - z[1], c[2] + g[2] - z[2]]
}

/** The grade on an image (linear Rec.2020 before the sigmoid, RGB interleaved): the GPU's CPU twin. */
export function gradeImage(rgb: Float32Array | Float64Array, g: ColourGradingSettings): Float64Array {
  const r = resolveGrading(g)
  const out = new Float64Array(rgb.length)
  for (let i = 0; i < rgb.length; i += 3) out.set(gradePixel([rgb[i], rgb[i + 1], rgb[i + 2]], r), i)
  return out
}

// ---- when it runs

const wheelActive = (w: GradingWheel) => w.sat !== 0 || w.lum !== 0
const advancedActive = (a: GradingAdvanced | undefined) =>
  !!a && (a.hueShift !== 0 || a.vibrance !== 0 || a.contrast !== 0 || [...a.chroma, ...a.saturation, ...a.brilliance].some((v) => v !== 0))
export const wheelsActive = (g: ColourGradingSettings) => WHEEL_KEYS.some((k) => wheelActive(g[k]))
/** Whether the grade changes anything; otherwise the stage is skipped (and an edit renders as one without it). */
export const gradingActive = (g: ColourGradingSettings | undefined): g is ColourGradingSettings => !!g && (wheelsActive(g) || advancedActive(g.advanced))

// ---- for the GPU (the Grade uniform of colour-grading.wgsl)

/** 15 matrix rows, 11 parameter vectors, the flags and the 512-entry gamut table (128 × vec4). */
export const GRADING_UNIFORM_SIZE = 15 * 16 + 11 * 16 + 16 + 512 * 4

export interface ColourGradingGpu {
  key: string
  uniform: ArrayBuffer
}

const rows = (m: Mat3) => [m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0]

/** The Grade uniform (all zero = off). */
export function gradingUniform(r: GradingResolved): ArrayBuffer {
  const buf = new ArrayBuffer(GRADING_UNIFORM_SIZE)
  const f = new Float32Array(buf)
  const u = new Uint32Array(buf)
  f.set([...rows(REC2020_TO_LMS), ...rows(LMS_TO_XYZ), ...rows(XYZ_TO_REC2020), ...rows(GRADING_TO_LMS), ...rows(LMS_TO_GRADING)], 0)
  let o = 60
  const put = (v: number[]) => {
    f.set(v, o)
    o += 4
  }
  put([WHITE_RG[0], WHITE_RG[1], r.lWhite, r.whiteFulcrum])
  put([...r.global, 0])
  put([...r.shadows, 0])
  put([...r.highlights, 0])
  put([...r.midtones, r.midtonesY])
  put([r.shadowsWeight, r.highlightsWeight, r.midtonesWeight, r.maskFulcrum])
  put([...r.chroma, r.chromaGlobal])
  put([...r.saturation, r.saturationGlobal])
  put([...r.brilliance, r.brillianceGlobal])
  put([r.vibrance, r.contrast, r.greyFulcrum, 0])
  put([r.hueCos, r.hueSin, 0, 0])
  u[o] = 1
  f.set(gamutLut(), o + 4)
  return buf
}

let lastGpu: { key: string; gpu: ColourGradingGpu | null } | null = null

/** What the shader needs, or null when the grade changes nothing (the stage is skipped). */
export function colourGradingGpu(g: ColourGradingSettings | undefined): ColourGradingGpu | null {
  if (!gradingActive(g)) return null
  const key = JSON.stringify(g)
  if (lastGpu?.key === key) return lastGpu.gpu
  const gpu = { key, uniform: gradingUniform(resolveGrading(g)) }
  lastGpu = { key, gpu }
  return gpu
}

// ---- storing

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const int = (v: unknown, lo: number, hi: number, d: number) => (finite(v) ? Math.round(clamp(v, lo, hi)) + 0 : d)
const dec = (v: unknown, lo: number, hi: number, d: number, k = 100) => (finite(v) ? Math.round(clamp(v, lo, hi) * k) / k + 0 : d)
/** A hue as stored: a whole degree, 0…359 (360 wraps to 0). */
export const wrapHue = (h: number) => (((Math.round(h) % 360) + 360) % 360) + 0

function normalizeWheel(raw: unknown): GradingWheel {
  if (!raw || typeof raw !== 'object') return ZERO_WHEEL
  const w = raw as Partial<Record<keyof GradingWheel, unknown>>
  return { hue: finite(w.hue) ? wrapHue(w.hue) : 0, sat: int(w.sat, 0, 100, 0), lum: int(w.lum, -100, 100, 0) }
}

const list4 = (raw: unknown) => Array.from({ length: 4 }, (_, i) => (Array.isArray(raw) ? int(raw[i], -100, 100, 0) : 0))

function normalizeAdvanced(raw: unknown): GradingAdvanced | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const a = raw as Partial<Record<keyof GradingAdvanced, unknown>>
  const d = DEFAULT_GRADING_ADVANCED
  const out: GradingAdvanced = {
    hueShift: int(a.hueShift, -180, 180, 0),
    vibrance: int(a.vibrance, -100, 100, 0),
    contrast: int(a.contrast, -100, 100, 0),
    chroma: list4(a.chroma),
    saturation: list4(a.saturation),
    brilliance: list4(a.brilliance),
    whiteFulcrum: dec(a.whiteFulcrum, -16, 16, d.whiteFulcrum),
    contrastFulcrum: dec(a.contrastFulcrum, 1, 100, d.contrastFulcrum),
  }
  if (finite(a.shadowsFalloff)) out.shadowsFalloff = dec(a.shadowsFalloff, 0, 3, 1)
  if (finite(a.highlightsFalloff)) out.highlightsFalloff = dec(a.highlightsFalloff, 0, 3, 1)
  return JSON.stringify(out) === JSON.stringify(d) ? undefined : out
}

const sameWheel = (a: GradingWheel, b: GradingWheel) => a.hue === b.hue && a.sat === b.sat && a.lum === b.lum

/**
 * Colour Grading as stored in the develop settings, or undefined when it is absent or at its defaults (every wheel at
 * 0, Blending 50, Balance 0, darktable's settings at their defaults): an untouched or reset grade leaves no trace, so the
 * edit equals one made before Colour Grading existed. A hue chosen with Saturation 0 is kept (it renders nothing).
 */
export function normalizeColourGrading(raw: unknown): ColourGradingSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const g = raw as Partial<Record<keyof ColourGradingSettings, unknown>>
  const out: ColourGradingSettings = {
    shadows: normalizeWheel(g.shadows),
    midtones: normalizeWheel(g.midtones),
    highlights: normalizeWheel(g.highlights),
    global: normalizeWheel(g.global),
    blending: int(g.blending, 0, 100, 50),
    balance: int(g.balance, -100, 100, 0),
  }
  const adv = normalizeAdvanced(g.advanced)
  if (adv) out.advanced = adv
  const atDefaults = WHEEL_KEYS.every((k) => sameWheel(out[k], ZERO_WHEEL)) && out.blending === 50 && out.balance === 0 && !adv
  return atDefaults ? undefined : out
}

/** Settings with a grade set, or without the key when it is at its defaults (the same object when nothing changed). */
export function withColourGrading<S extends { colourGrading?: ColourGradingSettings }>(s: S, g: ColourGradingSettings | undefined): S {
  const n = normalizeColourGrading(g)
  if (JSON.stringify(n) === JSON.stringify(s.colourGrading) && (n !== undefined || !('colourGrading' in s))) return s
  const { colourGrading: _old, ...rest } = s
  void _old
  return (n ? { ...rest, colourGrading: n } : rest) as S
}

/** The grade of develop settings saved as JSON (none for missing or damaged settings). */
export function gradingOf(develop: string | null | undefined): ColourGradingSettings | undefined {
  try {
    if (develop) return normalizeColourGrading((JSON.parse(develop) as { colourGrading?: unknown }).colourGrading)
  } catch {
    // damaged settings: none
  }
  return undefined
}

// ---- presets' Amount

/**
 * A preset's Amount on the grade (LightCraft's way, crates/pipeline/src/profiles.rs): each wheel's hue and saturation
 * move as a colour vector (saturation × the hue's direction) from the photo's towards the preset's by `amount` (0…2), its
 * luminance, Blending, Balance and darktable's sliders linearly; the fall-off overrides follow the preset above 0 %.
 */
export function blendColourGrading(before: ColourGradingSettings | undefined, after: ColourGradingSettings | undefined, amount: number): ColourGradingSettings | undefined {
  if (!before && !after) return undefined
  if (amount === 1) return after
  if (amount === 0) return before
  const a = before ?? DEFAULT_GRADING
  const b = after ?? DEFAULT_GRADING
  const lerp = (x: number, y: number) => x + (y - x) * amount
  const wheel = (k: WheelKey): GradingWheel => {
    const p = a[k]
    const q = b[k]
    const vx = lerp(p.sat * Math.cos(p.hue * DEG), q.sat * Math.cos(q.hue * DEG))
    const vy = lerp(p.sat * Math.sin(p.hue * DEG), q.sat * Math.sin(q.hue * DEG))
    const sat = Math.round(clamp(Math.hypot(vx, vy), 0, 100))
    // With no colour left, the hue of whichever side has one (the preset's first).
    const hue = sat > 0 ? wrapHue((Math.atan2(vy, vx) * 180) / Math.PI) : q.sat > 0 ? q.hue : p.hue
    return { hue, sat, lum: Math.round(clamp(lerp(p.lum, q.lum), -100, 100)) }
  }
  const aa = a.advanced ?? DEFAULT_GRADING_ADVANCED
  const ba = b.advanced ?? DEFAULT_GRADING_ADVANCED
  const n = (x: number, y: number) => Math.round(lerp(x, y) * 100) / 100
  const adv: GradingAdvanced = {
    hueShift: Math.round(lerp(aa.hueShift, ba.hueShift)),
    vibrance: Math.round(lerp(aa.vibrance, ba.vibrance)),
    contrast: Math.round(lerp(aa.contrast, ba.contrast)),
    chroma: aa.chroma.map((v, i) => Math.round(lerp(v, ba.chroma[i]))),
    saturation: aa.saturation.map((v, i) => Math.round(lerp(v, ba.saturation[i]))),
    brilliance: aa.brilliance.map((v, i) => Math.round(lerp(v, ba.brilliance[i]))),
    whiteFulcrum: n(aa.whiteFulcrum, ba.whiteFulcrum),
    contrastFulcrum: n(aa.contrastFulcrum, ba.contrastFulcrum),
  }
  const fall = amount > 0 ? ba : aa
  if (fall.shadowsFalloff !== undefined) adv.shadowsFalloff = fall.shadowsFalloff
  if (fall.highlightsFalloff !== undefined) adv.highlightsFalloff = fall.highlightsFalloff
  return normalizeColourGrading({
    shadows: wheel('shadows'),
    midtones: wheel('midtones'),
    highlights: wheel('highlights'),
    global: wheel('global'),
    blending: Math.round(lerp(a.blending, b.blending)),
    balance: Math.round(lerp(a.balance, b.balance)),
    advanced: adv,
  })
}

// ---- words and colours for the panel

/** The grade in words (the paste checklist). */
export function describeGrading(g: ColourGradingSettings | undefined): string {
  if (!g) return 'none'
  const parts: string[] = []
  for (const k of WHEEL_KEYS) {
    const w = g[k]
    if (!wheelActive(w)) continue
    const bits = [w.sat ? `hue ${w.hue}°, saturation ${w.sat}` : '', w.lum ? `luminance ${w.lum > 0 ? '+' : ''}${w.lum}` : ''].filter(Boolean)
    parts.push(`${WHEEL_NAMES[k]} ${bits.join(', ')}`)
  }
  if (!parts.length && !advancedActive(g.advanced)) return 'no wheel moved'
  if (g.blending !== 50) parts.push(`Blending ${g.blending}`)
  if (g.balance !== 0) parts.push(`Balance ${g.balance > 0 ? '+' : ''}${g.balance}`)
  if (advancedActive(g.advanced)) parts.push('darktable settings changed')
  return parts.join('; ')
}

/**
 * The grade with Shadows', Midtones' and Highlights' saturation at 100 where they have a tint (Global left alone): what the
 * photo shows while Blending is Alt-dragged, Lightroom's preview aid (Adobe's help as quoted by jkost.com). A view only.
 */
export function boostedGrading(g: ColourGradingSettings | undefined): ColourGradingSettings | undefined {
  if (!g) return g
  const up = (w: GradingWheel): GradingWheel => (w.sat > 0 ? { ...w, sat: 100 } : w)
  return { ...g, shadows: up(g.shadows), midtones: up(g.midtones), highlights: up(g.highlights) }
}

/** An sRGB CSS colour for a wheel's hue at a saturation (0…1) and lightness (0…1), as on an HSL colour wheel. */
export const hueCss = (hue: number, sat = 1, light = 0.5) => `hsl(${wrapHue(hue)} ${Math.round(sat * 100)}% ${Math.round(light * 100)}%)`
