import { describe, expect, it } from 'vitest'
import { ADOBE_RGB_PROFILE, extractJpegIcc, parseIcc } from '../color/icc'
import { embeddedPreviewColorSpace, jpegFileBlob, jpegOwnSpace, previewIsAdobeRgb, tagPreview } from './preview-space'

type Tag = [tag: number, type: number, values: number[] | string]

/** Little-endian TIFF bytes laid out by hand: IFD0, then child IFDs and blobs placed by `build`. */
class Tiff {
  bytes: number[] = []
  constructor() {
    this.bytes.push(0x49, 0x49, 42, 0, 8, 0, 0, 0)
  }
  u16(o: number, v: number) {
    this.bytes[o] = v & 0xff
    this.bytes[o + 1] = v >> 8
  }
  u32(o: number, v: number) {
    for (let i = 0; i < 4; i++) this.bytes[o + i] = (v >>> (8 * i)) & 0xff
  }
  /** Writes an IFD at the end; returns its offset. Values that don't fit in 4 bytes go after it. */
  ifd(tags: Tag[], base = 0): number {
    const at = this.bytes.length
    const n = tags.length
    this.bytes.length = at + 2 + n * 12 + 4
    this.bytes.fill(0, at)
    this.u16(at, n)
    tags.forEach(([tag, type, values], i) => {
      const e = at + 2 + i * 12
      const data: number[] = typeof values === 'string' ? [...values].map((c) => c.charCodeAt(0)).concat(0) : type === 3 ? values.flatMap((v) => [v & 0xff, v >> 8]) : type === 4 ? values.flatMap((v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24]) : values
      this.u16(e, tag)
      this.u16(e + 2, type)
      this.u32(e + 4, typeof values === 'string' ? data.length : values.length)
      if (data.length <= 4) data.forEach((b, j) => (this.bytes[e + 8 + j] = b))
      else {
        const off = this.bytes.length
        this.bytes.push(...data)
        this.u32(e + 8, off - base)
      }
    })
    return at
  }
  /** Points a LONG entry already written (tag in IFD at `ifdAt`) at `value`. */
  patch(ifdAt: number, tag: number, value: number) {
    const n = this.bytes[ifdAt] | (this.bytes[ifdAt + 1] << 8)
    for (let i = 0; i < n; i++) {
      const e = ifdAt + 2 + i * 12
      if ((this.bytes[e] | (this.bytes[e + 1] << 8)) === tag) this.u32(e + 8, value)
    }
  }
  get data() {
    return new Uint8Array(this.bytes)
  }
}

/** A RAW-like TIFF: Make, optional DNGVersion, an Exif IFD with ColorSpace, InteropIndex and a maker note. */
function raw(o: { make: string; colorSpace?: number; interop?: string; dng?: boolean; nikon?: number; nikonType?: 1 | 3 }): Uint8Array {
  const t = new Tiff()
  const ifd0 = t.ifd([[0x010f, 2, o.make], [0x8769, 4, [0]], ...(o.dng ? ([[0xc612, 1, [1, 4, 0, 0]]] as Tag[]) : [])])
  let interopAt = 0
  if (o.interop) interopAt = t.ifd([[0x0001, 2, o.interop]])
  let noteAt = 0
  let noteLen = 0
  if (o.nikon !== undefined) {
    noteAt = t.bytes.length
    if (o.nikonType === 1) {
      t.bytes.push(...[...'Nikon\0'].map((c) => c.charCodeAt(0)), 1, 0)
      t.ifd([[0x001e, 3, [o.nikon]]])
    } else {
      t.bytes.push(...[...'Nikon\0'].map((c) => c.charCodeAt(0)), 2, 0x10, 0, 0)
      const base = t.bytes.length
      t.bytes.push(0x49, 0x49, 42, 0, 8, 0, 0, 0)
      t.ifd([[0x0001, 7, [0, 2, 1, 0]], [0x001e, 3, [o.nikon]]], base)
    }
    noteLen = t.bytes.length - noteAt
  }
  const exifTags: Tag[] = []
  if (o.colorSpace !== undefined) exifTags.push([0xa001, 3, [o.colorSpace]])
  if (interopAt) exifTags.push([0xa005, 4, [interopAt]])
  if (noteAt) exifTags.push([0x927c, 7, [0, 0, 0, 0, 0]])
  const exifAt = t.ifd(exifTags)
  if (noteAt) {
    // The maker note entry: UNDEFINED[noteLen] at noteAt.
    const n = exifTags.length
    for (let i = 0; i < n; i++) {
      const e = exifAt + 2 + i * 12
      if ((t.bytes[e] | (t.bytes[e + 1] << 8)) === 0x927c) {
        t.u32(e + 4, noteLen)
        t.u32(e + 8, noteAt)
      }
    }
  }
  t.patch(ifd0, 0x8769, exifAt)
  return t.data
}

