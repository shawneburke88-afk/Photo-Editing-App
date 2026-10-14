import { describe, expect, it } from 'vitest'
import mixerWgsl from '../gpu/colour-mixer.wgsl?raw'
import { apply, SRGB_TO_REC2020 } from '../color/matrix'
import { boundarySaturation, hsbToRec2020, LUT_ELEM, rec2020ToHsb, whiteLStar } from '../color/ucs'
import {
  BAND_HSV,
  bandCentres,
  bandWeights,
  blendColourMixer,
  buildTables,
  colourMixerGpu,
  DEFAULT_ADVANCED,
  DEFAULT_COLOUR_MIXER,
  filterPlan,
  guidedCorrections,
  HUE_DEGREES,
  MIXER_UNIFORM_SIZE,
  mixImage,
  mixPixel,
  mixerUniform,
  newPoint,
  normalizeColourMixer,
  resolveMixer,
  withColourMixer,
  type ColourMixerSettings,
} from './colour-mixer'
import { normalizeSettings } from './settings'

const Z = [0, 0, 0, 0, 0, 0, 0, 0]
const mixer = (patch: Partial<ColourMixerSettings>): ColourMixerSettings => ({ hue: Z, saturation: Z, luminance: Z, ...patch })
const one = (i: number, v: number) => Z.map((_, k) => (k === i ? v : 0))
const deg = (r: number) => (((r * 180) / Math.PI) % 360 + 360) % 360
const lw = whiteLStar(1)
let seed = 12345
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

/** darktable's periodic RBF interpolation through 8 nodes 45° apart (colorequal.c `_periodic_RBF_interpolate`). */
function darktableRbf(nodes: number[], smoothing = Math.PI): number[] {
  const h = (k: number) => ((k * 45 + 20) * Math.PI) / 180
  const m = Math.ceil(3 * Math.sqrt(smoothing))
  const kern = (d: number) => Math.exp(Array.from({ length: m }, (_, l) => Math.exp((-l * l) / smoothing) * Math.cos(l * Math.abs(d))).reduce((a, b) => a + b, 0))
  const A = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) => kern(h(i) - h(j))))
  // Gaussian elimination (A is invertible).
  const M = A.map((r, i) => [...r, nodes[i]])
  for (let c = 0; c < 8; c++) {
    let p = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= 8; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = M.map((r, i) => r[8] / r[i])
  return Array.from({ length: LUT_ELEM }, (_, i) => {
    const hue = (i * 2 * Math.PI) / LUT_ELEM - Math.PI
    return x.reduce((s, xk, k) => s + xk * kern(hue - h(k)), 0)
  })
}

