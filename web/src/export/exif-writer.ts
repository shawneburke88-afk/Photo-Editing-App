// Builds the EXIF block (a little-endian TIFF structure) for exported images.
//
// Follows darktable's export (src/common/exif.cc dt_exif_read_blob): Orientation is 1 because the pixels
// are already upright, the pixel dimensions are the output size, DateTime is the export time, the capture
// time and camera settings are kept, and maker notes and thumbnails are not carried over.

export interface ExifSource {
  make: string
  model: string
  lens: string
  iso: number
  /** Seconds. */
  shutter: number
  aperture: number
  focalLength: number
  /** Camera-local capture time as Unix seconds read in UTC (0 if unknown). */
  capturedAt: number
}

export interface ExifOptions {
  width: number
  height: number
  /** EXIF ColorSpace: true for sRGB output (1), otherwise "uncalibrated" (0xFFFF), as darktable does. */
  srgb: boolean
  /** Pixels per inch written as the resolution (darktable default 300). */
  dpi?: number
  software?: string
  /** Export time (defaults to now). */
  now?: Date
}

export type Value =
  | { type: 2; text: string } // ASCII
  | { type: 3; values: number[] } // SHORT
  | { type: 4; values: number[] } // LONG
  | { type: 5; values: [number, number][] } // RATIONAL
  | { type: 7; bytes: Uint8Array } // UNDEFINED

const exifDate = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}:${p(d.getUTCMonth() + 1)}:${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

/** A positive number as a TIFF rational: exact fractions like 1/200 for short exposures. */
export function toRational(v: number): [number, number] {
  if (!(v > 0)) return [0, 1]
  if (v < 1) {
    const d = Math.round(1 / v)
    if (Math.abs(1 / d - v) / v < 0.01) return [1, d]
  }
  return [Math.round(v * 1000), 1000]
}

export function encodeIfd(entries: [number, Value][], start: number, next: number): Uint8Array {
  entries.sort((a, b) => a[0] - b[0])
  const size = (v: Value) =>
    v.type === 2 ? v.text.length + 1 : v.type === 3 ? 2 * v.values.length : v.type === 4 ? 4 * v.values.length : v.type === 5 ? 8 * v.values.length : v.bytes.length
  const headerLen = 2 + 12 * entries.length + 4
  let extra = 0
  for (const [, v] of entries) if (size(v) > 4) extra += (size(v) + 1) & ~1
  const out = new Uint8Array(headerLen + extra)
  const view = new DataView(out.buffer)
  view.setUint16(0, entries.length, true)
  let dataAt = headerLen
  entries.forEach(([tag, v], i) => {
    const e = 2 + 12 * i
    const n = size(v)
    const count = v.type === 2 ? v.text.length + 1 : v.type === 7 ? v.bytes.length : v.values.length
    view.setUint16(e, tag, true)
    view.setUint16(e + 2, v.type, true)
    view.setUint32(e + 4, count, true)
    const at = n > 4 ? dataAt : e + 8
    if (n > 4) {
      view.setUint32(e + 8, start + dataAt, true)
      dataAt += (n + 1) & ~1
    }
    if (v.type === 2) for (let k = 0; k < v.text.length; k++) out[at + k] = v.text.charCodeAt(k) & 0x7f
    else if (v.type === 3) v.values.forEach((x, k) => view.setUint16(at + 2 * k, x, true))
    else if (v.type === 4) v.values.forEach((x, k) => view.setUint32(at + 4 * k, x, true))
    else if (v.type === 5) v.values.forEach(([a, b], k) => (view.setUint32(at + 8 * k, a, true), view.setUint32(at + 8 * k + 4, b, true)))
    else out.set(v.bytes, at)
  })
  view.setUint32(headerLen - 4, next, true)
  return out
}

export const ascii = (s: string): Value => ({ type: 2, text: s.replace(/[^\x20-\x7e]/g, '?') })

/** IFD0 tags describing the camera and the export (without the EXIF IFD pointer). */
export function ifd0Entries(src: ExifSource, opts: ExifOptions): [number, Value][] {
  const dpi = opts.dpi ?? 300
  const ifd0: [number, Value][] = [
    [0x0112, { type: 3, values: [1] }],
    [0x011a, { type: 5, values: [[dpi, 1]] }],
    [0x011b, { type: 5, values: [[dpi, 1]] }],
    [0x0128, { type: 3, values: [2] }],
    [0x0131, ascii(opts.software ?? 'LightBench')],
    [0x0132, ascii(exifDate(opts.now ?? new Date()))],
  ]
  if (src.make) ifd0.push([0x010f, ascii(src.make)])
  if (src.model) ifd0.push([0x0110, ascii(src.model)])
  return ifd0
}

/** EXIF sub-IFD tags: capture settings, colour space and pixel dimensions. */
export function exifEntries(src: ExifSource, opts: ExifOptions): [number, Value][] {
  const exif: [number, Value][] = [
    [0x9000, { type: 7, bytes: new TextEncoder().encode('0232') }],
    [0xa001, { type: 3, values: [opts.srgb ? 1 : 0xffff] }],
    [0xa002, { type: 4, values: [opts.width] }],
    [0xa003, { type: 4, values: [opts.height] }],
  ]
  if (src.shutter > 0) exif.push([0x829a, { type: 5, values: [toRational(src.shutter)] }])
  if (src.aperture > 0) exif.push([0x829d, { type: 5, values: [toRational(src.aperture)] }])
  if (src.iso > 0) exif.push([0x8827, { type: 3, values: [Math.min(65535, Math.round(src.iso))] }])
  if (src.capturedAt > 0) exif.push([0x9003, ascii(exifDate(new Date(src.capturedAt * 1000)))])
  if (src.focalLength > 0) exif.push([0x920a, { type: 5, values: [toRational(src.focalLength)] }])
  if (src.lens) exif.push([0xa434, ascii(src.lens)])
  return exif
}

/** The EXIF payload as a TIFF structure ("II*\0" …), for JPEG APP1 (after "Exif\0\0") or PNG eXIf. */
export function buildExif(src: ExifSource, opts: ExifOptions): Uint8Array<ArrayBuffer> {
  const ifd0: [number, Value][] = [...ifd0Entries(src, opts), [0x8769, { type: 4, values: [0] }]]
  const exif = exifEntries(src, opts)
  // Layout: header (8) · IFD0 · EXIF IFD.
  const ifd0Len = encodeIfd([...ifd0], 8, 0).length
  const exifStart = 8 + ifd0Len
  const ifd0Final = ifd0.map(([t, v]): [number, Value] => (t === 0x8769 ? [t, { type: 4, values: [exifStart] }] : [t, v]))
  const a = encodeIfd(ifd0Final, 8, 0)
  const b = encodeIfd(exif, exifStart, 0)
  const out = new Uint8Array(8 + a.length + b.length)
  out.set([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0])
  out.set(a, 8)
  out.set(b, exifStart)
  return out
}
