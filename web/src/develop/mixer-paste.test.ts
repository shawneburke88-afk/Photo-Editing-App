import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type DevelopSettings } from '../engine/develop/settings'
import { newPoint, type ColourMixerSettings } from '../engine/develop/colour-mixer'
import { applyPaste, changedKeys, DEFAULT_PASTE_KEYS, describePaste, PASTE_ITEMS, type Clipboard } from './paste'
import { blendSettings } from './presets'
import { mainBand, tatApply, tatBands, tatDrag, tatLabel, tatStep } from './mixerTat'

const Z = [0, 0, 0, 0, 0, 0, 0, 0]
const point = { ...newPoint([0.3, 0.2, 0.1]), hueShift: 40, satShift: -20 }
const mixed = (m: Partial<ColourMixerSettings>): DevelopSettings => ({ ...DEFAULT_SETTINGS, colourMixer: { hue: Z, saturation: Z, luminance: Z, ...m } })
const clip = (settings: DevelopSettings, keys = DEFAULT_PASTE_KEYS): Clipboard => ({ settings, keys, rerunAuto: false, sourceKind: 'raw', sourceName: 'x' })

describe('Colour in Copy / Paste and presets', () => {
  it('is a Colour group of three items, Colour Mixer, Point Color and Colour Grading, ticked by default like the Tone Curve', () => {
    const items = PASTE_ITEMS.filter((i) => i.group === 'Colour').map((i) => i.key)
    expect(items).toEqual(['colourMixer', 'pointColor', 'colourGrading'])
    expect(DEFAULT_PASTE_KEYS).toContain('colourGrading')
    expect(DEFAULT_PASTE_KEYS).toContain('colourMixer')
    expect(DEFAULT_PASTE_KEYS).toContain('pointColor')
    // After the Tone Curve, before Detail, as the tool stack.
    const groups = [...new Set(PASTE_ITEMS.map((i) => i.group))]
    expect(groups.indexOf('Colour')).toBe(groups.indexOf('Tone Curve') + 1)
    expect(groups.indexOf('Detail')).toBe(groups.indexOf('Colour') + 1)
  })

  it('copies the bands and the points separately, each keeping the target’s other part', () => {
    const src = mixed({ saturation: Z.map((_, i) => (i === 5 ? 40 : 0)), points: [point] })
    const target = mixed({ hue: Z.map((_, i) => (i === 1 ? -20 : 0)), points: [{ ...point, lumShift: 50 }] })
    const bands = applyPaste(target, clip(src, ['colourMixer']), 'raw')
    expect(bands.colourMixer?.saturation[5]).toBe(40)
    expect(bands.colourMixer?.hue[1]).toBe(0)
    expect(bands.colourMixer?.points?.[0].lumShift).toBe(50)
    const pts = applyPaste(target, clip(src, ['pointColor']), 'raw')
    expect(pts.colourMixer?.hue[1]).toBe(-20)
    expect(pts.colourMixer?.points).toEqual([point])
    expect(describePaste(clip(src, ['colourMixer', 'pointColor']), 'raw')).toEqual([
      'Colour Mixer: Saturation Blue +40',
      'Point Color: 1 colour (Hue +40 Sat -20)',
    ])
  })

  it('a photo without a mixer copies “none”, and nothing is left behind (old edits stay as they were)', () => {
    const out = applyPaste(mixed({ saturation: Z.map(() => 10) }), clip({ ...DEFAULT_SETTINGS, exposure: 0.5 }), 'raw')
    expect('colourMixer' in out).toBe(false)
    expect('colourMixer' in applyPaste(DEFAULT_SETTINGS, clip(DEFAULT_SETTINGS), 'raw')).toBe(false)
    expect(changedKeys(DEFAULT_SETTINGS, mixed({ luminance: Z.map((_, i) => (i === 2 ? 5 : 0)) }))).toEqual(['colourMixer'])
    expect(changedKeys(DEFAULT_SETTINGS, mixed({ points: [point] }))).toEqual(['pointColor'])
  })

  it('scales with a preset’s Amount', () => {
    const preset = mixed({ saturation: Z.map((_, i) => (i === 5 ? 60 : 0)), points: [point] })
    const half = blendSettings(DEFAULT_SETTINGS, preset, 0.5)
    expect(half.colourMixer?.saturation[5]).toBe(30)
    expect(half.colourMixer?.points?.[0].hueShift).toBe(20)
    expect(blendSettings(DEFAULT_SETTINGS, preset, 0).colourMixer).toBeUndefined()
    expect(blendSettings(DEFAULT_SETTINGS, preset, 2).colourMixer?.saturation[5]).toBe(100)
  })
})

