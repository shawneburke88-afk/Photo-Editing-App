import { describe, expect, it } from 'vitest'
import {
  appendMasks, canAdd, capMessage, dabCount, defaultName, describeMasks, hasEffect, hasUnknown, MAX_COMPONENTS, MAX_DABS, MAX_MASKS, maskFamily, newMask, normalizeMask, normalizeMasks,
  presetMasks, refuseReason, type LocalMask, type MaskComponent,
} from './masks'
import { DEFAULT_SETTINGS, displayUniforms, normalizeSettings } from './settings'

// Masks (PHASE3.md Part 23): the stored model, its checks, the caps and the design-around (owner's decisions 7, 9, 12).

const radial = (id = 'r'): MaskComponent => ({ id, op: 'add', invert: false, shape: { kind: 'radial', center: [0.5, 0.5], rx: 0.2, ry: 0.1, angle: 10, feather: 50 } })
const linear = (id = 'l', op: MaskComponent['op'] = 'add'): MaskComponent => ({ id, op, invert: false, shape: { kind: 'linear', full: [0.1, 0.1], zero: [0.4, 0.4] } })
const brush = (id = 'b', dabs = 2): MaskComponent => ({ id, op: 'add', invert: false, shape: { kind: 'brush', strokes: [{ size: 0.02, feather: 50, flow: 100, density: 100, erase: false, dabs: Array.from({ length: dabs * 2 }, (_, i) => (i % 97) / 100) }] } })
const lum = (id = 'y', op: MaskComponent['op'] = 'add'): MaskComponent => ({ id, op, invert: false, shape: { kind: 'luminance', range: [40, 60, 100, 100] } })
const colour = (id = 'k', op: MaskComponent['op'] = 'add'): MaskComponent => ({ id, op, invert: false, shape: { kind: 'colour', samples: [[0.6, -0.02, -0.1]], refine: 50 } })
const mask = (components: MaskComponent[], extra: Partial<LocalMask> = {}): LocalMask => ({ id: 'm1', name: 'Mask', invert: false, amount: 100, feather: 0, refine: 0, components, adjust: { exposure: 1 }, ...extra })

describe('stored masks', () => {
  it('leave edits without masks exactly as they were (no key, nothing for the shader)', () => {
    const s = normalizeSettings({ exposure: 0.5 })
    expect('masks' in s).toBe(false)
    expect('masks' in displayUniforms(s)).toBe(false)
    expect('masks' in normalizeSettings({ exposure: 0.5, masks: [] })).toBe(false)
    expect('masks' in normalizeSettings({ exposure: 0.5, masks: 'junk' as never })).toBe(false)
  })

  it('keep a valid mask and pass it to the shader with the process version’s numbers', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, masks: [mask([radial()])] })
    expect(s.masks).toHaveLength(1)
    const u = displayUniforms(s)
    expect(u.masks?.list).toBe(s.masks)
    expect(u.masks?.params.gradientK).toBe(2)
    expect(u.masks?.bands).toHaveLength(9)
  })

  it('ignore damaged parts safely', () => {
    const out = normalizeMasks([
      null,
      'x',
      { components: 'no' },
      mask([{ id: 'z', op: 'bad', invert: 'yes', shape: { kind: 'radial', center: [NaN, 0], rx: 1, ry: 1 } } as never]),
      mask([{ id: 'ok', op: 'weird', invert: false, shape: { kind: 'linear', full: [0.1, 0.2], zero: [0.3, 1e9] } } as never], { amount: 9999, feather: -5, adjust: { exposure: 99, contrast: 'x', shadows: 0, whites: 12.7 } as never }),
    ])
    expect(out).toHaveLength(1)
    const m = out![0]
    expect(m.components[0].op).toBe('add')
    expect((m.components[0].shape as { zero: number[] }).zero[1]).toBe(3)
    expect(m.amount).toBe(200)
    expect(m.feather).toBe(0)
    expect(m.adjust).toEqual({ exposure: 4, whites: 13 })
  })

  it('keep kinds from a newer LightBench without rendering them', () => {
    const m = normalizeMask(mask([radial(), { id: 'd', op: 'intersect', invert: false, shape: { kind: 'hologram', what: 'subject', raster: { width: 2, height: 2, encoding: 'x', data: 'AA' } } } as never]))!
    expect(m.components).toHaveLength(2)
    expect(hasUnknown(m)).toBe(true)
    expect(describeMasks([m])).toContain('newer LightBench')
  })

  it('make ids unique and give default names by type', () => {
    const out = normalizeMasks([mask([radial()]), mask([linear()])])!
    expect(out[0].id).not.toBe(out[1].id)
    const list = [newMask([], radial().shape as never)]
    expect(list[0].name).toBe('Radial 1')
    expect(defaultName(list, 'radial')).toBe('Radial 2')
    expect(defaultName(list, 'colour')).toBe('Colour range 1')
  })

  it('has an effect only with a slider set and Amount above 0', () => {
    expect(hasEffect(mask([radial()]))).toBe(true)
    expect(hasEffect(mask([radial()], { adjust: {} }))).toBe(false)
    expect(hasEffect(mask([radial()], { amount: 0 }))).toBe(false)
  })
})

