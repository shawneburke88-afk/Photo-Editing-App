// Reads Lensfun's database XML (https://github.com/lensfun/lensfun, `data/db/*.xml`, database version 2) into the
// compact form LightBench downloads (`LensfunData`). Used at build time by `web/lensfun-plugin.ts`, which turns
// the pinned copy in `web/lensfun/db/` into one JSON file, and by the unit tests.
//
// What is kept follows Lensfun's own parser (libs/lensfun/database.cpp, `_xml_start_element`, `_xml_text`, and
// `lfLens::Check`, `lfCamera::Check`): mounts with their compatible mounts; cameras (maker, model, variant, mount,
// crop factor); lenses (maker, model, mounts, crop factor, aspect ratio, type, centre, focal and aperture ranges)
// and their calibrations. Defaults are Lensfun's: a lens without <cropfactor> has 1.0, without <aspect-ratio> 1.5
// ("3:2" style values are divided), TCA terms 0 and 1 default to 1; a distortion without `real-focal` gets
// Lensfun's estimate (`realFocal` below: ptlens focal·(1−a−b−c), poly3 focal·(1−k1), else the focal length).
//
// Differences, all of which change nothing for the pinned database (checked when it was converted):
// - Lensfun keeps all of a lens's calibrations in one set with the lens's crop factor and aspect ratio
//   (lens.cpp `GetCalibrationSetForAttributes`: "Always use Calibrations[0] for now"), so <calibration>'s own
//   attributes are not stored (the pinned database has none).
// - Lensfun uses only the first model it meets per kind (lens.cpp `Interpolate*`: "Take into account just the
//   first encountered lens model"); rows of another model are dropped here instead of at each lookup.
// - The "acm" models and model="none" rows are not kept (the pinned database has none; LightBench doesn't
//   evaluate ACM).
//
// The Lensfun database is licensed CC BY-SA 3.0 (Lensfun's README.md and data/COPYING.CC_BY-SA_3.0). The JSON
// made from it is an adaptation and stays under CC BY-SA 3.0 (THIRD_PARTY_NOTICES.md). The parsing rules are
// translated from Lensfun's library (LGPL-3.0), Copyright (C) 2007 Andrew Zabolotny and the Lensfun contributors.

/**
 * A Lensfun multi-language string: the default text, or [default, lang, text, lang, text, …] (database.cpp
 * stores translations after the default; matching tries every one, `lf_mlstr_get` shows the reader's language).
 */
export type MLString = string | string[]

export interface LensfunMount {
  name: string
  compat: string[]
}

export interface LensfunCamera {
  maker: MLString
  model: MLString
  variant?: MLString
  mount: string
  crop: number
}

export type DistortionModel = 'poly3' | 'poly5' | 'ptlens'
export type TcaModel = 'linear' | 'poly3'
export type VignettingModel = 'pa'

/** Calibrations of one kind: the model and one row per calibrated point. */
export interface Calibrations<M extends string> {
  model: M
  /**
   * distortion: [focal, measured real focal or 0, a | k1, b | k2, c]; TCA: [focal, kr | vr, kb | vb, cr, cb, br, bb];
   * vignetting: [focal, aperture, distance, k1, k2, k3].
   */
  rows: number[][]
}

export interface LensfunLens {
  maker: MLString
  model: MLString
  mounts: string[]
  crop: number
  aspect: number
  type: string
  /** Lens centre offset (`<center x y>`), in units of half the shorter image side; omitted when 0, 0. */
  center?: [number, number]
  /** From <focal>/<aperture>; 0 = not given (Lensfun guesses them from the name and calibrations). */
  minFocal: number
  maxFocal: number
  minAperture: number
  maxAperture: number
  distortion?: Calibrations<DistortionModel>
  tca?: Calibrations<TcaModel>
  vignetting?: Calibrations<VignettingModel>
}

export interface LensfunData {
  /** Where this copy came from (filled in by the build). */
  source: { repo: string; commit: string; date: string; licence: string }
  mounts: LensfunMount[]
  cameras: LensfunCamera[]
  lenses: LensfunLens[]
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s: string) =>
  s.indexOf('&') < 0
    ? s
    : s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
        e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? m,
      )

