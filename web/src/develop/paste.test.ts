import { describe, expect, it } from 'vitest'
import { BUILT_IN_TARGETS } from '../engine/develop/auto'
import { DEFAULT_RGB_SETTINGS, DEFAULT_SETTINGS } from '../engine/develop/settings'
import { applyPaste, changedKeys, describePaste, type Clipboard } from './paste'

const source = {
  ...DEFAULT_SETTINGS,
  exposure: 0.5,
  contrast: 20,
  vibrance: 10,
  whiteBalance: { mode: 'as-shot' as const, temperature: 5000, tint: 1 },
  advanced: { ...DEFAULT_SETTINGS.advanced, baseExposure: 1.2 },
}
const clip = (p: Partial<Clipboard> = {}): Clipboard => ({
  settings: source, keys: ['exposure', 'whiteBalance', 'baseExposure'], rerunAuto: false, sourceKind: 'raw', sourceName: 'A.NEF', ...p,
})

describe('paste', () => {
  it('replaces only the chosen settings', () => {
    const target = { ...DEFAULT_SETTINGS, exposure: -1, contrast: -30 }
    const out = applyPaste(target, clip(), 'raw')
    expect(out.exposure).toBe(0.5)
    expect(out.contrast).toBe(-30)
    expect(out.advanced.baseExposure).toBe(1.2)
  })

  it('pastes "As Shot" as a mode, so each photo keeps its own white balance', () => {
    const target = { ...DEFAULT_SETTINGS, whiteBalance: { mode: 'custom' as const, temperature: 3000, tint: 1.2 } }
    expect(applyPaste(target, clip(), 'raw').whiteBalance.mode).toBe('as-shot')
  })

  it('skips RAW-only settings on a JPEG and says so', () => {
    const out = applyPaste(DEFAULT_RGB_SETTINGS, clip(), 'rgb')
    expect(out.advanced.baseExposure).toBe(0)
    expect(describePaste(clip(), 'rgb').find((l) => l.startsWith('Base exposure'))).toContain('skipped')
  })

  it('leaves Auto’s sliders to the re-run and lists it first', () => {
    const auto = { target: BUILT_IN_TARGETS[0], sliders: ['exposure' as const], strength: 0.8 }
    const c = clip({ settings: { ...source, auto }, rerunAuto: true })
    expect(applyPaste({ ...DEFAULT_SETTINGS, exposure: -1 }, c, 'raw').exposure).toBe(-1)
    const lines = describePaste(c, 'raw')
    expect(lines[0]).toBe('Auto “Natural” re-run on each photo (80 %, sets Exposure)')
    expect(lines.some((l) => l.startsWith('Exposure'))).toBe(false)
  })

  it('finds which settings changed (for Auto Sync)', () => {
    expect(changedKeys(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, shadows: 12 })).toEqual(['shadows'])
    expect(changedKeys(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, advanced: { ...DEFAULT_SETTINGS.advanced, demosaic: 'bilinear' } })).toEqual(['demosaic'])
  })
})