describe('Colour Mixer bands', () => {
  it('places the band centres at the UCS hues of LightCraft’s HSV guesses (HSV saturation 50 %)', () => {
    const c = bandCentres().map(deg)
    const expected = [16.7, 54.3, 100.4, 138.1, 195.2, 271.6, 296.7, 331.1]
    c.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThan(0.1))
    expect(BAND_HSV).toEqual([0, 30, 60, 120, 180, 225, 270, 315])
    // Going round the circle from Red, every centre comes after the previous one.
    for (let i = 1; i < 8; i++) expect((c[i] - c[0] + 360) % 360).toBeGreaterThan((c[i - 1] - c[0] + 360) % 360)
    // Node placement turns them all.
    bandCentres(10).map(deg).forEach((v, i) => expect(Math.abs(((v - c[i] + 540) % 360) - 180 - 10)).toBeLessThan(1e-9))
  })

  it('weights every hue by at most two bands, summing to 1 (raised cosine), and a band fully at its own centre', () => {
    const centres = bandCentres()
    for (let i = 0; i < 3600; i++) {
      const w = bandWeights(((i / 3600) * 2 - 1) * Math.PI, centres)
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
      expect(w.filter((x) => x > 0).length).toBeLessThanOrEqual(2)
      w.forEach((x) => expect(x).toBeGreaterThanOrEqual(0))
    }
    centres.forEach((h, k) => expect(bandWeights(h, centres)[k]).toBeCloseTo(1, 12))
  })

  it('never overshoots: one band at ±100 moves only the hues between its neighbours, the same way', () => {
    const centres = bandCentres()
    for (let k = 0; k < 8; k++) {
      for (const v of [100, -100]) {
        for (const ch of ['hue', 'saturation', 'luminance'] as const) {
          const t = buildTables(mixer({ [ch]: one(k, v) }))
          const table = ch === 'hue' ? t.hue : ch === 'saturation' ? t.sat : t.bright
          const neutral = ch === 'hue' ? 0 : 1
          for (let i = 0; i < LUT_ELEM; i++) {
            const h = (i * 2 * Math.PI) / LUT_ELEM - Math.PI
            const d = table[i] - neutral
            // The same direction as the slider, or nothing.
            expect(d * Math.sign(v)).toBeGreaterThanOrEqual(-1e-15)
            // Nothing outside the arc between the two neighbouring centres.
            const prev = centres[(k + 7) % 8]
            const next = centres[(k + 1) % 8]
            const from = (x: number) => ((x - prev) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
            if (from(h) >= from(next)) expect(d).toBe(0)
          }
        }
      }
    }
  })

  it('keeps every table between its band values for any slider settings (500 random mixers)', () => {
    for (let n = 0; n < 500; n++) {
      const r = () => Z.map(() => Math.round(rnd() * 200 - 100))
      const m = mixer({ hue: r(), saturation: r(), luminance: r() })
      const t = buildTables(m)
      const lo = (a: number[]) => Math.min(...a)
      const hi = (a: number[]) => Math.max(...a)
      const k = (HUE_DEGREES * Math.PI) / 180 / 100
      let outside = 0
      for (let i = 0; i < LUT_ELEM; i++) {
        if (t.hue[i] < lo(m.hue) * k - 1e-12 || t.hue[i] > hi(m.hue) * k + 1e-12) outside++
        if (t.sat[i] < 1 + lo(m.saturation) / 200 - 1e-12 || t.sat[i] > 1 + hi(m.saturation) / 200 + 1e-12) outside++
        if (t.bright[i] < 1 + lo(m.luminance) / 100 - 1e-12 || t.bright[i] > 1 + hi(m.luminance) / 100 + 1e-12) outside++
      }
      expect(outside).toBe(0)
    }
  })

  it('darktable’s own RBF interpolation does overshoot (why it was replaced): one node at +1 dips to about −0.14', () => {
    const lut = darktableRbf([1, 0, 0, 0, 0, 0, 0, 0])
    const min = Math.min(...lut)
    expect(min).toBeLessThan(-0.1)
    expect(min).toBeGreaterThan(-0.2)
  })

  it('is continuous across 0°/360° and across the tables’ ends (±180°)', () => {
    const m = mixer({ hue: [80, 0, 0, 0, -60, 0, 0, -100], saturation: [100, 0, 0, 50, -100, 0, 0, -80], luminance: [-100, 0, 0, 70, 100, 0, 0, 90] })
    const r = resolveMixer(m)
    for (const at of [0, Math.PI]) {
      for (const ch of ['hue', 'sat', 'bright'] as const) {
        const f = (h: number) => {
          const t = r.tables[ch]
          const x = (LUT_ELEM * (h + Math.PI)) / (2 * Math.PI)
          const i0 = Math.floor(x) & (LUT_ELEM - 1)
          const i1 = Math.ceil(x) & (LUT_ELEM - 1)
          return t[i0] + (i0 !== i1 ? (x - Math.floor(x)) * (t[i1] - t[i0]) : 0)
        }
        // Both sides of the seam agree (atan2 jumps from π to −π there).
        const a = f(at - 1e-9 > Math.PI ? at - 2 * Math.PI : at - 1e-9)
        const b = f(at + 1e-9 > Math.PI ? at + 1e-9 - 2 * Math.PI : at + 1e-9)
        expect(Math.abs(a - b)).toBeLessThan(1e-6)
      }
      // And per pixel: colours just either side of the seam come out as close as they went in.
      const e = 1e-7
      const c1 = hsbToRec2020([at - e, 0.15, 0.5], lw)
      const c2 = hsbToRec2020([at + e > Math.PI ? at + e - 2 * Math.PI : at + e, 0.15, 0.5], lw)
      const o1 = mixPixel(c1, r)
      const o2 = mixPixel(c2, r)
      o1.forEach((v, i) => expect(Math.abs(v - o2[i])).toBeLessThan(1e-5))
    }
  })
})

