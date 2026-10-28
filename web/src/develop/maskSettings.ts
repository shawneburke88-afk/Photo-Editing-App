// Reusing a mask's settings (docs/PHASE3.md Part 31; owner, 2026-10-28): Copy / Paste mask settings and named mask
// presets. Both carry only a mask's sliders: every local slider (LOCAL_KEYS) and its Amount. A mask's parts, shapes,
// Invert, Feather and Refine stay as they are, so the values fit any mask of any kind on any photo.

import { LOCAL_KEYS, LOCAL_LABELS, normalizeAdjust, type LocalAdjust, type LocalMask } from '../engine/develop/masks'

/** A mask's slider values: its local sliders (only non-zero ones are stored, as in a mask) and its Amount (0–200 %). */
export interface MaskValues {
  adjust: LocalAdjust
  amount: number
}

/** The selected mask's values, to copy or to save as a preset. */
export function maskValues(m: Pick<LocalMask, 'adjust' | 'amount'>): MaskValues {
  return { adjust: normalizeAdjust(m.adjust), amount: m.amount }
}

/** The mask with these values: every local slider set to them (missing ones to 0) and its Amount; nothing else changes. */
export function withMaskValues(m: LocalMask, v: MaskValues): LocalMask {
  return { ...m, adjust: normalizeAdjust(v.adjust), amount: v.amount }
}

/** Whether a mask already has these values (applying them would change nothing). */
export function sameValues(m: Pick<LocalMask, 'adjust' | 'amount'>, v: MaskValues): boolean {
  const a = maskValues(m)
  const b = maskValues(v)
  return a.amount === b.amount && LOCAL_KEYS.every((k) => (a.adjust[k] ?? 0) === (b.adjust[k] ?? 0))
}

/** Checks stored values (a mask preset from the catalog); null when they can't be used. */
export function normalizeMaskValues(v: unknown): MaskValues | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (!o.adjust || typeof o.adjust !== 'object') return null
  const amount = typeof o.amount === 'number' && Number.isFinite(o.amount) ? Math.round(Math.min(200, Math.max(0, o.amount))) : 100
  return { adjust: normalizeAdjust(o.adjust), amount }
}

/** The values in words, for tooltips and the presets menu: "Exposure +0.50 EV, Shadows +20; Amount 80 %". */
export function describeMaskValues(v: MaskValues): string {
  const parts = LOCAL_KEYS.filter((k) => v.adjust[k]).map((k) => {
    const x = v.adjust[k]!
    return `${LOCAL_LABELS[k]} ${x > 0 ? '+' : ''}${k === 'exposure' ? `${x.toFixed(2)} EV` : x}`
  })
  const sliders = parts.length ? parts.join(', ') : 'all sliders at 0'
  return v.amount === 100 ? sliders : `${sliders}; Amount ${v.amount} %`
}

// ---- the app's mask clipboard: one set of values, kept while LightBench is open (any photo, any mask)

export interface MaskClip {
  values: MaskValues
  /** The mask it was copied from ("Radial 1"). */
  from: string
}

let clip: MaskClip | null = null
const listeners = new Set<() => void>()

export const maskClipboard = {
  get: (): MaskClip | null => clip,
  set(c: MaskClip | null) {
    clip = c ? { from: c.from, values: maskValues(c.values) } : null
    listeners.forEach((fn) => fn())
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => void listeners.delete(fn)
  },
}

// ---- mask presets (kept in the catalog's `mask_presets` table: JSON of MaskPresetData under a unique name)

export interface MaskPreset {
  id: number
  name: string
  values: MaskValues
}

/** What the catalog stores for a mask preset. */
export interface MaskPresetData extends MaskValues {
  version: 1
}

export const maskPresetData = (v: MaskValues): string => JSON.stringify({ version: 1, ...maskValues(v) } satisfies MaskPresetData)

export function maskPresetFromRow(row: { id: number; name: string; preset: string }): MaskPreset | null {
  try {
    const values = normalizeMaskValues(JSON.parse(row.preset))
    return values ? { id: row.id, name: row.name, values } : null
  } catch {
    return null
  }
}

/** Mask preset names: trimmed, at most 80 characters (as mask names). */
export const presetName = (name: string) => name.trim().slice(0, 80)
