import { describe, expect, it } from 'vitest'
import { BUILT_IN_TARGETS } from '../engine/develop/auto'
import { isWithinImage } from '../engine/develop/crop'
import { DEFAULT_GEOMETRY, rotate90, setAngle, setAspect } from '../engine/develop/geometry'
import { DEFAULT_RGB_SETTINGS, DEFAULT_SETTINGS } from '../engine/develop/settings'
import { DEFAULT_TRANSFORM, ZERO_PERSPECTIVE, type TransformSettings } from '../engine/develop/upright'
import { applyPaste, changedKeys, DEFAULT_PASTE_KEYS, describePaste, type Clipboard } from './paste'

const source = {
  ...DEFAULT_SETTINGS,
  exposure: 0.5,
  contrast: 20,
  vibrance: 10,
  whiteBalance: { mode: 'as-shot' as const, temperature: 5000, tint: 1 },
  advanced: { ...DEFAULT_SETTINGS.advanced, baseExposure: 1.2 },
}
const clip = (p: Partial<Clipboard> = {}): Clipboard => ({
  settings: source, keys: ['exposure', 'whiteBalance', 'baseExposure'], rerunAuto: false, sourceKind: 'raw', sourceName: 'A.NEF', ...p,
})

describe('paste', () => {
  it('replaces only the chosen settings', () => {
    const target = { ...DEFAULT_SETTINGS, exposure: -1, contrast: -30 }
    const out = applyPaste(target, clip(), 'raw')
    expect(out.exposure).toBe(0.5)
    expect(out.contrast).toBe(-30)
    expect(out.advanced.baseExposure).toBe(1.2)
  })

  it('pastes "As Shot" as a mode, so each photo keeps its own white balance', () => {
    const target = { ...DEFAULT_SETTINGS, whiteBalance: { mode: 'custom' as const, temperature: 3000, tint: 1.2 } }
    expect(applyPaste(target, clip(), 'raw').whiteBalance.mode).toBe('as-shot')
  })

  it('skips RAW-only settings on a JPEG and says so', () => {
    const out = applyPaste(DEFAULT_RGB_SETTINGS, clip(), 'rgb')
    expect(out.advanced.baseExposure).toBe(0)
    expect(describePaste(clip(), 'rgb').find((l) => l.startsWith('Base exposure'))).toContain('skipped')
  })

  it('leaves Auto’s sliders to the re-run and lists it first', () => {
    const auto = { target: BUILT_IN_TARGETS[0], sliders: ['exposure' as const], strength: 0.8 }
    const c = clip({ settings: { ...source, auto }, rerunAuto: true })
    expect(applyPaste({ ...DEFAULT_SETTINGS, exposure: -1 }, c, 'raw').exposure).toBe(-1)
    const lines = describePaste(c, 'raw')
    expect(lines[0]).toBe('Auto “Natural” re-run on each photo (80 %, sets Exposure)')
    expect(lines.some((l) => l.startsWith('Exposure'))).toBe(false)
  })

  it('finds which settings changed (for Auto Sync)', () => {
    expect(changedKeys(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, shadows: 12 })).toEqual(['shadows'])
    expect(changedKeys(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, advanced: { ...DEFAULT_SETTINGS.advanced, demosaic: 'bilinear' } })).toEqual(['demosaic'])
  })

  it('leaves the crop alone unless it is ticked', () => {
    expect(DEFAULT_PASTE_KEYS).not.toContain('crop')
    expect(DEFAULT_PASTE_KEYS).not.toContain('straighten')
    expect(DEFAULT_PASTE_KEYS).not.toContain('rotate')
    expect(DEFAULT_PASTE_KEYS).not.toContain('process')
    const cropped = { ...source, geometry: setAspect(DEFAULT_GEOMETRY, '1:1', 600, 400) }
    expect(applyPaste(DEFAULT_SETTINGS, clip({ settings: cropped, keys: DEFAULT_PASTE_KEYS }), 'raw', [600, 400]).geometry).toEqual(DEFAULT_GEOMETRY)
  })

  it('pastes a crop, keeping a locked aspect on a photo of another shape', () => {
    const cropped = { ...source, geometry: setAspect(DEFAULT_GEOMETRY, '1:1', 600, 400) }
    const out = applyPaste(DEFAULT_SETTINGS, clip({ settings: cropped, keys: ['crop'] }), 'raw', [400, 600]).geometry
    const c = out.crop
    expect((c.x1 - c.x0) * 400).toBeCloseTo((c.y1 - c.y0) * 600, 6)
    expect(out.aspect).toBe('1:1')
    expect(describePaste(clip({ settings: cropped, keys: ['crop'] }), 'raw')[0]).toBe('Crop: 67 × 100 % of the photo, 1:1')
  })

  it('pastes rotation, angle and crop in that order, keeping the crop inside the photo', () => {
    const turned = rotate90(setAngle(DEFAULT_GEOMETRY, 10, 600, 400), 1)
    const src = { ...source, geometry: turned }
    const out = applyPaste(DEFAULT_SETTINGS, clip({ settings: src, keys: ['rotate', 'straighten', 'crop'] }), 'raw', [600, 400]).geometry
    expect([out.turns, out.mirror, out.angle]).toEqual([1, false, 10])
    // Turned: the frame is 400 × 600.
    expect(isWithinImage({ rect: out.crop, angle: 10 }, 400, 600)).toBe(true)
    // The angle alone shrinks the target's own crop to fit.
    const angleOnly = applyPaste(DEFAULT_SETTINGS, clip({ settings: src, keys: ['straighten'] }), 'raw', [600, 400]).geometry
    expect(angleOnly.angle).toBe(10)
    expect(isWithinImage({ rect: angleOnly.crop, angle: 10 }, 600, 400)).toBe(true)
    expect(changedKeys(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, geometry: turned })).toEqual(['rotate', 'straighten', 'crop'])
  })
})

