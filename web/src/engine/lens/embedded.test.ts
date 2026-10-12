import { describe, expect, it } from 'vitest'
import { embeddedSourcePoint, embeddedVignettingGain, embeddedWarp, linearSpline, type EmbeddedData, type EmbeddedOptions } from './embedded'
import { fujiFromTags, olympusFromTags, panasonicFromWords, parseOpcodeList3, sonyFromTags } from './meta'

// The checks below follow darktable's formulas (src/iop/lens.cc `_init_coeffs_md_v2`, `_process_md`). The
// automatic scale divides every correction factor and multiplies every knot by the same number, so
// knot × factor is the scale-free value darktable computes before scaling; the tests check that.

const ALL: EmbeddedOptions = { distortion: true, tca: true, vignetting: true, distortionAmount: 1, vignettingAmount: 1, caAmount: 1 }

// The Sony tags of the ILCE-7M2 test file (`14bit-uncompressed-(3_2).arw`, raw IFD 0x7037, 0x7035, 0x7032).
const SONY_7M2 = {
  d: [16, 9, 1, -10, -22, -39, -57, -77, -95, -112, -124, -130, -127, -115, -90, -52, 2],
  c: [32, 1152, 1280, 1280, 1408, 1280, 1280, 1152, 1024, 768, 640, 512, 384, 256, 128, 0, 0, -1152, -1152, -1024, -896, -768, -640, -512, -384, -128, 0, 128, 384, 512, 640, 768, 640],
  v: [16, 0, 64, 256, 560, 976, 1504, 2128, 2816, 3584, 4400, 5264, 6128, 7008, 7872, 8704, 9536],
}

describe('Sony (darktable CORRECTION_TYPE_SONY)', () => {
  const data = sonyFromTags(SONY_7M2.d, SONY_7M2.c, SONY_7M2.v)!

  it('reads the tags as darktable checks them', () => {
    expect(data).toMatchObject({ type: 'sony' })
    if (data.type !== 'sony') return
    expect(data.distortion).toHaveLength(16)
    expect(data.caR[0]).toBe(1152)
    expect(data.caB[0]).toBe(-1152)
    expect(data.vignetting[15]).toBe(9536)
    // Inconsistent counts are refused.
    expect(sonyFromTags([16, ...SONY_7M2.d.slice(1)], SONY_7M2.c.slice(0, 20), SONY_7M2.v)).toBeNull()
    expect(sonyFromTags([17, ...SONY_7M2.d.slice(1)], SONY_7M2.c, SONY_7M2.v)).toBeNull()
  })

  it('builds darktable’s knots and factors', () => {
    const w = embeddedWarp(data, 6024, 4024, ALL)!
    expect(w.nc).toBe(16)
    for (let i = 0; i < 16; i++) {
      const knot = (i + 0.5) / 15
      const g = SONY_7M2.d[i + 1] * 2 ** -14 + 1
      expect(w.knotsDist[i] * w.cor[1][i]).toBeCloseTo(knot * g, 12)
      expect(w.knotsDist[i] * w.cor[0][i]).toBeCloseTo(knot * g * (SONY_7M2.c[i + 1] * 2 ** -21 + 1), 12)
      expect(w.knotsDist[i] * w.cor[2][i]).toBeCloseTo(knot * g * (SONY_7M2.c[i + 17] * 2 ** -21 + 1), 12)
      expect(w.vig[i]).toBeCloseTo(2 ** (0.5 - 2 ** (SONY_7M2.v[i + 1] * 2 ** -13 - 1)), 12)
    }
    expect(w.done).toEqual({ distortion: true, tca: true, vignetting: true })
  })

  it('scales so the border maps inside the photo (darktable’s 200-radius search)', () => {
    const w = embeddedWarp(data, 6024, 4024, ALL)!
    for (const [x, y] of [[0, 0], [6023, 4023], [3012, 0], [0, 2012]]) {
      for (const c of [0, 1, 2] as const) {
        const [sx, sy] = embeddedSourcePoint(w, x, y, c)
        // darktable's search samples the spline before scaling, so it is approximate: here up to 0.17 px past the
        // edge at the corner (the edge pixel is read there).
        expect(sx).toBeGreaterThanOrEqual(-0.5)
        expect(sy).toBeGreaterThanOrEqual(-0.5)
        expect(sx).toBeLessThanOrEqual(6024 + 0.5)
        expect(sy).toBeLessThanOrEqual(4024 + 0.5)
      }
    }
    // The vignetting gain grows towards the corner (the 7M2's table brightens the corners by about 1.5×).
    expect(embeddedVignettingGain(w, 0, 0)).toBeGreaterThan(1.4)
    expect(embeddedVignettingGain(w, 3012, 2012)).toBeCloseTo(1 / 2 ** (0.5 - 2 ** -1), 6)
  })

  it('amounts are darktable’s fine-tune factors; 0 turns a correction off', () => {
    const half = embeddedWarp(data, 6024, 4024, { ...ALL, distortionAmount: 0.5 })!
    const knot = 3.5 / 15
    expect(half.knotsDist[3] * half.cor[1][3]).toBeCloseTo(knot * (0.5 * SONY_7M2.d[4] * 2 ** -14 + 1), 12)
    const none = embeddedWarp(data, 6024, 4024, { ...ALL, distortionAmount: 0, tca: false })!
    expect(none.done.distortion).toBe(false)
    expect(none.done.tca).toBe(false)
    expect(embeddedWarp(data, 6024, 4024, { ...ALL, distortionAmount: 0, tca: false, vignettingAmount: 0 })).toBeNull()
  })
})

