// Lightroom's Effects fields in XMP sidecars (PHASE3.md Part 25; owner's decision E3 = A): Texture, Clarity, Dehaze, the
// post-crop vignette and grain are read at import and written back under Part 7's rules (only into sidecars that already
// hold Camera Raw settings and aren't already applied, and only what LightBench changed; sidecar/lightroom.ts
// `planLightroomWrite`, lightroomCurve.ts `planToneWrite`). Glow is read at import and NEVER written (owner, after
// Cowork's check: its field names come from a third-party source only). This file holds the conversions and the rules,
// without file access, so they can be unit-tested; xmp.ts reads and writes the fields.
//
// The fields (Adobe's Camera Raw namespace crs:) and how sure each is (Cowork, research/COLOUR_MIXER_EFFECTS.md and
// EFFECTS_DESIGN.md; nothing here was checked against a sidecar Lightroom wrote):
//  - Texture: ExifTool forum (Lightroom 8.3 / Camera Raw 11.3) [cowork]. −100…100.
//  - Clarity2012: darktable's importer reads it (lightroom.c) [read]. −100…100.
//  - Dehaze: Exiv2 and the Lightroom SDK list it [cowork]; Adobe's Lightroom API gives −100…+100 [cowork].
//  - PostCropVignetteAmount, …Midpoint, …Feather, …Roundness, …Style: darktable's importer reads them [read]; Exiv2 and the
//    Lightroom SDK list them with …HighlightContrast (Highlights) [cowork]. Style 1 = Highlight Priority is confirmed by
//    darktable's importer; 2 = Color Priority and 3 = Paint Overlay rest on one secondary source (UNVERIFIED).
//  - GrainAmount, GrainSize, GrainFrequency: Exiv2 / the SDK [cowork]. GrainFrequency read as Roughness (owner's decision
//    G3 = A; Cowork's indirect evidence: Size has its own field) — UNVERIFIED; darktable's importer reads it as coarseness.
//  - GlowStyle, GlowRange, GlowSpread, GlowWarmth: a third-party source only (Cowork, EFFECTS_VERIFY item 8e); their value
//    encodings are unknown, and the amount's field name is unknown, so a Glow read here has its Range, Spread, Warmth and
//    Style but no amount (it stays off until the user sets one). Read only; never written.
// Absent fields read as Lightroom's defaults as secondary sources give them (Midpoint 50, Feather 50, Size 25, Roughness 50;
// Cowork: Feather 50 from a secondary source, the others unconfirmed): UNVERIFIED.
// LightBench's sliders have Lightroom's names and ranges, so the numbers carry over one for one; the algorithms are
// darktable's (and LightBench's), so the look is only approximately Lightroom's (closest match).

import { DEFAULT_GLOW, DEFAULT_GRAIN, DEFAULT_VIGNETTE, effectsOf, newGrainSeed, normalizeEffects, type EffectsSettings, type GlowSettings, type VignetteStyle } from '../engine/develop/effects'

export { effectsOf }

/** The Effects fields LightBench reads and writes, in this order. */
export const LR_FX_FIELDS = [
  'Texture', 'Clarity2012', 'Dehaze',
  'PostCropVignetteAmount', 'PostCropVignetteMidpoint', 'PostCropVignetteRoundness', 'PostCropVignetteFeather', 'PostCropVignetteHighlightContrast', 'PostCropVignetteStyle',
  'GrainAmount', 'GrainSize', 'GrainFrequency',
] as const
/** Glow's fields: read only. */
export const LR_GLOW_FIELDS = ['GlowStyle', 'GlowRange', 'GlowSpread', 'GlowWarmth'] as const

/** Lightroom's defaults for absent fields (secondary sources; unverified). */
const DEFAULTS = [0, 0, 0, 0, 50, 0, 50, 0, 1, 0, 25, 50]
const SIGNED = new Set([0, 1, 2, 3, 5])

export type LrFxGroup = 'presence' | 'vignette' | 'grain'
const GROUP_FIELDS: Record<LrFxGroup, number[]> = { presence: [0, 1, 2], vignette: [3, 4, 5, 6, 7, 8], grain: [9, 10, 11] }
export const LR_FX_GROUPS: LrFxGroup[] = ['presence', 'vignette', 'grain']

