// The Colour Mixer and Point Color (owner's decisions, 2026-10-13; docs/research/COLOUR_MIXER_EFFECTS.md Part A and
// docs/PHASE3.md Part 15).
//
// Engine: darktable's colour equalizer (src/iop/colorequal.c, commit 6271f53; © the darktable developers,
// GPL-3.0-or-later), translated to WGSL (engine/gpu/colour-mixer.wgsl, colour-mixer-filter.wgsl); this file is its CPU
// twin and holds the settings. It works in darktable UCS 22 (engine/color/ucs.ts) on the scene-referred image before the
// sigmoid, after Basic's Vibrance and Saturation (darktable's place for it: iop_order.c v5.0, colorequal 41.2 before
// sigmoid 45.3). Per pixel: hue, saturation (S) and brightness (B) are looked up in three 512-entry hue tables (darktable's
// LUT_ELEM), weighted by the pixel's saturation so greys are left alone, smoothed by darktable's two guided filters (on by
// default) with the Scharr halo guard for brightness, and gamut-mapped to the working space (Rec.2020).
//
// LightBench's changes to darktable's maths (owner's decisions 2 and 3, and LightBench's own, each documented in Part 15):
//  - Band centres where Lightroom's bands are believed to be (`BAND_HSV`, LightCraft's guess), not darktable's 8 nodes
//    45° apart. Lightroom's real centres aren't published.
//  - The tables are built with LightCraft's raised-cosine partition of unity between neighbouring centres
//    (storytold/lightcraft crates/pipeline/src/colorops.rs `band_weights`, MIT/Apache-2.0) instead of darktable's periodic
//    RBF interpolation, which overshoots (one band at +100 pushes hues about 60° away by −14 %). Every hue is a convex
//    mix of at most two bands, so nothing overshoots and a band reaches exactly to its neighbours' centres.
//  - Darkening uses the reciprocal of darktable's brightness gain, so Luminance −100 never turns a colour black.
//  - The output keeps the pixel's own chromaticity; darktable's chroma prefilter only steers which corrections a pixel
//    gets (darktable also writes the prefiltered chromaticity out, which smooths chroma everywhere once the module is on).
//  - Gamut mapping applies only the compression a change adds (what darktable's map would do to the pixel as it came in
//    is taken off), so a pixel the mixer doesn't change stays exactly as it was and a tiny change makes a tiny difference.
//
// Point Color is LightBench's port of LightCraft's design (colorops.rs `PointK`: a soft box around a picked colour,
// Hue/Saturation/Luminance shifts, Variance, Range) to darktable UCS 22, applied after the bands, in order.

import { REC2020_TO_XYZ, XYZ_TO_REC2020, SRGB_TO_REC2020, apply, type Vec3 } from '../color/matrix'
import { buildGamutLut, hsbToJch, jchToHsb, jchToXyY, LUT_ELEM, luvToJch, lookupHue, NORM_MIN, rec2020ToLuv, softClip, whiteLStar, xyYToXyz } from '../color/ucs'

export const BAND_KEYS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const
export type BandKey = (typeof BAND_KEYS)[number]
/** Lightroom's band names (darktable's importer reads the same eight: src/develop/lightroom.c lines 621-764). */
export const BAND_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'] as const
/**
 * Band centres as HSV hues of sRGB colours: LightCraft's guess at Lightroom's (crates/develop/src/settings.rs
 * `MIXER_HUES`); Lightroom's own centres and widths aren't published.
 */
export const BAND_HSV = [0, 30, 60, 120, 180, 225, 270, 315] as const
/**
 * The HSV saturation (value 100 %) of the sRGB colours whose darktable UCS hue is taken as each band's centre. Fully
 * saturated sRGB colours lie on sRGB's gamut edge, where hue bends (HSV 30° is UCS 36° at full saturation, 54° at 50 %,
 * 61° at 25 %; HSV 225° and 270° are only 12° apart at full saturation): a middle saturation stands for the colours of
 * photographs. LightBench's choice.
 */
export const BAND_HSV_SATURATION = 0.5

export type MixerChannel = 'hue' | 'saturation' | 'luminance'
export const MIXER_CHANNELS: MixerChannel[] = ['hue', 'saturation', 'luminance']
export const CHANNEL_NAMES: Record<MixerChannel, string> = { hue: 'Hue', saturation: 'Saturation', luminance: 'Luminance' }

/** darktable's colour equalizer settings LightBench offers under Advanced (colorequal.c lines 99-146; their defaults). */
export interface MixerAdvanced {
  /** "use guided filter" (darktable: on). */
  guided: boolean
  /** "saturation threshold", 0…0.3 (darktable: 0.1). */
  threshold: number
  /** "contrast" of the saturation weight, −1…1 (darktable: 0). */
  contrast: number
  /** "white level", EV, −2…+2 here (darktable: +1; its soft range −2…+2). */
  whiteLevel: number
  /** "node placement": every band centre turned by this many degrees, −23…23 (darktable: 0). */
  placement: number
}

export const DEFAULT_ADVANCED: MixerAdvanced = { guided: true, threshold: 0.1, contrast: 0, whiteLevel: 1, placement: 0 }

/** One Point Color sample: a colour picked on the photo and how the colours around it change. */
export interface PointColour {
  /** The sampled colour as it reaches Point Color (after the bands), darktable UCS 22 HSB: hue (degrees), S, B. */
  hue: number
  saturation: number
  brightness: number
  /** −100…100 each. */
  hueShift: number
  satShift: number
  lumShift: number
  variance: number
  /** 0…100 (50): the overall range, and the hue, saturation and luminance ranges. */
  range: number
  hueRange: number
  satRange: number
  lumRange: number
}

