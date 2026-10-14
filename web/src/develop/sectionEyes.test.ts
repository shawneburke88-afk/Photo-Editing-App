import { describe, expect, it } from 'vitest'
import { DEFAULT_GEOMETRY } from '../engine/develop/geometry'
import { defaultsFor, DEFAULT_RGB_SETTINGS, DEFAULT_SETTINGS, displayUniforms, type DevelopSettings } from '../engine/develop/settings'
import { DEFAULT_TRANSFORM } from '../engine/develop/upright'
import { DEFAULT_TONE_CURVE, LINEAR, withToneCurve } from '../engine/develop/tone-curve'
import { DEFAULT_COLOUR_MIXER, withColourMixer, withPoints } from '../engine/develop/colour-mixer'
import { DEFAULT_GRADING, withColourGrading } from '../engine/develop/colour-grading'
import { DEFAULT_DETAIL, RAW_DETAIL, RAW_DETAIL_HIGH_ISO, withDetail } from '../engine/detail/settings'
import { DEFAULT_LENS, LEGACY_LENS } from '../engine/lens/correction'
import { applyEyes, eyeShown, eyeTitle, hiddenNames, hideSections, NO_GROUP_EYES, SECTIONS, wbHidden, withoutBasic, type SectionContext, type SectionId } from './sectionEyes'

const raw: SectionContext = { defaults: defaultsFor('raw', 200), lensApplied: true }
const rawHighIso: SectionContext = { defaults: defaultsFor('raw', 3200), lensApplied: true }
const jpeg: SectionContext = { defaults: defaultsFor('rgb'), lensApplied: false }
const point = { hue: 40, saturation: 0.06, brightness: 0.4, hueShift: 30, satShift: 10, lumShift: 0, variance: 0, range: 50, hueRange: 50, satRange: 50, lumRange: 50 }

/** A photo with every section changed. */
const edited: DevelopSettings = (() => {
  let s: DevelopSettings = {
    ...DEFAULT_SETTINGS,
    geometry: { ...DEFAULT_GEOMETRY, angle: 2, turns: 1, crop: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.8 }, transform: { ...DEFAULT_TRANSFORM, vertical: 20 } },
    lens: DEFAULT_LENS,
    whiteBalance: { mode: 'custom', temperature: 4300, tint: 1.03 },
    exposure: 0.7,
    contrast: 20,
    highlights: -40,
    shadows: 30,
    whites: 5,
    blacks: -12,
    vibrance: 15,
    saturation: -10,
    advanced: { ...DEFAULT_SETTINGS.advanced, baseExposure: 0.9 },
  }
  s = withToneCurve(s, {
    ...DEFAULT_TONE_CURVE,
    regions: { ...DEFAULT_TONE_CURVE.regions, lights: 20, shadows: -10 },
    rgb: [[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]],
    red: [[0, 0], [0.5, 0.55], [1, 1]],
    green: [[0, 0], [0.5, 0.47], [1, 1]],
    blue: [[0, 0], [0.4, 0.43], [1, 1]],
    saturation: 80,
  })
  s = withColourMixer(s, { ...DEFAULT_COLOUR_MIXER, hue: [10, 0, 0, 0, 0, 0, 0, 0], saturation: [0, 30, 0, 0, 0, -20, 0, 0], points: [point], advanced: { guided: true, threshold: 0.2, contrast: 0, whiteLevel: 1, placement: 0 } })
  s = withColourGrading(s, { ...DEFAULT_GRADING, shadows: { hue: 200, sat: 40, lum: 0 }, midtones: { hue: 120, sat: 0, lum: 10 }, highlights: { hue: 40, sat: 30, lum: 0 }, global: { hue: 30, sat: 10, lum: 0 }, blending: 70, balance: -20 })
  s = withDetail(s, { sharpen: { amount: 80, radius: 1.4, detail: 40, masking: 20 }, noise: { ...DEFAULT_DETAIL.noise, luminance: 30, color: 25 } })
  return { ...s, spots: [{ id: 's1', mode: 'remove', points: [[0.3, 0.4]], size: 0.01, feather: 0.5, opacity: 1, offset: [0.05, 0], seed: 1 }] }
})()

