// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readXmp, writeXmp, type SidecarData } from '../../sidecar/xmp'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings'
import { decodeRaster, encodeDepth } from './depth-map'
import {
  AI_RASTER_CAPS, aiChars, appendMasks, canAdd, capMessage, describeKinds, hasUnknown, maskFamily, MAX_AI_CHARS, MAX_AI_POINTS, needsAi, newMask, normalizeMask, normalizeMasks, presetMasks, refuseReason,
  type AiShape, type LocalMask,
} from './masks'
import { KIND_CODE, prepareMasks } from './mask-render'
import { processParams } from './process'
import { loadHistory, record, savedForm, startHistory } from '../../develop/history'

// AI selections (PHASE3.md Part 27): kind "ai" in the shape family (owner's AI-masks decision 1), the matte inside the
// edit and the .xmp in the sensor frame, drawn without the model, and how paste, presets, the history, caps and damaged
// files treat it. Old edits never hold one, so nothing they draw changes.

const W = 160
const H = 100
// A matte: an ellipse selected (255) on 0, soft at its edge.
const px = new Uint8Array(W * H).map((_, i) => {
  const x = (i % W) / W - 0.5
  const y = Math.floor(i / W) / H - 0.5
  return Math.round(255 * Math.min(1, Math.max(0, (0.3 - Math.hypot(x, y * 0.8)) * 40)))
})
const raster = await encodeDepth(px, W, H)
const aiShape = (withMatte = true, what = 'object'): AiShape => ({
  kind: 'ai', what, model: 'sam2-1-hiera-tiny', modelVersion: '814a066/fp16', runtime: 'onnxruntime-web 1.30.0 webgpu',
  prompt: { points: [[0.5, 0.5, 1], [0.6, 0.45, 0]] }, ...(withMatte ? { raster } : {}),
})
const mask = (id: string, shapes: object[], adjust: LocalMask['adjust'] = { exposure: 1 }, ops: LocalMask['components'][number]['op'][] = []): LocalMask => ({
  id, name: id, invert: false, amount: 100, feather: 0, refine: 0, adjust,
  components: shapes.map((shape, i) => ({ id: `${id}c${i}`, op: ops[i] ?? 'add', invert: false, shape: shape as AiShape })),
})
const radial = { kind: 'radial', center: [0.5, 0.5], rx: 0.2, ry: 0.2, angle: 0, feather: 50 }
const brush = { kind: 'brush', strokes: [{ size: 0.02, feather: 50, flow: 100, density: 100, erase: false, dabs: [0.4, 0.5, 0.42, 0.5] }] }
const lum = { kind: 'luminance', range: [40, 60, 100, 100] }
const depth = { kind: 'depth', range: [0, 0, 30, 50], model: 'd', modelVersion: 'x' }
const shown = { rawMap: [1, 0, 0, 0, 1, 0, 0, 0, 1] as never, w: W, h: H, sensor: [W, H] as [number, number] }

describe('AI selections combine like shapes (owner’s AI-masks decision 1)', () => {
  it('join shape masks (brush, gradients, other AI selections) and never ranges, either way round', () => {
    const o = mask('o', [aiShape()])
    expect(maskFamily(o)).toBe('shape')
    for (const k of ['brush', 'linear', 'radial', 'ai']) expect(canAdd(o, k)).toBe(true)
    for (const k of ['luminance', 'colour', 'depth']) expect(canAdd(o, k)).toBe(false)
    expect(canAdd(mask('r', [radial]), 'ai')).toBe(true)
    expect(canAdd(mask('l', [lum]), 'ai')).toBe(false)
    const why = refuseReason(mask('l', [lum]), 'ai')!
    expect(why).toMatch(/whole photo/)
    expect(why).toMatch(/object selection/)
    expect(why).not.toMatch(/patent|Lightroom|Adobe|darktable/i)
  })

  it('a stored range part combined with an AI selection is dropped on load', () => {
    expect(normalizeMask(mask('a', [aiShape(), lum, brush], undefined, ['add', 'intersect', 'subtract']))!.components.map((c) => c.shape.kind)).toEqual(['ai', 'brush'])
    expect(normalizeMask(mask('b', [depth, aiShape()]))!.components.map((c) => c.shape.kind)).toEqual(['depth'])
  })

  it('names masks by what they select, and describes them', () => {
    const a = newMask([], aiShape())
    expect(a.name).toBe('Object 1')
    expect(newMask([a], aiShape()).name).toBe('Object 2')
    expect(describeKinds(mask('m', [aiShape(), brush]))).toBe('Object (AI), Brush')
  })
})

