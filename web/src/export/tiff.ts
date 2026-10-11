// TIFF writer for exports: 8 or 16-bit RGB, deflate with horizontal predictor (darktable's default,
// src/imageio/format/tiff.c) or uncompressed, with ICC profile, EXIF and XMP. Little-endian, top-left, one
// image, no alpha.

import { encodeIfd, exifEntries, ifd0Entries, type ExifOptions, type ExifSource, type Value } from './exif-writer'
import { browserDeflate, type Deflate } from './png'

export interface TiffOptions {
  width: number
  height: number
  /** Interleaved RGB: Uint8Array for 8-bit, Uint16Array for 16-bit. */
  pixels: Uint8Array | Uint16Array
  compression: 'deflate' | 'none'
  icc?: Uint8Array
  xmp?: string
  exif?: { source: ExifSource; options: ExifOptions }
  deflate?: Deflate
}

const ROWS_PER_STRIP_BYTES = 256 * 1024

/** Horizontal differencing predictor (TIFF Predictor = 2), per sample, in place on a copy. */
function predict(strip: Uint8Array | Uint16Array, rowSamples: number): Uint8Array | Uint16Array {
  const out = strip.slice()
  const mask = strip instanceof Uint16Array ? 0xffff : 0xff
  for (let r = 0; r < out.length / rowSamples; r++) {
    const o = r * rowSamples
    for (let i = rowSamples - 1; i >= 3; i--) out[o + i] = (strip[o + i] - strip[o + i - 3]) & mask
  }
  return out
}

export async function encodeTiff(o: TiffOptions): Promise<Blob> {
  const deflate = o.deflate ?? browserDeflate
  const bits = o.pixels instanceof Uint16Array ? 16 : 8
  const rowSamples = o.width * 3
  const rowBytes = rowSamples * (bits / 8)
  const rowsPerStrip = Math.max(1, Math.floor(ROWS_PER_STRIP_BYTES / rowBytes))
  const strips: Uint8Array[] = []
  for (let y = 0; y < o.height; y += rowsPerStrip) {
    const n = Math.min(rowsPerStrip, o.height - y)
    let samples = o.pixels.subarray(y * rowSamples, (y + n) * rowSamples)
    if (o.compression === 'deflate') samples = predict(samples, rowSamples)
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength) // little-endian host
    strips.push(o.compression === 'deflate' ? await deflate(bytes.slice()) : bytes.slice())
  }

  // Layout: header (8) · strips · IFD0 (with its data: ICC, XMP, strip tables) · EXIF IFD.
  let at = 8
  const stripOffsets: number[] = []
  for (const s of strips) {
    stripOffsets.push(at)
    at += s.length + (s.length & 1)
  }
  const xmpBytes = o.xmp ? new TextEncoder().encode(o.xmp) : null

  const entries: [number, Value][] = [
    [256, { type: 4, values: [o.width] }],
    [257, { type: 4, values: [o.height] }],
    [258, { type: 3, values: [bits, bits, bits] }],
    [259, { type: 3, values: [o.compression === 'deflate' ? 8 : 1] }],
    [262, { type: 3, values: [2] }],
    [273, { type: 4, values: stripOffsets }],
    [277, { type: 3, values: [3] }],
    [278, { type: 4, values: [rowsPerStrip] }],
    [279, { type: 4, values: strips.map((s) => s.length) }],
    [284, { type: 3, values: [1] }],
  ]
  if (o.compression === 'deflate') entries.push([317, { type: 3, values: [2] }])
  if (o.icc) entries.push([34675, { type: 7, bytes: o.icc }])
  if (xmpBytes) entries.push([700, { type: 7, bytes: xmpBytes }])
  if (o.exif) entries.push(...ifd0Entries(o.exif.source, o.exif.options))

  const ifdStart = at
  const withPointer = o.exif ? [...entries, [34665, { type: 4, values: [0] }] as [number, Value]] : entries
  const ifdLen = encodeIfd(withPointer.map((e) => [...e] as [number, Value]), ifdStart, 0).length
  const exifStart = ifdStart + ifdLen + (ifdLen & 1)
  const ifd = encodeIfd(
    withPointer.map(([t, v]) => (t === 34665 ? [t, { type: 4, values: [exifStart] }] : [t, v])),
    ifdStart,
    0,
  )
  const exifIfd = o.exif ? encodeIfd(exifEntries(o.exif.source, o.exif.options), exifStart, 0) : new Uint8Array(0)

  const header = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0])
  new DataView(header.buffer).setUint32(4, ifdStart, true)
  const parts: Uint8Array[] = [header]
  for (const s of strips) {
    parts.push(s)
    if (s.length & 1) parts.push(new Uint8Array(1))
  }
  parts.push(ifd)
  if (ifd.length & 1) parts.push(new Uint8Array(1))
  parts.push(exifIfd)
  return new Blob(parts as BlobPart[], { type: 'image/tiff' })
}
