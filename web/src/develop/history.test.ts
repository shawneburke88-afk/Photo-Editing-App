import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../engine/develop/settings'
import { canRedo, canUndo, current, record, redo, replaceCurrent, startHistory, undo } from './history'

const s = (exposure: number) => ({ ...DEFAULT_SETTINGS, exposure })

describe('history', () => {
  it('merges quick changes to the same control into one step', () => {
    let h = startHistory(s(0))
    h = record(h, 'Exposure', s(0.1), 1000)
    h = record(h, 'Exposure', s(0.5), 1500)
    expect(h.steps).toHaveLength(2)
    expect(current(h).exposure).toBe(0.5)
  })
  it('starts a new step for a different control or after a pause', () => {
    let h = startHistory(s(0))
    h = record(h, 'Exposure', s(0.5), 1000)
    h = record(h, 'Contrast', { ...s(0.5), contrast: 20 }, 1100)
    h = record(h, 'Contrast', { ...s(0.5), contrast: 30 }, 5000)
    expect(h.steps.map((x) => x.label)).toEqual(['Import', 'Exposure', 'Contrast', 'Contrast'])
  })
  it('undoes and redoes, and a new change discards redo steps', () => {
    let h = startHistory(s(0))
    h = record(h, 'Exposure', s(1), 1000)
    h = record(h, 'Contrast', { ...s(1), contrast: 10 }, 9000)
    h = undo(h)
    expect(current(h).contrast).toBe(0)
    expect(canRedo(h)).toBe(true)
    h = redo(h)
    expect(current(h).contrast).toBe(10)
    h = undo(undo(h))
    expect(canUndo(h)).toBe(false)
    h = record(h, 'Shadows', { ...s(0), shadows: 40 }, 20000)
    expect(h.steps.map((x) => x.label)).toEqual(['Import', 'Shadows'])
  })

  it('replaces the settings of the step shown without adding a step (preset Amount)', () => {
    const h = record(startHistory(DEFAULT_SETTINGS), 'Preset: Punchy', { ...DEFAULT_SETTINGS, contrast: 25 }, 0)
    const r = replaceCurrent(h, { ...DEFAULT_SETTINGS, contrast: 12 })
    expect(r.steps.length).toBe(2)
    expect(r.steps[1].label).toBe('Preset: Punchy')
    expect(current(r).contrast).toBe(12)
    expect(current(h).contrast).toBe(25)
  })
})

describe('one step per drag', () => {
  it('keeps a step of its own when asked, even with the same name right after', () => {
    const h0 = startHistory(DEFAULT_SETTINGS)
    const a = record(h0, 'Tone curve: move point', { ...DEFAULT_SETTINGS, exposure: 1 }, 1000, false)
    const b = record(a, 'Tone curve: move point', { ...DEFAULT_SETTINGS, exposure: 2 }, 1100, false)
    expect(b.steps.length).toBe(3)
    const c = record(a, 'Tone curve: move point', { ...DEFAULT_SETTINGS, exposure: 2 }, 1100)
    expect(c.steps.length).toBe(2)
  })
})
