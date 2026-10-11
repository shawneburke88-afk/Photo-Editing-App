import { describe, expect, it } from 'vitest'
import { buildIcc, SRGB_PROFILE } from '../engine/color/icc'
import { crc32, encodePng } from './png'
import { encodeTiff } from './tiff'

/** zlib inflate via the standard DecompressionStream (available in browsers and Node). */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** A small test image with smooth gradients and edges. */
function image(w: number, h: number, bits: 8 | 16) {
  const max = bits === 8 ? 255 : 65535
  const px = bits === 8 ? new Uint8Array(w * h * 3) : new Uint16Array(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = 3 * (y * w + x)
      px[i] = Math.round((x / (w - 1)) * max)
      px[i + 1] = Math.round((y / (h - 1)) * max)
      px[i + 2] = (x + y) % 7 === 0 ? max : 0
    }
  return px
}

async function pngChunks(blob: Blob) {
  const b = new Uint8Array(await blob.arrayBuffer())
  const v = new DataView(b.buffer)
  expect([...b.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const chunks: { type: string; data: Uint8Array }[] = []
  for (let o = 8; o < b.length; ) {
    const len = v.getUint32(o)
    const type = String.fromCharCode(...b.subarray(o + 4, o + 8))
    const crc = v.getUint32(o + 8 + len)
    expect((crc32(b.subarray(o + 4, o + 8 + len)) ^ 0xffffffff) >>> 0).toBe(crc)
    chunks.push({ type, data: b.subarray(o + 8, o + 8 + len) })
    o += 12 + len
  }
  return chunks
}

function unfilter(data: Uint8Array, rowBytes: number, bpp: number) {
  const rows = data.length / (rowBytes + 1)
  const out = new Uint8Array(rows * rowBytes)
  for (let y = 0; y < rows; y++) {
    const f = data[y * (rowBytes + 1)]
    for (let i = 0; i < rowBytes; i++) {
      const x = data[y * (rowBytes + 1) + 1 + i]
      const a = i >= bpp ? out[y * rowBytes + i - bpp] : 0
      const b = y > 0 ? out[(y - 1) * rowBytes + i] : 0
      const c = y > 0 && i >= bpp ? out[(y - 1) * rowBytes + i - bpp] : 0
      const p = a + b - c
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c
      out[y * rowBytes + i] = (x + pred) & 0xff
    }
  }
  return out
}

describe('PNG writer', () => {
  for (const bits of [8, 16] as const) {
    it(`writes ${bits}-bit RGB that decodes back exactly`, async () => {
      const w = 37
      const h = 23
      const px = image(w, h, bits)
      const blob = await encodePng({ width: w, height: h, pixels: px, icc: { name: 'sRGB', data: buildIcc(SRGB_PROFILE) }, cicp: [1, 13], exif: new Uint8Array([0x49, 0x49, 0x2a, 0]), xmp: '<x:xmpmeta/>', dpi: 300 })
      const chunks = await pngChunks(blob)
      expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'cICP', 'iCCP', 'pHYs', 'eXIf', 'iTXt', 'IDAT', 'IEND'])
      const ihdr = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset)
      expect([ihdr.getUint32(0), ihdr.getUint32(4), chunks[0].data[8], chunks[0].data[9]]).toEqual([w, h, bits, 2])
      const iccZ = chunks[2].data.subarray(chunks[2].data.indexOf(0) + 2)
      expect((await inflate(iccZ)).length).toBe(buildIcc(SRGB_PROFILE).length)
      const bpp = bits === 8 ? 3 : 6
      const raw = unfilter(await inflate(chunks[6].data), w * bpp, bpp)
      const back = bits === 8 ? raw : Uint16Array.from({ length: px.length }, (_, i) => (raw[2 * i] << 8) | raw[2 * i + 1])
      expect([...back]).toEqual([...px])
    })
  }
})

describe('TIFF writer', () => {
  for (const bits of [8, 16] as const)
    for (const compression of ['deflate', 'none'] as const) {
      it(`writes ${bits}-bit ${compression} that reads back exactly`, async () => {
        const w = 41
        const h = 19
        const px = image(w, h, bits)
        const icc = buildIcc(SRGB_PROFILE)
        const blob = await encodeTiff({
          width: w, height: h, pixels: px, compression, icc, xmp: '<x:xmpmeta/>',
          exif: { source: { make: 'Nikon', model: 'D5200', lens: '', iso: 100, shutter: 0.01, aperture: 8, focalLength: 35, capturedAt: 0 }, options: { width: w, height: h, srgb: true } },
        })
        const b = new Uint8Array(await blob.arrayBuffer())
        const v = new DataView(b.buffer)
        expect(v.getUint16(0, true)).toBe(0x4949)
        const ifd = v.getUint32(4, true)
        const tags = new Map<number, { type: number; count: number; at: number }>()
        const n = v.getUint16(ifd, true)
        for (let i = 0; i < n; i++) {
          const e = ifd + 2 + 12 * i
          const type = v.getUint16(e + 2, true)
          const count = v.getUint32(e + 4, true)
          const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 } as Record<number, number>)[type] * count
          tags.set(v.getUint16(e, true), { type, count, at: size <= 4 ? e + 8 : v.getUint32(e + 8, true) })
        }
        const vals = (tag: number) => {
          const t = tags.get(tag)!
          return Array.from({ length: t.count }, (_, k) => (t.type === 3 ? v.getUint16(t.at + 2 * k, true) : v.getUint32(t.at + 4 * k, true)))
        }
        expect(vals(256)).toEqual([w])
        expect(vals(258)).toEqual([bits, bits, bits])
        expect(tags.get(34675)!.count).toBe(icc.length)
        expect(tags.has(34665)).toBe(true)
        const offsets = vals(273)
        const counts = vals(279)
        const rowSamples = w * 3
        const parts = await Promise.all(offsets.map((o, k) => {
          const data = b.subarray(o, o + counts[k])
          return compression === 'deflate' ? inflate(data) : Promise.resolve(data)
        }))
        const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
        let at = 0
        for (const p of parts) {
          all.set(p, at)
          at += p.length
        }
        const samples = bits === 8 ? all : new Uint16Array(all.buffer, all.byteOffset, all.length / 2)
        const mask = bits === 8 ? 0xff : 0xffff
        if (compression === 'deflate')
          for (let r = 0; r < h; r++) for (let i = 3; i < rowSamples; i++) samples[r * rowSamples + i] = (samples[r * rowSamples + i] + samples[r * rowSamples + i - 3]) & mask
        expect([...samples]).toEqual([...px])
      })
    }
})
