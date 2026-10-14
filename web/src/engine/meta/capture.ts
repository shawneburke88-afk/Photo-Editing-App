// What culling needs to know about how a photo was taken, beyond the catalog's capture time (whole seconds): the
// fraction of a second, the camera's own frame counter (so the frames of a fast burst can be ordered), and where the
// camera focused. Read with LightBench's TIFF reader (exif.ts) from RAW files (TIFF-based, or a RAF's embedded JPEG)
// and from JPEG files' EXIF. Never throws: what can't be read stays null.
//
// Where each piece comes from (tag numbers and layouts as exiftool documents them; checked here only where a test
// file had the tag, see docs/PHASE3.md Part 18):
// - SubSecTimeOriginal 0x9291 (else SubSecTime 0x9290) in the EXIF IFD: the digits after the decimal point.
// - EXIF SubjectArea 0x9214: a point (x, y), a circle (x, y, d) or a rectangle (x, y, w, h) centred on x, y, in the
//   image's pixels (PixelXDimension 0xa002 / PixelYDimension 0xa003, else the size the caller gives).
// - Nikon maker note ("Nikon\0", TIFF header at +10): ShutterCount 0x00a7, a counter that only goes up.
// - Sony maker note ("SONY DSC " / "SONY CAM " header, or none; offsets from the file's TIFF header): FocusLocation
//   0x2027 = (width, height, x, y) of the focus point; SequenceNumber 0xb04a on models that write it.
// - Fujifilm maker note ("FUJIFILM", little-endian, offsets from the maker note): FocusPixel 0x1023 = (x, y);
//   SequenceNumber 0x1101.

import { TiffReader, type TiffEntry } from './exif'

/** A focus region, normalised 0–1 in the stored (not yet turned upright) image. */
export interface FocusRegion {
  x: number
  y: number
  w: number
  h: number
  from: 'subjectarea' | 'sony' | 'fuji' | 'olympus'
}

export interface CaptureExtras {
  /** Milliseconds after `capturedAt`'s second (SubSecTimeOriginal), or null. */
  subSecMs: number | null
  /** The camera's own frame counter, or null. */
  sequence: number | null
  sequenceFrom: 'nikon-shutter-count' | 'fuji-sequence' | 'sony-sequence' | 'libraw-shot-order' | ''
  focus: FocusRegion | null
}

export const NO_EXTRAS: CaptureExtras = { subSecMs: null, sequence: null, sequenceFrom: '', focus: null }

type Ifd = Map<number, TiffEntry>

function ascii(bytes: Uint8Array, at: number, n: number): string {
  let s = ''
  for (let i = 0; i < n && at + i < bytes.length; i++) s += String.fromCharCode(bytes[at + i])
  return s
}

/** "045" → 45 ms; "4" → 400 ms; anything else null. */
export function subSecMs(text: string): number | null {
  const d = text.trim()
  if (!/^\d{1,9}$/.test(d)) return null
  return Math.round(Number(`0.${d}`) * 1000)
}

/** A focus box from SubjectArea's 2, 3 or 4 values in a w × h image (a point gets a box of 1/10 of the short side). */
export function subjectAreaBox(v: number[], w: number, h: number): FocusRegion | null {
  if (!(w > 0 && h > 0) || v.length < 2) return null
  const [x, y] = v
  if (!(x >= 0 && y >= 0 && x <= w && y <= h)) return null
  let bw: number
  let bh: number
  if (v.length >= 4) [bw, bh] = [v[2], v[3]]
  else if (v.length === 3) bw = bh = v[2]
  else bw = bh = Math.min(w, h) / 10
  if (!(bw > 0 && bh > 0)) return null
  return clampBox({ x: (x - bw / 2) / w, y: (y - bh / 2) / h, w: bw / w, h: bh / h, from: 'subjectarea' })
}

/** A point at (x, y) in a w × h image, as a box of 1/10 of the short side. */
export function pointBox(x: number, y: number, w: number, h: number, from: FocusRegion['from']): FocusRegion | null {
  if (!(w > 0 && h > 0 && x > 0 && y > 0 && x < w && y < h)) return null
  const s = Math.min(w, h) / 10
  return clampBox({ x: (x - s / 2) / w, y: (y - s / 2) / h, w: s / w, h: s / h, from })
}

function clampBox(b: FocusRegion): FocusRegion {
  const x0 = Math.max(0, Math.min(1, b.x))
  const y0 = Math.max(0, Math.min(1, b.y))
  const x1 = Math.max(0, Math.min(1, b.x + b.w))
  const y1 = Math.max(0, Math.min(1, b.y + b.h))
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0), from: b.from }
}

/**
 * Turns a box in the stored image upright, for a LibRaw orientation code (0 none, 3 180°, 6 90° clockwise, 5 90°
 * anticlockwise), so it matches the upright previews and thumbnails.
 */
