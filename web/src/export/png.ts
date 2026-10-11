// PNG writer for exports: 8 or 16-bit RGB, embedded ICC profile (iCCP) plus cICP when the colour space is a
// standard one, EXIF (eXIf), XMP (iTXt) and resolution (pHYs). darktable's PNG export is the reference
// (src/imageio/format/png.c): RGB without alpha, no interlacing.

export type Deflate = (data: Uint8Array<ArrayBuffer>) => Promise<Uint8Array<ArrayBuffer>>

/** zlib-wrapped deflate using the browser's CompressionStream (format "deflate" is RFC 1950 zlib). */
export const browserDeflate: Deflate = async (data) => {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return crc
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  v.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0)
  return out
}

/**
 * Applies PNG row filters, choosing per row the filter with the smallest sum of absolute (signed) bytes —
 * the usual libpng heuristic.
 */
export function filterRows(raw: Uint8Array, rowBytes: number, bpp: number): Uint8Array<ArrayBuffer> {
  const rows = raw.length / rowBytes
  const out = new Uint8Array(rows * (rowBytes + 1))
  const cand = Array.from({ length: 5 }, () => new Uint8Array(rowBytes))
  for (let y = 0; y < rows; y++) {
    const cur = raw.subarray(y * rowBytes, (y + 1) * rowBytes)
    const prev = y > 0 ? raw.subarray((y - 1) * rowBytes, y * rowBytes) : null
    let best = 0
    let bestSum = Infinity
    for (let f = 0; f < 5; f++) {
      const c = cand[f]
      let sum = 0
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0
        const b = prev ? prev[i] : 0
        const cc = prev && i >= bpp ? prev[i - bpp] : 0
        let pred = 0
        if (f === 1) pred = a
        else if (f === 2) pred = b
        else if (f === 3) pred = (a + b) >> 1
        else if (f === 4) {
          const p = a + b - cc
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - cc)
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc
        }
        const v = (cur[i] - pred) & 0xff
        c[i] = v
        sum += v < 128 ? v : 256 - v
        if (sum >= bestSum) break
      }
      if (sum < bestSum) {
        bestSum = sum
        best = f
      }
    }
    // Recompute the winner fully (the loop above may have stopped early for other filters).
    const o = y * (rowBytes + 1)
    out[o] = best
    const c = cand[best]
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev ? prev[i] : 0
      const cc = prev && i >= bpp ? prev[i - bpp] : 0
      let pred = 0
      if (best === 1) pred = a
      else if (best === 2) pred = b
      else if (best === 3) pred = (a + b) >> 1
      else if (best === 4) {
        const p = a + b - cc
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - cc)
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc
      }
      c[i] = (cur[i] - pred) & 0xff
    }
    out.set(c, o + 1)
  }
  return out
}

export interface PngOptions {
  width: number
  height: number
  /** Interleaved RGB samples: Uint8Array for 8-bit, Uint16Array for 16-bit. */
  pixels: Uint8Array | Uint16Array
  icc?: { name: string; data: Uint8Array }
  /** Coding-independent code points (primaries, transfer), e.g. sRGB = [1, 13]. */
  cicp?: [primaries: number, transfer: number]
  exif?: Uint8Array
  xmp?: string
  dpi?: number
  deflate?: Deflate
}

export async function encodePng(o: PngOptions): Promise<Blob> {
  const deflate = o.deflate ?? browserDeflate
  const bits = o.pixels instanceof Uint16Array ? 16 : 8
  const bpp = 3 * (bits / 8)
  const rowBytes = o.width * bpp
  let raw: Uint8Array
  if (bits === 16) {
    // PNG stores 16-bit samples big-endian.
    raw = new Uint8Array(o.pixels.length * 2)
    const px = o.pixels as Uint16Array
    for (let i = 0; i < px.length; i++) {
      raw[2 * i] = px[i] >> 8
      raw[2 * i + 1] = px[i] & 0xff
    }
  } else raw = o.pixels as Uint8Array

  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]
  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, o.width)
  hv.setUint32(4, o.height)
  ihdr[8] = bits
  ihdr[9] = 2 // truecolour RGB
  parts.push(chunk('IHDR', ihdr))
  if (o.cicp) parts.push(chunk('cICP', new Uint8Array([o.cicp[0], o.cicp[1], 0, 1])))
  if (o.icc) {
    const name = new TextEncoder().encode(o.icc.name.replace(/[^\x20-\x7e]/g, '').slice(0, 79) || 'ICC profile')
    const z = await deflate(o.icc.data as Uint8Array<ArrayBuffer>)
    const d = new Uint8Array(name.length + 2 + z.length)
    d.set(name)
    d.set(z, name.length + 2) // null separator + compression method 0
    parts.push(chunk('iCCP', d))
  }
  if (o.dpi) {
    const ppm = Math.round(o.dpi / 0.0254)
    const d = new Uint8Array(9)
    const dv = new DataView(d.buffer)
    dv.setUint32(0, ppm)
    dv.setUint32(4, ppm)
    d[8] = 1
    parts.push(chunk('pHYs', d))
  }
  if (o.exif) parts.push(chunk('eXIf', o.exif))
  if (o.xmp) {
    const key = new TextEncoder().encode('XML:com.adobe.xmp')
    const text = new TextEncoder().encode(o.xmp)
    const d = new Uint8Array(key.length + 5 + text.length)
    d.set(key)
    d.set(text, key.length + 5) // null, compression flag 0, method 0, empty language, empty translated keyword
    parts.push(chunk('iTXt', d))
  }
  parts.push(chunk('IDAT', await deflate(filterRows(raw, rowBytes, bpp))))
  parts.push(chunk('IEND', new Uint8Array(0)))
  return new Blob(parts as BlobPart[], { type: 'image/png' })
}
