import { describe, expect, it } from 'vitest'
import gradingWgsl from '../gpu/colour-grading.wgsl?raw'
import {
  blendColourGrading,
  boostedGrading,
  CHROMA_AT_100,
  colourGradingGpu,
  DEFAULT_GRADING,
  DEFAULT_GRADING_ADVANCED,
  describeGrading,
  falloffOf,
  gradeImage,
  gradePixel,
  gradeSteps,
  gradingActive,
  GRADING_UNIFORM_SIZE,
  gradingUniform,
  masksAt,
  MIDDLE_GREY,
  normalizeColourGrading,
  resolveGrading,
  WHITE_RG,
  withColourGrading,
  wrapHue,
  yrgHueOf,
  yrgOf,
  type ColourGradingSettings,
  type GradingWheel,
} from './colour-grading'
import { DEFAULT_SETTINGS, displayUniforms, normalizeSettings } from './settings'

const W = (hue: number, sat: number, lum = 0): GradingWheel => ({ hue, sat, lum })
const grade = (p: Partial<ColourGradingSettings>): ColourGradingSettings => ({ ...DEFAULT_GRADING, ...p })
/** A deterministic set of colours: greys, pale and saturated colours, dark and bright, a few outside Rec.2020. */
function samples(n = 400): number[][] {
  let s = 12345
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const out: number[][] = []
  for (let i = 0; i < n; i++) {
    const y = 0.002 * 2 ** (rnd() * 11)
    const k = rnd() < 0.15 ? 0 : rnd() < 0.7 ? 0.3 : 0.9
    out.push([0, 1, 2].map(() => y * (1 + k * (rnd() * 2 - 1))))
  }
  out.push([0.2, -0.01, 0.05], [0.9, 0.1, -0.02])
  return out
}
const close = (a: readonly number[], b: readonly number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol * Math.max(1e-3, Math.abs(b[i])))
const angle = (a: number, b: number) => Math.abs(((((a - b) / Math.PI) * 180 + 540) % 360) - 180)

describe('Colour Grading: neutral is the identity', () => {
  it('a grade at its defaults, or one that tints nothing, is not run at all', () => {
    expect(gradingActive(undefined)).toBe(false)
    expect(gradingActive(DEFAULT_GRADING)).toBe(false)
    // A hue without saturation, Blending and Balance alone, darktable's fulcrums alone: nothing to grade.
    const idle = grade({ shadows: W(200, 0), blending: 90, balance: -40, advanced: { ...DEFAULT_GRADING_ADVANCED, whiteFulcrum: 2, shadowsFalloff: 0.5 } })
    expect(gradingActive(idle)).toBe(false)
    expect(colourGradingGpu(idle)).toBeNull()
    expect(displayUniforms(normalizeSettings({ ...DEFAULT_SETTINGS, colourGrading: idle })).colourGrading).toBeNull()
    expect(gradingActive(grade({ global: W(0, 0, 5) }))).toBe(true)
    expect(gradingActive(grade({ advanced: { ...DEFAULT_GRADING_ADVANCED, contrast: 10 } }))).toBe(true)
  })

  it('darktable’s steps with neutral settings give the colour back (in gamut), and a neutral grade is exactly no change', () => {
    const r = resolveGrading(DEFAULT_GRADING)
    for (const c of samples()) {
      expect(close(gradePixel(c, r), c, 1e-9)).toBe(true)
      if (c.every((v) => v > 0) && Math.max(...c) - Math.min(...c) < 0.3 * Math.max(...c)) expect(close(gradeSteps(c, r, true), c, 1e-9)).toBe(true)
    }
  })

  it('adds only what the grade changes: darktable’s gamut map, negative clipping and saturation limit cancel out', () => {
    // A very saturated colour and one with a negative channel: darktable's module alone would move them.
    const r = resolveGrading(DEFAULT_GRADING)
    const sat: [number, number, number] = [0.9, 0.1, -0.02]
    expect(close(gradeSteps(sat, r, true), sat, 1e-3)).toBe(false)
    expect(close(gradePixel(sat, r), sat, 1e-9)).toBe(true)
    // A tiny change makes a tiny difference.
    const tiny = resolveGrading(grade({ shadows: W(200, 1) }))
    const out = gradePixel(sat, tiny)
    expect(Math.max(...out.map((v, i) => Math.abs(v - sat[i])))).toBeLessThan(0.01)
  })
})

