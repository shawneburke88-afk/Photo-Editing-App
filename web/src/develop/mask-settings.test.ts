// Mask settings reuse (PHASE3.md Part 31): Copy / Paste mask settings, mask presets' values, and AI parts left out of
// Copy/Paste settings and develop presets (owner, 2026-10-28), including presets saved before then.
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings, type DevelopSettings } from '../engine/develop/settings'
import { hasAiParts, LOCAL_KEYS, needsAi, needsDepth, presetMasks, withoutAiMasks, type AiShape, type DepthShape, type LocalMask, type MaskComponent } from '../engine/develop/masks'
import { applyPaste, describePaste, type Clipboard } from './paste'
import { presetClip, presetFromRow, type PresetData } from './presets'
import { describeMaskValues, maskClipboard, maskPresetData, maskPresetFromRow, maskValues, normalizeMaskValues, sameValues, withMaskValues } from './maskSettings'

const radial = { kind: 'radial', center: [0.5, 0.5], rx: 0.2, ry: 0.15, angle: 0, feather: 30 }
const linear = { kind: 'linear', full: [0.5, 0.1], zero: [0.5, 0.5] }
const brush = { kind: 'brush', strokes: [{ size: 0.02, feather: 50, flow: 100, density: 100, erase: false, dabs: [0.2, 0.2, 0.21, 0.2] }] }
const lum = { kind: 'luminance', range: [40, 60, 100, 100] }
const colour = { kind: 'colour', samples: [[0.6, 0.02, -0.1]], refine: 50 }
// AI parts as an edit stores them (a tiny 8-bit matte / depth map; their contents don't matter here).
const raster = { width: 2, height: 2, encoding: 'u8-med-deflate-b64', data: 'AAAA' }
const object = (): AiShape => ({ kind: 'ai', what: 'object', model: 'sam2-1-hiera-tiny', modelVersion: 'x/fp16', prompt: { points: [[0.5, 0.5, 1]] }, raster } as AiShape)
const sky = (): AiShape => ({ kind: 'ai', what: 'sky', model: 'efficientvit-seg-b1-ade20k', modelVersion: 'x/fp32', raster } as AiShape)
const people = (): AiShape => ({ kind: 'ai', what: 'face', model: 'mediapipe', modelVersion: 'x/fp32', prompt: { all: true, boxes: [[0.1, 0.1, 0.4, 0.9]] }, raster } as AiShape)
const subject = (): AiShape => ({ kind: 'ai', what: 'subject', model: 'later', modelVersion: 'x', raster } as AiShape)
const depth = (): DepthShape => ({ kind: 'depth', range: [0, 0, 30, 50], model: 'depth-anything-v2-small', modelVersion: 'x/fp32', raster } as DepthShape)

let n = 0
const mask = (name: string, parts: (object | [object, MaskComponent['op']])[], more: Partial<LocalMask> = {}): LocalMask => ({
  id: `m${++n}`, name, invert: false, amount: 100, feather: 0, refine: 0, adjust: { exposure: 0.5 },
  components: parts.map((p, i) => {
    const [shape, op] = Array.isArray(p) ? p : [p, 'add' as const]
    return { id: `c${n}-${i}`, op, invert: false, shape: shape as MaskComponent['shape'] }
  }),
  ...more,
})
const kinds = (m: LocalMask) => m.components.map((c) => `${c.op}:${c.shape.kind === 'ai' ? (c.shape as AiShape).what : c.shape.kind}`)

