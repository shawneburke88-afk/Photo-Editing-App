// Minimal EXIF reader for JPEG files: just the fields the library needs.

export interface ExifInfo {
  make: string
  model: string
  lens: string
  /** LibRaw-style orientation code: 0, 3 (180°), 5 (90° CCW), 6 (90° CW). */
  orientation: number
  /** "YYYY:MM:DD HH:MM:SS" camera-local time as Unix seconds read in UTC (0 if missing). */
  capturedAt: number
  iso: number
  shutter: number
  aperture: number
  focalLength: number
  /** FocalLengthIn35mmFilm (0xA405), 0 if absent. */
  focal35?: number
  width: number
  height: number
  /** EXIF interoperability index, e.g. "R98" (sRGB) or "R03" (Adobe RGB); '' if absent. */
  interopIndex: string
  /** EXIF ColorSpace tag: 1 = sRGB, 0xFFFF = uncalibrated, 0 = absent. */
  colorSpace: number
  /** IFD0 Artist, Copyright and ImageDescription ('' if absent), which darktable takes as creator, rights and description. */
  artist: string
  copyright: string
  description: string
}

const EXIF_TO_FLIP: Record<number, number> = { 1: 0, 3: 3, 6: 6, 8: 5 }

export function parseExifDate(s: string): number {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim())
  if (!m) return 0
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number)
  if (y < 1900) return 0
  return Date.UTC(y, mo - 1, d, h, mi, se) / 1000
}

/** Parses EXIF from the start of a JPEG file. Returns null when the data has no EXIF block. */
export function readJpegExif(bytes: Uint8Array): ExifInfo | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null
  let off = 2
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off)
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null
    const len = v.getUint16(off + 2)
    if (marker === 0xffe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966 /* "Exif" */) {
      return readTiff(v, off + 10, Math.min(v.byteLength, off + 2 + len))
    }
    off += 2 + len
  }
  return null
}

function readTiff(v: DataView, base: number, end: number): ExifInfo | null {
  if (base + 8 > end) return null
  const le = v.getUint16(base) === 0x4949
  const u16 = (o: number) => v.getUint16(o, le)
  const u32 = (o: number) => v.getUint32(o, le)
  const info: ExifInfo = {
    make: '', model: '', lens: '', orientation: 0, capturedAt: 0,
    iso: 0, shutter: 0, aperture: 0, focalLength: 0, width: 0, height: 0, interopIndex: '', colorSpace: 0,
    artist: '', copyright: '', description: '',
  }

  const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }
  const readEntries = (ifd: number, onEntry: (tag: number, type: number, count: number, valueOff: number) => void) => {
    if (ifd <= 0 || base + ifd + 2 > end) return
    const n = u16(base + ifd)
    for (let i = 0; i < n; i++) {
      const e = base + ifd + 2 + i * 12
      if (e + 12 > end) return
      const type = u16(e + 2)
      const count = u32(e + 4)
      const size = (TYPE_SIZE[type] ?? 1) * count
      const valueOff = size <= 4 ? e + 8 : base + u32(e + 8)
      if (valueOff + size > end) continue
      onEntry(u16(e), type, count, valueOff)
    }
  }
  const str = (o: number, n: number) => {
    let s = ''
    for (let i = 0; i < n; i++) {
      const c = v.getUint8(o + i)
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    return s.trim()
  }
  /** Free text: UTF-8 when it is valid UTF-8 (common in practice), otherwise one byte per character. */
  const text = (o: number, n: number) => {
    let len = 0
    while (len < n && v.getUint8(o + len) !== 0) len++
    const bytes = new Uint8Array(v.buffer, v.byteOffset + o, len)
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
    } catch {
      return String.fromCharCode(...bytes).trim()
    }
  }
  const num = (type: number, o: number) => {
    if (type === 3) return u16(o)
    if (type === 4) return u32(o)
    if (type === 5) {
      const d = u32(o + 4)
      return d ? u32(o) / d : 0
    }
    if (type === 10) {
      const d = v.getInt32(o + 4, le)
      return d ? v.getInt32(o, le) / d : 0
    }
    return 0
  }

  let exifIfd = 0
  let interopIfd = 0
  readEntries(u32(base + 4), (tag, type, count, o) => {
    if (tag === 0x010f) info.make = str(o, count)
    else if (tag === 0x0110) info.model = str(o, count)
    else if (tag === 0x0112) info.orientation = EXIF_TO_FLIP[num(type, o)] ?? 0
    else if (tag === 0x0132 && !info.capturedAt) info.capturedAt = parseExifDate(str(o, count))
    else if (tag === 0x8769) exifIfd = num(type, o)
    else if (tag === 0x013b) info.artist = text(o, count)
    else if (tag === 0x8298) info.copyright = text(o, count)
    else if (tag === 0x010e) info.description = text(o, count)
  })
  readEntries(exifIfd, (tag, type, count, o) => {
    if (tag === 0x9003) info.capturedAt = parseExifDate(str(o, count)) || info.capturedAt
    else if (tag === 0x829a) info.shutter = num(type, o)
    else if (tag === 0x829d) info.aperture = num(type, o)
    else if (tag === 0x8827) info.iso = num(type, o)
    else if (tag === 0x920a) info.focalLength = num(type, o)
    else if (tag === 0xa405) info.focal35 = num(type, o)
    else if (tag === 0xa434) info.lens = str(o, count)
    else if (tag === 0xa002) info.width = num(type, o)
    else if (tag === 0xa003) info.height = num(type, o)
    else if (tag === 0xa001) info.colorSpace = num(type, o)
    else if (tag === 0xa005) interopIfd = num(type, o)
  })
  readEntries(interopIfd, (tag, _type, count, o) => {
    if (tag === 0x0001) info.interopIndex = str(o, count)
  })
  return info
}

