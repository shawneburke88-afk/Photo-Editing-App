import { describe, expect, it } from 'vitest'
import { ADOBE_RGB_PROFILE, buildIcc, chooseInputProfile, evalCurve, extractJpegIcc, parseIcc, profileToRec2020, SRGB_PROFILE } from './icc'
import { SRGB_TO_REC2020 } from './matrix'

describe('ICC profiles', () => {
  it('maps sRGB to Rec.2020 like the pipeline’s own matrix', () => {
    const m = profileToRec2020(SRGB_PROFILE)
    m.forEach((v, i) => expect(v).toBeCloseTo(SRGB_TO_REC2020[i], 3))
  })
  it('evaluates the sRGB curve', () => {
    expect(evalCurve(SRGB_PROFILE.trc[0], 0.5)).toBeCloseTo(0.214, 3)
    expect(evalCurve(SRGB_PROFILE.trc[0], 0.02)).toBeCloseTo(0.02 / 12.92, 6)
    expect(evalCurve(ADOBE_RGB_PROFILE.trc[0], 0.5)).toBeCloseTo(0.5 ** (563 / 256), 6)
  })
  it('round-trips a profile through the writer and parser', () => {
    for (const p of [SRGB_PROFILE, ADOBE_RGB_PROFILE]) {
      const parsed = parseIcc(buildIcc(p))!
      expect(parsed.name).toBe(p.name)
      parsed.toXyzD50.forEach((v, i) => expect(v).toBeCloseTo(p.toXyzD50[i], 4))
      for (const x of [0, 0.01, 0.2, 0.5, 0.9, 1]) expect(evalCurve(parsed.trc[1], x)).toBeCloseTo(evalCurve(p.trc[1], x), 3)
    }
  })
  it('joins ICC chunks from JPEG APP2 segments in order', () => {
    const icc = buildIcc(ADOBE_RGB_PROFILE)
    const half = Math.ceil(icc.length / 2)
    const seg = (seq: number, data: Uint8Array) => {
      const head = new Uint8Array([0xff, 0xe2, 0, 0, ...new TextEncoder().encode('ICC_PROFILE'), 0, seq, 2])
      const len = head.length - 2 + data.length
      head[2] = len >> 8
      head[3] = len & 0xff
      return [...head, ...data]
    }
    // chunks deliberately out of order
    const jpeg = new Uint8Array([0xff, 0xd8, ...seg(2, icc.subarray(half)), ...seg(1, icc.subarray(0, half)), 0xff, 0xda, 0, 2])
    const out = extractJpegIcc(jpeg)!
    expect(out).toEqual(icc)
    expect(chooseInputProfile(out, null).profile.name).toBe('Adobe RGB (1998)')
  })
  it('falls back like darktable: interop R03 → Adobe RGB, otherwise sRGB', () => {
    expect(chooseInputProfile(null, 'R03').profile.name).toBe('Adobe RGB (1998)')
    expect(chooseInputProfile(null, null).profile.name).toBe('sRGB')
    expect(chooseInputProfile(new Uint8Array(10), null).note).toBeTruthy()
  })
})