describe('Fujifilm (darktable CORRECTION_TYPE_FUJI; made-up tag values)', () => {
  // X-Trans IV/V layout: [?, 9 knots, 9 values] for distortion and vignetting, [?, 9 knots, 9 red, 9 blue] for CA.
  const knots = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
  const dist = [-0.1, -0.3, -0.6, -1.0, -1.5, -2.1, -2.8, -3.6, -4.5]
  const vig = [99, 97, 94, 90, 85, 80, 74, 68, 62]
  const caR = knots.map((k) => 0.0002 * k)
  const caB = knots.map((k) => -0.0001 * k)
  // The CA tag has 29 values: darktable reads red at 10…18 and blue at 19…27.
  const data = fujiFromTags([0, ...knots, ...dist], [0, ...knots, ...caR, ...caB, 0], [0, ...knots, ...vig], 0)!

  it('reads both tag layouts and checks that the knots agree', () => {
    expect(data).toMatchObject({ type: 'fuji', cropf: 1, knots })
    expect(fujiFromTags([0, ...knots, ...dist], [0, ...knots, ...caR, ...caB, 0], [0, ...knots, ...vig], 2)).toMatchObject({ cropf: 1.25 })
    expect(fujiFromTags([0, ...knots, ...dist], [0, 0.15, ...knots.slice(1), ...caR, ...caB, 0], [0, ...knots, ...vig], 0)).toBeNull()
    // X-Trans I/II/III: 11 knots; the CA data has no knot at 0.
    const k11 = [0, ...knots, 1]
    const old = fujiFromTags([0, ...k11, ...k11.map(() => -1)], [0, ...k11.slice(1), ...k11.slice(1).map(() => 0.0001), ...k11.slice(1).map(() => 0)], [0, ...k11, ...k11.map(() => 90)], 0)
    expect(old).toMatchObject({ type: 'fuji' })
    if (old?.type === 'fuji') expect(old.caR[0]).toBe(0)
  })

  it('turns the source-radius table into one over the corrected radius', () => {
    const w = embeddedWarp(data, 6000, 4000, ALL)!
    expect(w.nc).toBe(16)
    for (let i = 0; i < 16; i++) {
      const rin = i / 15
      // knot = rin / m and green factor = m, so knot × factor = rin (the source radius).
      expect(w.knotsDist[i] * w.cor[1][i]).toBeCloseTo(rin, 12)
      const m = linearSpline([0, ...knots], [1, ...dist.map((d) => d / 100 + 1)], 10, rin)
      expect(w.knotsDist[i] * w.cor[0][i]).toBeCloseTo(rin * (linearSpline([0, ...knots], [0, ...caR], 10, rin) + 1), 12)
      expect(m).toBeGreaterThan(0)
    }
    // Vignetting over the source radius: 1 − (1 − v/100), and 1 at the added centre knot.
    expect(w.knotsVig.slice(0, 10)).toEqual([0, ...knots])
    expect(w.vig.slice(0, 10)).toEqual([1, ...vig.map((v) => 1 - (1 - v / 100))])
  })
})