describe('Colour Mixer pixels', () => {
  const extreme = mixer({ hue: Z.map(() => 100), saturation: Z.map(() => 100), luminance: Z.map(() => -100) })

  it('leaves greys exactly as they are, whatever the sliders (with and without the guided filter)', () => {
    for (const g of [0, 1e-4, 0.01, 0.18, 1, 8]) {
      for (const m of [extreme, mixer({ luminance: Z.map(() => 100) }), { ...extreme, advanced: { ...DEFAULT_ADVANCED, guided: false } }]) {
        expect(mixPixel([g, g, g], resolveMixer(m))).toEqual([g, g, g])
      }
    }
    // A grey photo through the guided filter, and with a Point Color sample of a colour.
    const w = 12
    const h = 9
    const img = new Float64Array(w * h * 3).map((_, i) => 0.05 + 0.01 * Math.floor(i / 3 / w))
    const pointed = { ...extreme, points: [{ ...newPoint([0.3, 0.1, 0.05]), hueShift: 100, satShift: 100, lumShift: 100, range: 100 }] }
    for (const m of [extreme, pointed]) expect([...mixImage(img, w, h, m, 1)]).toEqual([...img])
    // A Point Color sample of grey selects greys by lightness (LightCraft's design): its Luminance Shift does move them.
    const greyPoint = mixer({ points: [{ ...newPoint([0.06, 0.06, 0.06]), lumShift: 100 }] })
    expect(mixPixel([0.06, 0.06, 0.06], resolveMixer(greyPoint))[0]).toBeGreaterThan(0.06)
  })

  it('changes nearly grey colours only a little: brightness by at most 8 S, saturation at most doubled', () => {
    const r = resolveMixer(extreme)
    for (const s of [0.001, 0.004, 0.01]) {
      const o = rec2020ToHsb(mixPixel(hsbToRec2020([1, s, 0.5], lw), r), lw)
      expect(o[2] / 0.5).toBeGreaterThanOrEqual(1 / (1 + 8 * s) - 1e-9)
      expect(o[2] / 0.5).toBeLessThanOrEqual(1 + 1e-9)
      expect(o[1]).toBeLessThanOrEqual(2 * s + 1e-9)
    }
  })

  it('moves a band’s own colour by the slider scales: Hue +100 = +30°, Saturation −100 = grey, +100 = ×2 S', () => {
    const centres = bandCentres()
    for (let k = 0; k < 8; k++) {
      const c = hsbToRec2020([centres[k], 0.1, 0.5], lw)
      const hue = rec2020ToHsb(mixPixel(c, resolveMixer({ ...mixer({ hue: one(k, 100) }), advanced: { ...DEFAULT_ADVANCED, guided: false } })), lw)
      // At the centre the table's linear interpolation is a hair under the peak (512 entries).
      expect(deg(hue[0] - centres[k])).toBeCloseTo(30, 1)
      const grey = rec2020ToHsb(mixPixel(c, resolveMixer({ ...mixer({ saturation: one(k, -100) }), advanced: { ...DEFAULT_ADVANCED, guided: false } })), lw)
      expect(grey[1]).toBeLessThan(1e-3 * 0.1)
      // Doubled (a colour well inside the gamut, where its map does nothing).
      const pale = hsbToRec2020([centres[k], 0.02, 0.5], lw)
      const sat = rec2020ToHsb(mixPixel(pale, resolveMixer({ ...mixer({ saturation: one(k, 100) }), advanced: { ...DEFAULT_ADVANCED, guided: false } })), lw)
      expect(sat[1]).toBeCloseTo(0.04, 4)
    }
  })

  it('brightens with darktable’s gain and darkens by its reciprocal, so Luminance −100 never reaches black', () => {
    const centres = bandCentres()
    for (let k = 0; k < 8; k++) {
      // Colours inside Rec.2020 (a round trip through RGB keeps them exactly).
      for (const s of [0.01, 0.03, 0.05]) {
        const c = hsbToRec2020([centres[k], s, 0.4], lw)
        const r = (v: number) => resolveMixer({ ...mixer({ luminance: one(k, v) }), advanced: { ...DEFAULT_ADVANCED, guided: false } })
        const up = rec2020ToHsb(mixPixel(c, r(100)), lw)[2]
        const down = rec2020ToHsb(mixPixel(c, r(-100)), lw)[2]
        expect(up / 0.4).toBeCloseTo(1 + 8 * s, 3)
        expect(down / 0.4).toBeCloseTo(1 / (1 + 8 * s), 3)
        expect(down).toBeGreaterThan(0)
      }
    }
  })

  it('keeps more saturated colours inside Rec.2020 and never takes saturation below where it started', () => {
    const r = resolveMixer({ ...mixer({ saturation: Z.map(() => 100) }), advanced: { ...DEFAULT_ADVANCED, guided: false } })
    let worst = 0
    for (let n = 0; n < 2000; n++) {
      const c = [rnd(), rnd(), rnd()].map((v) => v * v)
      const before = rec2020ToHsb(c, lw)
      const o = mixPixel(c, r)
      const after = rec2020ToHsb(o, lw)
      expect(after[1]).toBeGreaterThanOrEqual(before[1] - 1e-9)
      // Inside darktable's boundary, or no further out than it started (Rec.2020's own colours near a primary can sit just
      // past the 512-entry table, which cuts the triangle's corners). darktable's map takes the boundary at the lightness
      // before clipping and clips at constant brightness, so the result can land a little past it: under 8 % here.
      worst = Math.max(worst, after[1] / Math.max(before[1], boundarySaturation(after, r.tables.gamut, lw)))
      // In RGB terms no channel goes far below zero. darktable's map takes the boundary at the lightness before clipping
      // (and its 512-entry table is a few % off near the primaries), so colours at the edge of Rec.2020 itself (here: next
      // to its green primary, past 95 % of the boundary) can end a few % outside.
      expect(Math.min(...o)).toBeGreaterThan(-0.05 * Math.max(...o))
    }
    expect(worst).toBeLessThan(1.08)
  })

  it('applies Point Color around its sample: full shifts at the sample, nothing far away, Variance pulls the range together', () => {
    const sample = apply(SRGB_TO_REC2020, [0.6, 0.35, 0.25])
    const p = newPoint(sample)
    const base = rec2020ToHsb(sample, lw)
    const r = (patch: object) => resolveMixer(mixer({ points: [{ ...p, ...patch }] }))
    const shifted = rec2020ToHsb(mixPixel(sample, r({ hueShift: 100 })), lw)
    expect(deg(shifted[0] - base[0])).toBeCloseTo(30, 6)
    const grey = rec2020ToHsb(mixPixel(sample, r({ satShift: -100 })), lw)
    expect(grey[1]).toBeLessThan(1e-9)
    const lum = rec2020ToHsb(mixPixel(sample, r({ lumShift: 100 })), lw)
    expect(lum[2] / base[2]).toBeCloseTo(Math.SQRT2, 6)
    // A blue far from the sample's orange: untouched.
    const blue = apply(SRGB_TO_REC2020, [0.2, 0.3, 0.7])
    expect(mixPixel(blue, r({ hueShift: 100, satShift: 100, lumShift: 100 }))).toEqual(blue)
    // A neighbouring colour inside the range moves towards the sample with Variance −100.
    const near = hsbToRec2020([base[0] + 0.1, base[1] * 1.1, base[2] * 1.1], lw)
    const pulled = rec2020ToHsb(mixPixel(near, r({ variance: -100 })), lw)
    const nearHsb = rec2020ToHsb(near, lw)
    expect(Math.abs(pulled[0] - base[0])).toBeLessThan(Math.abs(nearHsb[0] - base[0]))
  })
})

