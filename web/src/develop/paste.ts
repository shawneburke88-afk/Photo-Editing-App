// Copy / paste / sync of develop settings, Lightroom-style: the user picks which settings travel (grouped
// checkboxes), and pasting replaces those settings on each photo. It never appends to the target's edit the way
// darktable's default paste mode does (`plugins/lighttable/copy_history/pastemode` = 0, "append").

import type { DevelopSettings, SourceKind } from '../engine/develop/settings'
import { AUTO_SLIDERS, type AutoKey } from '../engine/develop/auto'
import { pasteCrop, setAngle, withOrientation, type GeometrySettings } from '../engine/develop/geometry'

export type PasteKey =
  | 'whiteBalance'
  | 'exposure' | 'contrast' | 'highlights' | 'shadows' | 'whites' | 'blacks'
  | 'vibrance' | 'saturation'
  | 'rotate' | 'straighten' | 'crop'
  | 'process' | 'baseExposure' | 'toneMapper' | 'highlightReconstruction' | 'demosaic'

export interface PasteItem {
  key: PasteKey
  label: string
  group: 'White balance' | 'Tone' | 'Presence' | 'Crop' | 'Advanced (darktable modules)'
  /**
   * Only pasted between photos of the same kind (RAW to RAW, JPEG to JPEG): a RAW's +0.7 EV base exposure or its
   * camera white balance would be wrong on a JPEG, which is already rendered.
   */
  sameKindOnly?: boolean
  /**
   * `size` is the target photo's size in its camera orientation, when known: the crop items use it to keep a
   * locked aspect and to keep the crop inside the photo.
   */
  copy: (to: DevelopSettings, from: DevelopSettings, size?: [number, number]) => DevelopSettings
  show: (s: DevelopSettings) => string
}

/** The straightened frame of a photo whose camera-oriented size is `size`, after the user's turns. */
const frameOf = (g: GeometrySettings, size?: [number, number]): [number, number] | null =>
  size ? (g.turns % 2 ? [size[1], size[0]] : size) : null

const ORIENTATION_TEXT = ['', 'turned right', 'turned 180°', 'turned left']
const orientationText = (g: GeometrySettings) =>
  !g.mirror ? ORIENTATION_TEXT[g.turns] || 'as shot' : g.turns === 0 ? 'flipped horizontally' : g.turns === 2 ? 'flipped vertically' : `${ORIENTATION_TEXT[g.turns]}, flipped`


const signed = (v: number, digits = 0, unit = '') => `${v > 0 ? '+' : ''}${v.toFixed(digits)}${unit}`
const slider = (key: 'exposure' | 'contrast' | 'highlights' | 'shadows' | 'whites' | 'blacks' | 'vibrance' | 'saturation', label: string, group: PasteItem['group']): PasteItem => ({
  key,
  label,
  group,
  copy: (to, from) => ({ ...to, [key]: from[key] }),
  show: (s) => (key === 'exposure' ? signed(s.exposure, 2, ' EV') : signed(s[key])),
})