/** What a sidecar says: the fields in LR_FX_FIELDS order (undefined where absent) and Glow's as text. */
export interface LrFxRead {
  fields: (number | undefined)[]
  glow: Partial<Record<(typeof LR_GLOW_FIELDS)[number], string>>
  processVersion: boolean
  applied: boolean
  /** lightbench:LightroomEffects: the Lightroom effects LightBench was last in step with. */
  marker?: string
}

/** Lightroom's effects with every field resolved (what Lightroom would show). */
export interface LrFxState {
  values: number[]
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function lrFxState(fields: (number | undefined)[] | undefined): LrFxState {
  return { values: LR_FX_FIELDS.map((_, i) => (finite(fields?.[i]) ? fields![i]! : DEFAULTS[i])) }
}

const STYLE_CODE: Record<VignetteStyle, number> = { highlight: 1, colour: 2, paint: 3 }
const STYLE_FROM: Record<number, VignetteStyle> = { 1: 'highlight', 2: 'colour', 3: 'paint' }

/** What Lightroom's fields would be for LightBench's effects. */
export function fxToLightroom(fx: EffectsSettings | undefined): LrFxState {
  const v = fx?.vignette ?? DEFAULT_VIGNETTE
  const g = fx?.grain ?? DEFAULT_GRAIN
  return {
    values: [fx?.texture ?? 0, fx?.clarity ?? 0, fx?.dehaze ?? 0, v.amount, v.midpoint, v.roundness, v.feather, v.highlights, STYLE_CODE[v.style], g.amount, g.size, g.roughness],
  }
}

/** A vignette or grain with Amount 0 does nothing: its other numbers don't count as a difference. */
function groupValues(s: LrFxState, g: LrFxGroup): number[] {
  const v = GROUP_FIELDS[g].map((i) => s.values[i])
  if (g === 'vignette' && Math.round(v[0]) === 0) return [0]
  if (g === 'grain' && Math.round(v[0]) === 0) return [0]
  return v.map((x) => Math.round(x))
}
export const sameFxGroup = (a: LrFxState, b: LrFxState, g: LrFxGroup) => JSON.stringify(groupValues(a, g)) === JSON.stringify(groupValues(b, g))
export const sameLrFx = (a: LrFxState, b: LrFxState) => LR_FX_GROUPS.every((g) => sameFxGroup(a, b, g))

export const lrFxKey = (s: LrFxState) => JSON.stringify(s.values.map((v) => Math.round(v * 100) / 100 + 0))

export function parseLrFxKey(key: string | null | undefined): LrFxState | null {
  if (!key) return null
  try {
    const v = JSON.parse(key) as unknown
    return Array.isArray(v) && v.length === LR_FX_FIELDS.length && v.every(finite) ? { values: v } : null
  } catch {
    return null
  }
}

export function sameLrFxKey(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === b) return true
  const x = parseLrFxKey(a)
  const y = parseLrFxKey(b)
  return !!x && !!y && sameLrFx(x, y)
}

/** Whether Lightroom's fields would change LightBench's effects. */
export const lrFxDiffers = (fx: EffectsSettings | undefined, s: LrFxState) => !sameLrFx(fxToLightroom(fx), s)

/**
 * Glow from Lightroom's (third-party-named) fields, kept off: the amount's field is unknown. Style as a name ("Bloom",
 * "Diffusion", "Halation"; numbers aren't mapped: their meaning is unknown); Range and Spread 0…100, Warmth −100…100, as
 * LightBench's own ranges (Adobe publishes none: an assumption, UNVERIFIED). Undefined when the sidecar has none.
 */
export function glowFromLightroom(glow: LrFxRead['glow'] | undefined): Partial<GlowSettings> | undefined {
  if (!glow || !Object.keys(glow).length) return undefined
  const out: Partial<GlowSettings> = {}
  const style = glow.GlowStyle?.trim().toLowerCase()
  if (style === 'bloom' || style === 'diffusion' || style === 'halation') out.style = style
  const num = (t: string | undefined, lo: number, hi: number) => {
    const v = t !== undefined && t.trim() !== '' ? Number(t) : NaN
    return Number.isFinite(v) ? Math.round(clamp(v, lo, hi)) : undefined
  }
  const range = num(glow.GlowRange, 0, 100)
  const spread = num(glow.GlowSpread, 0, 100)
  const warmth = num(glow.GlowWarmth, -100, 100)
  if (range !== undefined) out.range = range
  if (spread !== undefined) out.spread = spread
  if (warmth !== undefined) out.warmth = warmth
  return Object.keys(out).length ? out : undefined
}

