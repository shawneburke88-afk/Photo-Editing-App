// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readXmp, writeXmp, type SidecarData } from '../../sidecar/xmp'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings'
import { decodeRaster, encodeDepth } from './depth-map'
import { appendMasks, canAdd, describeKinds, needsAi, newMask, normalizeMask, partLabel, presetMasks, type AiShape, type LocalMask } from './masks'

// Sky parts (PHASE3.md Part 29): an AI part (`what: 'sky'`) with no prompt, its matte in the edit like an Object
// selection's; pasted and preset Sky parts wait for "Compute for this photo", and presets keep them (they aren't tied
// to one photo).

const W = 120
const H = 80
// The top 40 % is sky.
const px = new Uint8Array(W * H).map((_, i) => (Math.floor(i / W) < H * 0.4 ? 255 : 0))
const raster = await encodeDepth(px, W, H)
const sky = (withMatte = true): AiShape => ({ kind: 'ai', what: 'sky', model: 'efficientvit-seg-b1-ade20k', modelVersion: 'abcdef0/fp32', runtime: 'onnxruntime-web 1.30.0 webgpu', ...(withMatte ? { raster } : {}) })
const mask = (id: string, shapes: object[], invert = false): LocalMask => ({
  id, name: id, invert, amount: 100, feather: 0, refine: 0, adjust: { exposure: -0.5 },
  components: shapes.map((shape, i) => ({ id: `${id}c${i}`, op: i ? 'subtract' : 'add', invert: false, shape: shape as AiShape })),
})
const radial = { kind: 'radial', center: [0.5, 0.5], rx: 0.2, ry: 0.2, angle: 0, feather: 50 }

describe('Sky parts', () => {
  it('are named and described as the sky, and join shapes', () => {
    const a = newMask([], sky())
    expect(a.name).toBe('Sky 1')
    expect(newMask([a], sky()).name).toBe('Sky 2')
    expect(partLabel(sky())).toBe('Sky')
    expect(describeKinds(mask('m', [radial, sky()]))).toBe('Radial gradient, Sky (AI)')
    expect(canAdd(mask('m', [radial]), 'ai')).toBe(true)
  })

  it('keep no prompt, and round-trip through the sidecar exactly, inverted too', () => {
    const n = normalizeMask(mask('Sky 1', [sky()], true))!
    expect(n.components[0].shape).not.toHaveProperty('prompt')
    expect(n.invert).toBe(true)
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, masks: [mask('Sky 1', [sky()], true)] })
    const data: SidecarData = { rating: 0, flag: 0, color: 0, develop: JSON.stringify(s) }
    const back = normalizeSettings(JSON.parse(readXmp(writeXmp(null, data)!).develop!))
    expect(back).toEqual(s)
    expect(decodeRaster((back.masks![0].components[0].shape as AiShape).raster!)).toEqual(px)
  })

  it('are left out of paste and presets with the masks holding them (owner, 2026-10-28; Part 31)', () => {
    expect(appendMasks(undefined, [mask('Sky 1', [sky()]), mask('Radial minus sky', [radial, sky()])])).toBeUndefined()
    expect(presetMasks([mask('Sky 1', [sky()], true), mask('Radial minus sky', [radial, sky()])])).toBeUndefined()
    const p = presetMasks([mask('Sky 1', [sky()], true), mask('Radial', [radial])])!
    expect(p.map((m) => m.name)).toEqual(['Radial'])
    expect(p.some(needsAi)).toBe(false)
  })
})
