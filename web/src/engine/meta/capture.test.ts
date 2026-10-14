// Sub-second time, frame counters and focus points from EXIF and maker notes (built here with the export's IFD writer;
// the real test files were checked in the browser, docs/PHASE3.md Part 18).
import { describe, expect, it } from 'vitest'
import { ascii, encodeIfd, type Value } from '../../export/exif-writer'
import { pointBox, readCaptureExtras, subjectAreaBox, subSecMs, uprightBox } from './capture'

/** A little-endian JPEG whose EXIF IFD holds `exif` (and IFD0 `ifd0`); `makerNote(at)` builds the maker note bytes at its file offset. */
function jpeg(exif: [number, Value][], ifd0: [number, Value][] = [], makerNote?: (tiffOffset: number) => Uint8Array): Uint8Array {
  // IFD0 at 8, then the EXIF IFD. Offsets are relative to the TIFF header.
  const ifd0Entries: [number, Value][] = [...ifd0, [0x8769, { type: 4, values: [0] }]]
  const ifd0Len = encodeIfd(ifd0Entries.map(([t, v]) => [t, v]), 8, 0).length
  const exifAt = 8 + ifd0Len
  ifd0Entries[ifd0Entries.length - 1] = [0x8769, { type: 4, values: [exifAt] }]
  let exifEntries = exif
  if (makerNote) {
    // Two passes: the maker note's place depends on the EXIF IFD's size.
    const probe = encodeIfd([...exif, [0x927c, { type: 7, bytes: new Uint8Array(64) }]], exifAt, 0)
    const mnAt = exifAt + probe.length - 64
    exifEntries = [...exif, [0x927c, { type: 7, bytes: makerNote(mnAt) }]]
  }
  const tiff = new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, ...encodeIfd(ifd0Entries, 8, 0), ...encodeIfd(exifEntries, exifAt, 0)])
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const len = app1.length + 2
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...app1, 0xff, 0xd9])
}

describe('sub-second time', () => {
  it('reads the digits after the decimal point', () => {
    expect(subSecMs('45')).toBe(450)
    expect(subSecMs('045')).toBe(45)
    expect(subSecMs('4')).toBe(400)
    expect(subSecMs(' 123456 ')).toBe(123)
    expect(subSecMs('')).toBeNull()
    expect(subSecMs('1.5')).toBeNull()
  })

  it('comes from SubSecTimeOriginal, else SubSecTime', () => {
    expect(readCaptureExtras(jpeg([[0x9291, ascii('25')], [0x9290, ascii('99')]])).subSecMs).toBe(250)
    expect(readCaptureExtras(jpeg([[0x9290, ascii('99')]])).subSecMs).toBe(990)
    expect(readCaptureExtras(jpeg([])).subSecMs).toBeNull()
  })
})