export const PASTE_ITEMS: PasteItem[] = [
  {
    key: 'whiteBalance',
    label: 'White balance',
    group: 'White balance',
    // "As Shot" travels as a mode, so each photo keeps its own camera white balance (round 2, lesson 12).
    copy: (to, from) => ({ ...to, whiteBalance: { ...from.whiteBalance } }),
    show: (s) => (s.whiteBalance.mode === 'as-shot' ? 'As Shot (each photo’s own)' : `${Math.round(s.whiteBalance.temperature)} K, tint ${s.whiteBalance.tint.toFixed(2)}`),
  },
  slider('exposure', 'Exposure', 'Tone'),
  slider('contrast', 'Contrast', 'Tone'),
  slider('highlights', 'Highlights', 'Tone'),
  slider('shadows', 'Shadows', 'Tone'),
  slider('whites', 'Whites', 'Tone'),
  slider('blacks', 'Blacks', 'Tone'),
  slider('vibrance', 'Vibrance', 'Presence'),
  slider('saturation', 'Saturation', 'Presence'),
  // Crop items come in this order when pasted: orientation first (the crop rectangle is relative to it), then the
  // angle, then the rectangle (kept inside the photo at the new angle).
  {
    key: 'rotate',
    label: 'Rotate & flip',
    group: 'Crop',
    copy: (to, from) => ({ ...to, geometry: withOrientation(to.geometry, from.geometry.turns, from.geometry.mirror) }),
    show: (s) => orientationText(s.geometry),
  },
  {
    key: 'straighten',
    label: 'Straighten angle',
    group: 'Crop',
    copy: (to, from, size) => {
      const f = frameOf(to.geometry, size)
      return { ...to, geometry: f ? setAngle(to.geometry, from.geometry.angle, f[0], f[1]) : { ...to.geometry, angle: from.geometry.angle } }
    },
    show: (s) => `${s.geometry.angle > 0 ? '+' : ''}${s.geometry.angle.toFixed(2)}°`,
  },
  {
    key: 'crop',
    label: 'Crop',
    group: 'Crop',
    copy: (to, from, size) => {
      const f = frameOf(to.geometry, size)
      return { ...to, geometry: pasteCrop(to.geometry, from.geometry, f?.[0], f?.[1]) }
    },
    show: (s) => {
      const c = s.geometry.crop
      if (c.x0 === 0 && c.y0 === 0 && c.x1 === 1 && c.y1 === 1) return 'none'
      const aspect = s.geometry.locked ? (s.geometry.aspect === 'original' ? ', original aspect' : s.geometry.aspect === 'custom' ? `, ${s.geometry.custom.join(' : ')}` : `, ${s.geometry.aspect}`) : ''
      return `${Math.round((c.x1 - c.x0) * 100)} × ${Math.round((c.y1 - c.y0) * 100)} % of the photo${aspect}`
    },
  },
  {
    key: 'process',
    label: 'Process version',
    group: 'Advanced (darktable modules)',
    copy: (to, from) => ({ ...to, process: from.process }),
    show: (s) => String(s.process),
  },
  {
    key: 'baseExposure',
    label: 'Base exposure',
    group: 'Advanced (darktable modules)',
    sameKindOnly: true,
    copy: (to, from) => ({ ...to, advanced: { ...to.advanced, baseExposure: from.advanced.baseExposure } }),
    show: (s) => signed(s.advanced.baseExposure, 2, ' EV'),
  },
  {
    key: 'toneMapper',
    label: 'Tone mapper (sigmoid)',
    group: 'Advanced (darktable modules)',
    sameKindOnly: true,
    copy: (to, from) => ({
      ...to,
      advanced: { ...to.advanced, skew: from.advanced.skew, whiteTarget: from.advanced.whiteTarget, blackTarget: from.advanced.blackTarget, huePreservation: from.advanced.huePreservation },
    }),
    show: (s) => `skew ${s.advanced.skew.toFixed(2)}, hue ${Math.round(s.advanced.huePreservation)} %`,
  },
  {
    key: 'highlightReconstruction',
    label: 'Highlight reconstruction',
    group: 'Advanced (darktable modules)',
    sameKindOnly: true,
    copy: (to, from) => ({ ...to, advanced: { ...to.advanced, highlightReconstruction: from.advanced.highlightReconstruction, highlightClip: from.advanced.highlightClip } }),
    show: (s) => (s.advanced.highlightReconstruction ? `on, clip ${s.advanced.highlightClip.toFixed(2)}` : 'off'),
  },
  {
    key: 'demosaic',
    label: 'Demosaic',
    group: 'Advanced (darktable modules)',
    sameKindOnly: true,
    copy: (to, from) => ({ ...to, advanced: { ...to.advanced, demosaic: from.advanced.demosaic } }),
    show: (s) => s.advanced.demosaic.toUpperCase(),
  },
]

export const PASTE_GROUPS = [...new Set(PASTE_ITEMS.map((i) => i.group))]

/**
 * Default choice: everything except the crop items and the advanced darktable modules. Lightroom leaves its expert
 * items to the user; not copying the crop unless ticked is Lightroom's default as the owner described it
 * (2026-10-12; not checked against Lightroom here), and LightBench's choice either way.
 */
export const DEFAULT_PASTE_KEYS: PasteKey[] = PASTE_ITEMS.filter((i) => i.group !== 'Advanced (darktable modules)' && i.group !== 'Crop').map((i) => i.key)

/** What a copy carries. */
export interface Clipboard {
  settings: DevelopSettings
  keys: PasteKey[]
  /** Re-run the source's Auto on each photo (only offered when its tone came from Auto). */
  rerunAuto: boolean
  sourceKind: SourceKind
  sourceName: string
}

/** The sliders a re-run Auto sets; with re-run on, these come from each photo's own Auto instead. */
export const autoKeys = (c: Clipboard): AutoKey[] => (c.rerunAuto && c.settings.auto ? c.settings.auto.sliders : [])