export interface ColourMixerSettings {
  /** −100…100 per band, Lightroom's band order (Red … Magenta). */
  hue: number[]
  saturation: number[]
  luminance: number[]
  /** Point Color samples, in the order applied; absent when there are none. */
  points?: PointColour[]
  /** darktable's settings; absent at their defaults. */
  advanced?: MixerAdvanced
}

export const MAX_POINTS = 8
const ZEROS = [0, 0, 0, 0, 0, 0, 0, 0]
export const DEFAULT_COLOUR_MIXER: ColourMixerSettings = { hue: ZEROS, saturation: ZEROS, luminance: ZEROS }
export const DEFAULT_POINT_RANGES = { range: 50, hueRange: 50, satRange: 50, lumRange: 50 }

// ---- slider scales (LightBench's, owner's decision 5 / the research's A.5; Lightroom's aren't public)

/** Hue ±100 turns the band's colours by ±30° of darktable UCS hue (about to the neighbouring band). */
export const HUE_DEGREES = 30
/** Saturation: darktable's correction 1 + v/200, applied as S × (1 + 2 (corr − 1)): −100 is grey, +100 doubles S. */
export const satCorrection = (v: number) => 1 + v / 200
/**
 * Luminance: darktable's brightness table 1 + K·v/100 (K = 1 is darktable's full ±100 % slider), applied as
 * B × (1 + 8 S (table − 1)) for brightening and its reciprocal for darkening. Tuned by eye (Part 15).
 */
export const LUMINANCE_SCALE = 1
/**
 * Point Color: Hue Shift ±100 = ±30° of UCS hue, Saturation Shift −100 grey … +100 double S, Luminance Shift ±100 = B × 2^±0.5
 * (darktable UCS brightness follows lightness, about Y^0.49 at middle grey, so this is about ±1 EV of linear light in the
 * mid-tones). LightBench's scales, tuned by eye.
 */
export const POINT_LUM_LOG2B = 0.5
/** Point Color: Variance ±100 pulls the colours in the range 80 % towards the sample, or pushes them apart (LightCraft). */
export const POINT_VARIANCE = 0.8

const DEG = Math.PI / 180
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const wrap = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI))

// ---- band centres and weights

let hsvCentres: number[] | null = null

/** sRGB colour at an HSV hue (degrees), saturation s, value 1, linear. */
export function hsvLinear(h: number, s: number): Vec3 {
  const c = s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = 1 - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return [lin(r + m), lin(g + m), lin(b + m)]
}

/** The UCS hue (radians) of the sRGB colour at an HSV hue, at the bands' saturation. */
export function ucsHueOfHsv(h: number, s = BAND_HSV_SATURATION): number {
  const [, u, v] = rec2020ToLuv(apply(SRGB_TO_REC2020, hsvLinear(h, s)))
  return Math.atan2(v, u)
}

/** The eight band centres, darktable UCS hue in radians (−π…π), turned by `placement` degrees (darktable's node placement). */
export function bandCentres(placement = 0): number[] {
  hsvCentres ??= BAND_HSV.map((h) => ucsHueOfHsv(h))
  return hsvCentres.map((h) => wrap(h + placement * DEG))
}

/**
 * The bands' raised-cosine weights at a hue (LightCraft `band_weights`): between two neighbouring centres, the nearer one's
 * weight falls from 1 to 0 as ½ + ½ cos; every hue belongs to at most two bands and the weights sum to 1.
 */
export function bandWeights(h: number, centres: readonly number[]): number[] {
  const w = [0, 0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < 8; i++) {
    const a = centres[i]
    const j = (i + 1) % 8
    let span = wrap(centres[j] - a)
    if (span <= 0) span += 2 * Math.PI
    let d = wrap(h - a)
    if (d < 0) d += 2 * Math.PI
    if (d <= span) {
      const s = 0.5 - 0.5 * Math.cos((d / span) * Math.PI)
      w[i] += 1 - s
      w[j] += s
      break
    }
  }
  return w
}

// ---- tables

let gamut: Float64Array | null = null
/** Rec.2020's gamut boundary per UCS hue (darktable `dt_UCS_22_build_gamut_LUT`). */
export const gamutLut = () => (gamut ??= buildGamutLut())

export interface MixerTables {
  /** Per hue (512 entries over [−π, π)): hue offset (radians), saturation correction, brightness table, gamut M². */
  hue: Float64Array
  sat: Float64Array
  bright: Float64Array
  gamut: Float64Array
}

/** The hue tables of a mixer (darktable's LUT_hue, LUT_saturation, LUT_brightness and gamut_LUT). */
export function buildTables(m: ColourMixerSettings): MixerTables {
  const adv = m.advanced ?? DEFAULT_ADVANCED
  const centres = bandCentres(adv.placement)
  const hue = new Float64Array(LUT_ELEM)
  const sat = new Float64Array(LUT_ELEM)
  const bright = new Float64Array(LUT_ELEM)
  for (let i = 0; i < LUT_ELEM; i++) {
    // darktable samples its tables at i × 360° / LUT_ELEM − 180° (colorequal.c `_periodic_RBF_interpolate`).
    const h = (i * 2 * Math.PI) / LUT_ELEM - Math.PI
    const w = bandWeights(h, centres)
    let dh = 0
    let ds = 0
    let db = 0
    for (let k = 0; k < 8; k++) {
      if (!w[k]) continue
      dh += w[k] * m.hue[k]
      ds += w[k] * m.saturation[k]
      db += w[k] * m.luminance[k]
    }
    hue[i] = (dh / 100) * HUE_DEGREES * DEG
    sat[i] = Math.max(0, satCorrection(ds))
    bright[i] = Math.max(0, 1 + (LUMINANCE_SCALE * db) / 100)
  }
  return { hue, sat, bright, gamut: gamutLut() }
}

// ---- resolved parameters (what the shaders' Mixer uniform holds)