describe('paste: Upright and the Transform sliders', () => {
  const withT = (t: Partial<TransformSettings>) => ({
    ...DEFAULT_SETTINGS,
    geometry: { ...DEFAULT_GEOMETRY, transform: { ...DEFAULT_TRANSFORM, ...t } },
  })
  const src = withT({ upright: 'auto', solved: { rotation: 1.2, vertical: 0.3, horizontal: 0, shear: 0 }, vertical: 15, rotate: -2, focal: 50 })
  const c = (keys: Clipboard['keys']): Clipboard => ({ settings: src, keys, rerunAuto: false, sourceKind: 'raw', sourceName: 'A.NEF' })

  it('are unticked by default, like the crop', () => {
    expect(DEFAULT_PASTE_KEYS).not.toContain('upright')
    expect(DEFAULT_PASTE_KEYS).not.toContain('transform')
  })

  it('Auto travels as a mode to detect again (no numbers copied); the checklist says so', () => {
    const out = applyPaste(DEFAULT_SETTINGS, c(['upright']), 'raw')
    expect(out.geometry.transform?.upright).toBe('auto')
    expect(out.geometry.transform?.solved).toEqual(ZERO_PERSPECTIVE)
    expect(out.geometry.transform?.vertical).toBe(0)
    expect(describePaste(c(['upright']), 'raw').join('\n')).toContain('Upright: Auto (detected again on each photo)')
  })

  it('Guided copies its correction as it is', () => {
    const g = { ...src, geometry: { ...src.geometry, transform: { ...src.geometry.transform!, upright: 'guided' as const, guides: [[0.1, 0.1, 0.2, 0.9]] as [number, number, number, number][] } } }
    const out = applyPaste(DEFAULT_SETTINGS, { ...c(['upright']), settings: g }, 'raw')
    expect(out.geometry.transform?.solved).toEqual(src.geometry.transform!.solved)
    expect(out.geometry.transform?.guides).toEqual([])
    expect(out.geometry.transform?.focal).toBe(50)
  })

  it('the Transform sliders are copied as they are, keeping the target’s Upright', () => {
    const target = withT({ upright: 'vertical', solved: { rotation: 0, vertical: -0.1, horizontal: 0, shear: 0 } })
    const out = applyPaste(target, c(['transform']), 'raw')
    expect(out.geometry.transform?.vertical).toBe(15)
    expect(out.geometry.transform?.rotate).toBe(-2)
    expect(out.geometry.transform?.upright).toBe('vertical')
    expect(out.geometry.transform?.solved.vertical).toBe(-0.1)
    expect(describePaste(c(['transform']), 'raw').join('\n')).toContain('Transform sliders: Vertical +15, Rotate -2.0 (copied as they are)')
    // Auto Sync: another change on a photo with Upright Auto doesn't send Upright again; changing the mode does
    expect(changedKeys(src, { ...src, exposure: 1 })).toEqual(['exposure'])
    expect(changedKeys(DEFAULT_SETTINGS, src)).toEqual(expect.arrayContaining(['upright', 'transform']))
    // nothing to copy onto a photo without a transform leaves it without one
    expect(applyPaste(DEFAULT_SETTINGS, { ...c(['transform']), settings: DEFAULT_SETTINGS }, 'raw').geometry.transform).toBeUndefined()
  })
})