/** The items that will be pasted onto a photo of `kind` (same-kind-only items drop out across kinds). */
export function itemsFor(c: Clipboard, kind: SourceKind): PasteItem[] {
  const viaAuto = new Set<string>(autoKeys(c))
  return PASTE_ITEMS.filter((i) => c.keys.includes(i.key) && !viaAuto.has(i.key) && (!i.sameKindOnly || kind === c.sourceKind))
}

/**
 * Applies a copy to a photo's settings. Auto re-running happens afterwards (it needs the photo's pixels); the
 * record of it travels so the photo knows its tone came from Auto. `size` is the photo's size in its camera
 * orientation (for the crop items), when known.
 */
export function applyPaste(target: DevelopSettings, c: Clipboard, kind: SourceKind, size?: [number, number]): DevelopSettings {
  const items = itemsFor(c, kind)
  let out = target
  for (const item of items) out = item.copy(out, c.settings, size)
  // Pasted numbers on sliders the photo's own Auto had set: its tone no longer comes from that Auto.
  if (out.auto && items.some((i) => out.auto!.sliders.includes(i.key as AutoKey))) out = { ...out, auto: null }
  return out
}

/** Lines for the preview: what will change, as values. */
export function describePaste(c: Clipboard, kind: SourceKind | 'mixed'): string[] {
  const lines: string[] = []
  if (c.rerunAuto && c.settings.auto) {
    const a = c.settings.auto
    const labels = AUTO_SLIDERS.filter((x) => a.sliders.includes(x.key)).map((x) => x.label)
    lines.push(`Auto “${a.target.name}” re-run on each photo (${Math.round(a.strength * 100)} %, sets ${labels.join(', ')})`)
  }
  const viaAuto = new Set<string>(autoKeys(c))
  for (const item of PASTE_ITEMS) {
    if (!c.keys.includes(item.key) || viaAuto.has(item.key)) continue
    const skipped = item.sameKindOnly && kind !== c.sourceKind
    lines.push(`${item.label}: ${item.show(c.settings)}${skipped ? (kind === 'mixed' ? ' (only on photos of the same type)' : ' — skipped: different file type') : ''}`)
  }
  return lines
}

/** Which items differ between two settings (for Auto Sync: only what the user just changed travels). */
export function changedKeys(before: DevelopSettings, after: DevelopSettings): PasteKey[] {
  return PASTE_ITEMS.filter((i) => JSON.stringify(i.copy(before, after)) !== JSON.stringify(before)).map((i) => i.key)
}

// ---- the app's settings clipboard (shared by Library and Develop; kept for this visit only)

let clip: Clipboard | null = null
const clipListeners = new Set<() => void>()

export const settingsClipboard = {
  get: () => clip,
  set(c: Clipboard | null) {
    clip = c
    clipListeners.forEach((fn) => fn())
  },
  subscribe(fn: () => void) {
    clipListeners.add(fn)
    return () => void clipListeners.delete(fn)
  },
}

/** Merges two copies sent to the same photos (Auto Sync while the first is still waiting): the later values win. */
export function mergeClipboards(a: Clipboard, b: Clipboard): Clipboard {
  return { ...b, keys: [...new Set([...a.keys, ...b.keys])], rerunAuto: (a.rerunAuto || b.rerunAuto) && !!b.settings.auto }
}

// ---- the choice of settings, remembered in this browser

const KEYS_STORE = 'lightbench.paste.keys'
const AUTO_STORE = 'lightbench.paste.rerunAuto'

/** The settings chosen last time (Lightroom remembers the Copy Settings checkboxes too). */
export function rememberedChoice(): { keys: PasteKey[]; rerunAuto: boolean } {
  try {
    const keys = JSON.parse(localStorage.getItem(KEYS_STORE) ?? 'null') as PasteKey[] | null
    return {
      keys: Array.isArray(keys) ? keys.filter((k) => PASTE_ITEMS.some((i) => i.key === k)) : DEFAULT_PASTE_KEYS,
      rerunAuto: localStorage.getItem(AUTO_STORE) !== 'false',
    }
  } catch {
    return { keys: DEFAULT_PASTE_KEYS, rerunAuto: true }
  }
}

export function rememberChoice(c: Clipboard) {
  try {
    localStorage.setItem(KEYS_STORE, JSON.stringify(c.keys))
    localStorage.setItem(AUTO_STORE, String(c.rerunAuto))
  } catch {
    // Not remembered this time.
  }
}