describe('Colour Mixer guided filter (CPU twin)', () => {
  it('needs no pixels beyond its margin: a tile’s own pixels don’t change when far pixels do', () => {
    const m = mixer({ hue: [40, -30, 0, 20, 0, 0, 0, 0], saturation: [60, 0, -50, 0, 80, 100, 0, 0], luminance: [-60, 40, 0, -30, 0, -90, 0, 0] })
    const r = resolveMixer(m)
    for (const scale of [0.3, 1, 2]) {
      const pad = filterPlan(scale, r.maxBrightness).pad
      const w = 2 * pad + 14
      const h = 2 * pad + 6
      const img = new Float64Array(w * h * 3).map(() => rnd() * rnd())
      const a = guidedCorrections(img, w, h, r, scale)
      // Change everything at least `pad` away from the middle column.
      const mid = Math.floor(w / 2)
      const img2 = img.map((v, i) => (Math.abs(Math.floor(i / 3) % w - mid) >= pad ? rnd() : v))
      const b = guidedCorrections(img2, w, h, r, scale)
      for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) expect(b[3 * (y * w + mid) + c]).toBe(a[3 * (y * w + mid) + c])
    }
  })

  it('leaves neutral corrections exactly neutral far from the band (no spill from the filter)', () => {
    // Half the picture red (a band moved), half green (no band): the green half away from the edge is untouched.
    const w = 40
    const h = 8
    const red = apply(SRGB_TO_REC2020, [0.5, 0.1, 0.08])
    const green = apply(SRGB_TO_REC2020, [0.15, 0.45, 0.1])
    const img = new Float64Array(w * h * 3)
    for (let i = 0; i < w * h; i++) img.set(i % w < w / 2 ? red : green, 3 * i)
    const m = mixer({ saturation: one(0, 100), luminance: one(0, -100) })
    const out = mixImage(img, w, h, m, 1)
    const pad = filterPlan(1, 1).pad
    for (let y = 0; y < h; y++) for (let x = w / 2 + pad; x < w; x++) for (let c = 0; c < 3; c++) expect(out[3 * (y * w + x) + c]).toBe(img[3 * (y * w + x) + c])
    // The red half changed.
    expect(out[0]).not.toBe(img[0])
  })

  it('plans darktable’s radii: σ 0.75 / 0.5 / 1 px at full size, 0.2 px floors and a 0.5 px saturation blur when small', () => {
    const f = filterPlan(1, 1)
    expect([f.sh, f.sp, f.ss, f.sg]).toEqual([0.75, 0.5, 1, 1])
    expect(f.sb).toBeCloseTo(0.05)
    expect(f.gradAmp).toBe(4)
    const s = filterPlan(0.1, 2)
    expect([s.sh, s.sp, s.ss, s.sg]).toEqual([0.2, 0.2, 0.5, 0.5])
    expect(s.gradAmp).toBeCloseTo(4 * Math.SQRT2 * 0.01)
    expect(filterPlan(5, 1).sh).toBe(1.5)
  })
})

