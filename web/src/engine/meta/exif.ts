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
