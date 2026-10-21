// Edit history (Lightroom's History panel): every change is a step; rapid changes to the same
// control (e.g. dragging a slider) merge into one step.

import { defaultsFor, normalizeSettings, type DevelopSettings, type SourceKind } from '../engine/develop/settings'

export interface HistoryStep {
  label: string
  settings: DevelopSettings
  /** ms timestamp of the last change merged into this step. */
  at: number
}

export interface History {
  steps: HistoryStep[]
  /** Index of the step currently shown. */
  index: number
}

export const MERGE_WINDOW_MS = 1500
const MAX_STEPS = 200

export function startHistory(settings: DevelopSettings, label = 'Import'): History {
  return { steps: [{ label, settings, at: 0 }], index: 0 }
}

/**
 * Records a change. Steps after the current one (undone steps) are discarded, like Lightroom. `merge` false makes it a
 * step of its own even right after one of the same name (the end of a drag: one step per drag).
 */
export function record(h: History, label: string, settings: DevelopSettings, now = Date.now(), merge = true): History {
  const kept = h.steps.slice(0, h.index + 1)
  const top = kept[kept.length - 1]
  if (merge && kept.length > 1 && top.label === label && now - top.at < MERGE_WINDOW_MS) {
    kept[kept.length - 1] = { label, settings, at: now }
  } else {
    kept.push({ label, settings, at: now })
  }
  const steps = kept.slice(-MAX_STEPS)
  return { steps, index: steps.length - 1 }
}

export const canUndo = (h: History) => h.index > 0
export const canRedo = (h: History) => h.index < h.steps.length - 1
export const undo = (h: History): History => ({ ...h, index: Math.max(0, h.index - 1) })
export const redo = (h: History): History => ({ ...h, index: Math.min(h.steps.length - 1, h.index + 1) })
export const jump = (h: History, index: number): History => ({ ...h, index: Math.min(h.steps.length - 1, Math.max(0, index)) })
export const current = (h: History) => h.steps[h.index].settings

/** Changes the settings of the step shown, without adding a step (a preset's Amount after applying it). */
export function replaceCurrent(h: History, settings: DevelopSettings): History {
  const steps = [...h.steps]
  steps[h.index] = { ...steps[h.index], settings }
  return { ...h, steps }
}

/**
 * Saved form of the history (timestamps are not stored). Depth maps (PHASE3.md Part 24) and AI Remove patches
 * (Part 26) are kept once: each step's map or patch is replaced by "@r<n>", the n-th entry of `rasters` (base64 never contains "@"). Up to 200 steps of the
 * same photo otherwise repeat the same map in every step.
 */
export interface SavedHistory {
  steps: { label: string; settings: DevelopSettings }[]
  index: number
  rasters?: string[]
}

type RasterLike = { raster?: { data: string } }

/**
 * Calls `fn` on each Depth range shape's raster and each AI Remove spot's patch (Part 26) in a step's settings,
 * replacing its data with what `fn` returns.
 */
function mapRasters(s: DevelopSettings, fn: (data: string) => string): DevelopSettings {
  if (s.spots?.some((sp) => sp.ai)) s = { ...s, spots: s.spots.map((sp) => (sp.ai && typeof sp.ai.data === 'string' ? { ...sp, ai: { ...sp.ai, data: fn(sp.ai.data) } } : sp)) }
  if (!s.masks?.some((m) => m.components.some((c) => (c.shape as RasterLike).raster))) return s
  return {
    ...s,
    masks: s.masks.map((m) => ({
      ...m,
      components: m.components.map((c) => {
        const r = (c.shape as RasterLike).raster
        return r && typeof r.data === 'string' ? { ...c, shape: { ...c.shape, raster: { ...r, data: fn(r.data) } } } : c
      }),
    })),
  }
}

export const savedForm = (h: History): SavedHistory => {
  const rasters: string[] = []
  const index = new Map<string, number>()
  const steps = h.steps.map(({ label, settings }) => ({
    label,
    settings: mapRasters(settings, (data) => {
      let n = index.get(data)
      if (n === undefined) {
        n = rasters.length
        rasters.push(data)
        index.set(data, n)
      }
      return `@r${n}`
    }),
  }))
  return rasters.length ? { steps, index: h.index, rasters } : { steps, index: h.index }
}

/** The steps with their depth maps put back (a reference to a missing map leaves it empty: the part then waits for one). */
export function unpackRasters(sh: SavedHistory): SavedHistory['steps'] {
  const table = Array.isArray(sh.rasters) ? sh.rasters : []
  return sh.steps.map((st) => ({ label: st.label, settings: mapRasters(st.settings, (d) => (d.startsWith('@r') ? (typeof table[Number(d.slice(2))] === 'string' ? table[Number(d.slice(2))] : '') : d)) }))
}

/** A photo's history as saved in the catalog (or a fresh one at the defaults for its kind and EXIF ISO). */
export function loadHistory(saved: { settings: string; history: string } | null, kind: SourceKind, iso?: number | null): History {
  if (!saved) return startHistory(defaultsFor(kind, iso))
  try {
    const sh = JSON.parse(saved.history) as SavedHistory
    const steps = unpackRasters(sh).map((st) => ({ label: st.label, settings: normalizeSettings(st.settings, kind), at: 0 }))
    if (steps.length) return { steps, index: Math.min(sh.index, steps.length - 1) }
  } catch {
    // fall back to the settings alone
  }
  try {
    return startHistory(normalizeSettings(JSON.parse(saved.settings), kind))
  } catch {
    return startHistory(defaultsFor(kind, iso))
  }
}