describe('the matte in the edit and the sidecar', () => {
  const data = (develop: string | null): SidecarData => ({ rating: 0, flag: 0, color: 0, develop })

  it('round-trips through lightbench:Develop exactly, with the model, runtime and prompt', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, masks: [mask('Object 1', [aiShape(), brush], { exposure: 0.5 }, ['add', 'subtract'])] })
    const xmp = writeXmp(null, data(JSON.stringify(s)))!
    expect(xmp).not.toContain('crs:MaskGroupBasedCorrections')
    const back = normalizeSettings(JSON.parse(readXmp(xmp).develop!))
    expect(back).toEqual(s)
    const shape = back.masks![0].components[0].shape as AiShape
    expect(shape).toMatchObject({ kind: 'ai', what: 'object', model: 'sam2-1-hiera-tiny', modelVersion: '814a066/fp16', runtime: 'onnxruntime-web 1.30.0 webgpu', prompt: { points: [[0.5, 0.5, 1], [0.6, 0.45, 0]] } })
    expect(decodeRaster(shape.raster!)).toEqual(px)
  })

  it('checks prompts, mattes and the caps; a damaged matte leaves its part waiting, the rest of the edit kept', () => {
    const m = normalizeMask(mask('x', [{ ...aiShape(), prompt: { points: [[0.1, 0.2, 1], [NaN, 0, 1], [0.3, 0.3, 2], [9, -9, 0]], box: [0, 0, 1, 'x'] } }]))!
    expect((m.components[0].shape as AiShape).prompt).toEqual({ points: [[0.1, 0.2, 1], [3, -2, 0]] })
    const many = normalizeMask(mask('y', [{ ...aiShape(), prompt: { points: Array.from({ length: 200 }, () => [0.5, 0.5, 1]) } }]))!
    expect((many.components[0].shape as AiShape).prompt!.points).toHaveLength(MAX_AI_POINTS)
    expect(normalizeMask(mask('z', [{ ...aiShape(), what: '' }]))).toBeNull()
    const bad = [
      mask('a', [{ ...aiShape(), raster: { ...raster, data: 'not base64 !' } }]),
      mask('b', [{ ...aiShape(), raster: { ...raster, width: AI_RASTER_CAPS.side + 1 } }]),
      mask('c', [{ ...aiShape(), raster: { ...raster, width: 1024, height: 1025 } }]),
      mask('d', [{ ...aiShape(), raster: { ...raster, data: 'A'.repeat(AI_RASTER_CAPS.chars + 4) } }]),
    ]
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, exposure: 0.3, masks: bad })
    expect(s.exposure).toBe(0.3)
    expect(s.masks!.map((x) => x.name)).toEqual(['a', 'b', 'c', 'd'])
    expect(s.masks!.every(needsAi)).toBe(true)
    // A 1024 × 1024 matte is allowed (the long side is at most 1024 for every AI part: owner, 2026-10-22); 2048 isn't.
    expect(AI_RASTER_CAPS.side).toBe(1024)
    expect(normalizeMask(mask('e', [{ ...aiShape(), raster: { ...raster, width: 1024, height: 1024 } }]))!.components[0].shape).toHaveProperty('raster')
    expect(normalizeMask(mask('f', [{ ...aiShape(), raster: { ...raster, width: 2048, height: 1365 } }]))!.components[0].shape).not.toHaveProperty('raster')
    // All AI mattes of an edit together: past MAX_AI_CHARS the rest wait.
    const big = { ...raster, data: 'A'.repeat(AI_RASTER_CAPS.chars - 4) }
    const list = normalizeMasks(Array.from({ length: 12 }, (_, i) => mask(`m${i}`, [{ ...aiShape(), raster: big }])))!
    expect(list.filter((x) => !needsAi(x))).toHaveLength(Math.floor(MAX_AI_CHARS / big.data.length))
    expect(aiChars(list)).toBeLessThanOrEqual(MAX_AI_CHARS)
    expect(capMessage(list, { addAiChars: MAX_AI_CHARS })).toMatch(/AI selections/)
    // A newer build's AI selection (another "what") is kept and drawn: it is a matte like any other.
    const later = normalizeMask(mask('s', [aiShape(true, 'subject')]))!
    expect(hasUnknown(later)).toBe(false)
    expect(describeKinds(later)).toBe('AI selection (AI)')
  })
})