describe('range masks apply to the whole photo (the design-around, owner’s decision 12)', () => {
  it('lets shapes combine with shapes and ranges with ranges', () => {
    expect(canAdd(mask([radial()]), 'linear')).toBe(true)
    expect(canAdd(mask([radial()]), 'brush')).toBe(true)
    expect(canAdd(mask([lum()]), 'colour')).toBe(true)
    expect(canAdd(mask([]), 'luminance')).toBe(true)
    expect(maskFamily(mask([lum(), colour('c2', 'intersect')]))).toBe('range')
  })

  it('refuses a range with a shape, and a shape with a range, saying why without patent talk', () => {
    expect(canAdd(mask([radial()]), 'luminance')).toBe(false)
    expect(canAdd(mask([brush()]), 'colour')).toBe(false)
    expect(canAdd(mask([lum()]), 'linear')).toBe(false)
    expect(canAdd(mask([colour()]), 'brush')).toBe(false)
    expect(canAdd(mask([radial()]), 'depth')).toBe(false)
    const why = refuseReason(mask([radial()]), 'luminance')!
    expect(why).toMatch(/whole photo/)
    expect(why).not.toMatch(/patent/i)
    expect(refuseReason(mask([radial()]), 'linear')).toBeNull()
  })

  it('drops a range intersected with (or subtracted from) a shape when a stored mask has one', () => {
    const m = normalizeMask(mask([radial(), lum('y', 'intersect'), linear('l', 'subtract'), colour('k', 'subtract')]))!
    expect(m.components.map((c) => c.shape.kind)).toEqual(['radial', 'linear'])
    const r = normalizeMask(mask([lum(), radial('r2')]))!
    expect(r.components.map((c) => c.shape.kind)).toEqual(['luminance'])
  })
})

describe('caps (owner’s decision 9)', () => {
  it('keeps at most 64 masks, 32 parts each and 10,000 dabs per mask', () => {
    expect(normalizeMasks(Array.from({ length: 70 }, (_, i) => mask([radial()], { id: `m${i}` })))).toHaveLength(MAX_MASKS)
    expect(normalizeMask(mask(Array.from({ length: 40 }, (_, i) => linear(`l${i}`))))!.components).toHaveLength(MAX_COMPONENTS)
    const big = normalizeMask(mask([brush('a', 6000), brush('b', 6000)]))!
    expect(dabCount(big)).toBe(MAX_DABS)
  })

  it('says so before a change would break a cap', () => {
    const full = Array.from({ length: MAX_MASKS }, (_, i) => mask([radial()], { id: `m${i}` }))
    expect(capMessage(full, { addMask: true })).toMatch(/at most 64 masks/)
    expect(capMessage(full.slice(1), { addMask: true })).toBeNull()
    const parts = [mask(Array.from({ length: MAX_COMPONENTS }, (_, i) => linear(`l${i}`)))]
    expect(capMessage(parts, { maskId: 'm1', addComponent: true })).toMatch(/at most 32 parts/)
    const painted = [mask([brush('a', 9990)])]
    expect(capMessage(painted, { maskId: 'm1', addDabs: 20 })).toMatch(/10,000 brush dabs/)
    expect(capMessage(painted, { maskId: 'm1', addDabs: 10 })).toBeNull()
  })
})

describe('copy, paste and presets (owner’s decision 7)', () => {
  it('adds pasted masks after the photo’s own, with new ids, up to the cap', () => {
    const own = [mask([radial()], { id: 'own', name: 'Own' })]
    const pasted = [mask([linear()], { id: 'p1', name: 'Sky' }), mask([lum()], { id: 'p2', name: 'Bright' })]
    const out = appendMasks(own, pasted)!
    expect(out.map((m) => m.name)).toEqual(['Own', 'Sky', 'Bright'])
    expect(out[0]).toBe(own[0])
    expect(out[1].id).not.toBe('p1')
    expect(out[1].components[0].id).not.toBe(pasted[0].components[0].id)
    // The copy is independent of the source.
    ;(out[1].components[0].shape as { full: number[] }).full[0] = 0.9
    expect((pasted[0].components[0].shape as { full: number[] }).full[0]).toBe(0.1)
    const near = Array.from({ length: MAX_MASKS - 1 }, (_, i) => mask([radial()], { id: `m${i}` }))
    expect(appendMasks(near, pasted)).toHaveLength(MAX_MASKS)
    expect(appendMasks(undefined, undefined)).toBeUndefined()
  })

  it('leaves masks with brush strokes out of presets, keeping gradients and range masks', () => {
    const list = [mask([radial()], { id: 'a' }), mask([brush()], { id: 'b' }), mask([linear(), brush('b2')], { id: 'c' }), mask([lum()], { id: 'd' })]
    expect(presetMasks(list)!.map((m) => m.id)).toEqual(['a', 'd'])
    expect(presetMasks([mask([brush()])])).toBeUndefined()
  })
})
