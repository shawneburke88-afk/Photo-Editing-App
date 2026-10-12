import { describe, expect, it } from 'vitest'
import { ascii, encodeIfd } from '../../export/exif-writer'
import { parseExifDate, readJpegExif } from './exif'

/** Builds a little-endian JPEG with an EXIF block holding the given IFD0 and EXIF-IFD entries. */
function makeJpeg(): Uint8Array {
  const tiff: number[] = []
  const w16 = (n: number) => tiff.push(n & 0xff, (n >> 8) & 0xff)
  const w32 = (n: number) => tiff.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff)
  // Header: II, 42, IFD0 at 8
  tiff.push(0x49, 0x49); w16(42); w32(8)
  const make = 'NIKON CORPORATION\0'
  const model = 'NIKON D5200\0'
  const date = '2024:06:15 14:30:05\0'
  // IFD0: 4 entries -> 2 + 4*12 + 4 = 54 bytes, data area starts at 8 + 54 = 62
  const ifd0Data = 62
  const makeOff = ifd0Data
  const modelOff = makeOff + make.length
  const exifIfdOff = modelOff + model.length
  w16(4)
  w16(0x010f); w16(2); w32(make.length); w32(makeOff)
  w16(0x0110); w16(2); w32(model.length); w32(modelOff)
  w16(0x0112); w16(3); w32(1); w16(6); w16(0)
  w16(0x8769); w16(4); w32(1); w32(exifIfdOff)
  w32(0)
  for (const c of make + model) tiff.push(c.charCodeAt(0))
  // EXIF IFD: 3 entries -> 2 + 36 + 4 = 42 bytes, then data
  const dateOff = exifIfdOff + 42
  const expOff = dateOff + date.length
  w16(3)
  w16(0x9003); w16(2); w32(date.length); w32(dateOff)
  w16(0x829a); w16(5); w32(1); w32(expOff)
  w16(0x8827); w16(3); w32(1); w16(800); w16(0)
  w32(0)
  for (const c of date) tiff.push(c.charCodeAt(0))
  w32(1); w32(250)

  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const len = app1.length + 2
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...app1, 0xff, 0xd9])
}

describe('readJpegExif', () => {
  it('reads camera, date, orientation and exposure', () => {
    const info = readJpegExif(makeJpeg())!
    expect(info.make).toBe('NIKON CORPORATION')
    expect(info.model).toBe('NIKON D5200')
    expect(info.orientation).toBe(6)
    expect(info.capturedAt).toBe(Date.UTC(2024, 5, 15, 14, 30, 5) / 1000)
    expect(info.shutter).toBeCloseTo(1 / 250)
    expect(info.iso).toBe(800)
  })

  it('returns null for non-JPEG data', () => {
    expect(readJpegExif(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  })

  it('returns null for JPEG without EXIF', () => {
    expect(readJpegExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull()
  })
})

describe('parseExifDate', () => {
  it('parses EXIF date strings as UTC', () => {
    expect(parseExifDate('2026:10:10 08:21:00')).toBe(Date.UTC(2026, 9, 10, 8, 21, 0) / 1000)
  })
  it('rejects blank dates', () => {
    expect(parseExifDate('0000:00:00 00:00:00')).toBe(0)
    expect(parseExifDate('')).toBe(0)
  })
})

describe('readJpegExif artist, copyright and description', () => {
  /** A JPEG whose IFD0 holds the given entries. */
  function jpegWith(entries: Parameters<typeof encodeIfd>[0]): Uint8Array {
    const ifd = encodeIfd(entries, 8, 0)
    const tiff = new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, ...ifd])
    const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
    const len = app1.length + 2
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...app1, 0xff, 0xd9])
  }

  it('reads them from IFD0, trimmed', () => {
    const info = readJpegExif(jpegWith([[0x013b, ascii('Ann Smith ')], [0x8298, ascii('(c) 2024 Ann Smith')], [0x010e, ascii('          ')]]))!
    expect(info.artist).toBe('Ann Smith')
    expect(info.copyright).toBe('(c) 2024 Ann Smith')
    expect(info.description).toBe('')
  })

  it('decodes UTF-8 text', () => {
    const bytes = new TextEncoder().encode('© Zoë\0')
    const info = readJpegExif(jpegWith([[0x8298, { type: 7, bytes }]]))!
    expect(info.copyright).toBe('© Zoë')
  })
})
