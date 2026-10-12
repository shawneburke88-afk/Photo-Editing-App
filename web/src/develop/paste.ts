// Copy / paste / sync of develop settings, Lightroom-style: the user picks which settings travel (grouped
// checkboxes), and pasting replaces those settings on each photo. It never appends to the target's edit the way
// darktable's default paste mode does (`plugins/lighttable/copy_history/pastemode` = 0, "append").

import type { DevelopSettings, SourceKind } from '../engine/develop/settings'
import { AUTO_SLIDERS, type AutoKey } from '../engine/develop/auto'

export type PasteKey =
  | 'whiteBalance'
  | 'exposure' | 'contrast' | 'highlights' | 'shadows' | 'whites' | 'blacks'
  | 'vibrance' | 'saturation'
  | 'baseExposure' | 'toneMapper' | 'highlightReconstruction' | 'demosaic'

export interface PasteItem {
  key: PasteKey
  label: string
  group: 'White balance' | 'Tone' | 'Presence' | 'Advanced (darktable modules)'
  /**
   * Only pasted between photos of the same kind (RAW to RAW, JPEG to JPEG): a RAW's +0.7 EV base exposure or its
   * camera white balance would be wrong on a JPEG, which is already rendered.
   */
  sameKindOnly?: boolean
  copy: (to: DevelopSettings, from: DevelopSettings) => DevelopSettings
  show: (s: DevelopSettings) => string
}

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

/** Default choice: everything except the advanced darktable modules (Lightroom leaves its expert items to the user). */
export const DEFAULT_PASTE_KEYS: PasteKey[] = PASTE_ITEMS.filter((i) => i.group !== 'Advanced (darktable modules)').map((i) => i.key)

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
 * record of it travels so the photo knows its tone came from Auto.
 */
export function applyPaste(target: DevelopSettings, c: Clipboard, kind: SourceKind): DevelopSettings {
  const items = itemsFor(c, kind)
  let out = target
  for (const item of items) out = item.copy(out, c.settings)
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
