// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readXmp, writeXmp, type SidecarData } from '../../sidecar/xmp'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings'
import { encodeDepth, decodeDepth, MAX_DEPTH_CHARS } from './depth-map'
import {
  appendMasks, canAdd, existingDepth, hasUnknown, maskFamily, needsDepth, normalizeMask, normalizeMasks, presetMasks, refuseReason, withDepthMap, withoutDepthMaps,
  type DepthShape, type LocalMask,
} from './masks'
import { prepareMasks, KIND_CODE, sensorGrid } from './mask-render'
import { processParams } from './process'
import { loadHistory, record, savedForm, startHistory } from '../../develop/history'

// The AI Depth range (PHASE3.md Part 24): a range-family part (owner's decision 12), its depth map inside the edit and
// the .xmp (decision 10), and how paste, presets, the history and damaged files treat it.

const W = 120
const H = 80
const px = new Uint8Array(W * H).map((_, i) => Math.round((Math.floor(i / W) / (H - 1)) * 255)) // nearer towards the bottom
const raster = await encodeDepth(px, W, H)
const depthShape = (range: DepthShape['range'] = [0, 0, 30, 50], withMap = true): DepthShape => ({ kind: 'depth', range, model: 'depth-anything-v2-small', modelVersion: 'feedfac/fp32', runtime: 'onnxruntime-web 1.30.0 webgpu', ...(withMap ? { raster } : {}) })
const mask = (id: string, shapes: object[], adjust: LocalMask['adjust'] = { exposure: 1 }): LocalMask => ({
  id, name: id, invert: false, amount: 100, feather: 0, refine: 0, adjust,
  components: shapes.map((shape, i) => ({ id: `${id}c${i}`, op: i ? 'intersect' : 'add', invert: false, shape: shape as DepthShape })),
})
const radial = { kind: 'radial', center: [0.5, 0.5], rx: 0.2, ry: 0.2, angle: 0, feather: 50 }
const lum = { kind: 'luminance', range: [40, 60, 100, 100] }

describe('the Depth range is a range-family part (owner’s decision 12)', () => {
  it('joins range masks only, never a shape, in either order, without patent talk', () => {
    const d = mask('d', [depthShape()])
    expect(maskFamily(d)).toBe('range')
    expect(canAdd(d, 'luminance')).toBe(true)
    expect(canAdd(d, 'colour')).toBe(true)
    expect(canAdd(d, 'depth')).toBe(true)
    for (const k of ['brush', 'linear', 'radial']) expect(canAdd(d, k)).toBe(false)
    expect(canAdd(mask('r', [radial]), 'depth')).toBe(false)
    expect(canAdd(mask('l', [lum]), 'depth')).toBe(true)
    const why = refuseReason(mask('r', [radial]), 'depth')!
    expect(why).toMatch(/whole photo/)
    expect(why).not.toMatch(/patent/i)
  })

  it('a stored Depth ∩ shape loses the shape on load (and a shape mask loses the depth part)', () => {
    const a = normalizeMask(mask('a', [depthShape(), radial]))!
    expect(a.components.map((c) => c.shape.kind)).toEqual(['depth'])
    const b = normalizeMask(mask('b', [radial, depthShape()]))!
    expect(b.components.map((c) => c.shape.kind)).toEqual(['radial'])
    const c = normalizeMask(mask('c', [lum, depthShape()]))!
    expect(c.components.map((x) => x.shape.kind)).toEqual(['luminance', 'depth'])
    expect(hasUnknown(c)).toBe(false)
  })
})

