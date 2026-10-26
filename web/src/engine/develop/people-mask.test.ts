// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readXmp, writeXmp, type SidecarData } from '../../sidecar/xmp'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings'
import { encodeDepth } from './depth-map'
import { appendMasks, defaultName, describeKinds, MAX_AI_BOXES, needsAi, newMask, normalizeShape, partLabel, peopleWho, photoBoundAi, presetMasks, type AiShape, type LocalMask } from './masks'
import { KIND_CODE, prepareMasks } from './mask-render'
import { processParams } from './process'

// People's parts (PHASE3.md Part 28): AI selections whose `what` is a person's part, with the person (or everyone) and
// their boxes in the prompt and every model that took part; stored, named, pasted and kept in presets as decided.

const raster = await encodeDepth(new Uint8Array(16 * 10).fill(255), 16, 10)
const part = (what: string, prompt: AiShape['prompt'], withMatte = true): AiShape => ({
  kind: 'ai', what, model: what === 'person' ? 'rf-detr-seg-nano' : 'mediapipe-selfie-multiclass', modelVersion: what === 'person' ? '94f9197/fp32' : 'f3a7202/fp32',
  runtime: 'onnxruntime-web 1.30.0 webgpu+wasm', models: ['rf-detr-seg-nano 94f9197/fp32', 'yunet 48b10fa/fp32', 'mediapipe-selfie-multiclass f3a7202/fp32'], prompt, ...(withMatte ? { raster } : {}),
})
const one = (what: string, n = 2, withMatte = true) => part(what, { person: n, box: [0.1, 0.2, 0.4, 0.9] }, withMatte)
const all = (what: string, withMatte = true) => part(what, { all: true, boxes: [[0.1, 0.2, 0.4, 0.9], [0.5, 0.1, 0.8, 0.95]] }, withMatte)
const mask = (id: string, shapes: AiShape[]): LocalMask => ({
  id, name: id, invert: false, amount: 100, feather: 0, refine: 0, adjust: { exposure: 1 },
  components: shapes.map((shape, i) => ({ id: `${id}c${i}`, op: 'add', invert: false, shape })),
})

describe('People parts', () => {
  it('are named by who and what; their masks are "People n"', () => {
    expect(partLabel(one('person'))).toBe('Person 2')
    expect(partLabel(one('hair'))).toBe('Person 2: hair')
    expect(partLabel(one('bodySkin', 3))).toBe('Person 3: body skin')
    expect(partLabel(all('person'))).toBe('All people')
    expect(partLabel(all('face'))).toBe('All people: face')
    expect(peopleWho(undefined)).toBeNull()
    expect(defaultName([], 'ai', 'hair')).toBe('People 1')
    expect(newMask([newMask([], all('person'))], one('clothes')).name).toBe('People 2')
    expect(describeKinds(mask('m', [one('person'), one('hair')]))).toBe('Person 2 (AI), Person 2: hair (AI)')
  })

  it('round-trip through the edit and the .xmp with the person, the boxes and every model', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, masks: [mask('People 1', [one('person'), all('clothes')])] })
    const data: SidecarData = { rating: 0, flag: 0, color: 0, develop: JSON.stringify(s) }
    const back = normalizeSettings(JSON.parse(readXmp(writeXmp(null, data)!).develop!))
    expect(back).toEqual(s)
    expect(back.masks![0].components[0].shape).toEqual(one('person'))
    expect(back.masks![0].components[1].shape).toEqual(all('clothes'))
  })

  it('check what is stored: bad persons, boxes and models are dropped, boxes capped', () => {
    const s = normalizeShape({ ...one('hair'), prompt: { person: 0, all: 'yes', box: [0, 0, 1, 1], boxes: [[0, 0, 1], 'x', ...Array.from({ length: 40 }, () => [0, 0, 1, 1])] }, models: ['a', 3, ''] }) as AiShape
    expect(s.prompt).toEqual({ box: [0, 0, 1, 1], boxes: Array.from({ length: MAX_AI_BOXES }, () => [0, 0, 1, 1]) })
    expect(s.models).toEqual(['a'])
    // An Object selection made by part 1 stays exactly as it was (no new keys).
    const o: AiShape = { kind: 'ai', what: 'object', model: 'sam2-1-hiera-tiny', modelVersion: '814a066/fp16', runtime: 'onnxruntime-web 1.30.0 webgpu', prompt: { points: [[0.5, 0.5, 1]] }, raster }
    expect(normalizeShape(o)).toEqual(o)
    expect(Object.keys(normalizeShape(o)!)).toEqual(Object.keys(o))
  })

  it('are drawn from their matte, like an Object selection', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, masks: [mask('People 1', [all('person')])] })
    const shown = { rawMap: [1, 0, 0, 0, 1, 0, 0, 0, 1] as never, w: 16, h: 10, sensor: [16, 10] as [number, number] }
    const p = prepareMasks(s.masks!, shown, { x: 0, y: 0, w: 16, h: 10 }, processParams(2).masks)
    expect(p.masks[0].components[0].kind).toBe(KIND_CODE.ai)
    expect(p.masks[0].components[0].raster?.px.every((x) => x === 255)).toBe(true)
  })

  it('paste carries every People part, waiting; presets keep only "All people" parts (one person is one photo’s)', () => {
    const pasted = appendMasks(undefined, [mask('People 1', [one('hair'), all('face')])])!
    expect(needsAi(pasted[0])).toBe(true)
    expect(pasted[0].components.map((c) => (c.shape as AiShape).prompt)).toEqual([one('hair').prompt, all('face').prompt])
    expect(photoBoundAi(one('person'))).toBe(true)
    expect(photoBoundAi(all('person'))).toBe(false)
    const p = presetMasks([mask('People 1', [one('person')]), mask('People 2', [all('hair'), all('face')]), mask('People 3', [all('person'), one('face')])])!
    expect(p.map((m) => m.name)).toEqual(['People 2'])
    expect(needsAi(p[0])).toBe(true)
    expect(p[0].components[0].shape).not.toHaveProperty('raster')
    expect((p[0].components[0].shape as AiShape).prompt).toEqual(all('hair').prompt)
  })
})
