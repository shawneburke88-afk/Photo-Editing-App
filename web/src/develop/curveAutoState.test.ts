import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../engine/develop/settings'
import { CURVE_PRESETS, DEFAULT_TONE_CURVE, masterFunction, withToneCurve, type ToneCurveSettings } from '../engine/develop/tone-curve'
import { amountShown, applyResult, changeAmount } from './curveAutoState'
import { canRedo, current, record, redo, startHistory, undo } from './history'

const strong: ToneCurveSettings = { ...DEFAULT_TONE_CURVE, rgb: CURVE_PRESETS.find((p) => p.id === 'strong')!.points }
const fade: ToneCurveSettings = { ...DEFAULT_TONE_CURVE, rgb: CURVE_PRESETS.find((p) => p.id === 'fade')!.points }

describe('Tone Curve Auto in the history', () => {
  it('applies as one history step, named for the result', () => {
    const h0 = record(startHistory(DEFAULT_SETTINGS), 'Exposure', { ...DEFAULT_SETTINGS, exposure: 0.5 }, 1000)
    const r = applyResult(h0, 'Tone Curve: Auto contrast', 'contrast', strong, 1100)!
    expect(r.history.steps.length).toBe(h0.steps.length + 1)
    expect(r.history.steps.at(-1)!.label).toBe('Tone Curve: Auto contrast')
    expect(current(r.history).toneCurve).toEqual(strong)
    expect(current(r.history).exposure).toBe(0.5)
    // Its own step even right after another of the same name (no merging).
    const r2 = applyResult(r.history, 'Tone Curve: Auto contrast', 'contrast', fade, 1200)!
    expect(r2.history.steps.length).toBe(h0.steps.length + 2)
  })

  it('Amount changes that step in place: many drag ticks, no new steps', () => {
    const h0 = startHistory(DEFAULT_SETTINGS)
    let { history, applied } = applyResult(h0, 'Tone Curve: Auto contrast', 'contrast', strong)!
    const steps = history.steps.length
    for (const a of [0.9, 0.7, 0.5, 0.31, 0.5]) ({ history, applied } = changeAmount(history, applied, a))
    expect(history.steps.length).toBe(steps)
    expect(history.steps.at(-1)!.label).toBe('Tone Curve: Auto contrast')
    expect(amountShown(applied, current(history))).toBe(true)
    const f = masterFunction(current(history).toneCurve!)
    const g = masterFunction(strong)
    expect(f(0.17)).toBeCloseTo(0.17 + 0.5 * (g(0.17) - 0.17), 3)
  })

  it('Amount 0 gives the curve before Auto, 100 % the Auto curve', () => {
    const before = withToneCurve(DEFAULT_SETTINGS, fade)
    let { history, applied } = applyResult(startHistory(before), 'Tone Curve: Auto colour', 'colour', { ...fade, red: [[0, 0], [0.5, 0.53], [1, 1]] })!
    ;({ history, applied } = changeAmount(history, applied, 0))
    expect(current(history).toneCurve).toEqual(fade)
    ;({ history, applied } = changeAmount(history, applied, 1))
    expect(current(history).toneCurve!.red).toEqual([[0, 0], [0.5, 0.53], [1, 1]])
  })

  it('undo goes back to the curve before Auto; redo brings the result (with its Amount) back', () => {
    const h0 = startHistory(DEFAULT_SETTINGS)
    let { history, applied } = applyResult(h0, 'Tone Curve: Auto contrast', 'contrast', strong)!
    ;({ history, applied } = changeAmount(history, applied, 0.4))
    const undone = undo(history)
    expect(current(undone).toneCurve).toBeUndefined()
    // The Amount is hidden on another step, and moving it then changes nothing.
    expect(amountShown(applied, current(undone))).toBe(false)
    expect(changeAmount(undone, applied, 0.8).history).toBe(undone)
    expect(canRedo(undone)).toBe(true)
    const redone = redo(undone)
    expect(amountShown(applied, current(redone))).toBe(true)
  })

  it('Amount 0 never makes the step look like the step before it (so undo can\'t reach the Amount)', () => {
    let { history, applied } = applyResult(startHistory(DEFAULT_SETTINGS), 'Tone Curve: Auto contrast', 'contrast', strong)!
    ;({ history, applied } = changeAmount(history, applied, 0))
    expect(current(history)).not.toBe(history.steps[0].settings)
    expect(amountShown(applied, current(undo(history)))).toBe(false)
  })

  it('a result that changes nothing adds no step', () => {
    const s = withToneCurve(DEFAULT_SETTINGS, strong)
    expect(applyResult(startHistory(s), 'Tone Curve: Strong Contrast', 'strong', strong)).toBeNull()
    expect(applyResult(startHistory(DEFAULT_SETTINGS), 'Tone Curve: Linear', 'linear', undefined)).toBeNull()
  })
})