// ---- A general TIFF reader, for camera RAW files (TIFF-based: NEF, ARW, DNG, ORF, RW2, PEF, CR2…) and the maker
// notes inside them. Used by the lens corrections (engine/lens/meta.ts) to read the lens name and the camera's own
// correction data, which LibRaw's WebAssembly binding doesn't expose.

export interface TiffEntry {
  tag: number
  type: number
  count: number
  /** Absolute position of the value in the file. */
  at: number
}

const TIFF_TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 }

/** Reads IFDs of a TIFF structure whose offsets count from `base` (the TIFF header, or a maker note's start). */
export class TiffReader {
  readonly view: DataView
  readonly base: number
  readonly le: boolean

  constructor(view: DataView, base: number, le: boolean) {
    this.view = view
    this.base = base
    this.le = le
  }

  /**
   * A TIFF header at `at`: "II" or "MM", then 42, or the variants of Panasonic RW2 (0x55) and Olympus ORF
   * ("IIRO", "IIRS", "MMOR"). Returns the reader and the offset of IFD0, or null.
   */
  static open(bytes: Uint8Array, at = 0): { tiff: TiffReader; ifd0: number } | null {
    if (at < 0 || at + 8 > bytes.length) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const order = view.getUint16(at)
    if (order !== 0x4949 && order !== 0x4d4d) return null
    const le = order === 0x4949
    const magic = view.getUint16(at + 2, le)
    if (![42, 0x55, 0x4f52, 0x5352].includes(magic)) return null
    return { tiff: new TiffReader(view, at, le), ifd0: view.getUint32(at + 4, le) }
  }

  u16(o: number) {
    return this.view.getUint16(o, this.le)
  }

  u32(o: number) {
    return this.view.getUint32(o, this.le)
  }

  /** The entries of the IFD at `offset` (relative to the base); empty when it lies outside the file. */
  ifd(offset: number): Map<number, TiffEntry> {
    const out = new Map<number, TiffEntry>()
    const v = this.view
    const start = this.base + offset
    if (offset <= 0 || start + 2 > v.byteLength) return out
    const n = this.u16(start)
    for (let i = 0; i < n; i++) {
      const e = start + 2 + i * 12
      if (e + 12 > v.byteLength) break
      const type = this.u16(e + 2)
      const count = this.u32(e + 4)
      const size = (TIFF_TYPE_SIZE[type] ?? 1) * count
      const at = size <= 4 ? e + 8 : this.base + this.u32(e + 8)
      if (at + size > v.byteLength) continue
      const tag = this.u16(e)
      if (!out.has(tag)) out.set(tag, { tag, type, count, at })
    }
    return out
  }

  /** A numeric value as numbers (integers, rationals, floats; signed types read as signed). */
  numbers(e: TiffEntry | undefined, max = 1 << 16): number[] {
    if (!e) return []
    const v = this.view
    const n = Math.min(e.count, max)
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      const o = e.at + i * (TIFF_TYPE_SIZE[e.type] ?? 1)
      switch (e.type) {
        case 1: case 7: out.push(v.getUint8(o)); break
        case 6: out.push(v.getInt8(o)); break
        case 3: out.push(v.getUint16(o, this.le)); break
        case 8: out.push(v.getInt16(o, this.le)); break
        case 4: case 13: out.push(v.getUint32(o, this.le)); break
        case 9: out.push(v.getInt32(o, this.le)); break
        case 5: { const d = v.getUint32(o + 4, this.le); out.push(d ? v.getUint32(o, this.le) / d : 0); break }
        case 10: { const d = v.getInt32(o + 4, this.le); out.push(d ? v.getInt32(o, this.le) / d : 0); break }
        case 11: out.push(v.getFloat32(o, this.le)); break
        case 12: out.push(v.getFloat64(o, this.le)); break
        default: return out
      }
    }
    return out
  }

  /** The first value of a numeric entry (0 when missing). */
  number(e: TiffEntry | undefined): number {
    return this.numbers(e, 1)[0] ?? 0
  }

  /** An ASCII value, up to its first NUL, trimmed. */
  text(e: TiffEntry | undefined): string {
    if (!e) return ''
    let s = ''
    for (let i = 0; i < e.count; i++) {
      const c = this.view.getUint8(e.at + i)
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    return s.trim()
  }

  /** The raw bytes of a value. */
  bytes(e: TiffEntry | undefined): Uint8Array {
    if (!e) return new Uint8Array(0)
    const size = (TIFF_TYPE_SIZE[e.type] ?? 1) * e.count
    return new Uint8Array(this.view.buffer, this.view.byteOffset + e.at, size)
  }
}
