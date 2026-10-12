// The colour space of a RAW's embedded camera preview, so Adobe RGB previews aren't shown as sRGB (washed out).
//
// Browsers colour-manage a JPEG only by its ICC profile. Cameras set to Adobe RGB often store their preview JPEG
// without one and say "Adobe RGB" elsewhere: in the JPEG's own EXIF, or only in the RAW around it. Such a preview is
// tagged here with an Adobe RGB ICC profile, and the browser converts it like any tagged JPEG (so the thumbnail
// comes out in sRGB, and a wide-gamut screen gets the full colours).
//
// Ported from LightCraft (MIT/Apache-2.0), crates/raw/src/preview.rs `embedded_preview_color_space` (the RAW's
// signal: Nikon maker note 0x001e, else EXIF ColorSpace 0xFFFF + InteropIndex "R03", never for DNG) and
// crates/codecs/src/jpeg.rs `decode_with_fallback` (the RAW's signal is only a fallback: a JPEG's own ICC or EXIF
// wins). How the JPEG's own EXIF is read follows darktable (src/common/exif.cc, "Some files have the colorspace
// explicitly set": ColorSpace 1 = sRGB, 2 = Adobe RGB, 0xFFFF with InteropIndex R03 = Adobe RGB, R98 = sRGB).

import { ADOBE_RGB_PROFILE, buildIcc, extractJpegIcc } from '../color/icc'
import { readJpegExif } from './exif'

export type PreviewSpace = 'srgb' | 'adobe-rgb'

/** A minimal TIFF reader: IFD entries by tag, with the value's offset. */
function tiffReader(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (v.byteLength < 8) return null
  const order = v.getUint16(0)
  if (order !== 0x4949 && order !== 0x4d4d) return null
  const le0 = order === 0x4949
  if (v.getUint16(2, le0) !== 42) return null
  const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 13: 4 }
  type Entry = { type: number; count: number; at: number }
  /** Entries of the IFD at `off`; out-of-line values are at `base` + their stored offset. */
  const ifd = (off: number, le = le0, base = 0): Map<number, Entry> | null => {
    if (off <= 0 || off + 2 > v.byteLength) return null
    const n = v.getUint16(off, le)
    if (n === 0 || n > 1000 || off + 2 + n * 12 > v.byteLength) return null
    const out = new Map<number, Entry>()
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12
      const type = v.getUint16(e + 2, le)
      const count = v.getUint32(e + 4, le)
      const size = (SIZE[type] ?? 1) * count
      const at = size <= 4 ? e + 8 : base + v.getUint32(e + 8, le)
      if (at + size > v.byteLength) continue
      out.set(v.getUint16(e, le), { type, count, at })
    }
    return out
  }
  const uint = (e: Entry | undefined, le = le0): number | undefined => {
    if (!e) return undefined
    if (e.type === 3) return v.getUint16(e.at, le)
    if (e.type === 4 || e.type === 13) return v.getUint32(e.at, le)
    if (e.type === 1 || e.type === 7) return v.getUint8(e.at)
    return undefined
  }
  const ascii = (e: Entry | undefined) => {
    if (!e) return ''
    let s = ''
    for (let i = 0; i < e.count; i++) {
      const c = v.getUint8(e.at + i)
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    return s
  }
  return { v, le: le0, ifd, uint, ascii, ifd0: () => ifd(v.getUint32(4, le0)) }
}

/** The Nikon maker note's ColorSpace (0x001e: 1 = sRGB, 2 = Adobe RGB), per LightCraft's tiff/src/makernote.rs layouts. */
function nikonColorSpace(t: NonNullable<ReturnType<typeof tiffReader>>, at: number, count: number): number | undefined {
  const { v } = t
  const sig = (o: number, s: string) => [...s].every((c, i) => o + i < v.byteLength && v.getUint8(o + i) === c.charCodeAt(0))
  let note: Map<number, { type: number; count: number; at: number }> | null
  let le = t.le
  if (sig(at, 'Nikon\0')) {
    if (v.getUint8(at + 6) === 1) {
      // Type 1: IFD at +8, offsets relative to the RAW's TIFF header.
      note = t.ifd(at + 8)
    } else {
      // Type 3: its own TIFF header at +10; offsets relative to it.
      const base = at + 10
      if (base + 8 > v.byteLength) return undefined
      const order = v.getUint16(base)
      if (order !== 0x4949 && order !== 0x4d4d) return undefined
      le = order === 0x4949
      note = t.ifd(base + v.getUint32(base + 4, le), le, base)
    }
  } else {
    // No header: a plain IFD.
    note = count >= 2 ? t.ifd(at) : null
  }
  return t.uint(note?.get(0x001e), le)
}

