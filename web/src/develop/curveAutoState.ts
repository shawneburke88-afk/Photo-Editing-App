// Tone Curve Auto's history (PHASE3.md Part 21): a result is one history step, and its Amount changes that step in
// place while it is the step shown (as a preset's Amount does), so dragging Amount adds no steps.

import type { DevelopSettings } from '../engine/develop/settings'
import { curveAtAmount } from '../engine/develop/curve-auto'
import { withToneCurve, type ToneCurveSettings } from '../engine/develop/tone-curve'
import { current, record, replaceCurrent, type History } from './history'

/** The last Auto result or suggestion applied, while its Amount can be changed. */
export interface CurveApplied {
  /** The history step's name, e.g. "Tone Curve: Auto contrast". */
  label: string
  /** Which result: 'contrast', 'colour', or a preset's id. */
  kind: string
  /** The photo's settings before it, and the curve before and after. */
  base: DevelopSettings
  before: ToneCurveSettings | undefined
  after: ToneCurveSettings | undefined
  /** 0…1. */
  amount: number
  /** The settings of its history step (a new object for each Amount, so it is never mistaken for another step). */
  result: DevelopSettings
}

/** The settings for a result at an Amount. */
export function settingsAt(a: Pick<CurveApplied, 'base' | 'before' | 'after'>, amount: number): DevelopSettings {
  return { ...withToneCurve(a.base, curveAtAmount(a.before, a.after, amount)) }
}

/** Applies a result as one history step of its own (null when it changes nothing). */
export function applyResult(h: History, label: string, kind: string, after: ToneCurveSettings | undefined, now = Date.now()): { history: History; applied: CurveApplied } | null {
  const base = current(h)
  if (JSON.stringify(withToneCurve(base, after).toneCurve) === JSON.stringify(base.toneCurve)) return null
  const a = { label, kind, base, before: base.toneCurve, after, amount: 1 }
  const result = settingsAt(a, 1)
  return { history: record(h, label, result, now, false), applied: { ...a, result } }
}

/** The Amount slider: the step shown is changed in place, if it is still the result's step. */
export function changeAmount(h: History, a: CurveApplied, amount: number): { history: History; applied: CurveApplied } {
  const result = settingsAt(a, amount)
  const history = current(h) === a.result ? replaceCurrent(h, result) : h
  return { history, applied: { ...a, amount, result } }
}

/** The Amount is shown while the result's step is the one shown. */
export const amountShown = (a: CurveApplied | null, shown: DevelopSettings): a is CurveApplied => !!a && a.result === shown