describe('Colour Mixer targeted adjustment', () => {
  const w = [0, 0.25, 0.75, 0, 0, 0, 0, 0]
  it('moves the bands of the colour under the pointer in proportion, the main one by the full amount', () => {
    expect(tatBands(w)).toEqual([{ index: 1, k: 1 / 3 }, { index: 2, k: 1 }])
    const m = { hue: Z, saturation: Z, luminance: Z }
    const out = tatApply(m, 'saturation', w, 30)
    expect(out.saturation).toEqual([0, 10, 30, 0, 0, 0, 0, 0])
    expect(out.hue).toBe(Z)
    // 200 px up = +100 on the main band; Shift a quarter.
    expect(tatDrag(m, 'luminance', w, -200).luminance[2]).toBe(100)
    expect(tatDrag(m, 'luminance', w, 40, true).luminance[2]).toBe(-5)
    expect(tatStep(m, 'hue', w, true, false).hue[2]).toBe(2)
    expect(tatStep(m, 'hue', w, false, true).hue[2]).toBe(-10)
    // Clamped.
    expect(tatApply({ ...m, saturation: Z.map(() => 95) }, 'saturation', w, 30).saturation[2]).toBe(100)
    expect(tatLabel('saturation', w)).toBe('Colour mixer: Yellow Saturation (targeted)')
    expect(mainBand(w)).toBe(2)
    expect(mainBand(Z)).toBe(-1)
    // A band with less than 5 % of the main one's weight stays.
    expect(tatBands([0.97, 0.03, 0, 0, 0, 0, 0, 0])).toEqual([{ index: 0, k: 1 }])
  })
})

describe('Colour Grading in Copy / Paste and presets', () => {
  const graded = (sat: number): DevelopSettings => ({ ...DEFAULT_SETTINGS, colourGrading: { shadows: { hue: 200, sat, lum: -10 }, midtones: { hue: 0, sat: 0, lum: 0 }, highlights: { hue: 40, sat: 20, lum: 0 }, global: { hue: 0, sat: 0, lum: 0 }, blending: 70, balance: 0 } })
  it('copies the whole grade as one item; a photo without one copies “none”, leaving no key', () => {
    const out = applyPaste(DEFAULT_SETTINGS, clip(graded(30), ['colourGrading']), 'raw')
    expect(out.colourGrading).toEqual(graded(30).colourGrading)
    expect(describePaste(clip(graded(30), ['colourGrading']), 'raw')).toEqual(['Colour Grading: Shadows hue 200°, saturation 30, luminance -10; Highlights hue 40°, saturation 20; Blending 70'])
    const none = applyPaste(graded(30), clip(DEFAULT_SETTINGS), 'raw')
    expect('colourGrading' in none).toBe(false)
    expect(changedKeys(DEFAULT_SETTINGS, graded(5))).toEqual(['colourGrading'])
  })
  it('scales with a preset’s Amount', () => {
    expect(blendSettings(DEFAULT_SETTINGS, graded(40), 0.5).colourGrading?.shadows).toEqual({ hue: 200, sat: 20, lum: -5 })
    expect(blendSettings(DEFAULT_SETTINGS, graded(40), 0).colourGrading).toBeUndefined()
  })
})
