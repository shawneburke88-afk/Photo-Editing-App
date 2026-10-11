import { describe, expect, it } from 'vitest'
import { whiteLevel } from './white-level'

/** A 200×200 RGGB mosaic: mid-grey everywhere, with a blown-out region where each channel clips at its own level. */
function mosaic(clip: { r: number; g: number; b: number }, blown: boolean) {
  const w = 200
  const data = new Uint16Array(w * w).fill(1500)
  if (blown) {
    for (let y = 0; y < 80; y++) {
      for (let x = 0; x < w; x++) {
        const pos = (y & 1) * 2 + (x & 1)
        data[y * w + x] = pos === 0 ? clip.r : pos === 3 ? clip.b : clip.g
      }
    }
  }
  return { data, w }
}

describe('whiteLevel', () => {
  it('drops to the lowest channel clipping point (Nikon D80: green clips before red/blue)', () => {
    const { data, w } = mosaic({ r: 4095, g: 3996, b: 4095 }, true)
    expect(whiteLevel(data, w, 4095, [0, 0, 0, 0])).toBe(3996)
  })
  it('uses the camera linear maximum when reported', () => {
    const { data, w } = mosaic({ r: 4095, g: 3996, b: 4095 }, true)
    expect(whiteLevel(data, w, 4095, [3827, 3827, 3827, 3827])).toBe(3827)
  })
  it('keeps the nominal maximum for an unclipped photo without maker-note data', () => {
    const { data, w } = mosaic({ r: 0, g: 0, b: 0 }, false)
    data[123] = 3100 // a single bright pixel is not a clipping pile-up
    expect(whiteLevel(data, w, 4095, [0, 0, 0, 0])).toBe(4095)
  })
  it('ignores implausibly low linear maximums', () => {
    const { data, w } = mosaic({ r: 0, g: 0, b: 0 }, false)
    expect(whiteLevel(data, w, 16383, [1000, 1000, 1000, 1000])).toBe(16383)
  })
})
