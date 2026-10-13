import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type DevelopSettings } from '../engine/develop/settings'
import { DEFAULT_DETAIL } from '../engine/detail/settings'
import { applyPaste, changedKeys, DEFAULT_PASTE_KEYS, describePaste, type Clipboard } from './paste'
import { blendSettings } from './presets'

const withNr = (luminance: number, color: number, amount = 0): DevelopSettings => ({
  ...DEFAULT_SETTINGS,
  detail: { sharpen: { ...DEFAULT_DETAIL.sharpen, amount }, noise: { ...DEFAULT_DETAIL.noise, luminance, color } },
})
const clip = (settings: DevelopSettings, keys = DEFAULT_PASTE_KEYS): Clipboard => ({ settings, keys, rerunAuto: false, sourceKind: 'raw', sourceName: 'x' })

describe('Detail in Copy / Paste', () => {
  it('is ticked by default, as three items like Lightroom’s Copy Settings', () => {
    for (const k of ['sharpening', 'luminanceNoise', 'colorNoise'] as const) expect(DEFAULT_PASTE_KEYS).toContain(k)
  })

  it('copies each part on its own', () => {
    const src = withNr(40, 30, 60)
    const out = applyPaste(withNr(10, 5, 0), clip(src, ['luminanceNoise']), 'raw')
    expect(out.detail?.noise.luminance).toBe(40)
    expect(out.detail?.noise.color).toBe(5)
    expect(out.detail?.sharpen.amount).toBe(0)
    const sharp = applyPaste(DEFAULT_SETTINGS, clip(src, ['sharpening']), 'raw')
    expect(sharp.detail?.sharpen.amount).toBe(60)
    expect(sharp.detail?.noise.luminance).toBe(0)
  })

  it('pasting from an edit without Detail onto one without leaves no key (old edits stay as they were)', () => {
    const out = applyPaste({ ...DEFAULT_SETTINGS, exposure: 1 }, clip({ ...DEFAULT_SETTINGS, exposure: 0.5 }), 'raw')
    expect(out.exposure).toBe(0.5)
    expect('detail' in out).toBe(false)
    // …and turns it off where the target had it.
    expect('detail' in applyPaste(withNr(30, 30), clip(DEFAULT_SETTINGS), 'raw')).toBe(false)
  })

  it('describes the items and notices changes (Auto Sync)', () => {
    const lines = describePaste(clip(withNr(40, 0, 60)), 'raw')
    expect(lines).toContain('Sharpening: Amount 60, Radius 1.0, Detail 25, Masking 0')
    expect(lines.some((l) => l.startsWith('Noise reduction: Luminance: 40'))).toBe(true)
    expect(lines).toContain('Noise reduction: Color: off')
    expect(changedKeys(withNr(40, 0), withNr(45, 0))).toEqual(['luminanceNoise'])
  })
})

describe('Detail under a preset’s Amount', () => {
  it('moves every Detail slider from the photo’s value towards the preset’s', () => {
    const after = withNr(60, 40, 80)
    const half = blendSettings(DEFAULT_SETTINGS, after, 0.5)
    expect(half.detail?.noise.luminance).toBe(30)
    expect(half.detail?.noise.color).toBe(20)
    expect(half.detail?.sharpen.amount).toBe(40)
    const double = blendSettings(DEFAULT_SETTINGS, after, 2)
    expect(double.detail?.noise.luminance).toBe(100)
    expect(double.detail?.sharpen.amount).toBe(150)
    expect('detail' in blendSettings(DEFAULT_SETTINGS, after, 0)).toBe(false)
    expect('detail' in blendSettings(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, exposure: 1 }, 0.5)).toBe(false)
  })
})