/** A tiny JPEG header: SOI, optional APP segments, then EOI (enough for the marker readers). */
function jpeg(...segments: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const parts = [new Uint8Array([0xff, 0xd8]), ...segments, new Uint8Array([0xff, 0xd9])]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function app(marker: number, payload: Uint8Array): Uint8Array {
  const len = payload.length + 2
  return new Uint8Array([0xff, marker, len >> 8, len & 0xff, ...payload])
}

const exifApp = (tiff: Uint8Array) => app(0xe1, new Uint8Array([...new TextEncoder().encode('Exif\0\0'), ...tiff]))

describe('embedded preview colour space (LightCraft embedded_preview_color_space)', () => {
  it('reads EXIF ColorSpace 0xFFFF + InteropIndex R03 as Adobe RGB (Sony A7 II)', () => {
    expect(embeddedPreviewColorSpace(raw({ make: 'SONY', colorSpace: 0xffff, interop: 'R03' }))).toBe('adobe-rgb')
    expect(embeddedPreviewColorSpace(raw({ make: 'SONY', colorSpace: 1, interop: 'R98' }))).toBe('srgb')
    expect(embeddedPreviewColorSpace(raw({ make: 'SONY', colorSpace: 0xffff, interop: 'R98' }))).toBeNull()
    expect(embeddedPreviewColorSpace(raw({ make: 'SONY' }))).toBeNull()
  })

  it('never for a DNG', () => {
    expect(embeddedPreviewColorSpace(raw({ make: 'SONY', colorSpace: 0xffff, interop: 'R03', dng: true }))).toBeNull()
  })

  it('takes the Nikon maker note 0x001e first (type 3 and type 1 notes)', () => {
    expect(embeddedPreviewColorSpace(raw({ make: 'NIKON CORPORATION', nikon: 2 }))).toBe('adobe-rgb')
    expect(embeddedPreviewColorSpace(raw({ make: 'NIKON CORPORATION', nikon: 1, colorSpace: 0xffff, interop: 'R03' }))).toBe('srgb')
    expect(embeddedPreviewColorSpace(raw({ make: 'NIKON', nikon: 2, nikonType: 1 }))).toBe('adobe-rgb')
    // Only for Nikon: another make's note isn't read as Nikon's.
    expect(embeddedPreviewColorSpace(raw({ make: 'Canon', nikon: 2 }))).toBeNull()
  })

  it('returns null for data that isn’t TIFF', () => {
    expect(embeddedPreviewColorSpace(new Uint8Array([0, 1, 2, 3]))).toBeNull()
    expect(embeddedPreviewColorSpace(new Uint8Array(0))).toBeNull()
  })
})

describe('tagging previews', () => {
  const untagged = jpeg()

  it('tags an untagged preview Adobe RGB only when the RAW says so', () => {
    expect(tagPreview(untagged, null)).toBe(untagged)
    expect(tagPreview(untagged, 'srgb')).toBe(untagged)
    const tagged = tagPreview(untagged, 'adobe-rgb')
    const icc = extractJpegIcc(tagged)!
    const p = parseIcc(icc)!
    expect(p.toXyzD50.map((x) => Math.round(x * 1e4))).toEqual(ADOBE_RGB_PROFILE.toXyzD50.map((x) => Math.round(x * 1e4)))
    expect(p.trc[0]).toEqual({ type: 'gamma', gamma: 563 / 256 })
    // The rest of the JPEG is unchanged.
    expect([...tagged.subarray(tagged.length - 2)]).toEqual([0xff, 0xd9])
  })

  it('leaves a preview with its own ICC profile to the browser', () => {
    const withIcc = jpeg(app(0xe2, new Uint8Array([...new TextEncoder().encode('ICC_PROFILE\0'), 1, 1, 1, 2, 3])))
    expect(jpegOwnSpace(withIcc)).toBe('icc')
    expect(tagPreview(withIcc, 'adobe-rgb')).toBe(withIcc)
  })

  it('lets the preview’s own EXIF win over the RAW', () => {
    const exifSrgb = jpeg(exifApp(raw({ make: 'X', colorSpace: 1 })))
    const exifAdobe = jpeg(exifApp(raw({ make: 'X', colorSpace: 0xffff, interop: 'R03' })))
    expect(jpegOwnSpace(exifSrgb)).toBe('srgb')
    expect(previewIsAdobeRgb(exifSrgb, 'adobe-rgb')).toBe(false)
    expect(jpegOwnSpace(exifAdobe)).toBe('adobe-rgb')
    expect(previewIsAdobeRgb(exifAdobe, null)).toBe(true)
    expect(jpegOwnSpace(untagged)).toBeNull()
  })

  it('reads a JPEG file the way Develop does (R03 without ICC = Adobe RGB)', async () => {
    const adobe = jpeg(exifApp(raw({ make: 'X', colorSpace: 0xffff, interop: 'R03' })))
    const file = new Blob([adobe])
    const out = jpegFileBlob(file, adobe)
    expect(out).not.toBe(file)
    const bytes = new Uint8Array(await out.arrayBuffer())
    expect(parseIcc(extractJpegIcc(bytes)!)?.trc[0]).toEqual({ type: 'gamma', gamma: 563 / 256 })
    const plain = jpeg(exifApp(raw({ make: 'X', colorSpace: 1 })))
    const f2 = new Blob([plain])
    expect(jpegFileBlob(f2, plain)).toBe(f2)
  })
})
