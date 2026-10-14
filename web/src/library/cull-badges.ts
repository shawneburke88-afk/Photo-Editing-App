// Which culling-helper badges the grid and the culling view show (docs/PHASE3.md Part 18), remembered in this browser.
// On by default: possibly soft, shake, clipped, look-alike ("duplicate of…"), best in stack and suggested reject; very
// dark / very bright is off (often intended: night scenes, high key). If storage is blocked the choice still applies
// for this visit.

import { useSyncExternalStore } from 'react'
import type { PhotoRow } from '../catalog/types'
import { DEFAULT_SUGGEST, suggestReasons, type CullInfo, type SuggestOptions } from '../catalog/analysis'

export type BadgeKind = 'soft' | 'shake' | 'clipped' | 'exposure' | 'dup' | 'best' | 'suggested' | 'pending'

export const BADGES: { kind: BadgeKind; name: string; about: string }[] = [
  { kind: 'soft', name: 'Possibly soft', about: 'Less fine detail than usual for the camera and ISO, or clearly softer than the sharpest shot of its stack or look-alikes.' },
  { kind: 'shake', name: 'Shake', about: 'Detail smeared in one direction across the frame: camera shake or motion blur.' },
  { kind: 'clipped', name: 'Clipped', about: 'Highlights (or deep shadows) clipped in the camera preview; a RAW may hold more.' },
  { kind: 'exposure', name: 'Very dark or bright', about: 'Most of the frame very dark or very bright (often intended).' },
  { kind: 'dup', name: 'Look-alike', about: 'Looks like a sharper photo taken just before or after it (“duplicate of…”).' },
  { kind: 'best', name: 'Best in stack', about: 'The sharpest of its stack or group of look-alikes, weighted by exposure.' },
  { kind: 'suggested', name: 'Suggested reject', about: 'A suggestion only: nothing is flagged until you choose Apply in “Suggest rejects…”.' },
  { kind: 'pending', name: 'Not analysed yet', about: 'A small “…” until the background analysis has measured the photo (it is left out of suggestions, sorts last by sharpness).' },
]

export type BadgePrefs = Record<BadgeKind, boolean>
export const DEFAULT_BADGES: BadgePrefs = { soft: true, shake: true, clipped: true, exposure: false, dup: true, best: true, suggested: true, pending: true }

export interface CullPrefs {
  badges: BadgePrefs
  /** The reasons "Suggest rejects…" uses (the last ones chosen). */
  suggest: SuggestOptions
}

const KEY = 'lightbench.culling'

export function cleanPrefs(v: unknown): CullPrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<CullPrefs>
  const b = (o.badges && typeof o.badges === 'object' ? o.badges : {}) as Partial<BadgePrefs>
  const s = (o.suggest && typeof o.suggest === 'object' ? o.suggest : {}) as Partial<SuggestOptions>
  const pick = <T extends object>(src: Partial<T>, def: T): T =>
    Object.fromEntries(Object.entries(def).map(([k, d]) => [k, typeof src[k as keyof T] === 'boolean' ? src[k as keyof T] : d])) as T
  return { badges: pick(b, DEFAULT_BADGES), suggest: pick(s, DEFAULT_SUGGEST) }
}

function load(): CullPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    return cleanPrefs(raw ? JSON.parse(raw) : null)
  } catch {
    return cleanPrefs(null)
  }
}

let current: CullPrefs | null = null
const listeners = new Set<() => void>()

export const cullPrefs = {
  get(): CullPrefs {
    current ??= load()
    return current
  },
  update(fn: (p: CullPrefs) => CullPrefs) {
    current = fn(cullPrefs.get())
    try {
      localStorage.setItem(KEY, JSON.stringify(current))
    } catch {
      // Not remembered; still applies now.
    }
    listeners.forEach((l) => l())
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => void listeners.delete(l)
  },
}

export const useCullPrefs = () => useSyncExternalStore(cullPrefs.subscribe, cullPrefs.get)

export const NOT_ANALYSED = 'Not analysed yet: sharpness, shake, exposure and look-alikes are measured in the background. Until then the photo is left out of suggestions and sorts last by sharpness.'

export interface Badge {
  kind: BadgeKind
  /** Short text on the badge. */
  text: string
  /** The reason, for the tooltip and screen readers. */
  reason: string
}

/** The badges to show for a photo, in a fixed order. */
export function badgesFor(row: { flag: number; cull?: CullInfo | null; analysisState?: 'pending' | 'failed' }, prefs: CullPrefs): Badge[] {
  const c = row.cull
  if (!c) return row.analysisState === 'pending' && prefs.badges.pending ? [{ kind: 'pending', text: '…', reason: NOT_ANALYSED }] : []
  const on = prefs.badges
  const out: Badge[] = []
  if (on.suggested) {
    const why = suggestReasons(row, prefs.suggest)
    if (why) out.push({ kind: 'suggested', text: 'Reject?', reason: `Suggested reject (nothing is flagged until you Apply): ${why.join(' ')}` })
  }
  if (on.best && c.group?.best) out.push({ kind: 'best', text: '☆ Best', reason: c.group.reason })
  if (on.soft && (c.softInGroup || c.soft)) out.push({ kind: 'soft', text: 'Soft', reason: [c.softInGroup, c.soft].filter(Boolean).join(' ') })
  if (on.shake && c.shake) out.push({ kind: 'shake', text: 'Shake', reason: c.shake })
  if (on.clipped && c.clipped) out.push({ kind: 'clipped', text: 'Clipped', reason: c.clipped })
  if (on.exposure && c.exposure) out.push({ kind: 'exposure', text: /dark/i.test(c.exposure) ? 'Dark' : 'Bright', reason: c.exposure })
  if (on.dup && c.dupOf) out.push({ kind: 'dup', text: 'Look-alike', reason: c.dupOf.reason })
  return out
}

/**
 * Where Z zooms to (docs/PHASE3.md Part 18): the measured focus point, the camera's AF point when the file gives it, else
 * the sharpest area of the preview; the centre when the photo isn't analysed yet.
 */
export function focusPoint(row: Pick<PhotoRow, 'cull'> | undefined): { u: number; v: number } {
  const f = row?.cull?.focus
  return f ? { u: Math.min(1, Math.max(0, f.u)), v: Math.min(1, Math.max(0, f.v)) } : { u: 0.5, v: 0.5 }
}

