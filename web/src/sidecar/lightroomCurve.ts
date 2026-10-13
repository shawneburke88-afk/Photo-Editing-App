// Lightroom's tone curve fields in XMP sidecars (PHASE3.md Part 12), read and written under the rules of Part 7's crop
// fields (sidecar/lightroom.ts): read as the closest match; written only into sidecars that already hold Camera Raw
// settings, and only when LightBench changed its curve. This file holds the conversions and the rules, without any file
// access, so they can be unit-tested; xmp.ts reads and writes the fields.
//
// The fields (Adobe's Camera Raw namespace `crs:`):
//  - ToneCurvePV2012, ToneCurvePV2012Red, ToneCurvePV2012Green, ToneCurvePV2012Blue: point curves as an ordered list
//    (rdf:Seq) of "x, y" pairs of integers 0…255. darktable reads the first (src/develop/lightroom.c lines 963-978);
//    the channel names are as ExifTool lists them and as Lightroom was remembered to write them (not checked here).
//  - ToneCurveName2012: "Linear", "Medium Contrast", "Strong Contrast" or "Custom" (darktable lightroom.c 610-620).
//  - ParametricShadows, ParametricDarks, ParametricLights, ParametricHighlights (−100…100) and ParametricShadowSplit,
//    ParametricMidtoneSplit, ParametricHighlightSplit (0…100; Lightroom's defaults 25, 50, 75) (lightroom.c 582-609).
//
// The mapping (closest match, not checked in Lightroom):
//  - The points map to LightBench's point curves as x / 255, y / 255 on its curve's axis (the tones shown, sRGB-encoded).
//    Lightroom's curve axis is its own encoding, not documented here, so a curve moves the same numbers, not exactly the
//    same tones.
//  - The parametric sliders and splits map number for number to Regions. LightBench's region curve is its own design
//    (Lightroom's isn't public), so the shape is similar, not equal.
//  - Unlike darktable's importer, a named preset's points are used as the file states them, without the parametric
//    offsets added on top (lightroom.c lines 1516-1529 add them to the first points of any non-custom curve; the owner
//    chose not to copy that). When a file names Medium or Strong Contrast but holds no points, LightBench's presets of
//    those names stand in (tone-curve.ts CURVE_PRESETS; Lightroom's own preset points are Adobe's and aren't used).
//  - Refine Saturation and the brightness measure stay as they are (a new curve gets LightBench's defaults: 100 % and
//    Largest channel). Lightroom's own Refine Saturation field isn't read or written: the only source naming one
//    (crs:CurveRefineSaturation) is LightCraft's own documentation, unconfirmed.
//  - Lightroom's Red, Green and Blue curves are read whenever present. LightCraft only applies them when the master and
//    all three are present (its observation of Lightroom Classic, docs/research/lightcraft/REVIEW.md; unverified), which
//    isn't followed: a file with a channel curve is taken to mean it.

import { CURVE_PRESETS, DEFAULT_TONE_CURVE, isLinear, normalizePoints, withToneCurve, type CurvePoint, type ToneCurveSettings } from '../engine/develop/tone-curve'
import { NS_CRS } from './lightroom'

/** A point curve as Lightroom stores it: integer pairs 0…255. */
export type LrPoints = [number, number][]

/** The tone curve fields as a sidecar states them; absent fields are undefined. */
export interface LrToneFields {
  name?: string
  rgb?: LrPoints
  red?: LrPoints
  green?: LrPoints
  blue?: LrPoints
  shadows?: number
  darks?: number
  lights?: number
  highlights?: number
  shadowSplit?: number
  midtoneSplit?: number
  highlightSplit?: number
}

/** What a sidecar says about Lightroom's tone curve. */
export interface LrToneRead {
  fields: LrToneFields
  /** crs:ProcessVersion is present (Lightroom or Camera Raw settings). */
  processVersion: boolean
  /** crs:AlreadyApplied is True. */
  applied: boolean
  /** lightbench:LightroomToneCurve: the Lightroom curve LightBench was last in step with. */
  marker?: string
}

/** Lightroom's tone curve with every field resolved (what Lightroom would show). */
export interface LrToneState {
  /** Shadows, Darks, Lights, Highlights, ShadowSplit, MidtoneSplit, HighlightSplit. */
  params: [number, number, number, number, number, number, number]
  rgb: LrPoints
  red: LrPoints
  green: LrPoints
  blue: LrPoints
}

export const LR_LINEAR: LrPoints = [
  [0, 0],
  [255, 255],
]
const DEFAULT_PARAMS: LrToneState['params'] = [0, 0, 0, 0, 25, 50, 75]
const CHANNELS = ['rgb', 'red', 'green', 'blue'] as const

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** "x, y" pairs as Lightroom writes them; null when there are fewer than two usable points. */
export function parseLrPoints(items: string[] | null | undefined): LrPoints | null {
  if (!items) return null
  const pts: LrPoints = []
  for (const it of items) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(it)
    if (!m) continue
    pts.push([clamp(Math.round(Number(m[1])), 0, 255), clamp(Math.round(Number(m[2])), 0, 255)])
  }
  pts.sort((a, b) => a[0] - b[0])
  const out = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0])
  return out.length >= 2 ? out : null
}