function attributes(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of s.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = decode(m[2] ?? m[3] ?? '')
  return out
}

/** C's atof: the longest leading number (0 when there is none). */
const atof = (s: string | undefined) => {
  const m = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s ?? '')
  return m ? Number(m[0]) : 0
}

function addML(cur: MLString | undefined, lang: string | undefined, text: string): MLString {
  if (!lang) {
    // Replaces the default text, keeping translations (lf_mlstr_add with lang NULL).
    if (Array.isArray(cur)) return [text, ...cur.slice(1)]
    return text
  }
  if (cur === undefined || cur === '') return ['', lang, text]
  return Array.isArray(cur) ? [...cur, lang, text] : [cur, lang, text]
}

const DIST_TERMS: Record<string, number> = { a: 0, k1: 0, b: 1, k2: 1, c: 2 }
const TCA_TERMS: Record<string, number> = { kr: 0, vr: 0, kb: 1, vb: 1, cr: 2, cb: 3, br: 4, bb: 5 }
const VIG_TERMS: Record<string, number> = { k1: 0, k2: 1, k3: 2 }

function addRow<M extends string>(cal: Calibrations<M> | undefined, model: M, row: number[]): Calibrations<M> {
  if (!cal) return { model, rows: [row] }
  if (cal.model === model) cal.rows.push(row)
  return cal
}

