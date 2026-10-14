import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings, type DevelopSettings } from '../engine/develop/settings'
import type { LocalMask } from '../engine/develop/masks'
import { applyPaste, changedKeys, DEFAULT_PASTE_KEYS, describePaste, NOT_AUTO_SYNCED, PASTE_ITEMS, type Clipboard } from './paste'
import { blendSettings } from './presets'

// Masks in Copy/Paste, Sync and presets (PHASE3.md Part 23; owner's decision 7).

const m = (id: string, name: string, kind: 'linear' | 'brush' | 'luminance', exposure = 1): LocalMask => ({
  id, name, invert: false, amount: 100, feather: 0, refine: 0,
  components: [{ id: `${id}c`, op: 'add', invert: false, shape: kind === 'linear' ? { kind, full: [0.5, 0.1], zero: [0.5, 0.5] } : kind === 'brush' ? { kind, strokes: [{ size: 0.02, feather: 50, flow: 100, density: 100, erase: false, dabs: [0.2, 0.2] }] } : { kind, range: [40, 60, 100, 100] } }],
  adjust: { exposure },
})
const source: DevelopSettings = normalizeSettings({ ...DEFAULT_SETTINGS, exposure: 0.3, masks: [m('s1', 'Sky', 'linear', -1), m('s2', 'Brights', 'luminance', -0.5)] })
const target: DevelopSettings = normalizeSettings({ ...DEFAULT_SETTINGS, masks: [m('t1', 'Own', 'brush')] })
const clip = (keys: Clipboard['keys']): Clipboard => ({ settings: source, keys, rerunAuto: false, sourceKind: 'raw', sourceName: 'A.NEF' })

describe('masks in Copy and Paste', () => {
  it('are a Masks item, unticked by default', () => {
    const item = PASTE_ITEMS.find((i) => i.key === 'masks')!
    expect(item.group).toBe('Masks')
    expect(DEFAULT_PASTE_KEYS).not.toContain('masks')
    expect(applyPaste(target, clip(DEFAULT_PASTE_KEYS), 'raw').masks).toEqual(target.masks)
  })

  it('are added to the photo’s own masks when ticked', () => {
    const out = applyPaste(target, clip(['masks']), 'raw')
    expect(out.masks!.map((x) => x.name)).toEqual(['Own', 'Sky', 'Brights'])
    expect(out.exposure).toBe(target.exposure)
    // Onto a photo without masks they are simply its masks.
    expect(applyPaste(normalizeSettings({ ...DEFAULT_SETTINGS }), clip(['masks']), 'raw').masks!.map((x) => x.name)).toEqual(['Sky', 'Brights'])
    expect(describePaste(clip(['masks']), 'raw').join('\n')).toMatch(/2 masks: Sky \(Linear gradient\); Brights \(Luminance range\).*added/)
  })

  it('are never sent by Auto Sync', () => {
    const after = { ...target, masks: [...target.masks!, m('n', 'New', 'linear')] }
    expect(changedKeys(target, after)).toContain('masks')
    expect(NOT_AUTO_SYNCED).toEqual(expect.arrayContaining(['masks', 'spots']))
  })
})

describe('the Masks group’s eye', () => {
  it('shows the photo without its masks, a view only', async () => {
    const { applyEyes, NO_GROUP_EYES, hiddenNames } = await import('./sectionEyes')
    const shown = applyEyes(target, { ...NO_GROUP_EYES, masks: true }, new Set(), { defaults: DEFAULT_SETTINGS, lensApplied: false })
    expect('masks' in shown).toBe(false)
    expect(target.masks).toHaveLength(1)
    expect(applyEyes(target, NO_GROUP_EYES, new Set(), { defaults: DEFAULT_SETTINGS, lensApplied: false }).masks).toBe(target.masks)
    expect(hiddenNames([{ id: 'masks', name: 'Masks', off: true }], new Set())).toEqual(['Masks'])
  })
})

describe('masks in presets', () => {
  it('scale the masks a preset added by its Amount, leaving the photo’s own masks alone', () => {
    const before = target
    const after = applyPaste(target, clip(['masks']), 'raw')
    const half = blendSettings(before, after, 0.5)
    expect(half.masks!.map((x) => x.amount)).toEqual([100, 50, 50])
    const double = blendSettings(before, after, 2)
    expect(double.masks!.map((x) => x.amount)).toEqual([100, 200, 200])
    expect(blendSettings(before, after, 0).masks).toEqual(before.masks)
  })
})
