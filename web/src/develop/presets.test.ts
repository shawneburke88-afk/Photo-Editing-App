import { describe, expect, it } from 'vitest'
import { BUILT_IN_TARGETS } from '../engine/develop/auto'
import { DEFAULT_RGB_SETTINGS, DEFAULT_SETTINGS } from '../engine/develop/settings'
import { applyPaste } from './paste'
import { blendSettings, presetClip, presetFromRow, STARTER_PRESETS } from './presets'

const bw = STARTER_PRESETS.find((p) => p.id === 'starter:bw')!
const punchy = STARTER_PRESETS.find((p) => p.id === 'starter:punchy')!

describe('presets', () => {
  it('apply only the settings they hold', () => {
    const before = { ...DEFAULT_SETTINGS, exposure: 0.4, saturation: 20 }
    const after = applyPaste(before, presetClip(bw), 'raw')
    expect(after.saturation).toBe(-100)
    expect(after.exposure).toBe(0.4)
  })

  it('Amount fades or strengthens the change, within the sliders’ ranges', () => {
    const before = { ...DEFAULT_SETTINGS, contrast: 10 }
    const after = applyPaste(before, presetClip(punchy), 'raw')
    expect(blendSettings(before, after, 0)).toBe(before)
    expect(blendSettings(before, after, 1)).toBe(after)
    const half = blendSettings(before, after, 0.5)
    expect(half.contrast).toBe(18)
    expect(half.vibrance).toBe(15)
    expect(blendSettings(before, after, 2).contrast).toBe(40)
    expect(blendSettings({ ...DEFAULT_SETTINGS, saturation: 0 }, applyPaste(DEFAULT_SETTINGS, presetClip(bw), 'raw'), 2).saturation).toBe(-100)
  })

  it('Amount scales an Auto from 0 and keeps its record true', () => {
    const auto = { target: BUILT_IN_TARGETS[0], sliders: ['exposure' as const, 'blacks' as const], strength: 1 }
    const before = { ...DEFAULT_SETTINGS, exposure: -1 }
    const after = { ...DEFAULT_SETTINGS, exposure: 0.8, blacks: -40, auto }
    const r = blendSettings(before, after, 0.5)
    expect(r.exposure).toBe(0.4)
    expect(r.blacks).toBe(-20)
    expect(r.auto?.strength).toBe(0.5)
  })

  it('blends between As Shot and a custom white balance when the camera’s is known', () => {
    const before = DEFAULT_SETTINGS
    const after = { ...DEFAULT_SETTINGS, whiteBalance: { mode: 'custom' as const, temperature: 4000, tint: 1 } }
    const r = blendSettings(before, after, 0.5, { temperature: 6000, tint: 1 })
    expect(r.whiteBalance.mode).toBe('custom')
    expect(Math.round(r.whiteBalance.temperature)).toBe(4800)
    expect(blendSettings(before, after, 0.5).whiteBalance).toEqual(after.whiteBalance)
  })

  it('skip RAW-only settings on a JPEG, like Paste', () => {
    const raw = { ...bw, keys: ['baseExposure' as const], settings: { ...DEFAULT_SETTINGS, advanced: { ...DEFAULT_SETTINGS.advanced, baseExposure: 1.5 } } }
    expect(applyPaste(DEFAULT_RGB_SETTINGS, presetClip(raw), 'rgb').advanced.baseExposure).toBe(0)
  })

  it('read saved rows, ignoring broken ones', () => {
    const row = { id: 7, name: 'Mine', preset: JSON.stringify({ keys: ['contrast'], settings: { contrast: 30 }, rerunAuto: false, sourceKind: 'raw' }) }
    const p = presetFromRow(row)!
    expect(p).toMatchObject({ id: 'user:7', name: 'Mine', starter: false, keys: ['contrast'] })
    expect(p.settings.contrast).toBe(30)
    expect(p.settings.whiteBalance.mode).toBe('as-shot')
    expect(presetFromRow({ id: 8, name: 'x', preset: '{' })).toBeNull()
  })
})