describe('mask values (Copy / Paste mask settings, mask presets)', () => {
  const src = mask('Radial 1', [radial], { amount: 140, feather: 40, refine: 20, invert: true, adjust: { exposure: 0.75, shadows: 30, temperature: -12, texture: 15, glow: -20 } })

  it('copy every local slider and the Amount, and nothing else', () => {
    const v = maskValues(src)
    expect(v).toEqual({ adjust: { exposure: 0.75, shadows: 30, temperature: -12, texture: 15, glow: -20 }, amount: 140 })
    // Every key in LOCAL_KEYS travels.
    const all = mask('All', [radial], { adjust: Object.fromEntries(LOCAL_KEYS.map((k, i) => [k, k === 'exposure' ? 1.25 : i + 1])) })
    expect(Object.keys(maskValues(all).adjust).sort()).toEqual([...LOCAL_KEYS].sort())
  })

  it('pasted onto any mask kind, set its sliders and Amount and leave its parts, invert, feather and refine', () => {
    const target = mask('Colour range 1', [colour, [lum, 'intersect']], { amount: 60, feather: 10, refine: 70, invert: false, adjust: { contrast: 25, exposure: -1 } })
    const out = withMaskValues(target, maskValues(src))
    expect(out.adjust).toEqual(src.adjust)
    // Sliders the copied mask didn't set go to 0 (Contrast).
    expect(out.adjust.contrast).toBeUndefined()
    expect(out.amount).toBe(140)
    expect({ ...out, adjust: target.adjust, amount: target.amount }).toEqual(target)
    expect(sameValues(out, maskValues(src))).toBe(true)
    expect(sameValues(target, maskValues(src))).toBe(false)
    // An AI mask takes them the same way (its matte untouched).
    const ai = mask('Sky 1', [sky()])
    expect(withMaskValues(ai, maskValues(src)).components).toBe(ai.components)
  })

  it('the clipboard keeps its own copy until replaced, and tells its listeners', () => {
    const heard = vi.fn()
    const off = maskClipboard.subscribe(heard)
    const m = mask('Brush 1', [brush], { adjust: { exposure: 1 } })
    maskClipboard.set({ values: maskValues(m), from: m.name })
    m.adjust.exposure = -2
    expect(maskClipboard.get()).toEqual({ from: 'Brush 1', values: { adjust: { exposure: 1 }, amount: 100 } })
    expect(heard).toHaveBeenCalledTimes(1)
    off()
    maskClipboard.set(null)
    expect(maskClipboard.get()).toBeNull()
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('stored values are checked: known sliders in range, zeros dropped, Amount 0–200 (100 when missing)', () => {
    expect(normalizeMaskValues({ adjust: { exposure: 9, shadows: 0, contrast: 12.6, made_up: 5, tint: 'x' }, amount: 900 })).toEqual({ adjust: { exposure: 4, contrast: 13 }, amount: 200 })
    expect(normalizeMaskValues({ adjust: {} })).toEqual({ adjust: {}, amount: 100 })
    expect(normalizeMaskValues(null)).toBeNull()
    expect(normalizeMaskValues({ amount: 50 })).toBeNull()
    expect(maskPresetFromRow({ id: 3, name: 'Darken sky', preset: maskPresetData({ adjust: { exposure: -0.7, dehaze: 20 }, amount: 100 }) })).toEqual({ id: 3, name: 'Darken sky', values: { adjust: { exposure: -0.7, dehaze: 20 }, amount: 100 } })
    expect(JSON.parse(maskPresetData({ adjust: { exposure: 0.5 }, amount: 90 }))).toEqual({ version: 1, adjust: { exposure: 0.5 }, amount: 90 })
    expect(maskPresetFromRow({ id: 4, name: 'Broken', preset: '{not json' })).toBeNull()
  })

  it('are described in plain words', () => {
    expect(describeMaskValues({ adjust: { exposure: 0.5, shadows: 20 }, amount: 100 })).toBe('Exposure +0.50 EV, Shadows +20')
    expect(describeMaskValues({ adjust: { highlights: -40 }, amount: 80 })).toBe('Highlights -40; Amount 80 %')
    expect(describeMaskValues({ adjust: {}, amount: 100 })).toBe('all sliders at 0')
  })
})

describe('masks with AI parts are left out of Copy/Paste and presets (owner, 2026-10-28)', () => {
  it('every AI kind and Depth ranges; masks without AI parts pass unchanged', () => {
    const plain = mask('Radial 1', [radial, [brush, 'subtract']])
    const list = [mask('Object 1', [object()]), mask('Sky 1', [sky()]), mask('People 1', [people()]), mask('Subject 1', [subject()]), mask('Depth range 1', [depth()]), plain]
    expect(hasAiParts(list)).toBe(true)
    const out = withoutAiMasks(list)!
    expect(out).toEqual([plain])
    expect(out[0]).toBe(plain)
    expect(hasAiParts(out)).toBe(false)
    expect(withoutAiMasks([mask('Sky 1', [sky()])])).toBeUndefined()
    expect(withoutAiMasks(undefined)).toBeUndefined()
  })

  it('a mask mixing AI and other parts is left out whole', () => {
    const mixed = [
      mask('a', [object(), brush]),
      mask('b', [radial, [sky(), 'subtract']]),
      mask('c', [sky(), [radial, 'intersect'], [brush, 'subtract']]),
      mask('d', [depth(), [lum, 'intersect']]),
      mask('e', [lum, [depth(), 'subtract'], [colour, 'add']]),
      mask('f', [people(), [radial, 'subtract'], [linear, 'add']]),
    ]
    const keep = mask('g', [lum, [colour, 'intersect']])
    expect(withoutAiMasks([...mixed, keep])).toEqual([keep])
    expect(withoutAiMasks(mixed)).toBeUndefined()
  })

  it('Copy settings with Masks ticked carries the brush mask and leaves every mask with an AI part out', () => {
    const source = normalizeSettings({ ...DEFAULT_SETTINGS, masks: [mask('Sky 1', [sky()]), mask('Brush 1', [brush], { adjust: { exposure: 0.9 } }), mask('Object 1', [object(), radial]), mask('Top', [linear])] })
    expect(source.masks).toHaveLength(4)
    const clip: Clipboard = { settings: source, keys: ['masks'], rerunAuto: false, sourceKind: 'raw', sourceName: 'A.NEF' }
    const out = applyPaste(normalizeSettings({ ...DEFAULT_SETTINGS }), clip, 'raw')
    expect(out.masks!.map((x) => [x.name, kinds(x)])).toEqual([['Brush 1', ['add:brush']], ['Top', ['add:linear']]])
    expect(out.masks!.some((x) => needsAi(x) || needsDepth(x))).toBe(false)
    expect(describePaste(clip, 'raw').join('\n')).toMatch(/2 masks: Brush 1 \(Brush\); Top \(Linear gradient\).*Masks with AI parts aren’t copied/)
    // Only AI masks: nothing is added, and the photo's own masks stay.
    const own = normalizeSettings({ ...DEFAULT_SETTINGS, masks: [mask('Own', [linear])] })
    const onlyAi: DevelopSettings = normalizeSettings({ ...DEFAULT_SETTINGS, masks: [mask('Sky 1', [sky()])] })
    expect(applyPaste(own, { ...clip, settings: onlyAi }, 'raw').masks).toEqual(own.masks)
  })

  it('a new preset holds no mask with an AI part', () => {
    expect(presetMasks([mask('Sky 1', [sky()]), mask('Radial minus sky', [radial, [sky(), 'subtract']]), mask('Brush 1', [brush]), mask('Radial 1', [radial])])!.map((x) => [x.name, kinds(x)])).toEqual([['Radial 1', ['add:radial']]])
  })

  it('a preset saved earlier with AI parts applies without the masks holding them', () => {
    // As 0.6.18 saved it: AI parts kept without their mattes, waiting for "Compute for this photo".
    const strip = (s: object) => (({ raster: _r, ...rest }) => (void _r, rest))(s as AiShape)
    const old: PresetData = {
      keys: ['exposure', 'masks'],
      settings: { ...DEFAULT_SETTINGS, exposure: 0.4, masks: [mask('Sky 1', [strip(sky())], { invert: true }), mask('People 1', [strip(people())]), mask('Near', [strip(depth())]), mask('Radial minus sky', [radial, [strip(sky()), 'subtract']]), mask('Top', [linear])] },
      rerunAuto: false,
      sourceKind: 'raw',
    }
    const p = presetFromRow({ id: 7, name: 'Old look', preset: JSON.stringify(old) })!
    const out = applyPaste(normalizeSettings({ ...DEFAULT_SETTINGS }), presetClip(p), 'raw')
    expect(out.exposure).toBe(0.4)
    expect(out.masks!.map((x) => [x.name, kinds(x)])).toEqual([['Top', ['add:linear']]])
    expect(out.masks!.some((x) => needsAi(x) || needsDepth(x))).toBe(false)
  })
})
