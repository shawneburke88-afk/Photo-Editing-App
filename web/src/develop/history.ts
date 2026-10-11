// Edit history (Lightroom's History panel): every change is a step; rapid changes to the same
// control (e.g. dragging a slider) merge into one step.

import type { DevelopSettings } from '../engine/develop/settings'

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

/** Records a change. Steps after the current one (undone steps) are discarded, like Lightroom. */
export function record(h: History, label: string, settings: DevelopSettings, now = Date.now()): History {
  const kept = h.steps.slice(0, h.index + 1)
  const top = kept[kept.length - 1]
  if (kept.length > 1 && top.label === label && now - top.at < MERGE_WINDOW_MS) {
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
