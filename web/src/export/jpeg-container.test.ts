import { describe, expect, it } from 'vitest'
import { buildIcc, DISPLAY_P3_PROFILE, extractJpegIcc, parseIcc } from '../engine/color/icc'
import { readJpegExif } from '../engine/meta/exif'
import { buildExif } from './exif-writer'
import { addJpegMetadata } from './jpeg-container'

// SOI, JFIF APP0, an old EXIF APP1 that must be replaced, DQT stub, SOS stub, EOI.
const fakeJpeg = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0,
  0xff, 0xdb, 0, 3, 0,
  0xff, 0xda, 0, 2, 0xff, 0xd9,
])

describe('JPEG metadata', () => {
  it('inserts EXIF, XMP and a chunked ICC profile that readers find', () => {
    const icc = buildIcc(DISPLAY_P3_PROFILE)
    const big = new Uint8Array(140000) // forces ICC chunking
    big.set(icc)
    const exif = buildExif({ make: 'Nikon', model: 'D5200', lens: '', iso: 200, shutter: 0.01, aperture: 8, focalLength: 50, capturedAt: 0 }, { width: 100, height: 50, srgb: false })
    const out = addJpegMetadata(fakeJpeg, { exif, xmp: '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>', icc: big })
    expect([out[0], out[1], out[2], out[3]]).toEqual([0xff, 0xd8, 0xff, 0xe0]) // JFIF stays first
    expect(readJpegExif(out)!.model).toBe('D5200')
    expect(extractJpegIcc(out)!.length).toBe(big.length)
    expect(parseIcc(extractJpegIcc(out)!.subarray(0, icc.length))!.name).toBe('Display P3')
    expect(new TextDecoder('latin1').decode(out)).toContain('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta')
    // the old, empty EXIF segment was replaced, and the scan data is intact
    expect(new TextDecoder('latin1').decode(out).split('Exif\0').length).toBe(2)
    expect([...out.subarray(out.length - 6)]).toEqual([0xff, 0xda, 0, 2, 0xff, 0xd9])
  })
})
