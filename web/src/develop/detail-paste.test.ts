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
  it('is three items, as in Lightroom’s Copy Settings, unticked by default (like Lens: an old edit mustn’t turn new photos’ sharpening off)', () => {
    for (const k of ['sharpening', 'luminanceNoise', 'colorNoise'] as const) expect(DEFAULT_PASTE_KEYS).not.toContain(k)
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
    const { detail: _d, ...old } = DEFAULT_SETTINGS
    void _d
    const all = [...DEFAULT_PASTE_KEYS, 'sharpening', 'luminanceNoise', 'colorNoise'] as const
    const out = applyPaste({ ...old, exposure: 1 }, clip({ ...old, exposure: 0.5 }, [...all]), 'raw')
    expect(out.exposure).toBe(0.5)
    expect('detail' in out).toBe(false)
    // …turns it off where the target had it, when ticked…
    expect('detail' in applyPaste(withNr(30, 30), clip(old, [...all]), 'raw')).toBe(false)
    // …and leaves a new photo's default sharpening alone when not ticked (the default).
    expect(applyPaste(DEFAULT_SETTINGS, clip({ ...old, exposure: 0.5 }), 'raw').detail?.sharpen.amount).toBe(40)
  })

  it('describes the items and notices changes (Auto Sync)', () => {
    const lines = describePaste(clip(withNr(40, 0, 60)), 'raw')
    expect(lines.length).toBeGreaterThan(0)
    const all = describePaste(clip(withNr(40, 0, 60), [...DEFAULT_PASTE_KEYS, 'sharpening', 'luminanceNoise', 'colorNoise']), 'raw')
    expect(all).toContain('Sharpening: Amount 60, Radius auto (each photo’s own), Detail 25, Masking 0')
    expect(all.some((l) => l.startsWith('Noise reduction: Luminance: 40'))).toBe(true)
    expect(all).toContain('Noise reduction: Color: off')
    expect(changedKeys(withNr(40, 0), withNr(45, 0))).toEqual(['luminanceNoise'])
  })
})

describe('Detail under a preset’s Amount', () => {
  it('moves every Detail slider from the photo’s value towards the preset’s', () => {
    const { detail: _d, ...old } = DEFAULT_SETTINGS
    void _d
    const after = withNr(60, 40, 80)
    const half = blendSettings(old, after, 0.5)
    expect(half.detail?.noise.luminance).toBe(30)
    expect(half.detail?.noise.color).toBe(20)
    expect(half.detail?.sharpen.amount).toBe(40)
    const double = blendSettings(old, after, 2)
    expect(double.detail?.noise.luminance).toBe(100)
    expect(double.detail?.sharpen.amount).toBe(150)
    expect('detail' in blendSettings(old, after, 0)).toBe(false)
    expect('detail' in blendSettings(old, { ...old, exposure: 1 }, 0.5)).toBe(false)
    // From a new RAW photo's default sharpening (40) towards the preset's 80.
    expect(blendSettings(DEFAULT_SETTINGS, after, 0.5).detail?.sharpen.amount).toBe(60)
  })
})
