// Develop presets (owner's choices, 2026-10-12): a preset holds the settings chosen when it was saved (the same
// checklist as Copy), is applied with an Amount from 0 to 200 % like Lightroom's preset Amount, previews on hover,
// and one preset can be picked to develop new photos when a folder is opened or imported.

import { HIGHEST_TEMPERATURE, LOWEST_TEMPERATURE } from '../engine/color/temperature'
import { AUTO_SLIDERS, BUILT_IN_TARGETS } from '../engine/develop/auto'
import { DEFAULT_SETTINGS, type DevelopSettings, type SourceKind } from '../engine/develop/settings'
import { DEFAULT_DETAIL, DETAIL_RANGES, withDetail, type DetailSettings } from '../engine/detail/settings'
import type { Clipboard, PasteKey } from './paste'
import { blendToneCurve, withToneCurve } from '../engine/develop/tone-curve'
import { blendColourMixer, withColourMixer } from '../engine/develop/colour-mixer'

/** What is saved for a preset (in the catalog's `presets` table, as JSON). */
export interface PresetData {
  keys: PasteKey[]
  settings: DevelopSettings
  /** Run the preset's Auto (look, strength, sliders) on each photo. */
  rerunAuto: boolean
  /** RAW or JPEG: the advanced darktable modules only go to photos of the same type. */
  sourceKind: SourceKind
}

export interface Preset extends PresetData {
  /** `starter:…` for built-in starters, `user:<row id>` for the user's own. */
  id: string
  name: string
  starter: boolean
}

const starter = (id: string, name: string, values: Partial<DevelopSettings>): Preset => ({
  id: `starter:${id}`,
  name,
  starter: true,
  keys: Object.keys(values) as PasteKey[],
  settings: { ...DEFAULT_SETTINGS, ...values },
  rerunAuto: false,
  sourceKind: 'raw',
})

/**
 * Starting points built from today's sliders, chosen by eye — not standards. More arrive with the Phase 3 tools
 * (tone curve, colour mixer, grain…).
 */
export const STARTER_PRESETS: Preset[] = [
  {
    id: 'starter:auto',
    name: 'Auto tone (Natural)',
    starter: true,
    keys: [],
    settings: { ...DEFAULT_SETTINGS, auto: { target: BUILT_IN_TARGETS[0], sliders: AUTO_SLIDERS.map((s) => s.key), strength: 1 } },
    rerunAuto: true,
    sourceKind: 'raw',
  },
  starter('bw', 'Black & white', { saturation: -100, vibrance: 0 }),
  starter('punchy', 'Punchy', { contrast: 25, whites: 10, blacks: -10, vibrance: 30 }),
  starter('soft', 'Soft', { contrast: -20, highlights: -20, shadows: 20, saturation: -10 }),
  starter('bright', 'Bright & airy', { exposure: 0.5, contrast: -15, shadows: 30, whites: 15, vibrance: -10 }),
]

export function presetFromRow(row: { id: number; name: string; preset: string }): Preset | null {
  try {
    const d = JSON.parse(row.preset) as PresetData
    return { ...d, settings: { ...DEFAULT_SETTINGS, ...d.settings }, id: `user:${row.id}`, name: row.name, starter: false }
  } catch {
    return null
  }
}

/** A preset in the form Paste and the background developer take. */
export const presetClip = (p: Preset): Clipboard => ({ settings: p.settings, keys: p.keys, rerunAuto: p.rerunAuto && !!p.settings.auto, sourceKind: p.sourceKind, sourceName: p.name })

export const AMOUNT_MIN = 0
export const AMOUNT_MAX = 2

type Range = [number, number]
const SLIDER_RANGES: Record<'exposure' | 'contrast' | 'highlights' | 'shadows' | 'whites' | 'blacks' | 'vibrance' | 'saturation', Range> = {
  exposure: [-5, 5],
  contrast: [-100, 100],
  highlights: [-100, 100],
  shadows: [-100, 100],
  whites: [-100, 100],
  blacks: [-100, 100],
  vibrance: [-100, 100],
  saturation: [-100, 100],
}
// The ranges of the Advanced sliders in BasicPanel.
const ADVANCED_RANGES: Record<'baseExposure' | 'skew' | 'whiteTarget' | 'blackTarget' | 'huePreservation' | 'highlightClip', Range> = {
  baseExposure: [-2, 3],
  skew: [-1, 1],
  whiteTarget: [20, 200],
  blackTarget: [0, 2],
  huePreservation: [0, 100],
  highlightClip: [0.5, 1.5],
}
const TEMPERATURE_RANGE: Range = [LOWEST_TEMPERATURE + 99, HIGHEST_TEMPERATURE / 2]