export interface PointK {
  /** hue (radians), S, J, log2 B. */
  sample: [number, number, number, number]
  /** hue shift (radians), saturation shift, luminance shift (log2 B), variance. */
  shift: [number, number, number, number]
  /** half-widths: hue (radians), saturation, lightness; 1 = near-neutral sample (hue ignored). */
  width: [number, number, number, number]
}

/** Point Color's range box (LightBench's widths in darktable UCS, after LightCraft's in OkLCh; tuned by eye). */
export function resolvePoint(p: PointColour, lWhite: number): PointK {
  const k = Math.max(0.05, clamp(p.range, 0, 100) / 50)
  const f = (v: number) => clamp(v, 0, 100) / 100
  const h = p.hue * DEG
  const [j] = hsbToJch(h, p.saturation, p.brightness)
  void lWhite
  return {
    sample: [h, p.saturation, j, Math.log2(Math.max(p.brightness, 1e-9))],
    shift: [(clamp(p.hueShift, -100, 100) / 100) * HUE_DEGREES * DEG, clamp(p.satShift, -100, 100) / 100, (clamp(p.lumShift, -100, 100) / 100) * POINT_LUM_LOG2B, (clamp(p.variance, -100, 100) / 100) * POINT_VARIANCE],
    width: [(0.1 + 0.6 * f(p.hueRange)) * k, (0.01 + 0.06 * f(p.satRange)) * k, (0.05 + 0.4 * f(p.lumRange)) * k, p.saturation < 0.01 ? 1 : 0],
  }
}

export const pointIsNeutral = (p: PointColour) => p.hueShift === 0 && p.satShift === 0 && p.lumShift === 0 && p.variance === 0

export interface MixerResolved {
  tables: MixerTables
  centres: number[]
  lWhite: number
  /** darktable: threshold → −0.015 + 0.3 (5 threshold)² (the default 0.1 → 0.06, "an inflection point at 6 %"). */
  satShift: number
  brightShift: number
  satSlope: number
  /** darktable's max_brightness: the largest brightness table node, at least 1. */
  maxBrightness: number
  bands: boolean
  guided: boolean
  points: PointK[]
}

export const bandsActive = (m: ColourMixerSettings) => [m.hue, m.saturation, m.luminance].some((a) => a.some((v) => v !== 0))

export function resolveMixer(m: ColourMixerSettings): MixerResolved {
  const adv = m.advanced ?? DEFAULT_ADVANCED
  const lWhite = whiteLStar(adv.whiteLevel)
  const satShift = -0.015 + 0.3 * (5 * adv.threshold) ** 2
  const maxBrightness = Math.max(1, ...m.luminance.map((v) => 1 + (LUMINANCE_SCALE * v) / 100))
  // darktable: bright_shift = sat_shift + 0.01 × max_brightness × min(5, √param_size), param_size 1.
  const brightShift = satShift + 0.01 * maxBrightness
  const bands = bandsActive(m)
  return {
    tables: buildTables(m),
    centres: bandCentres(adv.placement),
    lWhite,
    satShift,
    brightShift,
    satSlope: 30 + 20 * adv.contrast,
    maxBrightness,
    bands,
    guided: bands && adv.guided,
    points: (m.points ?? []).filter((p) => !pointIsNeutral(p)).slice(0, MAX_POINTS).map((p) => resolvePoint(p, lWhite)),
  }
}

// ---- the filter's radii (colorequal.c `_prepare_process`; hue analysis radius 1.5 px, effect radius 1 px)

export interface FilterPlan {
  /** Kernel radii and σ: hue analysis (prefilter), effect (guide), saturation blur, gradient blur, brightness blur. */
  rh: number
  rp: number
  rs: number
  rg: number
  rb: number
  sh: number
  sp: number
  ss: number
  sg: number
  sb: number
  gradAmp: number
  /** The margin a tile needs so its own pixels never see the tile's edge (the filters' combined reach). */
  pad: number
}

/** darktable's chroma_feathering and param_feathering (colorequal.c `commit_params`). */
export const EPS_HUE = 1e-5
export const EPS_PARAM = 1e-6
/** Drawings magnified past this (target pixels per photo pixel) use its radii (a 2× high-density screen at 100 %). */
export const MAX_FILTER_SCALE = 2

/**
 * The filters for a rendering at `scale` target pixels per full-size photo pixel. darktable: hue σ = 0.5 × 1.5 × scale,
 * effect σ = 0.5 × 1 × scale (each at least 0.2 px, `gsigma`), saturation and gradient σ = max(0.5, scale), brightness
 * corrections σ = 0.1 × effect σ, gradient gain 4 √(max brightness) × scale². Gaussians sampled to 3 σ.
 */
export function filterPlan(scale: number, maxBrightness: number): FilterPlan {
  const s = clamp(scale, 1e-4, MAX_FILTER_SCALE)
  const sh = Math.max(0.2, 0.75 * s)
  const sp = Math.max(0.2, 0.5 * s)
  const ss = Math.max(0.5, s)
  const sg = Math.max(0.5, s)
  const sb = 0.1 * sp
  const r = (sigma: number) => Math.max(1, Math.ceil(3 * sigma))
  const [rh, rp, rs, rg, rb] = [r(sh), r(sp), r(ss), r(sg), r(sb)]
  // The output reads guideApply's a, b (rp) ← guideStats (rp, rg, rb) ← prefilterApply (rh; Scharr 1) ← prefilterStats (rh, rs).
  const pad = rp + Math.max(rp, rg, rb) + Math.max(rh + Math.max(rh, rs), 1 + rs) + 1
  return { rh, rp, rs, rg, rb, sh, sp, ss, sg, sb, gradAmp: 4 * Math.sqrt(maxBrightness) * s * s, pad }
}

// ---- per pixel (colour-mixer.wgsl `mixApplyPixel`)