const toLr = (pts: readonly CurvePoint[]): LrPoints => {
  const out: LrPoints = []
  for (const [x, y] of pts) {
    const p: [number, number] = [Math.round(x * 255), Math.round(y * 255)]
    // Two points closer than 1/255 become one (the first is kept).
    if (!out.length || p[0] > out[out.length - 1][0]) out.push(p)
  }
  return out.length >= 2 ? out : LR_LINEAR
}
const fromLr = (pts: LrPoints): CurvePoint[] => normalizePoints(pts.map(([x, y]) => [x / 255, y / 255])) ?? DEFAULT_TONE_CURVE.rgb

/** Lightroom's tone curve fields resolved: what Lightroom shows for them. */
export function lrToneState(f: LrToneFields | undefined): LrToneState {
  const x = f ?? {}
  const num = (v: number | undefined, d: number) => (finite(v) ? v : d)
  let rgb = x.rgb ?? null
  if (!rgb) {
    // A name without points: LightBench's preset of that name (the closest match it has).
    const preset = x.name === 'Medium Contrast' ? CURVE_PRESETS[1] : x.name === 'Strong Contrast' ? CURVE_PRESETS[2] : null
    rgb = preset ? toLr(preset.points) : LR_LINEAR
  }
  return {
    params: [num(x.shadows, 0), num(x.darks, 0), num(x.lights, 0), num(x.highlights, 0), num(x.shadowSplit, 25), num(x.midtoneSplit, 50), num(x.highlightSplit, 75)],
    rgb,
    red: x.red ?? LR_LINEAR,
    green: x.green ?? LR_LINEAR,
    blue: x.blue ?? LR_LINEAR,
  }
}

/** True when the state is Lightroom's untouched curve (nothing to read). */
export const isDefaultLrTone = (s: LrToneState) => s.params.every((v, i) => v === DEFAULT_PARAMS[i]) && CHANNELS.every((c) => sameLrPoints(s[c], LR_LINEAR))

const sameLrPoints = (a: LrPoints, b: LrPoints) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1])
const sameParams = (a: LrToneState, b: LrToneState) => a.params.every((v, i) => Math.abs(v - b.params[i]) < 0.5)
export const sameLrCurves = (a: LrToneState, b: LrToneState) => CHANNELS.every((c) => sameLrPoints(a[c], b[c]))
export const sameLrTone = (a: LrToneState, b: LrToneState) => sameParams(a, b) && sameLrCurves(a, b)

/** A stable text form, for remembering and comparing (sidecar/changes.ts, the marker). */
export const lrToneKey = (s: LrToneState) => JSON.stringify(s)

export function parseLrToneKey(key: string | null | undefined): LrToneState | null {
  if (!key) return null
  try {
    const j = JSON.parse(key) as LrToneState
    const pts = (p: unknown) => Array.isArray(p) && p.every((q) => Array.isArray(q) && q.length === 2 && q.every(finite))
    if (!Array.isArray(j.params) || j.params.length !== 7 || !j.params.every(finite) || !CHANNELS.every((c) => pts(j[c]))) return null
    return j
  } catch {
    return null
  }
}

export function sameLrToneKey(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === b) return true
  const x = parseLrToneKey(a)
  const y = parseLrToneKey(b)
  return !!x && !!y && sameLrTone(x, y)
}

/** What Lightroom's fields would be for LightBench's tone curve. */
export function toneToLightroom(tc: ToneCurveSettings | undefined): LrToneState {
  const t = tc ?? DEFAULT_TONE_CURVE
  const r = t.regions
  return {
    params: [r.shadows, r.darks, r.lights, r.highlights, r.splits[0], r.splits[1], r.splits[2]].map((v) => Math.round(v)) as LrToneState['params'],
    rgb: isLinear(t.rgb) ? LR_LINEAR : toLr(t.rgb),
    red: isLinear(t.red) ? LR_LINEAR : toLr(t.red),
    green: isLinear(t.green) ? LR_LINEAR : toLr(t.green),
    blue: isLinear(t.blue) ? LR_LINEAR : toLr(t.blue),
  }
}

/**
 * LightBench's tone curve with Lightroom's applied: Regions from the parametric fields, the four point curves from the
 * point fields. Refine Saturation and the brightness measure stay as they were (undefined when it all ends at the defaults).
 */