describe('Colour Mixer storage', () => {
  it('is absent at its defaults, so old edits keep their exact JSON', () => {
    expect(normalizeColourMixer(undefined)).toBeUndefined()
    expect(normalizeColourMixer(DEFAULT_COLOUR_MIXER)).toBeUndefined()
    expect(normalizeColourMixer({ hue: Z, saturation: Z, luminance: Z, advanced: DEFAULT_ADVANCED, points: [] })).toBeUndefined()
    const old = { version: 1 as const, process: 2, exposure: 0.5, shadows: 20 }
    const n = normalizeSettings(old, 'raw')
    expect('colourMixer' in n).toBe(false)
    expect(JSON.stringify(normalizeSettings(JSON.parse(JSON.stringify(n)), 'raw'))).toBe(JSON.stringify(n))
    // Reset: the key goes away, and an unchanged mixer gives back the same object.
    const s = withColourMixer(n, mixer({ saturation: one(5, 30) }))
    expect(s.colourMixer?.saturation[5]).toBe(30)
    expect(withColourMixer(s, s.colourMixer)).toBe(s)
    expect('colourMixer' in withColourMixer(s, DEFAULT_COLOUR_MIXER)).toBe(false)
    expect(JSON.stringify(withColourMixer(s, undefined))).toBe(JSON.stringify(n))
  })

  it('keeps darktable settings that differ, picked points, and clamps and rounds values', () => {
    expect(normalizeColourMixer({ hue: Z, saturation: Z, luminance: Z, advanced: { ...DEFAULT_ADVANCED, guided: false } })?.advanced?.guided).toBe(false)
    const p = newPoint([0.3, 0.2, 0.1])
    expect(normalizeColourMixer({ hue: Z, saturation: Z, luminance: Z, points: [p] })?.points).toEqual([p])
    const m = normalizeColourMixer({ hue: [250, -0.4, 3.6, 'x'], saturation: [1], luminance: null })!
    expect(m.hue).toEqual([100, 0, 4, 0, 0, 0, 0, 0])
    expect(m.saturation).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
    expect(m.luminance).toEqual(Z)
    expect(normalizeColourMixer({ hue: Z, saturation: Z, luminance: Z, points: Array.from({ length: 12 }, () => p) })?.points?.length).toBe(8)
  })

  it('blends with a preset’s Amount (0 the photo, 1 the preset, 2 twice its change)', () => {
    const before = mixer({ saturation: one(5, 20) })
    const after = mixer({ saturation: one(5, 60), hue: one(1, -40) })
    expect(blendColourMixer(before, after, 0.5)?.saturation[5]).toBe(40)
    expect(blendColourMixer(before, after, 0.5)?.hue[1]).toBe(-20)
    expect(blendColourMixer(before, after, 2)?.saturation[5]).toBe(100)
    expect(blendColourMixer(undefined, after, 0.5)?.hue[1]).toBe(-20)
    expect(blendColourMixer(before, after, 1)).toBe(after)
    expect(blendColourMixer(before, after, 0)).toBe(before)
    const p = { ...newPoint([0.3, 0.2, 0.1]), hueShift: 60 }
    expect(blendColourMixer(undefined, mixer({ points: [p] }), 0.5)?.points?.[0].hueShift).toBe(30)
  })
})