describe('Colour Grading: greys and hues', () => {
  it('greys stay neutral when only the luminance changes (every wheel, Blending and Balance)', () => {
    const g = grade({ shadows: W(120, 0, -70), midtones: W(0, 0, 60), highlights: W(300, 0, 80), global: W(30, 0, -40), blending: 20, balance: 35 })
    const r = resolveGrading(g)
    for (let ev = -8; ev <= 3; ev += 0.5) {
      const y = MIDDLE_GREY * 2 ** ev
      const out = gradePixel([y, y, y], r)
      const m = Math.max(...out)
      expect(m - Math.min(...out)).toBeLessThan(1e-9 * Math.max(1, m))
      expect(m).toBeGreaterThan(0)
    }
    // And they do change brightness: Shadows −70 darkens a dark grey, Highlights +80 brightens a bright one.
    expect(gradePixel([0.01, 0.01, 0.01], resolveGrading(grade({ shadows: W(0, 0, -70) })))[1]).toBeLessThan(0.01)
    expect(gradePixel([1, 1, 1], resolveGrading(grade({ highlights: W(0, 0, 80) })))[1]).toBeGreaterThan(1)
  })

  it('a grey in a wheel’s range takes the wheel’s hue (LightBench’s mapping), for every hue', () => {
    for (const k of ['shadows', 'midtones', 'highlights', 'global'] as const) {
      const y = k === 'shadows' ? 0.004 : k === 'highlights' ? 2 : MIDDLE_GREY
      for (let h = 0; h < 360; h += 15) {
        const out = gradePixel([y, y, y], resolveGrading(grade({ [k]: W(h, 40) })))
        const [, c, a] = yrgOf(out)
        expect(c).toBeGreaterThan(0.005)
        expect(angle(a, yrgHueOf(h))).toBeLessThan(k === 'midtones' ? 0.5 : 3)
      }
    }
    // Midtones at middle grey: the grey becomes the wheel’s colour at its chroma (within what the perceptual steps take off).
    const out = gradePixel([MIDDLE_GREY, MIDDLE_GREY, MIDDLE_GREY], resolveGrading(grade({ midtones: W(40, 100) })))
    expect(Math.abs(yrgOf(out)[1] - CHROMA_AT_100.midtones)).toBeLessThan(0.004)
  })

  it('hues wrap: 360 is 0, negative hues come round, and the Yrg white is the pipeline’s white', () => {
    expect(wrapHue(360)).toBe(0)
    expect(wrapHue(-10)).toBe(350)
    expect(wrapHue(725)).toBe(5)
    expect(normalizeColourGrading(grade({ shadows: W(370, 20) }))?.shadows.hue).toBe(10)
    expect(yrgHueOf(0)).toBeCloseTo(yrgHueOf(360), 12)
    const a = gradePixel([0.05, 0.05, 0.05], resolveGrading(grade({ shadows: W(359, 50) })))
    const b = gradePixel([0.05, 0.05, 0.05], resolveGrading(grade({ shadows: W(1, 50) })))
    expect(angle(yrgOf(a)[2], yrgOf(b)[2])).toBeLessThan(3)
    // darktable's constants are sRGB's D50-adapted white: LightBench's D65 white agrees to 5 · 10⁻⁵.
    expect(Math.abs(WHITE_RG[0] - 0.21902143)).toBeLessThan(5e-5)
    expect(Math.abs(WHITE_RG[1] - 0.54371398)).toBeLessThan(5e-5)
    expect(yrgOf([0.3, 0.3, 0.3])[1]).toBeLessThan(1e-12)
  })

  it('Global is unmasked: Blending and Balance don’t change it (Adobe’s description of Lightroom’s Global)', () => {
    const base = grade({ global: W(30, 60, 30) })
    for (const c of samples(60)) {
      const ref = gradePixel(c, resolveGrading(base))
      for (const p of [{ blending: 0 }, { blending: 100 }, { balance: 100 }, { balance: -100 }]) expect(close(gradePixel(c, resolveGrading({ ...base, ...p })), ref, 1e-12)).toBe(true)
    }
    // An even tint: the same Yrg chroma on a dark and a bright grey.
    const r = resolveGrading(grade({ global: W(200, 50) }))
    const dark = yrgOf(gradePixel([0.01, 0.01, 0.01], r))[1]
    const bright = yrgOf(gradePixel([0.5, 0.5, 0.5], r))[1]
    expect(Math.abs(dark - bright)).toBeLessThan(0.1 * bright)
  })
})