describe('DNG opcodes (darktable dng_opcode.c, CORRECTION_TYPE_DNG)', () => {
  /** OpcodeList3 with WarpRectilinear (3 planes) and FixVignetteRadial, big-endian as the DNG spec stores it. */
  function opcodes(): Uint8Array {
    const warp = [[1.0, 0.01, -0.002, 0.0003, 0, 0], [1.0002, 0.01, -0.002, 0.0003, 0, 0], [0.9998, 0.01, -0.002, 0.0003, 0, 0]]
    const vig = [-0.3, 0.05, -0.01, 0, 0]
    const wsize = 4 + 8 * 18 + 16
    const vsize = 8 * 7
    const buf = new DataView(new ArrayBuffer(4 + 16 + wsize + 16 + vsize))
    let o = 0
    buf.setUint32(o, 2); o += 4
    buf.setUint32(o, 1); buf.setUint32(o + 4, 0x01030000); buf.setUint32(o + 8, 1); buf.setUint32(o + 12, wsize); o += 16
    buf.setUint32(o, 3); o += 4
    for (const p of warp) for (const v of p) { buf.setFloat64(o, v); o += 8 }
    buf.setFloat64(o, 0.5); buf.setFloat64(o + 8, 0.5); o += 16
    buf.setUint32(o, 3); buf.setUint32(o + 4, 0x01030000); buf.setUint32(o + 8, 1); buf.setUint32(o + 12, vsize); o += 16
    for (const v of [...vig, 0.5, 0.5]) { buf.setFloat64(o, v); o += 8 }
    return new Uint8Array(buf.buffer)
  }

  it('reads WarpRectilinear and FixVignetteRadial', () => {
    const d = parseOpcodeList3(opcodes())!
    expect(d).toMatchObject({ type: 'dng', planes: 3 })
    if (d.type !== 'dng') return
    expect(d.warp![1][0]).toBe(1.0002)
    expect(d.vignette).toEqual([-0.3, 0.05, -0.01, 0, 0])
  })

  it('evaluates the radial polynomial per plane, the vignette as 1 / (1 + Σ k r²ⁿ)', () => {
    const d = parseOpcodeList3(opcodes())! as Extract<EmbeddedData, { type: 'dng' }>
    const w = embeddedWarp(d, 4000, 3000, ALL)!
    for (let i = 0; i < 16; i++) {
      const r = i / 15
      for (let c = 0; c < 3; c++) {
        const k = d.warp![c]
        expect(w.knotsDist[i] * w.cor[c][i]).toBeCloseTo(r * (k[0] + k[1] * r ** 2 + k[2] * r ** 4 + k[3] * r ** 6), 12)
      }
      expect(w.vig[i]).toBeCloseTo(1 / (1 + (-0.3 * r ** 2 + 0.05 * r ** 4 - 0.01 * r ** 6)), 12)
    }
    // LightBench: chromatic aberration off makes all planes follow green.
    const noCa = embeddedWarp(d, 4000, 3000, { ...ALL, tca: false })!
    expect(noCa.cor[0]).toEqual(noCa.cor[1])
    expect(noCa.cor[2]).toEqual(noCa.cor[1])
  })
})

describe('Olympus / OM System (darktable CORRECTION_TYPE_OLYMPUS; made-up values)', () => {
  it('needs a non-zero coefficient', () => {
    expect(olympusFromTags([0, 0, 0, 1], [0, 0, 0, 0, 0, 0])).toBeNull()
    expect(olympusFromTags([0.01, 0, 0, 1], [])).toMatchObject({ type: 'olympus', ca: null })
  })

  it('Rin = Rout·drs·(1 + dk2 (Rout·drs)² + …), CA added on the distorted radius', () => {
    const dist = [-0.05, 0.01, -0.002, 0.98]
    const ca = [0.0002, 0.0001, 0, -0.0001, 0, 0]
    const w = embeddedWarp(olympusFromTags(dist, ca)!, 4000, 3000, ALL)!
    for (let i = 0; i < 16; i++) {
      const r = i / 15
      const rs2 = (r * dist[3]) ** 2
      const g = dist[3] * (1 + rs2 * (dist[0] + rs2 * (dist[1] + rs2 * dist[2])))
      expect(w.knotsDist[i] * w.cor[1][i]).toBeCloseTo(r * g, 12)
      const rd = g * r
      const red = r > 0 ? g + (rd * (ca[0] + rd ** 2 * (ca[1] + rd ** 2 * ca[2]))) / r : g
      expect(w.knotsDist[i] * w.cor[0][i]).toBeCloseTo(r * red, 12)
    }
  })
})

describe('Panasonic (darktable CORRECTION_TYPE_PANASONIC; made-up values)', () => {
  it('reads DistortionInfo words only when enabled', () => {
    const words = new Array(16).fill(0)
    words[5] = 1000
    words[8] = -2000
    words[4] = 300
    words[11] = -50
    expect(panasonicFromWords(words)).toBeNull()
    words[7] = 0x21
    expect(panasonicFromWords(words)).toEqual({ type: 'panasonic', scale: 1 / (1 + 1000 / 32768), a: -2000 / 32768, b: 300 / 32768, c: -50 / 32768 })
  })

  it('inverts Ru = Rd + scale·(a·Rd³ + b·Rd⁵ + c·Rd⁷) with two fixed-point steps', () => {
    const p = { type: 'panasonic' as const, scale: 0.97, a: -0.06, b: 0.01, c: -0.002 }
    const w = embeddedWarp(p, 4000, 3000, ALL)!
    for (let i = 1; i < 16; i++) {
      const r = i / 15
      const rd = w.knotsDist[i] * w.cor[1][i]
      // Two iterations get close to the root (darktable's comment: about 1000× less error than none).
      const ru = rd + p.scale * (p.a * rd ** 3 + p.b * rd ** 5 + p.c * rd ** 7)
      const none = r + p.scale * (p.a * r ** 3 + p.b * r ** 5 + p.c * r ** 7)
      expect(Math.abs(ru - r)).toBeLessThan(1e-3)
      expect(Math.abs(ru - r)).toBeLessThan(Math.abs(none - r) / 20)
    }
  })
})