export function toneFromLightroom(current: ToneCurveSettings | undefined, s: LrToneState): ToneCurveSettings | undefined {
  const base = current ?? DEFAULT_TONE_CURVE
  const [sh, dk, lt, hl, ss, ms, hs] = s.params
  const tc: ToneCurveSettings = {
    ...base,
    regions: { shadows: clamp(sh, -100, 100), darks: clamp(dk, -100, 100), lights: clamp(lt, -100, 100), highlights: clamp(hl, -100, 100), splits: [ss, ms, hs] },
    rgb: fromLr(s.rgb),
    red: fromLr(s.red),
    green: fromLr(s.green),
    blue: fromLr(s.blue),
  }
  return withToneCurve<{ toneCurve?: ToneCurveSettings }>({}, tc).toneCurve
}

/** Whether Lightroom's fields would change LightBench's curve. */
export const lrToneDiffers = (tc: ToneCurveSettings | undefined, s: LrToneState) => !sameLrTone(toneToLightroom(tc), s)

/** The tone curve of develop settings saved as JSON (none for missing or damaged settings). */
export function toneCurveOf(develop: string | null | undefined): ToneCurveSettings | undefined {
  try {
    if (develop) return withToneCurve<{ toneCurve?: ToneCurveSettings }>({}, (JSON.parse(develop) as { toneCurve?: ToneCurveSettings }).toneCurve).toneCurve
  } catch {
    // damaged settings: no curve
  }
  return undefined
}

// ---- writing

export type LrToneGroup = 'parametric' | 'points'

export interface LrToneWritePlan {
  groups: LrToneGroup[]
  state: LrToneState
  /** Write ToneCurveName2012 too (only when the RGB points change). */
  name: boolean
  /** The marker to store (lightbench:LightroomToneCurve), when LightBench and Lightroom agree after the write. */
  marker?: string
}

/**
 * Which of Lightroom's tone curve fields LightBench writes into an existing sidecar: as `planLightroomWrite` for the
 * crop (sidecar/lightroom.ts). Only into a sidecar that already holds Camera Raw settings and isn't already applied; a
 * group only when LightBench's curve differs from the fields and LightBench itself changed it since this file was last
 * written (the file's own lightbench:Develop shows another curve, or none when it has no LightBench settings yet), or the
 * fields no longer match the marker (Ignore after Lightroom changed them).
 */
export function planToneWrite(file: LrToneRead | undefined, fileDevelop: ToneCurveSettings | undefined, ours: ToneCurveSettings | undefined): LrToneWritePlan {
  const state = toneToLightroom(ours)
  if (!file || !file.processVersion || file.applied) return { groups: [], state, name: false }
  const theirs = lrToneState(file.fields)
  const before = toneToLightroom(fileDevelop)
  const marker = parseLrToneKey(file.marker)
  const want = (same: (a: LrToneState, b: LrToneState) => boolean) => !same(state, theirs) && (!same(state, before) || (!!marker && !same(marker, theirs)))
  const groups: LrToneGroup[] = []
  if (want(sameParams)) groups.push('parametric')
  if (want(sameLrCurves)) groups.push('points')
  const after: LrToneState = {
    params: groups.includes('parametric') ? state.params : theirs.params,
    rgb: groups.includes('points') ? state.rgb : theirs.rgb,
    red: groups.includes('points') ? state.red : theirs.red,
    green: groups.includes('points') ? state.green : theirs.green,
    blue: groups.includes('points') ? state.blue : theirs.blue,
  }
  return { groups, state, name: groups.includes('points') && !sameLrPoints(state.rgb, theirs.rgb), marker: sameLrTone(after, state) ? lrToneKey(after) : undefined }
}

/** The values written: simple fields as text, point curves as their "x, y" items. */
export function lrToneValues(p: LrToneWritePlan): { local: string; value: string | string[] }[] {
  const s = p.state
  const out: { local: string; value: string | string[] }[] = []
  if (p.groups.includes('parametric')) {
    const names = ['ParametricShadows', 'ParametricDarks', 'ParametricLights', 'ParametricHighlights', 'ParametricShadowSplit', 'ParametricMidtoneSplit', 'ParametricHighlightSplit']
    names.forEach((n, i) => out.push({ local: n, value: String(Math.round(s.params[i])) }))
  }
  if (p.groups.includes('points')) {
    if (p.name) out.push({ local: 'ToneCurveName2012', value: sameLrPoints(s.rgb, LR_LINEAR) ? 'Linear' : 'Custom' })
    const items = (pts: LrPoints) => pts.map(([x, y]) => `${x}, ${y}`)
    out.push({ local: 'ToneCurvePV2012', value: items(s.rgb) })
    out.push({ local: 'ToneCurvePV2012Red', value: items(s.red) })
    out.push({ local: 'ToneCurvePV2012Green', value: items(s.green) })
    out.push({ local: 'ToneCurvePV2012Blue', value: items(s.blue) })
  }
  return out
}

export { NS_CRS }
