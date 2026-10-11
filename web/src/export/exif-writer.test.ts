import { describe, expect, it } from 'vitest'
import { readJpegExif } from '../engine/meta/exif'
import { buildExif, toRational } from './exif-writer'

/** Wraps a TIFF/EXIF payload in a minimal JPEG APP1 segment so the library's own reader can parse it. */
function asJpeg(tiff: Uint8Array) {
  const len = 2 + 6 + tiff.length
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...new TextEncoder().encode('Exif'), 0, 0, ...tiff, 0xff, 0xda])
}

describe('EXIF writer', () => {
  it('writes fields that the EXIF reader reads back', () => {
    const tiff = buildExif(
      { make: 'NIKON CORPORATION', model: 'NIKON D5200', lens: '18-55mm f/3.5-5.6', iso: 400, shutter: 1 / 250, aperture: 5.6, focalLength: 35, capturedAt: Date.UTC(2026, 9, 11, 14, 30, 5) / 1000 },
      { width: 2048, height: 1365, srgb: true, now: new Date('2026-10-12T08:00:00Z') },
    )
    const e = readJpegExif(asJpeg(tiff))!
    expect(e.make).toBe('NIKON CORPORATION')
    expect(e.model).toBe('NIKON D5200')
    expect(e.lens).toBe('18-55mm f/3.5-5.6')
    expect(e.iso).toBe(400)
    expect(e.shutter).toBeCloseTo(1 / 250, 6)
    expect(e.aperture).toBeCloseTo(5.6, 3)
    expect(e.focalLength).toBe(35)
    expect(e.capturedAt).toBe(Date.UTC(2026, 9, 11, 14, 30, 5) / 1000)
    expect([e.width, e.height]).toEqual([2048, 1365])
    expect(e.orientation).toBe(0) // EXIF orientation 1 = upright
    expect(e.colorSpace).toBe(1)
  })
  it('marks non-sRGB output as uncalibrated, like darktable', () => {
    const e = readJpegExif(asJpeg(buildExif({ make: '', model: '', lens: '', iso: 0, shutter: 0, aperture: 0, focalLength: 0, capturedAt: 0 }, { width: 10, height: 10, srgb: false })))!
    expect(e.colorSpace).toBe(0xffff)
  })
  it('writes short exposures as exact fractions', () => {
    expect(toRational(1 / 200)).toEqual([1, 200])
    expect(toRational(2.5)).toEqual([2500, 1000])
  })
})