export const satWeight = (x: number, slope: number) => 1 / (1 + Math.exp(-slope * clamp(x, -1, 1 - 1 / 4096)))

export function rgbSaturation(c: readonly number[]): number {
  const mx = Math.max(c[0], c[1], c[2])
  const d = mx - Math.min(c[0], c[1], c[2])
  return mx > NORM_MIN && d > NORM_MIN ? d / mx : 0
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** How much a colour (hue, S, J) belongs to a point's range (LightCraft's soft box). */
export function pointWeight(p: PointK, h: number, s: number, j: number): number {
  const wh = p.width[3] >= 0.5 ? 1 : (1 - smooth(0.5 * p.width[0], p.width[0], Math.abs(wrap(h - p.sample[0])))) * smooth(0.005, 0.025, s)
  if (wh <= 0) return 0
  const ws = 1 - smooth(0.5 * p.width[1], p.width[1], Math.abs(s - p.sample[1]))
  const wl = 1 - smooth(0.5 * p.width[2], p.width[2], Math.abs(j - p.sample[2]))
  return wh * ws * wl
}

const brightGain = (x: number) => (x >= 0 ? 1 + x : 1 / (1 - x))

/** darktable `gamut_map_HSB`: the saturation of an HSB colour soft-clipped at its hue and lightness. */
export function softClipHsb(hsb: readonly number[], r: MixerResolved): number {
  const [j, , h] = hsbToJch(hsb[0], hsb[1], hsb[2])
  const mc = (15.932993652962535 * Math.pow(Math.max(j * r.lWhite, 0), 0.6523997524738018) * Math.pow(lookupHue(r.tables.gamut, h), 0.6007557017508491)) / r.lWhite
  const bound = jchToHsb(j, mc, h)[1]
  return softClip(hsb[1], 0.8 * bound, bound)
}

const toRgb = (j: number, c: number, h: number, lWhite: number): Vec3 => apply(XYZ_TO_REC2020, xyYToXyz(jchToXyY(j, c, h, lWhite)))

/** The pixel's HSB and JCH (darktable UCS 22). */
function ucsOf(c: readonly number[], lWhite: number) {
  const [l, u, v] = rec2020ToLuv(c)
  const jch = luvToJch(l, lWhite, u, v)
  return { jch, hsb: jchToHsb(jch[0], jch[1], jch[2]) }
}

/** The bands' corrections from the tables at the pixel's own hue (no guided filter): hue offset, saturation, brightness. */
export function tableCorrections(r: MixerResolved, c: readonly number[]): Vec3 {
  if (!r.bands) return [0, 1, 0]
  const { jch, hsb } = ucsOf(c, r.lWhite)
  if (!(jch[1] > NORM_MIN)) return [0, 1, 0]
  const t = r.tables
  return [lookupHue(t.hue, hsb[0]), lookupHue(t.sat, hsb[0]), hsb[1] * (lookupHue(t.bright, hsb[0]) - 1)]
}

/** The mixer and Point Color on one pixel (linear Rec.2020 before the sigmoid), with the bands' corrections `corr`. */
export function mixPixel(c: readonly number[], r: MixerResolved, corr: readonly number[] = tableCorrections(r, c)): Vec3 {
  const { jch, hsb } = ucsOf(c, r.lWhite)
  const [hc, sc, bc] = r.bands ? corr : [0, 1, 0]
  let changed = hc !== 0 || sc !== 1 || bc !== 0
  let h = hsb[0] + hc
  let s = Math.max(0, hsb[1] * (1 + 2 * (sc - 1)))
  let b = Math.max(0, hsb[2] * brightGain(8 * bc))
  for (const p of r.points) {
    const j = hsbToJch(h, s, b)[0]
    const w = pointWeight(p, h, s, j)
    if (w <= 0) continue
    changed = true
    const v = p.shift[3]
    h += w * (v * wrap(h - p.sample[0]) + p.shift[0])
    s = Math.max(0, (s + w * v * (s - p.sample[1])) * (1 + w * p.shift[1]))
    if (b > 0) b = 2 ** (Math.log2(b) + w * (v * (Math.log2(b) - p.sample[3]) + p.shift[2]))
  }
  if (!changed) return [c[0], c[1], c[2]]
  // Gamut: only the compression the change adds, never past the mapped value or the start (colour-mixer.wgsl explains).
  const mapped = softClipHsb([h, s, b], r)
  const had = hsb[1] - softClipHsb(hsb, r)
  s = Math.min(s - Math.max(0, s - mapped - had), Math.max(hsb[1], mapped))
  const [j2, c2] = hsbToJch(h, s, b)
  void jch
  return toRgb(j2, c2, h, r.lWhite)
}

// ---- the guided filter on a whole image (colour-mixer-filter.wgsl on one tile)

/**
 * The bands' corrections for an image (linear Rec.2020 before the sigmoid, RGB interleaved, w × h) drawn at `scale`, as
 * the GPU computes them: the image's edge repeated `pad` pixels around it, darktable's filters on that, the margin cut
 * off. Returns [hue offset, saturation correction, brightness correction] per pixel.
 */
