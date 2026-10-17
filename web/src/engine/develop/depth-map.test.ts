import { describe, expect, it } from 'vitest'
import { inflateRaw } from '../../lib/inflate'
import { decodeDepth, DEPTH_ENCODING, depthPosition, encodeDepth, fromBase64, medFilter, medUnfilter, normalizeRaster, quantizeDisparity, sampleDepth, toBase64 } from './depth-map'
import { depthAlpha } from './mask-math'

/** A depth-like map: a ground plane getting nearer towards the bottom, a near "subject" with a hard edge, a far sky. */
function syntheticDepth(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = y < h * 0.35 ? 4 : 40 + ((y - h * 0.35) / (h * 0.65)) * 150
      const dx = (x - w * 0.6) / (w * 0.12)
      const dy = (y - h * 0.62) / (h * 0.3)
      if (dx * dx + dy * dy < 1) v = 230 - 10 * dy
      px[y * w + x] = Math.round(v)
    }
  }
  return px
}

async function deflate(b: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([b as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

describe('inflateRaw', () => {
  it('decodes what the platform deflates (stored, fixed and dynamic blocks)', async () => {
    const rnd = new Uint8Array(70000)
    let s = 7
    for (let i = 0; i < rnd.length; i++) rnd[i] = (s = (s * 1103515245 + 12345) & 0x7fffffff) >> 16
    const text = new TextEncoder().encode('depth '.repeat(5000) + 'LightBench')
    // Random bytes come out as stored blocks, short text as a fixed-code block, the rest as dynamic ones.
    for (const data of [new Uint8Array(0), rnd, new TextEncoder().encode('abc'), text, syntheticDepth(300, 200)]) {
      expect(inflateRaw(await deflate(data))).toEqual(data)
    }
    // A stored block written by hand: BFINAL 1, BTYPE 00, LEN 3, NLEN ~3.
    expect(inflateRaw(new Uint8Array([1, 3, 0, 0xfc, 0xff, 7, 8, 9]))).toEqual(new Uint8Array([7, 8, 9]))
  }, 30000)

  it('refuses damaged data and too much output', async () => {
    const z = await deflate(syntheticDepth(64, 64))
    expect(() => inflateRaw(z.subarray(0, z.length >> 1))).toThrow()
    expect(() => inflateRaw(new Uint8Array([0xff, 0xff, 0xff]))).toThrow()
    expect(() => inflateRaw(z, 100)).toThrow(/too large/)
  })
})

describe('depth map encoding', () => {
  it('MED prediction round-trips exactly', () => {
    const px = syntheticDepth(37, 23)
    expect(medUnfilter(medFilter(px, 37, 23), 37, 23)).toEqual(px)
  })

  it('round-trips through the stored form, and a model-sized map stays small', async () => {
    const w = 784
    const h = 518
    const px = syntheticDepth(w, h)
    const r = await encodeDepth(px, w, h)
    expect(r.encoding).toBe(DEPTH_ENCODING)
    expect(r.width).toBe(w)
    expect(decodeDepth(r)).toEqual(px)
    // 406,112 depth values; smooth regions compress to almost nothing (the size in a real photo depends on its detail).
    expect(r.data.length).toBeLessThan(20000)
    expect(fromBase64(toBase64(px))).toEqual(px)
  }, 30000)

  it('a damaged map decodes to null; bad fields are refused', async () => {
    const r = await encodeDepth(syntheticDepth(40, 30), 40, 30)
    expect(decodeDepth({ ...r, data: r.data.slice(0, 10) })).toBeNull()
    expect(decodeDepth({ ...r, width: 41 })).toBeNull()
    expect(decodeDepth({ ...r, encoding: 'png' })).toBeNull()
    expect(normalizeRaster(r)).toEqual(r)
    expect(normalizeRaster({ ...r, width: 0 })).toBeNull()
    expect(normalizeRaster({ ...r, width: 5000 })).toBeNull()
    expect(normalizeRaster({ ...r, data: 'not base64!' })).toBeNull()
    expect(normalizeRaster({ ...r, encoding: 'raw' })).toBeNull()
    expect(normalizeRaster(null)).toBeNull()
  })

  it('samples bilinearly in sensor uv, and the range scale runs near → far', () => {
    const px = new Uint8Array([0, 255, 255, 0])
    expect(sampleDepth(px, 2, 2, 0.25, 0.25)).toBe(0)
    expect(sampleDepth(px, 2, 2, 0.5, 0.25)).toBeCloseTo(0.5)
    expect(depthPosition(1)).toBe(0)
    expect(depthPosition(0)).toBe(100)
    expect(depthAlpha(1, [0, 0, 30, 50])).toBe(1)
    expect(depthAlpha(0.6, [0, 0, 30, 50])).toBeCloseTo(0.5)
    expect(depthAlpha(0.2, [0, 0, 30, 50])).toBe(0)
    expect(depthAlpha(0.2, [0, 0, 30, 50], true)).toBe(0.2)
  })

  it('scales the model output between robust percentiles, and refuses non-finite values', () => {
    const d = new Float32Array(10000).map((_, i) => i / 100)
    d[5] = 1e6
    const q = quantizeDisparity(d)
    expect(q[0]).toBe(0)
    expect(q[9999]).toBe(255)
    expect(q[5000]).toBeGreaterThan(120)
    expect(q[5000]).toBeLessThan(135)
    d[7] = NaN
    expect(() => quantizeDisparity(d)).toThrow(/non-finite/)
  })
})