describe('Colour Grading: masks (darktable’s, with Blending and Balance)', () => {
  it('reproduce the brief’s table at the defaults; shadows + highlights = 1, the three sum to 1.5 at middle grey', () => {
    const table: [number, number[]][] = [[-4, [0.94, 0.02, 0.06]], [-1, [0.73, 0.3, 0.27]], [0, [0.5, 0.5, 0.5]], [1, [0.21, 0.21, 0.79]], [2, [0.04, 0.01, 0.96]]]
    for (const [ev, want] of table) {
      const m = masksAt(MIDDLE_GREY * 2 ** ev)
      m.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThan(0.011))
      expect(m[0] + m[2]).toBeCloseTo(1, 12)
    }
    const g = masksAt(MIDDLE_GREY)
    expect(g[0] + g[1] + g[2]).toBeCloseTo(1.5, 6)
  })

  it('Blending widens (100) or narrows (0) the overlap; Balance moves the split', () => {
    expect(falloffOf(50)).toBe(1)
    expect(falloffOf(100)).toBe(0)
    expect(falloffOf(0)).toBe(3)
    const at = (b: number) => masksAt(MIDDLE_GREY * 4, grade({ blending: b }))[0]
    expect(at(100)).toBeGreaterThan(at(50))
    expect(at(50)).toBeGreaterThan(at(0))
    // Balance +100: the split 2 EV lower, so middle grey is mostly "highlights".
    const plus = masksAt(MIDDLE_GREY, grade({ balance: 100 }))
    expect(plus[2]).toBeGreaterThan(0.85)
    expect(masksAt(MIDDLE_GREY * 0.25, grade({ balance: 100 }))[2]).toBeCloseTo(0.5, 6)
    expect(masksAt(MIDDLE_GREY, grade({ balance: -100 }))[0]).toBeGreaterThan(0.85)
    // Advanced fall-offs override Blending's.
    const own = masksAt(MIDDLE_GREY * 4, grade({ blending: 100, advanced: { ...DEFAULT_GRADING_ADVANCED, shadowsFalloff: 3 } }))[0]
    expect(own).toBeCloseTo(masksAt(MIDDLE_GREY * 4, grade({ blending: 0 }))[0], 12)
  })
})