export function guidedCorrections(rgb: Float32Array | Float64Array, w: number, h: number, r: MixerResolved, scale: number): Float64Array {
  const f = filterPlan(scale, r.maxBrightness)
  const P = f.pad
  const W = w + 2 * P
  const H = h + 2 * P
  const n = W * H
  // The input: U, V, RGB saturation, L*.
  const inp = new Float64Array(n * 4)
  for (let y = 0; y < H; y++) {
    const sy = clamp(y - P, 0, h - 1)
    for (let x = 0; x < W; x++) {
      const sx = clamp(x - P, 0, w - 1)
      const o = 3 * (sy * w + sx)
      const c = [rgb[o], rgb[o + 1], rgb[o + 2]]
      const [l, u, v] = rec2020ToLuv(c)
      inp.set([u, v, rgbSaturation(c), l], 4 * (y * W + x))
    }
  }
  const gauss = (d2: number, s: number) => Math.exp(-d2 / (2 * s * s))
  const at = (x: number, y: number) => clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)
  const coeffs = (cov: number[], corr: number[], eps: number): number[] => {
    const s0 = cov[0] + eps
    const s1 = cov[1]
    const s3 = cov[2] + eps
    const det = s0 * s3 - s1 * s1
    if (Math.abs(det) <= 4 * 1.1920929e-7) return [0, 0, 0, 0]
    const i0 = s3 / det
    const i1 = -s1 / det
    const i3 = s0 / det
    return [corr[0] * i0 + corr[1] * i1, corr[0] * i1 + corr[1] * i3, corr[2] * i0 + corr[3] * i1, corr[2] * i1 + corr[3] * i3]
  }
  // prefilterStats
  const A = new Float64Array(n * 4)
  const B = new Float64Array(n * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sw = 0, mu = 0, mv = 0, quu = 0, quv = 0, qvv = 0, ssw = 0, ss = 0
      const rr = Math.max(f.rh, f.rs)
      for (let dy = -rr; dy <= rr; dy++) {
        for (let dx = -rr; dx <= rr; dx++) {
          const k = 4 * at(x + dx, y + dy)
          const d2 = dx * dx + dy * dy
          if (Math.abs(dx) <= f.rh && Math.abs(dy) <= f.rh) {
            const g = gauss(d2, f.sh)
            sw += g
            mu += g * inp[k]
            mv += g * inp[k + 1]
            quu += g * inp[k] * inp[k]
            quv += g * inp[k] * inp[k + 1]
            qvv += g * inp[k + 1] * inp[k + 1]
          }
          if (Math.abs(dx) <= f.rs && Math.abs(dy) <= f.rs) {
            const g = gauss(d2, f.ss)
            ssw += g
            ss += g * inp[k + 2]
          }
        }
      }
      mu /= sw
      mv /= sw
      const cov = [quu / sw - mu * mu, quv / sw - mu * mv, qvv / sw - mv * mv]
      const a = coeffs(cov, [cov[0], cov[1], cov[1], cov[2]], EPS_HUE)
      const i = 4 * (y * W + x)
      A.set(a, i)
      B.set([mu - a[0] * mu - a[1] * mv, mv - a[2] * mu - a[3] * mv, ss / ssw, inp[i + 3]], i)
    }
  }
  // prefilterApply
  const C = new Float64Array(n * 4)
  const D = new Float64Array(n * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sw = 0
      const a = [0, 0, 0, 0]
      const b = [0, 0]
      for (let dy = -f.rh; dy <= f.rh; dy++) {
        for (let dx = -f.rh; dx <= f.rh; dx++) {
          const k = 4 * at(x + dx, y + dy)
          const g = gauss(dx * dx + dy * dy, f.sh)
          sw += g
          for (let q = 0; q < 4; q++) a[q] += g * A[k + q]
          b[0] += g * B[k]
          b[1] += g * B[k + 1]
        }
      }
      for (let q = 0; q < 4; q++) a[q] /= sw
      b[0] /= sw
      b[1] /= sw
      const i = 4 * (y * W + x)
      const u0 = inp[i]
      const v0 = inp[i + 1]
      const satB = B[i + 2]
      const L = B[i + 3]
      const cv = [a[0] * u0 + a[1] * v0 + b[0], a[2] * u0 + a[3] * v0 + b[1]]
      const wgt = satWeight(satB - r.satShift, r.satSlope)
      const u = wgt * (cv[0] - u0) + u0
      const v = wgt * (cv[1] - v0) + v0
      const jch = luvToJch(L, r.lWhite, u, v)
      const hsb = jchToHsb(jch[0], jch[1], jch[2])
      let corr = [0, 1, 0]
      if (jch[1] > NORM_MIN) corr = [lookupHue(r.tables.hue, hsb[0]), lookupHue(r.tables.sat, hsb[0]), hsb[1] * (lookupHue(r.tables.bright, hsb[0]) - 1)]
      const cx = clamp(x, 1, W - 2)
      const cy = clamp(y, 1, H - 2)
      const sv = (dx: number, dy: number) => B[4 * ((cy + dy) * W + cx + dx) + 2]
      const gx = (47 / 255) * (sv(-1, -1) - sv(1, -1) + sv(-1, 1) - sv(1, 1)) + (162 / 255) * (sv(-1, 0) - sv(1, 0))
      const gy = (47 / 255) * (sv(-1, -1) - sv(-1, 1) + sv(1, -1) - sv(1, 1)) + (162 / 255) * (sv(0, -1) - sv(0, 1))
      const gr = Math.max(0, Math.hypot(gx, gy) - 0.02)
      C.set([u, v, corr[0], corr[1]], i)
      D.set([corr[2], f.gradAmp * gr * gr, satB, L], i)
    }
  }
  // guideStats
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sw = 0, mu = 0, mv = 0, quu = 0, quv = 0, qvv = 0, sc = 0, bw = 0, bc = 0, gw = 0, gs = 0
      const cr = [0, 0, 0, 0]
      const rr = Math.max(f.rp, f.rg, f.rb)
      for (let dy = -rr; dy <= rr; dy++) {
        for (let dx = -rr; dx <= rr; dx++) {
          const k = 4 * at(x + dx, y + dy)
          const d2 = dx * dx + dy * dy
          const tu = C[k], tv = C[k + 1], ts = C[k + 3], ub = D[k]
          if (Math.abs(dx) <= f.rp && Math.abs(dy) <= f.rp) {
            const g = gauss(d2, f.sp)
            sw += g
            mu += g * tu
            mv += g * tv
            quu += g * tu * tu
            quv += g * tu * tv
            qvv += g * tv * tv
            sc += g * ts
            cr[0] += g * tu * ts
            cr[1] += g * tv * ts
            cr[2] += g * tu * ub
            cr[3] += g * tv * ub
          }
          if (Math.abs(dx) <= f.rb && Math.abs(dy) <= f.rb) {
            const g = gauss(d2, f.sb)
            bw += g
            bc += g * ub
          }
          if (Math.abs(dx) <= f.rg && Math.abs(dy) <= f.rg) {
            const g = gauss(d2, f.sg)
            gw += g
            gs += g * D[k + 1]
          }
        }
      }
      mu /= sw
      mv /= sw
      const cov = [quu / sw - mu * mu, quv / sw - mu * mv, qvv / sw - mv * mv]
      const msc = sc / sw
      const mbc = bc / bw
      const corr = [cr[0] / sw - mu * msc, cr[1] / sw - mv * msc, cr[2] / sw - mu * mbc, cr[3] / sw - mv * mbc]
      const a = coeffs(cov, corr, EPS_PARAM)
      const i = 4 * (y * W + x)
      A.set(a, i)
      B.set([msc - a[0] * mu - a[1] * mv, mbc - a[2] * mu - a[3] * mv, gs / gw, 0], i)
    }
  }
  // guideApply, on the image's own pixels only
  const out = new Float64Array(w * h * 3)
  for (let y = P; y < P + h; y++) {
    for (let x = P; x < P + w; x++) {
      let sw = 0
      const a = [0, 0, 0, 0]
      const b = [0, 0]
      for (let dy = -f.rp; dy <= f.rp; dy++) {
        for (let dx = -f.rp; dx <= f.rp; dx++) {
          const k = 4 * at(x + dx, y + dy)
          const g = gauss(dx * dx + dy * dy, f.sp)
          sw += g
          for (let q = 0; q < 4; q++) a[q] += g * A[k + q]
          b[0] += g * B[k]
          b[1] += g * B[k + 1]
        }
      }
      for (let q = 0; q < 4; q++) a[q] /= sw
      b[0] /= sw
      b[1] /= sw
      const i = 4 * (y * W + x)
      const cv = [a[0] * C[i] + a[1] * C[i + 1] + b[0], a[2] * C[i] + a[3] * C[i + 1] + b[1]]
      const satB = D[i + 2]
      const sat = 1 + (cv[0] - 1) * satWeight(satB - r.satShift, r.satSlope)
      const bright = cv[1] * (1 - clamp(B[i + 2], 0, 1)) * satWeight(satB - r.brightShift, r.satSlope)
      out.set([C[i + 2], sat, bright], 3 * ((y - P) * w + (x - P)))
    }
  }
  return out
}

