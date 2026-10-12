import { describe, expect, it } from 'vitest'
import { readDngColor } from './dng-tags'

type Entry = { tag: number; type: number; values: number[] }

/** A minimal TIFF: header, IFD0 with the given entries, values after it. Rationals are given as pairs. */
function tiff(entries: Entry[], littleEndian: boolean): Uint8Array {
  const size: Record<number, number> = { 1: 1, 3: 2, 4: 4, 5: 8, 10: 8, 11: 4, 12: 8 }
  const sorted = [...entries].sort((a, b) => a.tag - b.tag)
  const ifdSize = 2 + sorted.length * 12 + 4
  let dataOff = 8 + ifdSize
  const buf = new ArrayBuffer(4096)
  const v = new DataView(buf)
  v.setUint16(0, littleEndian ? 0x4949 : 0x4d4d)
  v.setUint16(2, 42, littleEndian)
  v.setUint32(4, 8, littleEndian)
  v.setUint16(8, sorted.length, littleEndian)
  sorted.forEach((e, k) => {
    const o = 10 + k * 12
    const rational = e.type === 5 || e.type === 10
    const count = rational ? e.values.length / 2 : e.values.length
    v.setUint16(o, e.tag, littleEndian)
    v.setUint16(o + 2, e.type, littleEndian)
    v.setUint32(o + 4, count, littleEndian)
    const bytes = size[e.type] * count
    let at = o + 8
    if (bytes > 4) {
      v.setUint32(o + 8, dataOff, littleEndian)
      at = dataOff
      dataOff += bytes + (bytes & 1)
    }
    e.values.forEach((x, i) => {
      switch (e.type) {
        case 1: v.setUint8(at + i, x); break
        case 3: v.setUint16(at + 2 * i, x, littleEndian); break
        case 4: case 5: v.setUint32(at + 4 * i, x, littleEndian); break
        case 10: v.setInt32(at + 4 * i, x, littleEndian); break
        case 11: v.setFloat32(at + 4 * i, x, littleEndian); break
        case 12: v.setFloat64(at + 8 * i, x, littleEndian); break
      }
    })
  })
  return new Uint8Array(buf, 0, dataOff)
}

const srat = (xs: number[], den = 10000) => xs.flatMap((x) => [Math.round(x * den), den])
const CM1 = [0.7527, -0.2068, -0.091, -0.5955, 1.431, 0.1737, -0.2481, 0.3391, 0.5873]
const CM2 = [1.0676, -0.3149, -0.2765, -0.553, 1.6283, -0.1152, -0.0614, 0.1997, 0.5991]

const entries = (): Entry[] => [
  { tag: 50706, type: 1, values: [1, 4, 0, 0] }, // DNGVersion
  { tag: 50721, type: 10, values: srat(CM1) },
  { tag: 50722, type: 10, values: srat(CM2) },
  { tag: 50723, type: 10, values: srat([0.9844, 0, 0, 0, 1, 0, 0, 0, 1.0078]) },
  { tag: 50727, type: 5, values: [1, 1, 1, 1, 1, 1] },
  { tag: 50728, type: 5, values: [468750, 1000000, 1, 1, 625000, 1000000] },
  { tag: 50730, type: 10, values: [-3, 10] },
  { tag: 50778, type: 3, values: [21] },
  { tag: 50779, type: 3, values: [17] },
  { tag: 50964, type: 12, values: [0.6, 0.3, 0.06, 0.25, 0.9, -0.15, 0.01, -0.15, 0.97] },
]

describe('readDngColor', () => {
  for (const le of [true, false]) {
    it(`reads the colour tags of IFD0 (${le ? 'little' : 'big'}-endian)`, () => {
      const c = readDngColor(tiff(entries(), le))!
      expect(c).not.toBeNull()
      expect(c.illuminant).toEqual([21, 17])
      c.colorMatrix[0]!.forEach((x, i) => expect(x).toBeCloseTo(CM1[i], 9))
      c.colorMatrix[1]!.forEach((x, i) => expect(x).toBeCloseTo(CM2[i], 9))
      expect(c.cameraCalibration[0]![0]).toBeCloseTo(0.9844, 9)
      expect(c.cameraCalibration[1]).toBeNull()
      expect(c.analogBalance).toEqual([1, 1, 1])
      expect(c.asShotNeutral).toEqual([0.46875, 1, 0.625])
      expect(c.asShotWhiteXY).toBeNull()
      expect(c.baselineExposure).toBeCloseTo(-0.3, 9)
      expect(c.forwardMatrix[0]![4]).toBeCloseTo(0.9, 12)
      expect(c.forwardMatrix[1]).toBeNull()
    })
  }

  it('ignores files that are not DNGs and matrices that are not 3×3 or are singular', () => {
    expect(readDngColor(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0, 0]))).toBeNull()
    expect(readDngColor(tiff(entries().filter((e) => e.tag !== 50706), true))).toBeNull()
    const four = entries().map((e) => (e.tag === 50721 ? { ...e, values: srat([...CM1, 0.1, 0.2, 0.3]) } : e))
    expect(readDngColor(tiff(four, true))!.colorMatrix[0]).toBeNull()
    const singular = entries().map((e) => (e.tag === 50722 ? { ...e, values: srat([1, 2, 3, 2, 4, 6, 0, 0, 1]) } : e))
    expect(readDngColor(tiff(singular, true))!.colorMatrix[1]).toBeNull()
  })

  it('reads AsShotWhiteXY when there is no AsShotNeutral', () => {
    const e = entries().filter((x) => x.tag !== 50728)
    e.push({ tag: 50729, type: 5, values: [3127, 10000, 3290, 10000] })
    const c = readDngColor(tiff(e, false))!
    expect(c.asShotNeutral).toBeNull()
    expect(c.asShotWhiteXY![0]).toBeCloseTo(0.3127, 9)
    expect(c.asShotWhiteXY![1]).toBeCloseTo(0.329, 9)
  })
})