/**
 * LightBench's effects with Lightroom's applied (only the groups that differ from what LightBench has, so LightBench's
 * own settings Lightroom has no field for stay: the vignette's centre and shape, colour grain, darktable's settings). A
 * grain that starts here gets a new seed. `glow` (read only) sets Glow's other sliders when present.
 */
export function fxFromLightroom(current: EffectsSettings | undefined, s: LrFxState, glow?: Partial<GlowSettings>, rand: () => number = Math.random): EffectsSettings | undefined {
  const ours = fxToLightroom(current)
  const fx: EffectsSettings = { ...current }
  const v = s.values
  if (!sameFxGroup(ours, s, 'presence')) {
    fx.texture = Math.round(clamp(v[0], -100, 100))
    fx.clarity = Math.round(clamp(v[1], -100, 100))
    fx.dehaze = Math.round(clamp(v[2], -100, 100))
  }
  if (!sameFxGroup(ours, s, 'vignette')) {
    fx.vignette = {
      ...(current?.vignette ?? DEFAULT_VIGNETTE),
      amount: Math.round(clamp(v[3], -100, 100)),
      midpoint: Math.round(clamp(v[4], 0, 100)),
      roundness: Math.round(clamp(v[5], -100, 100)),
      feather: Math.round(clamp(v[6], 0, 100)),
      highlights: Math.round(clamp(v[7], 0, 100)),
      style: STYLE_FROM[Math.round(v[8])] ?? 'highlight',
    }
  }
  if (!sameFxGroup(ours, s, 'grain')) {
    fx.grain = {
      ...(current?.grain ?? { ...DEFAULT_GRAIN, seed: newGrainSeed(rand) }),
      amount: Math.round(clamp(v[9], 0, 100)),
      size: Math.round(clamp(v[10], 0, 100)),
      roughness: Math.round(clamp(v[11], 0, 100)),
    }
  }
  if (glow) fx.glow = { ...(current?.glow ?? DEFAULT_GLOW), ...glow }
  return normalizeEffects(fx)
}

// ---- writing

export interface LrFxWritePlan {
  groups: LrFxGroup[]
  state: LrFxState
  /** The marker to store (lightbench:LightroomEffects), when LightBench and Lightroom agree after the write. */
  marker?: string
}

/**
 * Which Effects fields LightBench writes into an existing sidecar, by the crop's and the tone curve's rules: only into a
 * sidecar with Camera Raw settings (crs:ProcessVersion) that isn't already applied; a group only when LightBench's values
 * differ from the file's and LightBench itself changed them since the file was last written (the file's own
 * lightbench:Develop shows others, or none when it has no LightBench settings yet), or the fields no longer match the
 * marker (Ignore after Lightroom changed them). Glow is never written.
 */
export function planFxWrite(file: LrFxRead | undefined, fileDevelop: EffectsSettings | undefined, ours: EffectsSettings | undefined): LrFxWritePlan {
  const state = fxToLightroom(ours)
  if (!file || !file.processVersion || file.applied) return { groups: [], state }
  const theirs = lrFxState(file.fields)
  const before = fxToLightroom(fileDevelop)
  const marker = parseLrFxKey(file.marker)
  const groups = LR_FX_GROUPS.filter((g) => !sameFxGroup(state, theirs, g) && (!sameFxGroup(state, before, g) || (!!marker && !sameFxGroup(marker, theirs, g))))
  const after: LrFxState = { values: theirs.values.map((x, i) => (groups.some((g) => GROUP_FIELDS[g].includes(i)) ? state.values[i] : x)) }
  return { groups, state, marker: sameLrFx(after, state) ? lrFxKey(after) : undefined }
}

/** The values written for the plan's groups, as Lightroom-style text: integers, signed ones with a sign ("+13"). */
export function lrFxValues(p: LrFxWritePlan): { local: string; value: string }[] {
  const out: { local: string; value: string }[] = []
  for (const g of p.groups) {
    for (const i of GROUP_FIELDS[g]) {
      const n = Math.round(p.state.values[i]) + 0
      out.push({ local: LR_FX_FIELDS[i], value: SIGNED.has(i) && n > 0 ? `+${n}` : String(n) })
    }
  }
  return out
}