/** The mixer on a whole image (linear Rec.2020 before the sigmoid, RGB interleaved) drawn at `scale`: the GPU's CPU twin. */
export function mixImage(rgb: Float32Array | Float64Array, w: number, h: number, m: ColourMixerSettings, scale: number): Float64Array {
  const r = resolveMixer(m)
  const corr = r.guided ? guidedCorrections(rgb, w, h, r, scale) : null
  const out = new Float64Array(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    const c = [rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2]]
    out.set(mixPixel(c, r, corr ? [corr[3 * i], corr[3 * i + 1], corr[3 * i + 2]] : undefined), 3 * i)
  }
  return out
}

// ---- for the GPU (the Mixer uniform of colour-mixer.wgsl, 544 bytes, and the 512 × 1 table texture)

export const MIXER_UNIFORM_SIZE = 544

export interface ColourMixerGpu {
  /** The tables' key: the engine uploads them again only when it changes. */
  key: string
  /** 512 × 4 floats: hue offset, saturation correction, brightness table, gamut M². */
  lut: Float32Array<ArrayBuffer>
  /** The Mixer uniform without the view's choices (visualize). */
  uniform: ArrayBuffer
  /** The guided filter runs (a pre-pass per tile). */
  guided: boolean
  maxBrightness: number
}

/** The Mixer uniform of a resolved mixer (or a neutral one, for Visualize with nothing set). */
export function mixerUniform(r: MixerResolved | null, visualize = 0): ArrayBuffer {
  const buf = new ArrayBuffer(MIXER_UNIFORM_SIZE)
  const f = new Float32Array(buf)
  const u = new Uint32Array(buf)
  const m = REC2020_TO_XYZ
  const n = XYZ_TO_REC2020
  f.set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0], 0)
  f.set([n[0], n[1], n[2], 0, n[3], n[4], n[5], 0, n[6], n[7], n[8], 0], 12)
  const rr = r ?? resolveMixer(DEFAULT_COLOUR_MIXER)
  f.set(rr.centres, 24)
  f.set([rr.lWhite, rr.satShift, rr.brightShift, rr.satSlope], 32)
  u[36] = r ? (r.bands ? 1 : 0) | (r.guided ? 2 : 0) | (r.points.length ? 4 : 0) : 0
  u[37] = r ? r.points.length : 0
  u[38] = visualize
  for (let i = 0; i < (r?.points.length ?? 0); i++) {
    const p = r!.points[i]
    f.set([...p.sample, ...p.shift, ...p.width], 40 + 12 * i)
  }
  return buf
}

let lastGpu: { key: string; gpu: ColourMixerGpu } | null = null