/**
 * The colour space the RAW says its embedded JPEG is in (LightCraft's `embedded_preview_color_space`): the Nikon
 * maker note's ColorSpace; else (not for a DNG, whose previews are rendered by the converter) the RAW's EXIF
 * ColorSpace 1 = sRGB, or 0xFFFF with InteropIndex "R03" = Adobe RGB. Null when it doesn't say, or isn't TIFF-based.
 */
export function embeddedPreviewColorSpace(raw: Uint8Array): PreviewSpace | null {
  const t = tiffReader(raw)
  const ifd0 = t?.ifd0()
  if (!t || !ifd0) return null
  const make = t.ascii(ifd0.get(0x010f)).trim().toUpperCase()
  const exif = t.ifd(t.uint(ifd0.get(0x8769)) ?? 0)
  if (!exif) return null
  if (make.startsWith('NIKON')) {
    const note = exif.get(0x927c)
    const cs = note ? nikonColorSpace(t, note.at, note.count) : undefined
    if (cs === 1) return 'srgb'
    if (cs === 2) return 'adobe-rgb'
  }
  if (ifd0.has(0xc612)) return null
  const cs = t.uint(exif.get(0xa001))
  if (cs === 1) return 'srgb'
  if (cs === 0xffff) {
    const interop = t.ifd(t.uint(exif.get(0xa005)) ?? 0)
    if (t.ascii(interop?.get(0x0001)).startsWith('R03')) return 'adobe-rgb'
  }
  return null
}

/**
 * How a JPEG declares its own colours: 'icc' (the browser applies it), the space its EXIF gives (darktable's
 * reading), or null when it says nothing.
 */
export function jpegOwnSpace(jpeg: Uint8Array): 'icc' | PreviewSpace | null {
  if (extractJpegIcc(jpeg)) return 'icc'
  const exif = readJpegExif(jpeg)
  if (!exif) return null
  if (exif.colorSpace === 2 || (exif.colorSpace === 0xffff && exif.interopIndex.startsWith('R03'))) return 'adobe-rgb'
  return 'srgb'
}

/**
 * Whether an embedded preview needs an Adobe RGB profile: its own ICC or EXIF first, then what the RAW says
 * (`container`, from embeddedPreviewColorSpace), else sRGB.
 */
export function previewIsAdobeRgb(jpeg: Uint8Array, container: PreviewSpace | null): boolean {
  const own = jpegOwnSpace(jpeg)
  return (own ?? container) === 'adobe-rgb'
}

let adobeIcc: Uint8Array | null = null

/** APP2 ICC_PROFILE segment(s) holding LightBench's Adobe RGB (1998) profile (icc.ts buildIcc). */
function adobeSegment(): Uint8Array {
  adobeIcc ??= (() => {
    const icc = buildIcc(ADOBE_RGB_PROFILE)
    const sig = new TextEncoder().encode('ICC_PROFILE\0')
    const len = 2 + sig.length + 2 + icc.length
    const seg = new Uint8Array(2 + len)
    seg.set([0xff, 0xe2, len >> 8, len & 0xff])
    seg.set(sig, 4)
    seg.set([1, 1], 4 + sig.length)
    seg.set(icc, 6 + sig.length)
    return seg
  })()
  return adobeIcc
}

/** The JPEG with an Adobe RGB ICC profile inserted after its start marker (the rest is unchanged). */
export function withAdobeRgbProfile(jpeg: Uint8Array): Uint8Array<ArrayBuffer> {
  const seg = adobeSegment()
  const out = new Uint8Array(jpeg.length + seg.length)
  out.set(jpeg.subarray(0, 2))
  out.set(seg, 2)
  out.set(jpeg.subarray(2), 2 + seg.length)
  return out
}

/**
 * A JPEG file for the browser to show in the Library, read the way Develop reads it (icc.ts chooseInputProfile,
 * darktable's colorin): with no ICC profile, an EXIF InteropIndex "R03" means Adobe RGB, so it is tagged as such.
 * `head` is the start of the file (where its ICC and EXIF are). Otherwise the file itself.
 */
export function jpegFileBlob(file: Blob, head: Uint8Array): Blob {
  if (head.length < 4 || head[0] !== 0xff || head[1] !== 0xd8 || extractJpegIcc(head)) return file
  if (readJpegExif(head)?.interopIndex !== 'R03') return file
  return new Blob([head.subarray(0, 2) as Uint8Array<ArrayBuffer>, adobeSegment() as Uint8Array<ArrayBuffer>, file.slice(2)], { type: 'image/jpeg' })
}

/** An embedded preview ready for the browser: tagged Adobe RGB when it is (see previewIsAdobeRgb), else unchanged. */
export function tagPreview(jpeg: Uint8Array<ArrayBuffer>, container: PreviewSpace | null): Uint8Array<ArrayBuffer> {
  return jpeg.length >= 4 && jpeg[0] === 0xff && jpeg[1] === 0xd8 && previewIsAdobeRgb(jpeg, container) ? withAdobeRgbProfile(jpeg) : jpeg
}
