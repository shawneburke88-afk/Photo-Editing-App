import { describe, expect, it } from 'vitest'
import { clipUniforms, DEFAULT_CLIP, rawThresholds } from './indicators'

describe('clipping indicator values (darktable overexposed.c / rawoverexposed.c)', () => {
  it('converts the darktable defaults', () => {
    const u = clipUniforms(DEFAULT_CLIP)
    expect(u.upper).toBeCloseTo(0.9999, 6)
    expect(u.lower).toBeCloseTo(2 ** -12.69, 9)
    expect(u.upperColour).toEqual([1, 0, 0])
    expect(u.lowerColour).toEqual([0, 0, 1])
  })
  it('caps the lower threshold at −4 EV like darktable', () => {
    expect(clipUniforms({ ...DEFAULT_CLIP, lowerEv: -2 }).lower).toBe(2 ** -4)
  })
  it('computes raw thresholds per CFA position: t · (white − black) + black, truncated', () => {
    expect(rawThresholds({ black: [512, 512, 512, 512], white: 15360 }, 1)).toEqual([15360, 15360, 15360, 15360])
    expect(rawThresholds({ black: [600, 0, 0, 600], white: 3880 }, 0.5)).toEqual([2240, 1940, 1940, 2240])
  })
})