/** What the shaders need, or null when the mixer changes nothing. */
export function colourMixerGpu(m: ColourMixerSettings | undefined): ColourMixerGpu | null {
  if (!m) return null
  const key = JSON.stringify(m)
  if (lastGpu?.key === key) return lastGpu.gpu
  const r = resolveMixer(m)
  if (!r.bands && !r.points.length) return null
  const lut = new Float32Array(LUT_ELEM * 4)
  for (let i = 0; i < LUT_ELEM; i++) lut.set([r.tables.hue[i], r.tables.sat[i], r.tables.bright[i], r.tables.gamut[i]], 4 * i)
  const gpu: ColourMixerGpu = { key: JSON.stringify([m.hue, m.saturation, m.luminance, m.advanced?.placement ?? 0]), lut, uniform: mixerUniform(r), guided: r.guided, maxBrightness: r.maxBrightness }
  lastGpu = { key, gpu }
  return gpu
}

/** The tables of a mixer that changes nothing (Visualize alone). */
export function neutralMixerLut(): Float32Array<ArrayBuffer> {
  const t = buildTables(DEFAULT_COLOUR_MIXER)
  const lut = new Float32Array(LUT_ELEM * 4)
  for (let i = 0; i < LUT_ELEM; i++) lut.set([t.hue[i], t.sat[i], t.bright[i], t.gamut[i]], 4 * i)
  return lut
}

// ---- storing

const int = (v: unknown, lo: number, hi: number, d: number) => (finite(v) ? Math.round(clamp(v, lo, hi)) + 0 : d)
const bandArray = (raw: unknown) => Array.from({ length: 8 }, (_, i) => (Array.isArray(raw) ? int(raw[i], -100, 100, 0) : 0))

export function normalizePoint(raw: unknown): PointColour | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<Record<keyof PointColour, unknown>>
  if (!finite(p.hue) || !finite(p.saturation) || !finite(p.brightness)) return null
  return {
    hue: Math.round((((p.hue % 360) + 360) % 360) * 100) / 100,
    saturation: Math.round(clamp(p.saturation, 0, 4) * 1e5) / 1e5,
    brightness: Math.round(clamp(p.brightness, 0, 64) * 1e5) / 1e5,
    hueShift: int(p.hueShift, -100, 100, 0),
    satShift: int(p.satShift, -100, 100, 0),
    lumShift: int(p.lumShift, -100, 100, 0),
    variance: int(p.variance, -100, 100, 0),
    range: int(p.range, 0, 100, 50),
    hueRange: int(p.hueRange, 0, 100, 50),
    satRange: int(p.satRange, 0, 100, 50),
    lumRange: int(p.lumRange, 0, 100, 50),
  }
}

function normalizeAdvanced(raw: unknown): MixerAdvanced | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const a = raw as Partial<Record<keyof MixerAdvanced, unknown>>
  const d = DEFAULT_ADVANCED
  const n = (v: unknown, lo: number, hi: number, def: number, k: number) => (finite(v) ? Math.round(clamp(v, lo, hi) * k) / k + 0 : def)
  const out: MixerAdvanced = {
    guided: typeof a.guided === 'boolean' ? a.guided : d.guided,
    threshold: n(a.threshold, 0, 0.3, d.threshold, 1000),
    contrast: n(a.contrast, -1, 1, d.contrast, 1000),
    whiteLevel: n(a.whiteLevel, -2, 2, d.whiteLevel, 100),
    placement: n(a.placement, -23, 23, d.placement, 10),
  }
  return (Object.keys(d) as (keyof MixerAdvanced)[]).every((k) => out[k] === d[k]) ? undefined : out
}

/**
 * The Colour Mixer as stored in the develop settings, or undefined when it is absent or at its defaults (no band moved, no
 * point, darktable's settings at their defaults): an untouched or reset mixer leaves no trace, so the edit equals one made
 * before the mixer existed. A point that changes nothing (yet) is kept: it was picked.
 */
export function normalizeColourMixer(raw: unknown): ColourMixerSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const m = raw as Partial<Record<keyof ColourMixerSettings, unknown>>
  const out: ColourMixerSettings = { hue: bandArray(m.hue), saturation: bandArray(m.saturation), luminance: bandArray(m.luminance) }
  const points = Array.isArray(m.points) ? m.points.map(normalizePoint).filter((p): p is PointColour => !!p).slice(0, MAX_POINTS) : []
  if (points.length) out.points = points
  const adv = normalizeAdvanced(m.advanced)
  if (adv) out.advanced = adv
  return bandsActive(out) || points.length || adv ? out : undefined
}

/** Settings with a mixer set, or without the key when it is at its defaults (the same object when nothing changed). */
export function withColourMixer<S extends { colourMixer?: ColourMixerSettings }>(s: S, m: ColourMixerSettings | undefined): S {
  const n = normalizeColourMixer(m)
  if (JSON.stringify(n) === JSON.stringify(s.colourMixer) && (n !== undefined || !('colourMixer' in s))) return s
  const { colourMixer: _old, ...rest } = s
  void _old
  return (n ? { ...rest, colourMixer: n } : rest) as S
}

/** The mixer's bands and darktable settings, with another mixer's Point Color (for Paste's two items). */
export function withPoints(m: ColourMixerSettings | undefined, points: PointColour[] | undefined): ColourMixerSettings {
  const base = m ?? DEFAULT_COLOUR_MIXER
  const { points: _p, ...rest } = base
  void _p
  return points?.length ? { ...rest, points } : rest
}

/** The mixer without its Point Color (the bands and darktable settings). */
export const bandsOf = (m: ColourMixerSettings | undefined): ColourMixerSettings => withPoints(m, undefined)

// ---- presets' Amount

/**
 * A preset's Amount on the mixer: each band moves from the photo's value towards the preset's by `amount` (0…2), like the
 * other sliders. Points: the preset's, with their shifts and Variance scaled the same way from the photo's point at the
 * same place in the list (or from 0); darktable's settings follow the preset above 0 %.
 */