describe('focus regions', () => {
  it('reads EXIF SubjectArea as a point, circle or rectangle in the image size', () => {
    const rect = readCaptureExtras(jpeg([[0x9214, { type: 3, values: [600, 400, 200, 100] }], [0xa002, { type: 4, values: [1200] }], [0xa003, { type: 4, values: [800] }]])).focus!
    expect(rect.from).toBe('subjectarea')
    expect(rect.x).toBeCloseTo(500 / 1200)
    expect(rect.y).toBeCloseTo(350 / 800)
    expect(rect.w).toBeCloseTo(200 / 1200)
    expect(rect.h).toBeCloseTo(100 / 800)
    const circle = subjectAreaBox([300, 300, 60], 1200, 800)!
    for (const [k, v] of Object.entries({ x: 0.225, y: 0.3375, w: 0.05, h: 0.075 })) expect(circle[k as 'x']).toBeCloseTo(v, 6)
    // A point: a box of a tenth of the short side, from the size given when the file has none.
    const pt = readCaptureExtras(jpeg([[0x9214, { type: 3, values: [100, 100] }]]), { w: 1000, h: 500 }).focus!
    expect(pt.x + pt.w / 2).toBeCloseTo(0.1)
    expect(pt.y + pt.h / 2).toBeCloseTo(0.2)
    expect(subjectAreaBox([5000, 10], 1000, 500)).toBeNull()
  })

  it('reads a Sony maker note without a header: FocusLocation (width, height, x, y) and SequenceNumber', () => {
    // Offsets in a Sony maker note count from the file's TIFF header (exiftool; the ILCE-6300 test file).
    const bytes = jpeg([], [[0x010f, ascii('SONY')]], (at) => encodeIfd([[0x2027, { type: 3, values: [6000, 4000, 3525, 1241] }], [0xb04a, { type: 3, values: [3] }]], at, 0))
    const x = readCaptureExtras(bytes)
    expect(x.focus!.from).toBe('sony')
    expect(x.focus!.x + x.focus!.w / 2).toBeCloseTo(3525 / 6000, 4)
    expect(x.focus!.y + x.focus!.h / 2).toBeCloseTo(1241 / 4000, 4)
    expect(x.sequence).toBe(3)
    expect(x.sequenceFrom).toBe('sony-sequence')
  })

  it('reads a Nikon maker note: ShutterCount orders frames', () => {
    const bytes = jpeg([], [[0x010f, ascii('NIKON CORPORATION')]], () => {
      const inner = encodeIfd([[0x00a7, { type: 4, values: [49277] }]], 8, 0)
      return new Uint8Array([...new TextEncoder().encode('Nikon\0'), 2, 0x11, 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, ...inner])
    })
    expect(readCaptureExtras(bytes)).toMatchObject({ sequence: 49277, sequenceFrom: 'nikon-shutter-count' })
  })

  it('reads a Fujifilm maker note: FocusPixel and SequenceNumber', () => {
    const bytes = jpeg([[0xa002, { type: 4, values: [6000] }], [0xa003, { type: 4, values: [4000] }]], [], () => {
      const ifd = encodeIfd([[0x1023, { type: 3, values: [1500, 1000] }], [0x1101, { type: 3, values: [2] }]], 12, 0)
      return new Uint8Array([...new TextEncoder().encode('FUJIFILM'), 12, 0, 0, 0, ...ifd])
    })
    const x = readCaptureExtras(bytes)
    expect(x.focus!.from).toBe('fuji')
    expect(x.focus!.x + x.focus!.w / 2).toBeCloseTo(0.25)
    expect(x.focus!.y + x.focus!.h / 2).toBeCloseTo(0.25)
    expect(x.sequence).toBe(2)
  })

  it('never throws on junk', () => {
    expect(readCaptureExtras(new Uint8Array([1, 2, 3]))).toMatchObject({ subSecMs: null, sequence: null, focus: null })
    expect(readCaptureExtras(new Uint8Array(200))).toMatchObject({ focus: null })
    expect(pointBox(0, 0, 100, 100, 'sony')).toBeNull()
  })

  it('turns a box upright like the previews (LibRaw orientation codes)', () => {
    const b = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }
    const centre = (r: typeof b) => [r.x + r.w / 2, r.y + r.h / 2].map((v) => Math.round(v * 1000) / 1000)
    // (u, v) = (0.25, 0.25) in the stored image.
    expect(centre(uprightBox(b, 0))).toEqual([0.25, 0.25])
    expect(centre(uprightBox(b, 3))).toEqual([0.75, 0.75])
    // 90° clockwise: the left edge goes to the top. (u, v) → (1 − v, u).
    expect(centre(uprightBox(b, 6))).toEqual([0.75, 0.25])
    // 90° anticlockwise: (u, v) → (v, 1 − u).
    expect(centre(uprightBox(b, 5))).toEqual([0.25, 0.75])
    expect(uprightBox(b, 6)).toMatchObject({ w: 0.1, h: 0.3 })
  })
})
