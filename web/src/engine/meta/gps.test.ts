import { describe, expect, it } from 'vitest'
import { ascii, encodeIfd } from '../../export/exif-writer'
import { readJpegExif } from './exif'
import { formatGps, gpsFromDms, gpsFromLibRaw } from './gps'

/** A JPEG whose IFD0 points at a GPS IFD with the given entries. */
function jpegWithGps(entries: Parameters<typeof encodeIfd>[0]): Uint8Array {
  const ifd0 = encodeIfd([[0x8825, { type: 4, values: [26] }]], 8, 0)
  const gps = encodeIfd(entries, 26, 0)
  const tiff = new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, ...ifd0, ...gps])
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const len = app1.length + 2
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...app1, 0xff, 0xd9])
}

const SYDNEY: Parameters<typeof encodeIfd>[0] = [
  [0x0001, ascii('S')],
  [0x0002, { type: 5, values: [[33, 1], [51, 1], [3564, 100]] }],
  [0x0003, ascii('E')],
  [0x0004, { type: 5, values: [[151, 1], [12, 1], [4032, 100]] }],
  [0x0005, { type: 7, bytes: new Uint8Array([1]) }],
  [0x0006, { type: 5, values: [[125, 10]] }],
]

describe('GPS', () => {
  it('reads a JPEG’s GPS IFD (the values of LightCraft’s exif.rs test)', () => {
    const g = readJpegExif(jpegWithGps(SYDNEY))!.gps!
    expect(g.lat).toBeCloseTo(-(33 + 51 / 60 + 35.64 / 3600), 9)
    expect(g.lon).toBeCloseTo(151 + 12 / 60 + 40.32 / 3600, 9)
    expect(g.alt).toBeCloseTo(-12.5, 9)
  })

  it('needs both coordinates', () => {
    expect(readJpegExif(jpegWithGps(SYDNEY.slice(0, 2)))!.gps).toBeNull()
    expect(readJpegExif(jpegWithGps([[0x0000, { type: 7, bytes: new Uint8Array([2, 3, 0, 0]) }]]))!.gps).toBeNull()
    expect(gpsFromDms([91, 0, 0], 'N', [0, 0, 0], 'E')).toBeNull()
  })

  it('reads LibRaw’s parsed_gps (reference letters as character codes)', () => {
    const g = gpsFromLibRaw({ latitude: [40, 26, 46.8], longitude: [79, 58, 56.4], altitude: 300, altref: 0, latref: 78, longref: 87, gpsparsed: 1 })!
    expect(g.lat).toBeCloseTo(40.4463333, 6)
    expect(g.lon).toBeCloseTo(-79.9823333, 6)
    expect(g.alt).toBe(300)
    // A GPS IFD holding only its version (philadelphia.nef, a D700 with no GPS unit): LibRaw marks it parsed, all zero.
    expect(gpsFromLibRaw({ latitude: [0, 0, 0], longitude: [0, 0, 0], altitude: 0, altref: 0, latref: 0, longref: 0, gpsparsed: 1 })).toBeNull()
    expect(gpsFromLibRaw({ latitude: [1, 0, 0], longitude: [1, 0, 0], altitude: 0, altref: 0, latref: 78, longref: 69, gpsparsed: 0 })).toBeNull()
  })

  it('formats a position for the Info panel', () => {
    expect(formatGps({ lat: 45.421530, lon: -75.697193, alt: 70.4 })).toBe('45.42153° N, 75.69719° W · 70 m')
    expect(formatGps({ lat: -33.85, lon: 151.2 })).toBe('33.85000° S, 151.20000° E')
  })
})
