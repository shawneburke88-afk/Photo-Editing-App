import { describe, expect, it } from 'vitest'
import { parseIptc, readJpegIptc } from './iptc'

const enc = new TextEncoder()

function ds(out: number[], rec: number, d: number, data: Uint8Array | string) {
  const b = typeof data === 'string' ? enc.encode(data) : data
  out.push(0x1c, rec, d, b.length >> 8, b.length & 0xff, ...b)
}

/** LightCraft's sample_iim (crates/meta/src/iptc.rs tests), plus the location and headline datasets. */
function sample(): Uint8Array {
  const v: number[] = []
  ds(v, 1, 90, new Uint8Array([0x1b, 0x25, 0x47]))
  ds(v, 2, 0, new Uint8Array([0, 4]))
  ds(v, 2, 5, 'Tïtle')
  ds(v, 2, 25, 'alpha')
  ds(v, 2, 25, 'beta')
  ds(v, 2, 25, 'alpha')
  ds(v, 2, 80, 'Photographer')
  ds(v, 2, 80, 'Assistant')
  ds(v, 2, 116, 'CC0')
  ds(v, 2, 120, 'A caption')
  ds(v, 2, 90, 'Ottawa')
  ds(v, 2, 95, 'Ontario')
  ds(v, 2, 101, 'Canada')
  ds(v, 2, 105, 'Parliament at dusk')
  ds(v, 2, 55, '20210304')
  return new Uint8Array(v)
}

/** A JPEG with the IIM in APP13 "Photoshop 3.0" resource 0x0404, after another resource (0x040c, a thumbnail). */
function jpegWith(iim: Uint8Array): Uint8Array {
  const res = (id: number, data: Uint8Array) => {
    const pad = data.length & 1 ? [0] : []
    return [...enc.encode('8BIM'), id >> 8, id & 0xff, 0, 0, data.length >>> 24, (data.length >> 16) & 0xff, (data.length >> 8) & 0xff, data.length & 0xff, ...data, ...pad]
  }
  const payload = [...enc.encode('Photoshop 3.0\0'), ...res(0x040c, new Uint8Array([1, 2, 3])), ...res(0x0404, iim)]
  const len = payload.length + 2
  return new Uint8Array([0xff, 0xd8, 0xff, 0xed, len >> 8, len & 0xff, ...payload, 0xff, 0xd9])
}

describe('IPTC-IIM', () => {
  it('reads record 2 into the Metadata panel’s fields and keywords', () => {
    const r = parseIptc(sample())
    expect(r.metadata).toEqual({
      title: 'Tïtle',
      creator: 'Photographer; Assistant',
      copyright: 'CC0',
      caption: 'A caption',
      city: 'Ottawa',
      state: 'Ontario',
      country: 'Canada',
      headline: 'Parliament at dusk',
    })
    expect(r.keywords).toEqual(['alpha', 'beta'])
  })

  it('reads Latin-1, extended sizes, and survives cut-off data (LightCraft’s test)', () => {
    const v: number[] = []
    ds(v, 2, 5, new Uint8Array([0x43, 0xe9])) // "Cé" in Latin-1
    v.push(0x1c, 2, 120, 0x80, 0x02, 0x00, 0x03, ...enc.encode('abc'))
    const r = parseIptc(new Uint8Array(v))
    expect(r.metadata.title).toBe('Cé')
    expect(r.metadata.caption).toBe('abc')
    const s = sample()
    for (let n = 0; n < s.length; n++) expect(() => parseIptc(s.subarray(0, n))).not.toThrow()
    expect(parseIptc(new Uint8Array([0x1c, 2, 5, 0xff, 0xff]))).toEqual({ metadata: {}, keywords: [] })
  })

  it('finds the IIM in a JPEG’s APP13', () => {
    const r = readJpegIptc(jpegWith(sample()))!
    expect(r.metadata.title).toBe('Tïtle')
    expect(r.keywords).toEqual(['alpha', 'beta'])
    expect(readJpegIptc(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull()
    expect(readJpegIptc(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  })
})
