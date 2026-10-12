// Lensfun, translated from its library (https://github.com/lensfun/lensfun, libs/lensfun, at the commit of the
// pinned database in web/lensfun/source.json; LGPL-3.0, Copyright (C) 2007 Andrew Zabolotny and the Lensfun
// contributors; this translation is distributed under LightBench's GPL-3.0-or-later, which LGPL-3.0 allows).
//
// - Matching a camera and a lens to the database: `lfFuzzyStrCmp` (auxfun.cpp), `_lf_strcmp`,
//   `lfDatabase::FindCamerasExt`, `FindLenses` and `MatchScore` (database.cpp), `lfLens::GuessParameters`
//   (lens.cpp). darktable calls these with no search flags, so words are matched strictly (every word of the
//   EXIF name must be in the database name).
// - Interpolating calibrations: `InterpolateDistortion` and `InterpolateTCA` (a Hermite spline over the
//   calibrated focal lengths, with Lensfun's parameter scaling) and `InterpolateVignetting` (inverse distance
//   weighting over focal length, aperture and distance, power 3.5) (lens.cpp, `_lf_interpolate` in auxfun.cpp).
// - The correction itself (modifier.cpp, mod-coord.cpp, mod-subpix.cpp, mod-color.cpp): Lensfun's normalised
//   coordinates (units of the real focal length about the lens centre), the rescaling of each model's
//   coefficients from its calibration coordinates, the distortion models poly3, poly5 and ptlens, TCA linear and
//   poly3 (applied after distortion), vignetting pa (applied at the uncorrected position), and `GetAutoScale`,
//   which enlarges the corrected image until no empty border shows (darktable's lens module uses it by default:
//   `reload_defaults` sets `scale = _get_autoscale_lf(...)`).
//
// Everything is evaluated as Lensfun defines it, never refitted to another model. The GPU evaluates the same
// formulas per pixel (engine/gpu/warp.wgsl); `LensfunWarp.sourcePoint` here is the CPU reference used by the tests
// and the white balance picker.
//
// LightBench additions, marked where they are: the Distortion and Vignetting amounts (0…2, 1 = the profile) blend
// the radial distortion factor and the vignetting falloff linearly, as darktable's embedded-metadata fine-tune
// sliders do (lens.cc `_init_coeffs_md_v2`: `cor_dist_ft * (r_cor − 1) + 1`). Lensfun itself has no amounts.
// Ties between equal match scores keep the database order (Lensfun's std::sort leaves their order unspecified).

import { mlText, mlTexts, realFocal, type LensfunCamera, type LensfunData, type LensfunLens, type LensfunMount, type MLString } from './lensfun-xml'