export function blendColourMixer(before: ColourMixerSettings | undefined, after: ColourMixerSettings | undefined, amount: number): ColourMixerSettings | undefined {
  if (!before && !after) return undefined
  if (amount === 1) return after
  if (amount === 0) return before
  const a = before ?? DEFAULT_COLOUR_MIXER
  const b = after ?? DEFAULT_COLOUR_MIXER
  const lerp = (x: number, y: number, lo = -100, hi = 100) => Math.round(clamp(x + (y - x) * amount, lo, hi))
  const bands = (k: MixerChannel) => a[k].map((v, i) => lerp(v, b[k][i]))
  const points = (b.points ?? a.points ?? []).map((p, i): PointColour => {
    const q = b.points ? a.points?.[i] : undefined
    const from = (k: 'hueShift' | 'satShift' | 'lumShift' | 'variance') => (b.points ? (q ? q[k] : 0) : p[k])
    const to = (k: 'hueShift' | 'satShift' | 'lumShift' | 'variance') => (b.points ? p[k] : 0)
    return { ...p, hueShift: lerp(from('hueShift'), to('hueShift')), satShift: lerp(from('satShift'), to('satShift')), lumShift: lerp(from('lumShift'), to('lumShift')), variance: lerp(from('variance'), to('variance')) }
  })
  return normalizeColourMixer({ hue: bands('hue'), saturation: bands('saturation'), luminance: bands('luminance'), ...(points.length ? { points } : {}), ...(amount > 0 ? (b.advanced ? { advanced: b.advanced } : {}) : a.advanced ? { advanced: a.advanced } : {}) })
}

// ---- words and colours for the panel

/** The mixer in words (the paste checklist). */
export function describeMixer(m: ColourMixerSettings | undefined): string {
  if (!m || !bandsActive(m)) return m?.advanced ? 'no band moved (darktable settings changed)' : 'none'
  const parts: string[] = []
  for (const ch of MIXER_CHANNELS) {
    const moved = BAND_NAMES.map((n, i) => [n, m[ch][i]] as const).filter(([, v]) => v !== 0)
    if (moved.length) parts.push(`${CHANNEL_NAMES[ch]} ${moved.map(([n, v]) => `${n} ${v > 0 ? '+' : ''}${v}`).join(', ')}`)
  }
  if (m.advanced && !m.advanced.guided) parts.push('guided filter off')
  return parts.join('; ')
}

export function describePoints(points: PointColour[] | undefined): string {
  if (!points?.length) return 'none'
  return `${points.length} ${points.length === 1 ? 'colour' : 'colours'} (${points.map((p) => [p.hueShift && `Hue ${p.hueShift > 0 ? '+' : ''}${p.hueShift}`, p.satShift && `Sat ${p.satShift > 0 ? '+' : ''}${p.satShift}`, p.lumShift && `Lum ${p.lumShift > 0 ? '+' : ''}${p.lumShift}`, p.variance && `Variance ${p.variance > 0 ? '+' : ''}${p.variance}`].filter(Boolean).join(' ') || 'no change').join('; ')})`
}

/** A CSS colour (sRGB, clipped) for an HSB colour of darktable UCS 22, for swatches and slider tracks. */
export function cssOfHsb(h: number, s: number, b: number, whiteEv = DEFAULT_ADVANCED.whiteLevel): string {
  const lw = whiteLStar(whiteEv)
  const [j, c] = hsbToJch(h, s, b)
  const rec = toRgb(j, c, h, lw)
  const xyz = apply(REC2020_TO_XYZ, rec)
  const srgb = apply([3.2404542, -1.5371385, -0.4985314, -0.969266, 1.8760108, 0.041556, 0.0556434, -0.2040259, 1.0572252], xyz)
  const enc = (v: number) => {
    const x = clamp(v, 0, 1)
    return Math.round(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055))
  }
  return `rgb(${enc(srgb[0])}, ${enc(srgb[1])}, ${enc(srgb[2])})`
}

/** The HSB (darktable UCS 22) of a linear Rec.2020 colour. */
export function hsbOf(c: readonly number[], whiteEv = DEFAULT_ADVANCED.whiteLevel): Vec3 {
  return ucsOf(c, whiteLStar(whiteEv)).hsb
}

/** A band's colour for the panel: its centre hue at a moderate saturation and brightness. */
export function bandCss(i: number, opts: { hueShift?: number; sat?: number; bright?: number; placement?: number } = {}): string {
  const h = bandCentres(opts.placement ?? 0)[i] + (opts.hueShift ?? 0) * DEG
  return cssOfHsb(h, opts.sat ?? 0.12, opts.bright ?? 0.75)
}

/** A Point Color sample made from a picked colour (linear Rec.2020 as it reaches Point Color). */
export function newPoint(c: readonly number[], whiteEv = DEFAULT_ADVANCED.whiteLevel): PointColour {
  const [h, s, b] = hsbOf(c, whiteEv)
  return normalizePoint({ hue: ((h / DEG) % 360 + 360) % 360, saturation: s, brightness: b, hueShift: 0, satShift: 0, lumShift: 0, variance: 0, ...DEFAULT_POINT_RANGES })!
}

/** The bands a hue belongs to, with their weights (the hover marker and the targeted adjustment tool). */
export function bandsAt(c: readonly number[], m: ColourMixerSettings | undefined): { weights: number[]; hue: number; grey: boolean } {
  const adv = m?.advanced ?? DEFAULT_ADVANCED
  const lw = whiteLStar(adv.whiteLevel)
  const { jch, hsb } = ucsOf(c, lw)
  const satShift = -0.015 + 0.3 * (5 * adv.threshold) ** 2
  const grey = !(jch[1] > NORM_MIN) || satWeight(rgbSaturation(c) - satShift, 30 + 20 * adv.contrast) < 0.05
  return { weights: bandWeights(hsb[0], bandCentres(adv.placement)), hue: hsb[0], grey }
}