describe('Colour Grading: storing, presets, words', () => {
  it('is absent at its defaults, so an old edit’s JSON stays as it was', () => {
    const old = { ...DEFAULT_SETTINGS, exposure: 0.4 }
    const json = JSON.stringify(normalizeSettings(old))
    expect(JSON.stringify(normalizeSettings({ ...old, colourGrading: DEFAULT_GRADING }))).toBe(json)
    expect('colourGrading' in normalizeSettings({ ...old, colourGrading: { ...DEFAULT_GRADING, advanced: DEFAULT_GRADING_ADVANCED } })).toBe(false)
    const graded = withColourGrading(normalizeSettings(old), grade({ shadows: W(200, 30) }))
    expect(graded.colourGrading?.shadows).toEqual(W(200, 30))
    expect(withColourGrading(graded, graded.colourGrading)).toBe(graded)
    const reset = withColourGrading(graded, undefined)
    expect('colourGrading' in reset).toBe(false)
    expect(JSON.stringify(reset)).toBe(json)
    // A hue chosen with no saturation, Blending or Balance alone are kept (the user set them).
    expect(normalizeColourGrading(grade({ midtones: W(120, 0) }))?.midtones.hue).toBe(120)
    expect(normalizeColourGrading(grade({ blending: 100 }))?.blending).toBe(100)
  })

  it('clamps and rounds what it reads', () => {
    const n = normalizeColourGrading({ shadows: { hue: 12.6, sat: 140, lum: -300 }, blending: 'x', balance: 101.4, advanced: { vibrance: 33.3, chroma: [1, 2], shadowsFalloff: 9 } })!
    expect(n.shadows).toEqual({ hue: 13, sat: 100, lum: -100 })
    expect(n.midtones).toEqual(W(0, 0))
    expect([n.blending, n.balance]).toEqual([50, 100])
    expect(n.advanced?.vibrance).toBe(33)
    expect(n.advanced?.chroma).toEqual([1, 2, 0, 0])
    expect(n.advanced?.shadowsFalloff).toBe(3)
    expect(n.advanced?.highlightsFalloff).toBeUndefined()
    expect(normalizeColourGrading(null)).toBeUndefined()
  })

  it('a preset’s Amount moves each wheel as a colour vector, the sliders linearly', () => {
    const preset = grade({ shadows: W(200, 40, -20), highlights: W(40, 30), blending: 80, balance: 20 })
    const half = blendColourGrading(undefined, preset, 0.5)!
    expect(half.shadows).toEqual(W(200, 20, -10))
    expect([half.blending, half.balance]).toEqual([65, 10])
    expect(blendColourGrading(undefined, preset, 0)).toBeUndefined()
    expect(blendColourGrading(undefined, preset, 2)!.shadows).toEqual(W(200, 80, -40))
    // Between two hues the vector passes through the hue between them, not round the other way.
    const mid = blendColourGrading(grade({ shadows: W(350, 50) }), grade({ shadows: W(10, 50) }), 0.5)!
    expect(mid.shadows.hue).toBe(0)
    expect(mid.shadows.sat).toBe(49)
  })

  it('Alt-drag on Blending shows the range tints at saturation 100 (Global left alone)', () => {
    const b = boostedGrading(grade({ shadows: W(200, 10), midtones: W(0, 0, 20), global: W(30, 15) }))!
    expect(b.shadows.sat).toBe(100)
    expect(b.midtones.sat).toBe(0)
    expect(b.global.sat).toBe(15)
  })

  it('describes itself for the paste checklist', () => {
    expect(describeGrading(undefined)).toBe('none')
    expect(describeGrading(grade({ shadows: W(200, 30), highlights: W(0, 0, 15), blending: 70 }))).toBe('Shadows hue 200°, saturation 30; Highlights luminance +15; Blending 70')
  })
})

describe('Colour Grading on the GPU', () => {
  it('packs the Grade uniform as colour-grading.wgsl lays it out (2480 bytes)', () => {
    const struct = /struct Grade \{([\s\S]*?)\n\}/.exec(gradingWgsl)![1]
    const fields = [...struct.matchAll(/^\s+(\w+): ([\w<>, ]+),/gm)].map((m) => [m[1], m[2]])
    let at = 0
    const offsets: Record<string, number> = {}
    for (const [name, type] of fields) {
      const size = type.startsWith('vec4') ? 16 : type.startsWith('array<vec4f, 128>') ? 16 * 128 : 4
      const align = size >= 16 ? 16 : 4
      at = Math.ceil(at / align) * align
      offsets[name] = at
      at += size
    }
    expect(offsets.white).toBe(60 * 4)
    expect(offsets.hue).toBe(100 * 4)
    expect(offsets.flags).toBe(104 * 4)
    expect(offsets.gamut).toBe(108 * 4)
    expect(at).toBe(GRADING_UNIFORM_SIZE)
    const g = grade({ shadows: W(200, 30) })
    const buf = gradingUniform(resolveGrading(g))
    expect(buf.byteLength).toBe(GRADING_UNIFORM_SIZE)
    const f = new Float32Array(buf)
    expect(new Uint32Array(buf)[104]).toBe(1)
    expect(f[60]).toBeCloseTo(WHITE_RG[0], 6)
    expect(colourGradingGpu(g)?.uniform.byteLength).toBe(GRADING_UNIFORM_SIZE)
  })

  it('the CPU twin of an image is per pixel', () => {
    const g = grade({ highlights: W(40, 50, 20) })
    const img = new Float64Array([0.1, 0.2, 0.3, 0.5, 0.5, 0.5])
    const out = gradeImage(img, g)
    const r = resolveGrading(g)
    expect([...out.slice(3)]).toEqual(gradePixel([0.5, 0.5, 0.5], r))
  })
})
