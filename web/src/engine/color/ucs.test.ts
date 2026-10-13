import { describe, expect, it } from 'vitest'
import { apply, REC2020_TO_XYZ, SRGB_TO_REC2020 } from './matrix'
import { boundarySaturation, buildGamutLut, D65_XY, gamutMapHsb, hsbToRec2020, lookupHue, LUT_ELEM, lStarToY, rec2020ToHsb, rec2020ToLuv, whiteLStar, xyToUv, yToLStar } from './ucs'

const lw = whiteLStar(1)
const deg = (r: number) => (r * 180) / Math.PI

describe('darktable UCS 22', () => {
  it('puts D65 white at the origin and sRGB red at about 20° (darktable: "sRGB primary red records at 20° of hue")', () => {
    const [u, v] = xyToUv(...D65_XY)
    expect(Math.hypot(u, v)).toBeLessThan(1e-5)
    const red = rec2020ToHsb(apply(SRGB_TO_REC2020, [1, 0, 0]), lw)
    expect(Math.abs(deg(red[0]) - 20)).toBeLessThan(1)
  })

  it('round-trips L* and colours through HSB', () => {
    for (const y of [1e-4, 0.01, 0.18, 1, 4, 30]) expect(lStarToY(yToLStar(y)) / y).toBeCloseTo(1, 10)
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 500; i++) {
      const c = [rnd() * 2, rnd() * 2, rnd() * 2]
      const back = hsbToRec2020(rec2020ToHsb(c, lw), lw)
      back.forEach((v, k) => expect(Math.abs(v - c[k])).toBeLessThan(1e-9 * Math.max(1, c[k])))
    }
  })

  it('builds Rec.2020’s gamut boundary: its primaries and secondaries sit on it (within the 512-entry table’s resolution)', () => {
    const g = buildGamutLut(REC2020_TO_XYZ)
    expect(g.length).toBe(LUT_ELEM)
    expect(Math.min(...g)).toBeGreaterThan(0)
    for (const c of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1]]) {
      const [, u, v] = rec2020ToLuv(c)
      const m2 = u * u + v * v
      expect(Math.abs(lookupHue(g, Math.atan2(v, u)) / m2 - 1)).toBeLessThan(0.06)
    }
    // Inside: a mid grey-ish orange is far from it.
    const hsb = rec2020ToHsb([0.3, 0.2, 0.15], lw)
    expect(hsb[1]).toBeLessThan(0.5 * boundarySaturation(hsb, g, lw))
  })

  it('gamut-maps saturation softly between 80 % and 100 % of the boundary, never past it', () => {
    const g = buildGamutLut()
    for (const h of [-3, -2, -1, 0, 1, 2, 3]) {
      for (const s of [0.05, 0.2, 0.4, 0.8, 2]) {
        const hsb = [h, s, 0.5]
        // darktable's boundary is the one at the pixel's own lightness.
        const bound = boundarySaturation(hsb, g, lw)
        const out = gamutMapHsb(hsb, g, lw)
        expect(out[1]).toBeLessThanOrEqual(bound * (1 + 1e-9))
        if (s <= 0.8 * bound) expect(out[1]).toBe(s)
        expect(out[0]).toBe(h)
        expect(out[2]).toBe(0.5)
      }
    }
  })
})