const clamp = (v: number, [lo, hi]: Range) => Math.min(hi, Math.max(lo, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * The preset's Amount: moves each setting from `before` towards `after` (the photo with the preset fully applied)
 * by `amount` — 0 leaves the photo as it was, 1 is the preset, 2 doubles its change. Switches (demosaic, highlight
 * reconstruction) follow the preset whenever the amount is above 0. Sliders set by an Auto in the preset scale
 * from 0, like Auto's own strength, so the photo's Auto record stays true. `asShot` (the camera's white balance)
 * lets a change between "As Shot" and a custom white balance be blended.
 */
export function blendSettings(before: DevelopSettings, after: DevelopSettings, amount: number, asShot?: { temperature: number; tint: number }): DevelopSettings {
  const t = Math.min(AMOUNT_MAX, Math.max(AMOUNT_MIN, amount))
  if (t === 1) return after
  if (t === 0) return before
  let out: DevelopSettings = { ...after, advanced: { ...after.advanced } }
  for (const k of Object.keys(SLIDER_RANGES) as (keyof typeof SLIDER_RANGES)[]) {
    out[k] = clamp(lerp(before[k], after[k], t), SLIDER_RANGES[k])
  }
  for (const k of Object.keys(ADVANCED_RANGES) as (keyof typeof ADVANCED_RANGES)[]) {
    out.advanced[k] = clamp(lerp(before.advanced[k], after.advanced[k], t), ADVANCED_RANGES[k])
  }
  const a = after.auto
  if (a && a !== before.auto && a.strength > 0) {
    const strength = Math.min(1.5, a.strength * t)
    for (const k of a.sliders) out[k] = clamp(Math.round((after[k] * strength) / a.strength * 100) / 100, SLIDER_RANGES[k])
    out.auto = { ...a, strength }
  }
  out = { ...out, whiteBalance: blendWhiteBalance(before.whiteBalance, after.whiteBalance, t, asShot) }
  // The tone curve: its change from the photo's own curve (or a straight line) scaled by the amount.
  if (before.toneCurve !== after.toneCurve) out = withToneCurve(out, blendToneCurve(before.toneCurve, after.toneCurve, t))
  // The Colour Mixer: each band from the photo's value towards the preset's, Point Color's shifts the same way.
  if (before.colourMixer !== after.colourMixer) out = withColourMixer(out, blendColourMixer(before.colourMixer, after.colourMixer, t))
  if (before.detail || after.detail) out = withDetail(out, blendDetail(before.detail ?? DEFAULT_DETAIL, after.detail ?? DEFAULT_DETAIL, t))
  // Keep the sliders' own precision.
  for (const k of ['contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'saturation'] as const) out[k] = Math.round(out[k])
  out.exposure = Math.round(out.exposure * 100) / 100
  return out
}

/**
 * Sharpening and Noise Reduction under a preset's Amount: every slider moves from the photo's value (off when it has
 * none) towards the preset's, like the other sliders, at the slider's own precision (LightBench's choice).
 */
function blendDetail(before: DetailSettings, after: DetailSettings, t: number): DetailSettings {
  const b = (k: 'amount' | 'radius' | 'detail' | 'masking', x: number, y: number, digits = 0) => {
    const [lo, hi] = DETAIL_RANGES[k]
    return Math.round(clamp(lerp(x, y, t), [lo, hi]) * 10 ** digits) / 10 ** digits
  }
  const n = (k: keyof DetailSettings['noise']) => {
    const [lo, hi] = DETAIL_RANGES[k]
    return Math.round(clamp(lerp(before.noise[k], after.noise[k], t), [lo, hi]))
  }
  return {
    sharpen: {
      amount: b('amount', before.sharpen.amount, after.sharpen.amount),
      radius: b('radius', before.sharpen.radius, after.sharpen.radius, 1),
      detail: b('detail', before.sharpen.detail, after.sharpen.detail),
      masking: b('masking', before.sharpen.masking, after.sharpen.masking),
    },
    noise: {
      luminance: n('luminance'),
      luminanceDetail: n('luminanceDetail'),
      luminanceContrast: n('luminanceContrast'),
      color: n('color'),
      colorDetail: n('colorDetail'),
      colorSmoothness: n('colorSmoothness'),
    },
  }
}

function blendWhiteBalance(
  before: DevelopSettings['whiteBalance'],
  after: DevelopSettings['whiteBalance'],
  t: number,
  asShot?: { temperature: number; tint: number },
): DevelopSettings['whiteBalance'] {
  if (before.mode === 'as-shot' && after.mode === 'as-shot') return after
  const from = before.mode === 'custom' ? before : asShot
  const to = after.mode === 'custom' ? after : asShot
  if (!from || !to) return after
  // Temperature blends in mireds (how the Temp slider moves), tint in log steps (how the Tint slider moves).
  const mired = lerp(1e6 / from.temperature, 1e6 / to.temperature, t)
  return {
    mode: 'custom',
    temperature: clamp(1e6 / Math.max(1, mired), TEMPERATURE_RANGE),
    tint: Math.exp(lerp(Math.log(from.tint), Math.log(to.tint), t)),
  }
}