describe('Colour Mixer on the GPU', () => {
  it('packs the Mixer uniform as colour-mixer.wgsl lays it out (544 bytes)', () => {
    const struct = /struct Mixer \{([\s\S]*?)\n\}/.exec(mixerWgsl)![1]
    const fields = [...struct.matchAll(/^\s+(\w+): ([\w<>, ]+),/gm)].map((m) => [m[1], m[2]])
    let at = 0
    const offsets: Record<string, number> = {}
    for (const [name, type] of fields) {
      const size = type.startsWith('vec4') ? 16 : type.startsWith('array<PointK, 8>') ? 48 * 8 : 4
      const align = size >= 16 ? 16 : 4
      at = Math.ceil(at / align) * align
      offsets[name] = at
      at += size
    }
    expect(offsets.centres0).toBe(24 * 4)
    expect(offsets.lWhite).toBe(32 * 4)
    expect(offsets.flags).toBe(36 * 4)
    expect(offsets.visualize).toBe(38 * 4)
    expect(offsets.points).toBe(40 * 4)
    expect(at).toBe(MIXER_UNIFORM_SIZE)
    const m = mixer({ saturation: one(2, 50), points: [{ ...newPoint([0.3, 0.2, 0.1]), hueShift: 10 }] })
    const u = new Uint32Array(mixerUniform(resolveMixer(m), 3))
    expect(u.length * 4).toBe(MIXER_UNIFORM_SIZE)
    expect(u[36]).toBe(1 | 2 | 4)
    expect(u[37]).toBe(1)
    expect(u[38]).toBe(3)
    expect(colourMixerGpu(undefined)).toBeNull()
    expect(colourMixerGpu(mixer({ advanced: { ...DEFAULT_ADVANCED, guided: false } }))).toBeNull()
    expect(colourMixerGpu(m)?.guided).toBe(true)
  })
})