// ---------------------------------------------------------------------------------------------------------
// Strings

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\v' || c === '\f'
const isDigit = (c: string) => c >= '0' && c <= '9'
/** C's ispunct in the "C" locale: printable ASCII that is neither a letter, a digit nor a space. */
const isPunct = (c: string) => /^[!-/:-@[-`{-~]$/.test(c)

/** `_lf_strcmp`: case-insensitive, runs of white space count as one space, leading and trailing spaces ignored. */
export function lfStrcmp(a: string | null | undefined, b: string | null | undefined): number {
  const n = (s: string | null | undefined) => (s ? s.trim().replace(/\s+/g, ' ').toLowerCase() : '')
  const x = n(a)
  const y = n(b)
  if (!x) return y ? -1 : 0
  if (!y) return 1
  return x === y ? 0 : x < y ? -1 : 1
}

/** `_lf_mlstrcmp`: 0 when `a` equals any text of the multi-language string. */
const mlStrEq = (a: string, b: MLString) => mlTexts(b).some((t) => lfStrcmp(a, t) === 0)

/** `lfFuzzyStrCmp::Split`: words by character class (numbers, punctuation, letters), case-folded and sorted. */
export function fuzzyWords(str: string | null | undefined): string[] {
  const out: string[] = []
  if (!str) return out
  let i = 0
  const n = str.length
  while (i < n) {
    while (i < n && isSpace(str[i])) i++
    if (i >= n) break
    const start = i++
    const c = str[start]
    let strip = 0
    if (isDigit(c)) {
      while (i < n && (isDigit(str[i]) || str[i] === '.')) i++
      if (i - start >= 2 && str[i - 2] === '.' && str[i - 1] === '0') strip = 2
    } else if (isPunct(c)) {
      while (i < n && isPunct(str[i])) i++
    } else {
      while (i < n && !isSpace(str[i]) && !isDigit(str[i]) && !isPunct(str[i])) i++
    }
    // Solitary symbols, and a single letter "f", are skipped, except "+" and "*".
    if (i - start === 1 && (isPunct(c) || c.toLowerCase() === 'f') && c !== '*' && c !== '+') continue
    const word = str.slice(start, i - strip).toLowerCase()
    // Sorted insert (duplicates kept), as `_lf_ptr_array_insert_sorted` with strcmp.
    let lo = 0
    let hi = out.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (out[mid] <= word) lo = mid + 1
      else hi = mid
    }
    out.splice(lo, 0, word)
  }
  return out
}

/** `lfFuzzyStrCmp`: the share of matched words, 0…100; with `allWords`, 0 unless every pattern word is found. */
export class FuzzyMatcher {
  private readonly pattern: string[]
  private readonly allWords: boolean
  constructor(pattern: string | null | undefined, allWords = true) {
    this.pattern = fuzzyWords(pattern)
    this.allWords = allWords
  }

  compare(match: string): number {
    const m = fuzzyWords(match)
    const p = this.pattern
    if (!m.length || !p.length) return 0
    let mi = 0
    let score = 0
    for (const word of p) {
      const old = mi
      for (; mi < m.length; mi++) {
        const r = word === m[mi] ? 0 : word < m[mi] ? -1 : 1
        if (r === 0) {
          score++
          break
        }
        if (r < 0) {
          if (this.allWords) return 0
          mi = old - 1
          break
        }
      }
      if (this.allWords) {
        if (mi >= m.length) return 0
        mi++
      } else {
        mi = mi >= m.length ? old : mi + 1
      }
    }
    return Math.trunc((score * 200) / (p.length + m.length))
  }

  /** The best score over all texts of a multi-language string. */
  compareML(match: MLString): number {
    let best = 0
    for (const t of mlTexts(match)) {
      best = Math.max(best, this.compare(t))
      if (best >= 100) break
    }
    return best
  }
}

// ---------------------------------------------------------------------------------------------------------
// Lens parameters guessed from the name (lens.cpp `GuessParameters`)

const LENS_NAME_REGEXES: [RegExp, [number, number, number]][] = [
  // [min focal]-[max focal]mm f/[min aperture]-[max aperture]
  [/^[^:]*?([0-9]+[0-9.]*)[-]?([0-9]+[0-9.]*)?(mm)\s+(f\/|f|1\/|1:)?([0-9.]+)(-[0-9.]+)?.*$/, [1, 2, 5]],
  // 1:[min aperture]-[max aperture] [min focal]-[max focal]mm
  [/^.*?1:([0-9.]+)[-]?([0-9.]+)?\s+([0-9.]+)[-]?([0-9.]+)?(mm)?.*$/, [3, 4, 1]],
  // [min aperture]-[max aperture]/[min focal]-[max focal]
  [/^.*?([0-9.]+)[-]?([0-9.]+)?\s*\/\s*([0-9.]+)[-]?([0-9.]+)?.*$/, [3, 4, 1]],
]
// As in Lensfun, including its "[0.9]" (which matches the characters 0, . and 9).
const EXTENDER_MAGNIFICATION = /^.*?[0-9](\.[0.9]+)?x.*$/
const atof = (s: string) => {
  const m = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s)
  return m ? Number(m[0]) : 0
}

export interface LensParams {
  minFocal: number
  maxFocal: number
  minAperture: number
  maxAperture: number
}

/** `lfLens::GuessParameters`: focal and aperture ranges from the model name, then from the calibrations. */
export function guessParameters(model: string | null, given: LensParams, lens?: Pick<LensfunLens, 'distortion' | 'tca' | 'vignetting'>): LensParams {
  const out = { ...given }
  let minf = Infinity
  let maxf = -Infinity
  let mina = Infinity
  let maxa = -Infinity
  if (model && (!out.minAperture || !out.minFocal) && !/adapter|reducer|booster|extender|converter|magnifier/.test(model) && !EXTENDER_MAGNIFICATION.test(model)) {
    for (const [re, idx] of LENS_NAME_REGEXES) {
      const m = re.exec(model)
      if (!m) continue
      if (m[idx[0]] !== undefined) minf = atof(m[idx[0]])
      if (m[idx[1]] !== undefined) maxf = atof(m[idx[1]])
      if (m[idx[2]] !== undefined) mina = atof(m[idx[2]])
      break
    }
  }
  if (lens && (!out.minAperture || !out.minFocal)) {
    for (const r of lens.distortion?.rows ?? []) [minf, maxf] = [Math.min(minf, r[0]), Math.max(maxf, r[0])]
    for (const r of lens.tca?.rows ?? []) [minf, maxf] = [Math.min(minf, r[0]), Math.max(maxf, r[0])]
    for (const r of lens.vignetting?.rows ?? []) {
      ;[minf, maxf] = [Math.min(minf, r[0]), Math.max(maxf, r[0])]
      ;[mina, maxa] = [Math.min(mina, r[1]), Math.max(maxa, r[1])]
    }
  }
  if (minf !== Infinity && !out.minFocal) out.minFocal = minf
  if (maxf !== -Infinity && !out.maxFocal) out.maxFocal = maxf
  if (mina !== Infinity && !out.minAperture) out.minAperture = mina
  if (maxa !== -Infinity && !out.maxAperture) out.maxAperture = maxa
  if (!out.maxFocal) out.maxFocal = out.minFocal
  return out
}

// ---------------------------------------------------------------------------------------------------------
// The database

/** A lens of the database with its guessed parameters (as Lensfun's `Check` leaves them). */
export interface DbLens extends LensfunLens {
  /** Index in the database (stable identity). */
  index: number
  params: LensParams
}

export interface ScoredCamera {
  camera: LensfunCamera
  score: number
}

export interface ScoredLens {
  lens: DbLens
  score: number
}

/** `_lf_compare_num`: 0 neutral (one unknown), −1 different by 1 % or more, +1 equal. */
function compareNum(a: number, b: number): number {
  if (!a || !b) return 0
  const r = a / b
  return r <= 0.99 || r >= 1.01 ? -1 : 1
}

export class LensfunDb {
  readonly source: LensfunData['source']
  readonly mounts: LensfunMount[]
  readonly cameras: LensfunCamera[]
  readonly lenses: DbLens[]

  constructor(data: LensfunData) {
    this.source = data.source
    this.mounts = data.mounts
    this.cameras = data.cameras
    this.lenses = data.lenses.map((l, index) => ({
      ...l,
      index,
      params: guessParameters(mlTexts(l.model)[0] ?? null, { minFocal: l.minFocal, maxFocal: l.maxFocal, minAperture: l.minAperture, maxAperture: l.maxAperture }, l),
    }))
  }

  /** `FindCamerasExt` (strict word matching): cameras whose maker and model match, best first. */
  findCameras(maker: string | null, model: string | null): ScoredCamera[] {
    const mk = maker || null
    const md = model || null
    const fm = new FuzzyMatcher(mk)
    const fd = new FuzzyMatcher(md)
    const out: ScoredCamera[] = []
    for (const camera of this.cameras) {
      const s1 = mk ? fm.compareML(camera.maker) : 0
      if (mk && !s1) continue
      const s2 = md ? fd.compareML(camera.model) : 0
      if (md && !s2) continue
      out.push({ camera, score: s1 + s2 })
    }
    return out.sort((a, b) => b.score - a.score)
  }

  /** `FindMount(...)->GetCompats()`. */
  compatMounts(mount: string): string[] {
    return this.mounts.find((m) => lfStrcmp(m.name, mount) === 0)?.compat ?? []
  }

  /** `MatchScore`. `pattern` holds the EXIF lens (its maker may be empty, as darktable passes none). */
  matchScore(pattern: { maker: string | null; model: string | null; params: LensParams }, match: DbLens, camera: LensfunCamera | null, fuzzy: FuzzyMatcher, compat: string[]): number {
    let score = 0
    const hasCalibrations = !!(match.distortion || match.tca || match.vignetting)
    if (camera && hasCalibrations) {
      // One calibration set per lens, with the lens's crop factor (see lensfun-xml.ts).
      const cc = camera.crop
      const lc = match.crop
      let crop = 0
      if (!(cc > 0.01 && cc < lc * 0.96)) {
        if (cc >= lc * 1.41) crop = 2
        else if (cc >= lc * 1.31) crop = 4
        else if (cc >= lc * 1.21) crop = 6
        else if (cc >= lc * 1.11) crop = 8
        else if (cc >= lc * 1.01) crop = 10
        else if (cc >= lc) crop = 5
        else if (cc >= lc * 0.96) crop = 3
      }
      if (!crop) return 0
      score += crop
    }
    for (const [a, b] of [
      [pattern.params.minFocal, match.params.minFocal],
      [pattern.params.maxFocal, match.params.maxFocal],
      [pattern.params.minAperture, match.params.minAperture],
      [pattern.params.maxAperture, match.params.maxAperture],
    ]) {
      const c = compareNum(a, b)
      if (c < 0) return 0
      if (c > 0) score += 10
    }
    if (match.mounts.length && (camera || compat.length)) {
      if (camera?.mount && match.mounts.some((m) => lfStrcmp(camera.mount, m) === 0)) score += 10
      else if (compat.some((c) => match.mounts.some((m) => lfStrcmp(c, m) === 0))) score += 9
      else return 0
    }
    if (pattern.maker && match.maker) {
      if (!mlStrEq(pattern.maker, match.maker)) return 0
      score += 10
    }
    if (pattern.model && match.model) {
      let s = fuzzy.compareML(match.model)
      if (!s) return 0
      s = Math.trunc((s * 4) / 10)
      score += s || 1
    }
    return score
  }

  /** `FindLenses(camera, maker, model, 0)`: lenses matching the EXIF name on this camera, best first. */
  findLenses(camera: LensfunCamera | null, maker: string | null, model: string | null): ScoredLens[] {
    const mk = maker || null
    const md = model || null
    const params = guessParameters(md, { minFocal: 0, maxFocal: 0, minAperture: 0, maxAperture: 0 })
    const fuzzy = new FuzzyMatcher(md)
    const compat = camera?.mount ? this.compatMounts(camera.mount) : []
    const out: ScoredLens[] = []
    for (const lens of this.lenses) {
      const score = this.matchScore({ maker: mk, model: md, params }, lens, camera, fuzzy, compat)
      if (score > 0) out.push({ lens, score })
    }
    return out.sort((a, b) => b.score - a.score)
  }

  /** Every lens that fits the camera's mount (or a compatible one), for picking by hand. */
  lensesFor(camera: LensfunCamera | null): DbLens[] {
    if (!camera) return this.lenses
    const compat = this.compatMounts(camera.mount)
    return this.lenses.filter((l) => l.mounts.some((m) => lfStrcmp(m, camera.mount) === 0 || compat.some((c) => lfStrcmp(c, m) === 0)))
  }
}

/** A camera's or lens's name as shown: the maker and the model (Lensfun's English text). */
export const cameraName = (c: LensfunCamera) => `${mlText(c.maker)} ${mlText(c.model)}${c.variant ? ` ${mlText(c.variant)}` : ''}`
export const lensName = (l: LensfunLens) => mlText(l.model)
export { mlText }

// ---------------------------------------------------------------------------------------------------------
// Interpolation (lens.cpp)

/** `_lf_interpolate`: Hermite spline through y2 (t = 0) and y3 (t = 1); a missing y1 or y4 is null. */
export function lfInterpolate(y1: number | null, y2: number, y3: number, y4: number | null, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  const tg2 = y1 === null ? y3 - y2 : (y3 - y1) * 0.5
  const tg3 = y4 === null ? y3 - y2 : (y4 - y2) * 0.5
  return (2 * t3 - 3 * t2 + 1) * y2 + (t3 - 2 * t2 + t) * tg2 + (-2 * t3 + 3 * t2) * y3 + (t3 - t2) * tg3
}

/** The calibrated rows around `focal`: [further above, above, below, further below], as `__insert_spline`. */
function splineRows(rows: number[][], focal: number): { exact: number[] | null; s: (number[] | null)[] } {
  const s: (number[] | null)[] = [null, null, null, null]
  const d = [-Infinity, -Infinity, Infinity, Infinity]
  for (const r of rows) {
    const df = focal - r[0]
    if (df === 0) return { exact: r, s }
    if (df < 0) {
      if (df > d[1]) {
        d[0] = d[1]
        d[1] = df
        s[0] = s[1]
        s[1] = r
      } else if (df > d[0]) {
        d[0] = df
        s[0] = r
      }
    } else if (df < d[2]) {
      d[3] = d[2]
      d[2] = df
      s[3] = s[2]
      s[2] = r
    } else if (df < d[3]) {
      d[3] = df
      s[3] = r
    }
  }
  return { exact: null, s }
}

/** The calibration set can be used for an image of crop factor `crop` (Lensfun's `crop / calib crop >= 0.96`). */
const cropUsable = (lens: LensfunLens, crop: number) => crop / lens.crop >= 0.96

export interface InterpolatedDistortion {
  model: 'poly3' | 'poly5' | 'ptlens'
  focal: number
  realFocal: number
  terms: number[]
}

/** `InterpolateDistortion`. */
export function interpolateDistortion(lens: LensfunLens, crop: number, focal: number): InterpolatedDistortion | null {
  const cal = lens.distortion
  if (!cal || !cal.rows.length || !cropUsable(lens, crop)) return null
  const model = cal.model
  const terms = (r: number[]) => r.slice(2)
  const { exact, s } = splineRows(cal.rows, focal)
  if (exact) return { model, focal: exact[0], realFocal: realFocal(model, exact), terms: terms(exact) }
  if (!s[1] || !s[2]) {
    const r = (s[1] ?? s[2])!
    return { model, focal: r[0], realFocal: realFocal(model, r), terms: terms(r) }
  }
  const t = (focal - s[1][0]) / (s[2][0] - s[1][0])
  const rf = (r: number[] | null) => (r ? realFocal(model, r) : null)
  const out: InterpolatedDistortion = { model, focal, realFocal: lfInterpolate(rf(s[0]), rf(s[1])!, rf(s[2])!, rf(s[3]), t), terms: [] }
  // Poly models: every term is scaled by its focal length before interpolating (`__parameter_scales`).
  const n = cal.rows[0].length - 2
  for (let i = 0; i < n; i++) {
    const y = (r: number[] | null) => (r ? r[2 + i] * r[0] : null)
    out.terms.push(lfInterpolate(y(s[0]), y(s[1])!, y(s[2])!, y(s[3]), t) / focal)
  }
  return out
}

export interface InterpolatedTca {
  model: 'linear' | 'poly3'
  terms: number[]
}

/** `InterpolateTCA`. */
export function interpolateTca(lens: LensfunLens, crop: number, focal: number): InterpolatedTca | null {
  const cal = lens.tca
  if (!cal || !cal.rows.length || !cropUsable(lens, crop)) return null
  const model = cal.model
  const { exact, s } = splineRows(cal.rows, focal)
  if (exact) return { model, terms: exact.slice(1) }
  if (!s[1] || !s[2]) return { model, terms: (s[1] ?? s[2])!.slice(1) }
  const t = (focal - s[1][0]) / (s[2][0] - s[1][0])
  const terms: number[] = []
  const n = cal.rows[0].length - 1
  for (let i = 0; i < n; i++) {
    // Terms 0 and 1 (kr/kb, vr/vb) are not scaled; the others by the focal length (`__parameter_scales`).
    const k = (r: number[] | null) => (i < 2 ? 1 : r ? r[0] : NaN)
    const y = (r: number[] | null) => (r ? r[1 + i] * k(r) : null)
    terms.push(lfInterpolate(y(s[0]), y(s[1])!, y(s[2])!, y(s[3]), t) / (i < 2 ? 1 : focal))
  }
  return { model, terms }
}

/** `__vignetting_dist`: distance between two shooting conditions on normalised, reciprocal axes. */
function vignettingDist(lens: DbLens, row: number[], focal: number, aperture: number, distance: number): number {
  let f1 = focal - lens.params.minFocal
  let f2 = row[0] - lens.params.minFocal
  const df = lens.params.maxFocal - lens.params.minFocal
  if (df !== 0) {
    f1 /= df
    f2 /= df
  }
  const a1 = 4 / aperture
  const a2 = 4 / row[1]
  const d1 = 0.1 / distance
  const d2 = 0.1 / row[2]
  return Math.sqrt((f2 - f1) ** 2 + (a2 - a1) ** 2 + (d2 - d1) ** 2)
}

/** `InterpolateVignetting` (pa terms k1, k2, k3), or null when no calibration is close enough. */
export function interpolateVignetting(lens: DbLens, crop: number, focal: number, aperture: number, distance: number): number[] | null {
  const cal = lens.vignetting
  if (!cal || !cal.rows.length || !cropUsable(lens, crop)) return null
  const terms = [0, 0, 0]
  let total = 0
  let smallest = Infinity
  for (const r of cal.rows) {
    const dist = vignettingDist(lens, r, focal, aperture, distance)
    if (dist < 0.0001) return r.slice(3, 6)
    smallest = Math.min(smallest, dist)
    const w = Math.abs(1 / dist ** 3.5)
    for (let i = 0; i < 3; i++) terms[i] += w * r[3 + i]
    total += w
  }
  if (smallest > 1) return null
  if (!(total > 0) || smallest === Infinity) return null
  return terms.map((t) => t / total)
}

// ---------------------------------------------------------------------------------------------------------
// The correction (modifier.cpp, mod-coord.cpp, mod-subpix.cpp, mod-color.cpp)

/** What the correction does, in Lensfun's normalised coordinates; also what the GPU gets. */
export interface LensfunWarp {
  kind: 'lensfun'
  /** Image size in pixels (sensor orientation). */
  width: number
  height: number
  /** Pixels → normalised units (`NormScale`), and the lens centre in normalised units (`CenterX`, `CenterY`). */
  normScale: number
  center: [number, number]
  /** Coordinates are multiplied by this before distortion: 1 / the automatic scale (`EnableScaling`). */
  scale: number
  /** Distortion: model and its rescaled terms (`rescale_polynomial_coefficients`), and the LightBench amount. */
  distortion: { model: 'poly3' | 'poly5' | 'ptlens'; terms: number[]; amount: number } | null
  /** TCA: model and rescaled terms (linear: kr, kb; poly3: vr, vb, cr, cb, br, bb). */
  tca: { model: 'linear' | 'poly3'; terms: number[] } | null
  /** Vignetting pa: rescaled k1, k2, k3, and the LightBench amount. */
  vignetting: { terms: number[]; amount: number } | null
}

export interface LensfunShot {
  /** Crop factor of the camera (Lensfun's camera entry, as darktable uses it). */
  crop: number
  focal: number
  aperture: number
  /** Focus distance in metres (darktable uses 1000 when the file has none). */
  distance: number
}

export interface LensfunOptions {
  distortion: boolean
  tca: boolean
  vignetting: boolean
  /** LightBench amounts, 1 = the profile (see the file header). */
  distortionAmount: number
  vignettingAmount: number
}

const HYPOT_FF = Math.hypot(36, 24)

/**
 * `lfModifier` set up for correction (not `Reverse`) of a `width` × `height` image, with the corrections asked
 * for and the automatic scale. Null when the lens has none of them for this shot.
 */
export function lensfunWarp(lens: DbLens, shot: LensfunShot, width: number, height: number, opts: LensfunOptions): LensfunWarp | null {
  const W = width >= 2 ? width - 1 : 1
  const H = height >= 2 ? height - 1 : 1
  const dist = interpolateDistortion(lens, shot.crop, shot.focal)
  const rf = dist ? dist.realFocal : shot.focal
  const normScale = HYPOT_FF / shot.crop / Math.hypot(W + 1, H + 1) / rf
  const size = Math.min(W, H)
  const [lcx, lcy] = lens.center ?? [0, 0]
  const center: [number, number] = [(W / 2 + (size / 2) * lcx) * normScale, (H / 2 + (size / 2) * lcy) * normScale]

  // Hugin coordinates: r = 1 at half the shorter side of the calibration sensor (distortion, TCA) or at its corner (vignetting).
  const huginHalfHeight = HYPOT_FF / lens.crop / Math.hypot(lens.aspect, 1) / 2
  const h = rf / huginHalfHeight
  let distortion: LensfunWarp['distortion'] = null
  if (opts.distortion && dist && opts.distortionAmount > 0) {
    const t = [...dist.terms]
    if (dist.model === 'poly3') {
      const d = 1 - t[0]
      t[0] *= h ** 2 / d ** 3
    } else if (dist.model === 'poly5') {
      t[0] *= h ** 2
      t[1] *= h ** 4
    } else {
      const d = 1 - t[0] - t[1] - t[2]
      t[0] *= h ** 3 / d ** 4
      t[1] *= h ** 2 / d ** 3
      t[2] *= h / d ** 2
    }
    distortion = { model: dist.model, terms: t, amount: opts.distortionAmount }
  }
  let tca: LensfunWarp['tca'] = null
  const tc = opts.tca ? interpolateTca(lens, shot.crop, shot.focal) : null
  if (tc) {
    const t = [...tc.terms]
    if (tc.model === 'poly3') {
      t[2] *= h
      t[3] *= h
      t[4] *= h * h
      t[5] *= h * h
    }
    tca = { model: tc.model, terms: t }
  }
  let vignetting: LensfunWarp['vignetting'] = null
  const vg = opts.vignetting && opts.vignettingAmount > 0 ? interpolateVignetting(lens, shot.crop, shot.focal, shot.aperture, shot.distance) : null
  if (vg) {
    const hv = rf / (HYPOT_FF / lens.crop / 2)
    vignetting = { terms: [vg[0] * hv ** 2, vg[1] * hv ** 4, vg[2] * hv ** 6], amount: opts.vignettingAmount }
  }
  if (!distortion && !tca && !vignetting) return null
  const warp: LensfunWarp = { kind: 'lensfun', width, height, normScale, center, scale: 1, distortion, tca, vignetting }
  const auto = autoScale(warp)
  if (auto !== 1) warp.scale = 1 / auto
  return warp
}

/** The distortion callback (`ModifyCoord_Dist_*`, correction direction) on a normalised point, with the amount. */
export function distortPoint(d: NonNullable<LensfunWarp['distortion']>, x: number, y: number): [number, number] {
  const r2 = x * x + y * y
  const t = d.terms
  let f: number
  if (d.model === 'poly3') f = t[0] * r2 + 1
  else if (d.model === 'poly5') f = 1 + t[0] * r2 + t[1] * r2 * r2
  else {
    const r = Math.sqrt(r2)
    f = t[0] * r2 * r + t[1] * r2 + t[2] * r + 1
  }
  f = 1 + d.amount * (f - 1)
  return [x * f, y * f]
}

/** The TCA callback (`ModifyCoord_TCA_*`) for red (channel 0) or blue (2); green is unchanged. */
export function tcaPoint(t: NonNullable<LensfunWarp['tca']>, channel: 0 | 2, x: number, y: number): [number, number] {
  const k = t.terms
  if (t.model === 'linear') {
    const s = channel === 0 ? k[0] : k[1]
    return [x * s, y * s]
  }
  const [v, c, b] = channel === 0 ? [k[0], k[2], k[4]] : [k[1], k[3], k[5]]
  const r2 = x * x + y * y
  const p = b * r2 + c * Math.sqrt(r2) + v
  return [x * p, y * p]
}

/**
 * `ApplySubpixelGeometryDistortion` for one point: where channel `channel` of the corrected image at (x, y) is
 * read in the uncorrected image. Pixel coordinates have pixel centres at whole numbers (Lensfun's convention).
 */
export function lensfunSourcePoint(w: LensfunWarp, x: number, y: number, channel: 0 | 1 | 2 = 1): [number, number] {
  let px = (x * w.normScale - w.center[0]) * w.scale
  let py = (y * w.normScale - w.center[1]) * w.scale
  if (w.distortion) [px, py] = distortPoint(w.distortion, px, py)
  if (w.tca && channel !== 1) [px, py] = tcaPoint(w.tca, channel, px, py)
  return [(px + w.center[0]) / w.normScale, (py + w.center[1]) / w.normScale]
}

/** `ModifyColor_DeVignetting_PA` with the LightBench amount: the gain applied at uncorrected pixel (x, y). */
export function lensfunVignettingGain(w: LensfunWarp, x: number, y: number): number {
  if (!w.vignetting) return 1
  const px = x * w.normScale - w.center[0]
  const py = y * w.normScale - w.center[1]
  const r2 = px * px + py * py
  const [k1, k2, k3] = w.vignetting.terms
  const c = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2
  return 1 / (1 + w.vignetting.amount * (c - 1))
}

const NEWTON_EPS = 0.00001

/** Points on the image border, as [distance from the centre, angle], in normalised units. */
function borderPoints(w: LensfunWarp, perEdge: number): [number, number][] {
  const W = w.width >= 2 ? w.width - 1 : 1
  const H = w.height >= 2 ? w.height - 1 : 1
  if (perEdge <= 1) {
    // Lensfun's eight: the edge middles and the corners (`GetAutoScale`).
    const a1 = Math.atan2(H, W)
    const corner = Math.sqrt(W * W + H * H) * 0.5 * w.normScale
    return [
      [W * 0.5 * w.normScale, 0], [corner, a1], [H * 0.5 * w.normScale, Math.PI / 2], [corner, Math.PI - a1],
      [W * 0.5 * w.normScale, Math.PI], [corner, Math.PI + a1], [H * 0.5 * w.normScale, (Math.PI * 3) / 2], [corner, 2 * Math.PI - a1],
    ]
  }
  const out: [number, number][] = []
  for (let i = 0; i < perEdge; i++) {
    const t = -1 + (2 * i) / perEdge
    for (const [x, y] of [[t * W, -H], [W, t * H], [-t * W, H], [-W, -t * H]]) out.push([Math.hypot(x, y) * 0.5 * w.normScale, Math.atan2(y, x)])
  }
  return out
}

/**
 * The corrected radius whose distorted point lies on the image border in direction `angle`
 * (`GetTransformedDistance`: Newton's method from `dist`), stopping when within `tol` normalised units; −1 when
 * it doesn't converge.
 */
function transformedDistance(w: LensfunWarp, dist: number, angle: number, tol: number): number {
  const d = w.distortion!
  const W = w.width >= 2 ? w.width - 1 : 1
  const H = w.height >= 2 ? w.height - 1 : 1
  const maxX = (W / 2) * w.normScale
  const maxY = (H / 2) * w.normScale
  const residual = ([x, y]: [number, number]) => Math.max(x - maxX, -maxX - x, y - maxY, -maxY - y)
  const sa = Math.sin(angle)
  const ca = Math.cos(angle)
  let ru = dist
  let dx = 0.0001
  for (let countdown = 50; ; countdown--) {
    const rd = residual(distortPoint(d, ca * ru, sa * ru))
    if (rd > -tol && rd < tol) break
    if (!countdown) return -1
    const rd1 = residual(distortPoint(d, ca * (ru + dx), sa * (ru + dx)))
    if (Math.abs(rd1 - rd) < 0.00001 * (tol / (NEWTON_EPS * 100))) {
      dx *= 2
      continue
    }
    ru -= rd / ((rd1 - rd) / dx)
  }
  return ru
}

/**
 * `GetAutoScale(false)` exactly as Lensfun computes it: the enlargement that leaves no empty border, checked at
 * the corners and edge middles, each found to within 0.001 normalised units, times 1.001 (and 1.001 more with TCA).
 */
export function lensfunAutoScale(w: LensfunWarp): number {
  const subpixel = w.tca ? 1.001 : 1
  if (!w.distortion) return subpixel
  let scale = 0.01
  for (const [dist, angle] of borderPoints(w, 1)) scale = Math.max(scale, dist / transformedDistance(w, dist, angle, NEWTON_EPS * 100))
  return scale * 1.001 * subpixel
}

/**
 * The automatic scale LightBench uses: Lensfun's method with two changes (LightBench's, measured on the test
 * files): each border point is found to within 1e-9 normalised units instead of 0.001, and 32 points around the
 * border are checked instead of 8. Lensfun's tolerance is a fixed share of the focal length, so at long focal
 * lengths it can leave a few pixels uncovered (on the ILCE-6300 file at 97 mm, Lensfun's scale left the corners
 * 6.6 px outside the photo); wavy ("moustache") distortion can also peak between Lensfun's eight points.
 */
export function autoScale(w: LensfunWarp): number {
  const subpixel = w.tca ? 1.001 : 1
  if (!w.distortion) return subpixel
  let scale = 0.01
  for (const [dist, angle] of [...borderPoints(w, 1), ...borderPoints(w, 8)]) {
    const t = transformedDistance(w, dist, angle, 1e-9)
    scale = Math.max(scale, t > 0 ? dist / t : dist / transformedDistance(w, dist, angle, NEWTON_EPS * 100))
  }
  return scale * 1.001 * subpixel
}


// ---------------------------------------------------------------------------------------------------------
// Choosing the camera and lens as darktable's lens module does (src/iop/lens.cc `reload_defaults`)

export interface LensfunMatch {
  camera: LensfunCamera | null
  /** Crop factor used: the Lensfun camera's (0 without a camera: darktable then doesn't correct). */
  crop: number
  lens: DbLens | null
}

/**
 * darktable's lens module: the first camera of `FindCamerasExt(maker, model)`, its crop factor, and the first
 * lens of `FindLenses(camera, NULL, lens)` (`reload_defaults`, `_commit_params_lf`). For a fixed-lens camera (mount
 * name starting with a lower-case letter) with no lens found, the lens name is dropped and the lens with the
 * shortest model name is taken. Without a camera in the database darktable's pipe has no crop factor and doesn't
 * correct (`_process_lf`: `d->crop <= 0` bypasses), so neither does this; the camera can be picked by hand.
 * `picked` holds the user's choices, which replace the automatic ones.
 */
export function matchLensfun(db: LensfunDb, exif: { maker: string; model: string; lens: string }, picked?: { camera?: LensfunCamera | null; lens?: DbLens | null }): LensfunMatch {
  const camera = picked?.camera ?? db.findCameras(exif.maker, exif.model)[0]?.camera ?? null
  if (!camera) return { camera: null, crop: 0, lens: null }
  if (picked?.lens) return { camera, crop: camera.crop, lens: picked.lens }
  let lenses = db.findLenses(camera, null, sanitizeLens(exif.lens))
  let lens = lenses[0]?.lens ?? null
  if (!lens && /^[a-z]/.test(camera.mount)) {
    lenses = db.findLenses(camera, null, null)
    const len = (l: DbLens) => (mlTexts(l.model)[0] ?? '').length
    for (const l of lenses) if (!lens || len(l.lens) < len(lens)) lens = l.lens
  }
  return { camera, crop: camera.crop, lens }
}


/** darktable's `_lens_sanitize`: the lens name up to " or " or " (" (exiv2 may list several candidates). */
export function sanitizeLens(s: string): string {
  const cut = [s.indexOf(' or '), s.indexOf(' (')].filter((i) => i > 0)
  return cut.length ? s.slice(0, Math.min(...cut)) : s
}