describe('the depth map in the edit and the sidecar', () => {
  const data = (develop: string | null): SidecarData => ({ rating: 0, flag: 0, color: 0, develop })

  it('round-trips through lightbench:Develop exactly (no recompute needed elsewhere)', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, masks: [mask('Near', [depthShape([0, 5, 25, 40])])] })
    const xmp = writeXmp(null, data(JSON.stringify(s)))!
    expect(xmp).not.toContain('crs:MaskGroupBasedCorrections')
    const back = normalizeSettings(JSON.parse(readXmp(xmp).develop!))
    expect(back).toEqual(s)
    const shape = back.masks![0].components[0].shape as DepthShape
    expect(shape.raster).toEqual(raster)
    expect(decodeDepth(shape.raster!)).toEqual(px)
    // Only the map is added to the sidecar, with about 200 characters of escaped JSON around it.
    const without = writeXmp(null, data(JSON.stringify(normalizeSettings({ ...DEFAULT_SETTINGS, masks: [mask('Near', [depthShape([0, 5, 25, 40], false)])] }))))!
    expect(xmp.length - without.length).toBeLessThan(raster.data.length + 200)
  })

  it('keeps a part whose map is damaged, without the map, and the rest of the edit', () => {
    const bad = [
      mask('a', [{ ...depthShape(), raster: { ...raster, data: 'not base64 !' } }]),
      mask('b', [{ ...depthShape(), raster: { ...raster, width: 99999 } }]),
      mask('c', [{ ...depthShape(), raster: { ...raster, encoding: 'jpeg' } }]),
      mask('d', [{ ...depthShape(), raster: { ...raster, data: 'A'.repeat(MAX_DEPTH_CHARS + 4) } }]),
      mask('e', [{ ...depthShape(), range: 'near' }]),
    ]
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, exposure: 0.3, masks: bad })
    expect(s.exposure).toBe(0.3)
    expect(s.masks!.map((m) => m.name)).toEqual(['a', 'b', 'c', 'd'])
    expect(s.masks!.every(needsDepth)).toBe(true)
    // Data that passes the field checks but doesn't decode: kept, and the drawing leaves the mask out.
    const corrupt = normalizeMasks([mask('x', [{ ...depthShape(), raster: { ...raster, data: raster.data.slice(0, 40) } }])])!
    expect(needsDepth(corrupt[0])).toBe(false)
    const shown = { rawMap: [1, 0, 0, 0, 1, 0, 0, 0, 1] as never, w: W, h: H, sensor: [W, H] as [number, number] }
    expect(prepareMasks(corrupt, shown, { x: 0, y: 0, w: W, h: H }, processParams(2).masks).masks).toHaveLength(0)
  })

  it('a drawing gets the map, the range and the uv → sensor grid; the depth-map view shows the map itself', () => {
    const shown = { rawMap: [1, 0, 0, 0, 1, 0, 0, 0, 1] as never, w: W, h: H, sensor: [W, H] as [number, number] }
    const list = [mask('Near', [depthShape([0, 0, 30, 50])])]
    const p = prepareMasks(list, shown, { x: 0, y: 0, w: W, h: H }, processParams(2).masks)
    expect(p.masks).toHaveLength(1)
    const c = p.masks[0].components[0]
    expect(c.kind).toBe(KIND_CODE.depth)
    expect(c.p0).toEqual([0, 0, 30, 50])
    expect(c.depth?.px).toEqual(px)
    expect(p.grid?.uv.length).toBe((p.grid!.n + 1) ** 2 * 2)
    // Without an effect it is left out, unless shown; shown as the depth map it has no effect and the overlay mark.
    const noFx = [mask('Near', [depthShape()], {})]
    expect(prepareMasks(noFx, shown, { x: 0, y: 0, w: W, h: H }, processParams(2).masks).masks).toHaveLength(0)
    const view = prepareMasks(noFx, shown, { x: 0, y: 0, w: W, h: H }, processParams(2).masks, 'Near', true)
    expect(view.masks[0].components[0].p1[0]).toBe(1)
    expect(view.masks[0].values.slice(0, 10).every((v) => v === 0)).toBe(true)
    expect(view.masks[0].values[10]).toBe(1)
    // A part without its map leaves the mask out of the drawing.
    expect(prepareMasks([mask('x', [depthShape(undefined, false)])], shown, { x: 0, y: 0, w: W, h: H }, processParams(2).masks).masks).toHaveLength(0)
  })

  it('the grid maps the drawn image to the sensor through a quarter turn', () => {
    // A quarter turn clockwise: displayed (u, v) shows sensor (v, 1 − u).
    const turn = [0, 1, 0, -1, 0, 1, 0, 0, 1] as never
    const g = sensorGrid({ rawMap: turn, w: H, h: W, sensor: [W, H] }, 4)
    const at = (i: number, j: number) => [g[(j * 5 + i) * 2], g[(j * 5 + i) * 2 + 1]]
    expect(at(0, 0)[0]).toBeCloseTo(0)
    expect(at(0, 0)[1]).toBeCloseTo(1)
    expect(at(4, 0)[1]).toBeCloseTo(0)
  })
})

describe('paste, presets and the history', () => {
  it('pasted Depth ranges take the target’s own map, else wait for one', () => {
    const src = [mask('Near', [depthShape([10, 20, 30, 40])])]
    const onto = appendMasks(undefined, src)!
    expect(needsDepth(onto[0])).toBe(true)
    expect((onto[0].components[0].shape as DepthShape).range).toEqual([10, 20, 30, 40])
    const ownMap = { ...raster, data: raster.data } // the target's map (here the same bytes)
    const target = [mask('Own', [{ ...depthShape(), raster: ownMap }])]
    const both = appendMasks(target, src)!
    expect(both).toHaveLength(2)
    expect((both[1].components[0].shape as DepthShape).raster).toEqual(ownMap)
    expect(existingDepth(both)?.raster).toEqual(ownMap)
  })

  it('presets keep depth ranges without the photo’s map; withDepthMap fills them in', () => {
    const p = presetMasks([mask('Near', [depthShape()]), mask('Brush', [{ kind: 'brush', strokes: [{ size: 0.01, feather: 50, flow: 100, density: 100, erase: false, dabs: [0.1, 0.1] }] }])])!
    expect(p.map((m) => m.name)).toEqual(['Near'])
    expect(needsDepth(p[0])).toBe(true)
    const filled = withDepthMap(p, existingDepth([mask('x', [depthShape()])])!)
    expect(needsDepth(filled[0])).toBe(false)
    expect(withoutDepthMaps(filled)[0].components[0].shape).not.toHaveProperty('raster')
  })

  it('the saved history keeps each depth map once and reads it back', () => {
    let h = startHistory(normalizeSettings(DEFAULT_SETTINGS))
    const withDepth = normalizeSettings({ ...DEFAULT_SETTINGS, masks: [mask('Near', [depthShape()])] })
    for (let i = 0; i < 30; i++) h = record(h, `step ${i}`, { ...withDepth, exposure: i / 10 }, i * 10000, false)
    const saved = savedForm(h)
    const json = JSON.stringify(saved)
    expect(saved.rasters).toHaveLength(1)
    expect(json.length).toBeLessThan(raster.data.length * 1.2 + 30 * 3000)
    const back = loadHistory({ settings: JSON.stringify(withDepth), history: json }, 'raw')
    expect(back.steps).toHaveLength(31)
    expect(back.steps[30].settings.masks![0].components[0].shape).toEqual(withDepth.masks![0].components[0].shape)
    // A reference to a missing map: the part waits for a new one.
    const broken = loadHistory({ settings: '{}', history: JSON.stringify({ ...saved, rasters: [] }) }, 'raw')
    expect(needsDepth(broken.steps[30].settings.masks![0])).toBe(true)
  })
})
