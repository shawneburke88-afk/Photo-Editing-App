import { describe, expect, it } from 'vitest'
import { DEFAULT_GLOW, DEFAULT_GRAIN, DEFAULT_VIGNETTE, reseedGrain } from '../engine/develop/effects'
import { DEFAULT_SETTINGS, normalizeSettings, type DevelopSettings } from '../engine/develop/settings'
import { applyPaste, changedKeys, DEFAULT_PASTE_KEYS, describePaste, PASTE_ITEMS, type Clipboard } from './paste'
import { DEFAULT_EXPORT, exportDither } from '../export/run'

// The Effects in Copy/Paste and Sync, virtual copies and the Export dither option (PHASE3.md Part 25).

const source: DevelopSettings = normalizeSettings({
  ...DEFAULT_SETTINGS,
  effects: {
    texture: 25,
    clarity: -10,
    dehaze: 40,
    dehazeDistance: 0.6,
    contrastTexture: { detailLevel: 6, haloControl: 1, noiseBias: 0.002 },
    vignette: { ...DEFAULT_VIGNETTE, amount: -30, style: 'colour' },
    grain: { ...DEFAULT_GRAIN, amount: 40, seed: 111 },
    glow: { ...DEFAULT_GLOW, amount: 20, style: 'diffusion' },
  },
})
const target: DevelopSettings = normalizeSettings({ ...DEFAULT_SETTINGS, effects: { grain: { ...DEFAULT_GRAIN, amount: 5, seed: 999 } } })
const clip = (keys: Clipboard['keys']): Clipboard => ({ settings: source, keys, rerunAuto: false, sourceKind: 'raw', sourceName: 'A.NEF' })

describe('effects in Copy and Paste', () => {
  it('Texture, Clarity, Dehaze are Presence items; Vignette, Grain, Glow an Effects group; all ticked by default', () => {
    for (const k of ['texture', 'clarity', 'dehaze'] as const) expect(PASTE_ITEMS.find((i) => i.key === k)!.group).toBe('Presence')
    for (const k of ['vignette', 'grain', 'glow'] as const) expect(PASTE_ITEMS.find((i) => i.key === k)!.group).toBe('Effects')
    for (const k of ['texture', 'clarity', 'dehaze', 'vignette', 'grain', 'glow'] as const) expect(DEFAULT_PASTE_KEYS).toContain(k)
  })

  it('each item copies its own part (with its darktable settings) and nothing else', () => {
    const d = applyPaste(target, clip(['dehaze']), 'raw')
    expect(d.effects).toEqual({ dehaze: 40, dehazeDistance: 0.6, grain: target.effects!.grain })
    const t = applyPaste(target, clip(['texture']), 'raw')
    expect(t.effects!.texture).toBe(25)
    expect(t.effects!.contrastTexture).toEqual(source.effects!.contrastTexture)
    expect(t.effects!.clarity).toBeUndefined()
    const v = applyPaste(target, clip(['vignette', 'glow']), 'raw')
    expect(v.effects!.vignette).toEqual(source.effects!.vignette)
    expect(v.effects!.glow).toEqual(source.effects!.glow)
  })

  it('pasted grain keeps the photo’s own pattern (its seed), or gets a new one', () => {
    const g = applyPaste(target, clip(['grain']), 'raw')
    expect(g.effects!.grain).toEqual({ ...source.effects!.grain, seed: 999 })
    const fresh = applyPaste(DEFAULT_SETTINGS, clip(['grain']), 'raw')
    expect(fresh.effects!.grain!.amount).toBe(40)
    expect(fresh.effects!.grain!.seed).not.toBe(111)
  })

  it('copying “none” removes the part; a seed alone is no change (Auto Sync)', () => {
    const none = applyPaste(source, { ...clip(['vignette']), settings: DEFAULT_SETTINGS }, 'raw')
    expect(none.effects!.vignette).toBeUndefined()
    const reseeded = { ...target, effects: { grain: { ...target.effects!.grain!, seed: 5 } } }
    expect(changedKeys(target, reseeded)).not.toContain('grain')
    expect(changedKeys(target, { ...target, effects: { ...target.effects, texture: 3 } })).toEqual(['texture'])
  })

  it('the checklist describes them', () => {
    const lines = describePaste(clip(['dehaze', 'vignette', 'grain', 'glow']), 'raw')
    expect(lines).toContain('Dehaze: +40, distance 0.6')
    expect(lines.find((l) => l.startsWith('Post-Crop Vignetting'))).toMatch(/Color Priority, Amount -30/)
    expect(lines.find((l) => l.startsWith('Grain'))).toMatch(/each photo’s own pattern/)
    expect(lines.find((l) => l.startsWith('Glow'))).toMatch(/Diffusion, Glow 20/)
  })
})

describe('virtual copies get their own grain pattern', () => {
  it('every grain seed in the edit and its history is replaced; other JSON stays as it is', () => {
    const settings = JSON.stringify(source)
    const history = JSON.stringify({ steps: [{ label: 'a', settings: source }, { label: 'b', settings: DEFAULT_SETTINGS }], index: 1 })
    const s2 = JSON.parse(reseedGrain(settings, 4242)) as DevelopSettings
    expect(s2.effects!.grain!.seed).toBe(4242)
    expect({ ...s2, effects: { ...s2.effects, grain: { ...s2.effects!.grain, seed: 111 } } }).toEqual(source)
    const h2 = JSON.parse(reseedGrain(history, 4242)) as { steps: { settings: DevelopSettings }[] }
    expect(h2.steps[0].settings.effects!.grain!.seed).toBe(4242)
    expect(reseedGrain(JSON.stringify(DEFAULT_SETTINGS), 1)).toBe(JSON.stringify(DEFAULT_SETTINGS))
    expect(reseedGrain('{bad', 1)).toBe('{bad')
  })
})

describe('Export dither (owner’s decision V2 = C)', () => {
  it('JPEGs are never dithered unless the new option is ticked (off by default); PNG/TIFF keep their option', () => {
    expect(DEFAULT_EXPORT.ditherJpeg).toBe(false)
    expect(exportDither(DEFAULT_EXPORT, 8)).toBe(0)
    expect(exportDither({ ...DEFAULT_EXPORT, ditherJpeg: true }, 8)).toBe(1)
    expect(exportDither({ ...DEFAULT_EXPORT, format: 'png' }, 8)).toBe(1)
    expect(exportDither({ ...DEFAULT_EXPORT, format: 'png', dither: false, ditherJpeg: true }, 8)).toBe(0)
    expect(exportDither({ ...DEFAULT_EXPORT, format: 'tiff' }, 16)).toBe(0)
  })
})
