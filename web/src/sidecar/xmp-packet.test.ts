import { describe, expect, it } from 'vitest'
import { extractJpegXmp } from './xmp-packet'

const enc = new TextEncoder()

function segment(marker: number, payload: Uint8Array): number[] {
  const len = payload.length + 2
  return [0xff, marker, len >> 8, len & 0xff, ...payload]
}

const jpeg = (...segments: number[][]) => new Uint8Array([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0, 2, 0xff, 0xd9])

describe('extractJpegXmp', () => {
  it('finds the XMP packet after an EXIF segment', () => {
    const exif = segment(0xe1, enc.encode('Exif\0\0rest'))
    const xmp = segment(0xe1, enc.encode('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>hi</x:xmpmeta>'))
    expect(extractJpegXmp(jpeg(exif, xmp))).toBe('<x:xmpmeta>hi</x:xmpmeta>')
  })

  it('returns null without an XMP segment or for non-JPEG data', () => {
    expect(extractJpegXmp(jpeg(segment(0xe1, enc.encode('Exif\0\0x'))))).toBeNull()
    expect(extractJpegXmp(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  })
})