const hide = (...ids: SectionId[]) => hideSections(edited, new Set(ids), raw)

/** What each section's own Reset (or, for Lens, turning it off) gives, written out as the panels do it. */
const reset: Record<SectionId, (s: DevelopSettings, c: SectionContext) => DevelopSettings> = {
  'crop.crop': (s) => ({ ...s, geometry: { ...DEFAULT_GEOMETRY, transform: s.geometry.transform } }),
  'crop.transform': (s) => {
    const { transform: _t, ...g } = s.geometry
    void _t
    return { ...s, geometry: g }
  },
  'crop.lens': (s) => ({ ...s, lens: LEGACY_LENS }),
  'basic.wb': (s, c) => ({ ...s, whiteBalance: c.defaults.whiteBalance }),
  'basic.tone': (s) => ({ ...s, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 }),
  'basic.presence': (s) => ({ ...s, vibrance: 0, saturation: 0 }),
  'curve.regions': (s) => withToneCurve(s, { ...s.toneCurve!, regions: DEFAULT_TONE_CURVE.regions }),
  'curve.rgb': (s) => withToneCurve(s, { ...s.toneCurve!, rgb: LINEAR }),
  'curve.red': (s) => withToneCurve(s, { ...s.toneCurve!, red: LINEAR }),
  'curve.green': (s) => withToneCurve(s, { ...s.toneCurve!, green: LINEAR }),
  'curve.blue': (s) => withToneCurve(s, { ...s.toneCurve!, blue: LINEAR }),
  'colour.mixer': (s) => withColourMixer(s, withPoints({ ...DEFAULT_COLOUR_MIXER, advanced: s.colourMixer!.advanced }, s.colourMixer!.points)),
  'colour.points': (s) => withColourMixer(s, withPoints(s.colourMixer, undefined)),
  'grading.shadows': (s) => withColourGrading(s, { ...s.colourGrading!, shadows: { hue: 0, sat: 0, lum: 0 } }),
  'grading.midtones': (s) => withColourGrading(s, { ...s.colourGrading!, midtones: { hue: 0, sat: 0, lum: 0 } }),
  'grading.highlights': (s) => withColourGrading(s, { ...s.colourGrading!, highlights: { hue: 0, sat: 0, lum: 0 } }),
  'grading.global': (s) => withColourGrading(s, { ...s.colourGrading!, global: { hue: 0, sat: 0, lum: 0 } }),
  'detail.sharpen': (s, c) => withDetail(s, { ...s.detail!, sharpen: c.defaults.detail!.sharpen }),
  'detail.noise': (s) => withDetail(s, { ...s.detail!, noise: DEFAULT_DETAIL.noise }),
}