export function uprightBox<T extends { x: number; y: number; w: number; h: number }>(b: T, flip: number): T {
  if (flip === 3) return { ...b, x: 1 - b.x - b.w, y: 1 - b.y - b.h }
  if (flip === 6) return { ...b, x: 1 - b.y - b.h, y: b.x, w: b.h, h: b.w }
  if (flip === 5) return { ...b, x: b.y, y: 1 - b.x - b.w, w: b.h, h: b.w }
  return b
}

/** The position of the TIFF header inside a JPEG's EXIF APP1 segment, or −1. */
export function exifTiffInJpeg(bytes: Uint8Array, at = 0): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (at + 4 > bytes.length || v.getUint16(at) !== 0xffd8) return -1
  let off = at + 2
  while (off + 4 <= bytes.length) {
    const marker = v.getUint16(off)
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return -1
    const len = v.getUint16(off + 2)
    if (marker === 0xffe1 && ascii(bytes, off + 4, 6) === 'Exif\0\0') return off + 10
    off += 2 + len
  }
  return -1
}

/**
 * Reads the extras from a file's bytes: a whole RAW file (TIFF-based, or Fujifilm RAF), or the start of a JPEG (its
 * EXIF block). `size` is the image's size in the stored orientation, for SubjectArea when the file doesn't say.
 */
export function readCaptureExtras(bytes: Uint8Array, size?: { w: number; h: number }): CaptureExtras {
  const out: CaptureExtras = { ...NO_EXTRAS }
  try {
    let tiffAt = -1
    if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) tiffAt = exifTiffInJpeg(bytes)
    else if (ascii(bytes, 0, 8) === 'FUJIFILM' && bytes.length >= 108) {
      // RAF: the EXIF (and the maker note) are in the embedded JPEG, whose offset is at byte 84.
      tiffAt = exifTiffInJpeg(bytes, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(84))
    } else tiffAt = 0
    const opened = tiffAt >= 0 ? TiffReader.open(bytes, tiffAt) : null
    if (!opened) return out
    const t = opened.tiff
    const ifd0 = t.ifd(opened.ifd0)
    const exif = t.ifd(t.number(ifd0.get(0x8769)))
    out.subSecMs = subSecMs(t.text(exif.get(0x9291))) ?? subSecMs(t.text(exif.get(0x9290)))
    const w = t.number(exif.get(0xa002)) || size?.w || 0
    const h = t.number(exif.get(0xa003)) || size?.h || 0
    const area = exif.get(0x9214)
    if (area) out.focus = subjectAreaBox(t.numbers(area, 4), w, h)
    const mn = exif.get(0x927c)
    if (mn) makerNote(bytes, t, mn, w, h, out)
  } catch {
    // A damaged or unusual file: keep what was found.
  }
  return out
}

function makerNote(bytes: Uint8Array, t: TiffReader, mn: TiffEntry, w: number, h: number, out: CaptureExtras) {
  const head = ascii(bytes, mn.at, 12)
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (head.startsWith('Nikon\0')) {
    const n = TiffReader.open(bytes, mn.at + 10)
    if (!n) return
    const count = n.tiff.number(n.tiff.ifd(n.ifd0).get(0x00a7))
    if (count > 0) {
      out.sequence = count
      out.sequenceFrom = 'nikon-shutter-count'
    }
  } else if (head.startsWith('FUJIFILM')) {
    const f = new TiffReader(v, mn.at, true)
    const ifd = f.ifd(f.u32(mn.at + 8))
    const fp = f.numbers(ifd.get(0x1023), 2)
    if (!out.focus && fp.length === 2) out.focus = pointBox(fp[0], fp[1], w, h, 'fuji')
    const seq = ifd.get(0x1101)
    if (seq) {
      out.sequence = f.number(seq)
      out.sequenceFrom = 'fuji-sequence'
    }
  } else if (head.startsWith('SONY DSC ') || head.startsWith('SONY CAM ') || /^sony/i.test(cameraMake(t))) {
    // Recent Sony bodies (the ILCE-6300 test file) write the maker note's IFD with no header.
    const ifdAt = head.startsWith('SONY') ? mn.at + 12 : mn.at
    const ifd: Ifd = t.ifd(ifdAt - t.base)
    const loc = t.numbers(ifd.get(0x2027), 4)
    if (!out.focus && loc.length === 4) out.focus = pointBox(loc[2], loc[3], loc[0], loc[1], 'sony')
    const seq = ifd.get(0xb04a)
    if (seq) {
      out.sequence = t.number(seq)
      out.sequenceFrom = 'sony-sequence'
    }
  }
}

function cameraMake(t: TiffReader): string {
  // IFD0 of the file this reader belongs to.
  try {
    return t.text(t.ifd(t.u32(t.base + 4)).get(0x010f))
  } catch {
    return ''
  }
}