describe('drawing an AI selection (never runs a model)', () => {
  it('a drawing gets the matte and the uv → sensor grid; brushes subtract from it in the same mask', () => {
    const list = [mask('Object 1', [aiShape(), brush], { exposure: 1 }, ['add', 'subtract'])]
    const p = prepareMasks(list, shown, { x: 0, y: 0, w: W, h: H }, processParams(2).masks)
    expect(p.masks).toHaveLength(1)
    const [a, b] = p.masks[0].components
    expect(a.kind).toBe(KIND_CODE.ai)
    expect(KIND_CODE.ai).toBe(7)
    expect(a.raster?.px).toEqual(px)
    expect([a.raster?.w, a.raster?.h]).toEqual([W, H])
    expect(b.kind).toBe(KIND_CODE.brush)
    expect(b.op).toBe(1)
    expect(p.grid?.uv.length).toBe((p.grid!.n + 1) ** 2 * 2)
  })

  it('a part waiting for its matte, or with a matte that doesn’t decode, leaves its mask out; masks without AI get no grid', () => {
    expect(prepareMasks([mask('w', [aiShape(false)])], shown, { x: 0, y: 0, w: W, h: H }, processParams(2).masks).masks).toHaveLength(0)
    const corrupt = normalizeMasks([mask('x', [{ ...aiShape(), raster: { ...raster, data: raster.data.slice(0, 40) } }])])!
    expect(needsAi(corrupt[0])).toBe(false)
    expect(prepareMasks(corrupt, shown, { x: 0, y: 0, w: W, h: H }, processParams(2).masks).masks).toHaveLength(0)
    const plain = prepareMasks([mask('r', [radial])], shown, { x: 0, y: 0, w: W, h: H }, processParams(2).masks)
    expect(plain.grid).toBeUndefined()
  })
})

describe('paste, presets and the history', () => {
  it('paste and presets leave out every mask with an AI selection, mixed masks too (owner, 2026-10-28; Part 31)', () => {
    expect(appendMasks(undefined, [mask('Object 1', [aiShape(), brush], undefined, ['add', 'subtract'])])).toBeUndefined()
    expect(appendMasks(undefined, [mask('Object 1', [aiShape(), brush])])).toBeUndefined()
    const onto = appendMasks(undefined, [mask('Object 1', [aiShape()]), mask('Radial', [radial])])!
    expect(onto.map((m) => m.name)).toEqual(['Radial'])
    expect(presetMasks([mask('Object 1', [aiShape()]), mask('Brush', [brush]), mask('Object 2', [radial, aiShape()], undefined, ['add', 'subtract'])])).toBeUndefined()
    const p = presetMasks([mask('Object 1', [aiShape()]), mask('Radial', [radial]), mask('Sky 1', [aiShape(true, 'sky')])])!
    expect(p.map((m) => m.name)).toEqual(['Radial'])
    expect(p.some(needsAi)).toBe(false)
  })

  it('the saved history keeps each matte once and reads it back', () => {
    let h = startHistory(normalizeSettings(DEFAULT_SETTINGS))
    const withAi = normalizeSettings({ ...DEFAULT_SETTINGS, masks: [mask('Object 1', [aiShape()])] })
    for (let i = 0; i < 30; i++) h = record(h, `step ${i}`, { ...withAi, exposure: i / 10 }, i * 10000, false)
    const saved = savedForm(h)
    expect(saved.rasters).toHaveLength(1)
    expect(JSON.stringify(saved).length).toBeLessThan(raster.data.length * 1.2 + 30 * 3000)
    const back = loadHistory({ settings: JSON.stringify(withAi), history: JSON.stringify(saved) }, 'raw')
    expect(back.steps[30].settings.masks![0].components[0].shape).toEqual(withAi.masks![0].components[0].shape)
    const broken = loadHistory({ settings: '{}', history: JSON.stringify({ ...saved, rasters: [] }) }, 'raw')
    expect(needsAi(broken.steps[30].settings.masks![0])).toBe(true)
  }, 30000)
})