describe('section eyes: each section is set to what its Reset gives', () => {
  for (const d of SECTIONS) {
    it(d.id, () => {
      const out = hide(d.id)
      expect(out).toEqual(reset[d.id](edited, raw))
      // Only that section changed: hiding it twice is the same, and the GPU's uniforms equal the reset photo's.
      expect(hideSections(out, new Set([d.id]), raw)).toEqual(out)
      expect(JSON.stringify(displayUniforms(out))).toBe(JSON.stringify(displayUniforms(reset[d.id](edited, raw))))
      expect(out).not.toEqual(edited)
    })
  }

  it('touches nothing outside the section (Basic: Advanced stays; the curve keeps Refine Saturation)', () => {
    expect(hide('basic.tone').advanced).toEqual(edited.advanced)
    expect(hide('basic.tone').whiteBalance).toEqual(edited.whiteBalance)
    expect(hide('curve.rgb').toneCurve!.saturation).toBe(80)
    expect(hide('curve.rgb').toneCurve!.red).toEqual(edited.toneCurve!.red)
    expect(hide('colour.mixer').colourMixer!.points).toEqual([point])
    expect(hide('colour.points').colourMixer!.hue).toEqual(edited.colourMixer!.hue)
    expect(hide('grading.shadows').colourGrading!.blending).toBe(70)
    expect(hide('crop.crop').geometry.transform).toEqual(edited.geometry.transform)
    expect(hide('crop.transform').geometry.crop).toEqual(edited.geometry.crop)
    expect(hide('detail.sharpen').detail!.noise).toEqual(edited.detail!.noise)
    expect(hide('detail.noise').detail!.sharpen).toEqual(edited.detail!.sharpen)
  })

  it('all of a group\'s sections hidden equal the group at its defaults (curve, mixer, wheels)', () => {
    expect(hide('curve.regions', 'curve.rgb', 'curve.red', 'curve.green', 'curve.blue').toneCurve!.saturation).toBe(80)
    expect(hide('colour.mixer', 'colour.points').colourMixer).toEqual({ ...DEFAULT_COLOUR_MIXER, advanced: edited.colourMixer!.advanced })
    expect(hide('basic.wb', 'basic.tone', 'basic.presence')).toEqual(withoutBasic(edited, raw.defaults))
  })
})

describe('defaults that are not "nothing"', () => {
  it('white balance goes back to As Shot', () => {
    expect(hide('basic.wb').whiteBalance.mode).toBe('as-shot')
    expect(eyeShown('basic.wb', { ...edited, whiteBalance: { mode: 'as-shot', temperature: 4300, tint: 1.03 } }, raw, new Set())).toBe(false)
  })

  it('a RAW\'s sharpening goes back to its default (on: Amount 40, 25 above ISO 1000), a JPEG\'s to off', () => {
    expect(hide('detail.sharpen').detail!.sharpen).toEqual(RAW_DETAIL.sharpen)
    expect(hideSections(edited, new Set(['detail.sharpen']), rawHighIso).detail!.sharpen).toEqual(RAW_DETAIL_HIGH_ISO.sharpen)
    const j = withDetail({ ...DEFAULT_RGB_SETTINGS }, { ...DEFAULT_DETAIL, sharpen: { ...DEFAULT_DETAIL.sharpen, amount: 50 } })
    expect(hideSections(j, new Set(['detail.sharpen']), jpeg).detail).toBeUndefined()
    // A RAW at its default sharpening has no Sharpening eye; an old edit without Detail does (Reset would sharpen it).
    expect(eyeShown('detail.sharpen', defaultsFor('raw', 200), raw, new Set())).toBe(false)
    const old = { ...DEFAULT_SETTINGS }
    delete old.detail
    expect(eyeShown('detail.sharpen', old, raw, new Set())).toBe(true)
    expect(hideSections(old, new Set(['detail.sharpen']), raw).detail!.sharpen.amount).toBe(40)
  })

  it('lens corrections are hidden by turning them off, and their eye shows only when they are applied', () => {
    expect(hide('crop.lens').lens).toEqual(LEGACY_LENS)
    expect(eyeShown('crop.lens', edited, { ...raw, lensApplied: false }, new Set())).toBe(false)
    expect(eyeShown('crop.lens', edited, raw, new Set())).toBe(true)
  })
})