/** Parses one Lensfun XML file, adding its mounts, cameras and lenses to `into`. Invalid entries are skipped (as Lensfun's `Check`). */
export function parseLensfunXml(xml: string, into: Pick<LensfunData, 'mounts' | 'cameras' | 'lenses'>): void {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '')
  const stack: string[] = []
  let mount: LensfunMount | null = null
  let camera: Partial<LensfunCamera> | null = null
  let lens: LensfunLens | null = null
  let lang: string | undefined
  for (const m of text.matchAll(/<(\/?)([\w-]+)([^>]*?)(\/?)>|([^<]+)/g)) {
    if (m[5] !== undefined) {
      const ctx = stack[stack.length - 1]
      if (!ctx || !/\S/.test(m[5])) continue
      const t = decode(m[5]).trim()
      if (ctx === 'name' && mount) mount.name = t
      else if (ctx === 'compat' && mount) mount.compat.push(t)
      else if (ctx === 'maker') {
        if (camera) camera.maker = addML(camera.maker, lang, t)
        else if (lens) lens.maker = addML(lens.maker, lang, t)
      } else if (ctx === 'model') {
        if (camera) camera.model = addML(camera.model, lang, t)
        else if (lens) lens.model = addML(lens.model, lang, t)
      } else if (ctx === 'variant' && camera) camera.variant = addML(camera.variant, lang, t)
      else if (ctx === 'mount') {
        if (camera) camera.mount = t
        else if (lens) lens.mounts.push(t)
      } else if (ctx === 'cropfactor') {
        if (camera) camera.crop = atof(t)
        else if (lens) lens.crop = atof(t)
      } else if (ctx === 'aspect-ratio' && lens) {
        const colon = t.indexOf(':')
        lens.aspect = colon >= 0 ? atof(t) / atof(t.slice(colon + 1)) : atof(t)
      } else if (ctx === 'type' && lens) lens.type = t.toLowerCase()
      lang = undefined
      continue
    }
    const [, close, name, attrText, selfClose] = m
    if (close) {
      stack.pop()
      if (name === 'mount' && mount && stack.length === 1) {
        if (mount.name) into.mounts.push(mount)
        mount = null
      } else if (name === 'camera' && camera) {
        const c = camera
        if (c.maker && c.model && c.mount && (c.crop ?? 0) > 0) into.cameras.push(c as LensfunCamera)
        camera = null
      } else if (name === 'lens' && lens) {
        if (lens.model && lens.mounts.length && lens.crop > 0 && lens.aspect >= 1) into.lenses.push(lens)
        lens = null
      }
      continue
    }
    const a = attrText ? attributes(attrText) : {}
    const ctx = stack[stack.length - 1]
    if (!selfClose) stack.push(name)
    lang = a.lang
    if (name === 'mount' && ctx === 'lensdatabase') mount = { name: '', compat: [] }
    else if (name === 'camera') camera = { mount: '' }
    else if (name === 'lens') {
      lens = { maker: '', model: '', mounts: [], crop: 1, aspect: 1.5, type: 'rectilinear', minFocal: 0, maxFocal: 0, minAperture: 0, maxAperture: 0 }
    } else if (name === 'focal' && lens) {
      if (a.min !== undefined) lens.minFocal = atof(a.min)
      if (a.max !== undefined) lens.maxFocal = atof(a.max)
      if (a.value !== undefined) lens.minFocal = lens.maxFocal = atof(a.value)
    } else if (name === 'aperture' && lens) {
      if (a.min !== undefined) lens.minAperture = atof(a.min)
      if (a.max !== undefined) lens.maxAperture = atof(a.max)
      if (a.value !== undefined) lens.minAperture = lens.maxAperture = atof(a.value)
    } else if (name === 'center' && lens) {
      const c: [number, number] = [atof(a.x), atof(a.y)]
      if (c[0] || c[1]) lens.center = c
    } else if (name === 'distortion' && lens) {
      const model = a.model as DistortionModel
      if (model !== 'poly3' && model !== 'poly5' && model !== 'ptlens') continue
      const t = [0, 0, 0]
      for (const [k, i] of Object.entries(DIST_TERMS)) if (a[k] !== undefined) t[i] = atof(a[k])
      const focal = atof(a.focal)
      // A measured real focal length, else 0: `realFocal` gives Lensfun's estimate.
      const real = a['real-focal'] !== undefined ? Math.max(0, atof(a['real-focal'])) : 0
      lens.distortion = addRow(lens.distortion, model, [focal, real, ...(model === 'ptlens' ? t : model === 'poly5' ? t.slice(0, 2) : t.slice(0, 1))])
    } else if (name === 'tca' && lens) {
      const model = a.model as TcaModel
      if (model !== 'linear' && model !== 'poly3') continue
      const t = [1, 1, 0, 0, 0, 0]
      for (const [k, i] of Object.entries(TCA_TERMS)) if (a[k] !== undefined) t[i] = atof(a[k])
      lens.tca = addRow(lens.tca, model, [atof(a.focal), ...(model === 'poly3' ? t : t.slice(0, 2))])
    } else if (name === 'vignetting' && lens) {
      if (a.model !== 'pa') continue
      const t = [0, 0, 0]
      for (const [k, i] of Object.entries(VIG_TERMS)) if (a[k] !== undefined) t[i] = atof(a[k])
      lens.vignetting = addRow(lens.vignetting, 'pa', [atof(a.focal), atof(a.aperture), atof(a.distance), ...t])
    }
  }
}

/** All texts of a multi-language string: the default first, then the translations. */
export const mlTexts = (s: MLString | undefined): string[] =>
  s === undefined ? [] : Array.isArray(s) ? [s[0], ...s.filter((_, i) => i > 0 && i % 2 === 0)].filter(Boolean) : s ? [s] : []

/** The text Lensfun shows in an English locale (`lf_mlstr_get`): the "en" translation, else the default. */
export function mlText(s: MLString | undefined): string {
  if (s === undefined) return ''
  if (!Array.isArray(s)) return s
  for (let i = 1; i + 1 < s.length; i += 2) if (s[i] === 'en') return s[i + 1]
  return s[0]
}

/** A distortion row's real focal length: the measured one, else Lensfun's estimate (database.cpp, <distortion>). */
export function realFocal(model: DistortionModel, row: number[]): number {
  if (row[1] > 0) return row[1]
  const f = row[0]
  return model === 'ptlens' ? f * (1 - row[2] - row[3] - row[4]) : model === 'poly3' ? f * (1 - row[2]) : f
}