describe('when the eyes show', () => {
  it('no eye on an unedited photo; an eye per changed section', () => {
    const fresh = defaultsFor('raw', 200)
    for (const d of SECTIONS) expect(eyeShown(d.id, fresh, { ...raw, lensApplied: false }, new Set())).toBe(false)
    for (const d of SECTIONS) expect(eyeShown(d.id, edited, raw, new Set())).toBe(true)
  })

  it('a section whose eye is off keeps its eye, even when it is back at its default', () => {
    const fresh = defaultsFor('raw', 200)
    for (const d of SECTIONS) expect(eyeShown(d.id, fresh, raw, new Set([d.id]))).toBe(true)
  })

  it('a grading wheel with a hue but no saturation changes nothing and has no eye', () => {
    const s = withColourGrading(DEFAULT_SETTINGS, { ...DEFAULT_GRADING, shadows: { hue: 120, sat: 0, lum: 0 }, balance: 10 })
    expect(eyeShown('grading.shadows', s, raw, new Set())).toBe(false)
  })

  it('tooltips follow the group eyes\' style', () => {
    expect(eyeTitle('basic.wb', false, false)).toBe('Show the photo without its white balance, As Shot instead (nothing is changed)')
    expect(eyeTitle('curve.red', false, false)).toBe('Show the photo without the Red curve (nothing is changed)')
    expect(eyeTitle('curve.red', true, false)).toBe('Show Red curve again')
    expect(eyeTitle('curve.red', true, true)).toMatch(/whole group is hidden/)
  })
})

describe('group eyes and section eyes together', () => {
  it('without section eyes, the group eyes give exactly what they gave before', () => {
    expect(applyEyes(edited, { ...NO_GROUP_EYES, basic: true }, new Set(), raw)).toEqual(withoutBasic(edited, raw.defaults))
    expect(applyEyes(edited, { ...NO_GROUP_EYES, curve: true }, new Set(), raw).toneCurve).toBeUndefined()
    expect(applyEyes(edited, { ...NO_GROUP_EYES, detail: true }, new Set(), raw).detail).toBeUndefined()
    expect(applyEyes(edited, { ...NO_GROUP_EYES, remove: true }, new Set(), raw).spots).toBeUndefined()
    const crop = applyEyes(edited, { ...NO_GROUP_EYES, crop: true }, new Set(), raw)
    expect(crop.geometry).toEqual(DEFAULT_GEOMETRY)
    expect(crop.lens).toEqual(LEGACY_LENS)
    expect(applyEyes(edited, NO_GROUP_EYES, new Set(), raw)).toBe(edited)
  })

  it('the group eye overrides: the whole group is hidden whatever its sections\' eyes', () => {
    const groupOnly = applyEyes(edited, { ...NO_GROUP_EYES, curve: true }, new Set(), raw)
    const both = applyEyes(edited, { ...NO_GROUP_EYES, curve: true }, new Set(['curve.red']), raw)
    expect(both).toEqual(groupOnly)
    const detailBoth = applyEyes(edited, { ...NO_GROUP_EYES, detail: true }, new Set(['detail.sharpen']), raw)
    expect(detailBoth.detail).toBeUndefined()
  })

  it('section eyes of other groups still apply while a group is hidden', () => {
    const s = applyEyes(edited, { ...NO_GROUP_EYES, curve: true }, new Set(['basic.wb', 'curve.red']), raw)
    expect(s.whiteBalance.mode).toBe('as-shot')
    expect(s.toneCurve).toBeUndefined()
    expect(s.exposure).toBe(0.7)
  })

  it('the badge lists a hidden group by its name, else its hidden sections', () => {
    const groups = (off: Partial<Record<string, boolean>>) =>
      (['crop', 'remove', 'basic', 'curve', 'colour', 'grading', 'detail'] as const).map((id) => ({ id, name: id === 'curve' ? 'Tone Curve' : id, off: !!off[id] }))
    expect(hiddenNames(groups({}), new Set(['curve.red', 'basic.wb']))).toEqual(['White balance', 'Red curve'])
    expect(hiddenNames(groups({ curve: true }), new Set(['curve.red', 'basic.wb']))).toEqual(['White balance', 'Tone Curve'])
    expect(hiddenNames(groups({}), new Set())).toEqual([])
  })

  it('white balance hidden (its eye or Basic\'s) rebuilds the RAW stage with As Shot', () => {
    expect(wbHidden(NO_GROUP_EYES, new Set(['basic.wb']))).toBe(true)
    expect(wbHidden({ ...NO_GROUP_EYES, basic: true }, new Set())).toBe(true)
    expect(wbHidden(NO_GROUP_EYES, new Set(['basic.tone']))).toBe(false)
  })
})
