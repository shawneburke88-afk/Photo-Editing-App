import { describe, expect, it } from 'vitest'
import { nikonDescription, nikonPlain, readLensMeta } from './meta'

// Made-up RAW files: TIFF structures with the tags LightBench reads (as darktable reads them through exiv2).

type Value = { type: number; v: number[] | string | Uint8Array }
interface Ifd {
  entries: [number, Value | Ifd][]
}
const isIfd = (x: Value | Ifd): x is Ifd => 'entries' in x
const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 }

/**
 * Lays out `ifd` after `prefix` (offsets count from the start of the result, as in a TIFF file or a maker note).
 * `ifd0At` is where IFD0's offset is written (4 for a TIFF header), if anywhere.
 */
function build(prefix: number[], ifd: Ifd, le = true, ifd0At = -1): Uint8Array {
  const buf = new ArrayBuffer(1 << 16)
  const dv = new DataView(buf)
  const u8 = new Uint8Array(buf)
  u8.set(prefix)
  let end = prefix.length
  const align = () => { if (end % 2) end++ }
  const place = (d: Ifd): number => {
    align()
    const at = end
    const n = d.entries.length
    end += 2 + 12 * n + 4
    dv.setUint16(at, n, le)
    d.entries.forEach(([tag, val], i) => {
      const e = at + 2 + 12 * i
      dv.setUint16(e, tag, le)
      if (isIfd(val)) {
        dv.setUint16(e + 2, 4, le)
        dv.setUint32(e + 4, 1, le)
        dv.setUint32(e + 8, place(val), le)
        return
      }
      const bytes = encode(val, le)
      dv.setUint16(e + 2, val.type, le)
      dv.setUint32(e + 4, val.type === 2 ? bytes.length : bytes.length / SIZE[val.type], le)
      if (bytes.length <= 4) u8.set(bytes, e + 8)
      else {
        align()
        dv.setUint32(e + 8, end, le)
        u8.set(bytes, end)
        end += bytes.length
      }
    })
    dv.setUint32(at + 2 + 12 * n, 0, le)
    return at
  }
  const ifd0 = place(ifd)
  if (ifd0At >= 0) dv.setUint32(ifd0At, ifd0, le)
  return u8.slice(0, end)
}

function encode({ type, v }: Value, le: boolean): Uint8Array {
  if (typeof v === 'string') return new Uint8Array([...v].map((c) => c.charCodeAt(0)).concat(0))
  if (v instanceof Uint8Array) return v
  const out = new DataView(new ArrayBuffer(v.length * SIZE[type]))
  v.forEach((x, i) => {
    const o = i * SIZE[type]
    if (type === 1 || type === 7) out.setUint8(o, x)
    else if (type === 3) out.setUint16(o, x, le)
    else if (type === 8) out.setInt16(o, x, le)
    else if (type === 4) out.setUint32(o, x, le)
    else if (type === 9) out.setInt32(o, x, le)
    else if (type === 5 || type === 10) {
      out.setInt32(o, Math.round(x * 1e6), le)
      out.setInt32(o + 4, 1e6, le)
    } else if (type === 11) out.setFloat32(o, x, le)
    else if (type === 12) out.setFloat64(o, x, le)
  })
  return new Uint8Array(out.buffer)
}

const tiff = (ifd0: Ifd, magic = 42, le = true) => build([...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...(le ? [magic & 0xff, magic >> 8] : [magic >> 8, magic & 0xff]), 0, 0, 0, 0], ifd0, le, 4)
const text = (s: string): Value => ({ type: 2, v: s })
const exif = (lens?: string, makernote?: Uint8Array): Ifd => ({
  entries: [
    [0x829d, { type: 5, v: [8] }],
    [0x920a, { type: 5, v: [97] }],
    [0xa405, { type: 3, v: [145] }],
    ...(lens ? [[0xa434, text(lens)] as [number, Value]] : []),
    ...(makernote ? [[0x927c, { type: 7, v: makernote }] as [number, Value]] : []),
  ],
})

describe('reading lens metadata from RAW files', () => {
  it('Sony ARW: names, focal length and the raw IFD’s correction tags', () => {
    const d = [11, 0, 14, 58, 144, 273, 431, 647, 906, 1236, 1653, 2185, 0, 0, 0, 0, 0]
    const c = [22, ...new Array(22).fill(-1408), ...new Array(10).fill(0)]
    const v = [11, 0, 64, 272, 608, 1072, 1648, 2320, 3072, 3888, 4736, 5616, 0, 0, 0, 0, 0]
    const file = tiff({
      entries: [
        [0x010f, text('SONY')],
        [0x0110, text('ILCE-6300')],
        [0x014a, { entries: [[0x7032, { type: 8, v }], [0x7035, { type: 8, v: c }], [0x7037, { type: 8, v: d }]] }],
        [0x8769, exif('E PZ 18-105mm F4 G OSS')],
      ],
    })
    const m = readLensMeta(file)
    expect(m).toMatchObject({ make: 'SONY', model: 'ILCE-6300', lens: 'E PZ 18-105mm F4 G OSS', lensFrom: 'exif', focal: 97, aperture: 8, focal35: 145 })
    expect(m.embedded).toMatchObject({ type: 'sony', distortion: d.slice(1, 12), vignetting: v.slice(1, 12) })
  })

  it('Nikon NEF: a lens description from the maker note’s Lens and LensType', () => {
    const inner = build([0x4d, 0x4d, 0, 42, 0, 0, 0, 0], { entries: [[0x0083, { type: 1, v: [0x0e] }], [0x0084, { type: 5, v: [18, 200, 3.5, 5.6] }]] }, false, 4)
    const mn = new Uint8Array([...'Nikon\0'].map((ch) => ch.charCodeAt(0)).concat([2, 0x10, 0, 0], [...inner]))
    const m = readLensMeta(tiff({ entries: [[0x010f, text('NIKON CORPORATION')], [0x0110, text('NIKON D80')], [0x8769, exif(undefined, mn)]] }))
    expect(m).toMatchObject({ make: 'NIKON CORPORATION', model: 'NIKON D80', lens: '18-200mm f/3.5-5.6G VR', lensFrom: 'nikon', embedded: null })
  })

  it('writes Nikon descriptions as Lensfun names Nikon lenses', () => {
    expect(nikonDescription([28, 105, 3.5, 4.5], 0x02)).toBe('28-105mm f/3.5-4.5D')
    expect(nikonDescription([50, 50, 1.8, 1.8], 0x02)).toBe('50mm f/1.8D')
    expect(nikonDescription([18, 55, 3.5, 5.6], 0x8e)).toBe('AF-P 18-55mm f/3.5-5.6G VR')
    expect(nikonDescription([70, 200, 2.8, 2.8], 0x4e)).toBe('70-200mm f/2.8E VR')
    expect(nikonPlain('AF-P 18-55mm f/3.5-5.6G VR')).toBe('18-55mm f/3.5-5.6')
  })

  it('Olympus ORF: the maker note’s ImageProcessing IFD (0x2040), offsets from the maker note', () => {
    const header = [...'OLYMPUS\0'].map((ch) => ch.charCodeAt(0)).concat([0x49, 0x49, 3, 0])
    const mn = build(header, { entries: [[0x2040, { entries: [[0x150a, { type: 10, v: [-0.05, 0.01, -0.002, 0.98] }], [0x150c, { type: 10, v: [0.0002, 0, 0, -0.0001, 0, 0] }]] }]] })
    const m = readLensMeta(tiff({ entries: [[0x010f, text('OLYMPUS IMAGING CORP.')], [0x0110, text('E-M5')], [0x8769, exif('M.Zuiko Digital ED 12-50mm F3.5-6.3 EZ', mn)]] }, 0x4f52))
    expect(m.embedded?.type).toBe('olympus')
    if (m.embedded?.type !== 'olympus') return
    expect(m.embedded.dist!.map((x) => Math.round(x * 1e4) / 1e4)).toEqual([-0.05, 0.01, -0.002, 0.98])
    expect(m.embedded.ca![0]).toBeCloseTo(0.0002, 9)
  })

  it('DNG: OpcodeList3 in the raw IFD', () => {
    const op = new DataView(new ArrayBuffer(4 + 16 + 56))
    op.setUint32(0, 1)
    op.setUint32(4, 3)
    op.setUint32(16, 56)
    ;[-0.3, 0.05, -0.01, 0, 0, 0.5, 0.5].forEach((x, i) => op.setFloat64(20 + 8 * i, x))
    const file = tiff({ entries: [[0x010f, text('Leica Camera AG')], [0x014a, { entries: [[0xc74e, { type: 7, v: new Uint8Array(op.buffer) }]] }]] })
    expect(readLensMeta(file).embedded).toEqual({ type: 'dng', planes: 1, warp: null, vignette: [-0.3, 0.05, -0.01, 0, 0] })
  })

  it('Panasonic RW2: DistortionInfo 0x0119 in IFD0', () => {
    const words = new DataView(new ArrayBuffer(32))
    ;[0, 0, 0, 0, 300, 1000, 0, 1, -2000, 0, 0, -50, 2500, 0, 0, 0].forEach((w, i) => words.setInt16(2 * i, w, true))
    const m = readLensMeta(tiff({ entries: [[0x010f, text('Panasonic')], [0x0110, text('DC-G9')], [0x0119, { type: 7, v: new Uint8Array(words.buffer) }]] }, 0x55))
    expect(m.embedded).toEqual({ type: 'panasonic', scale: 1 / (1 + 1000 / 32768), a: -2000 / 32768, b: 300 / 32768, c: -50 / 32768 })
  })

  it('Fujifilm RAF: the raw data’s TIFF (0xf00b, 0xf00f, 0xf010) and the JPEG maker note’s CropMode', () => {
    const knots = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
    const fujiMn = build([...'FUJIFILM'].map((ch) => ch.charCodeAt(0)).concat([12, 0, 0, 0]), { entries: [[0x104d, { type: 3, v: [2] }]] })
    const app1Tiff = tiff({ entries: [[0x010f, text('FUJIFILM')], [0x0110, text('GFX100S')], [0x8769, exif('GF63mmF2.8 R WR', fujiMn)]] })
    const jpeg = [0xff, 0xd8, 0xff, 0xe1, (app1Tiff.length + 8) >> 8, (app1Tiff.length + 8) & 0xff, ...[...'Exif\0\0'].map((c) => c.charCodeAt(0)), ...app1Tiff, 0xff, 0xd9]
    const raw = tiff({ entries: [[0xf000, { entries: [
      [0xf00b, { type: 11, v: [0, ...knots, ...knots.map((k) => -k)] }],
      [0xf00f, { type: 11, v: [0, ...knots, ...knots.map(() => 0.0001), ...knots.map(() => -0.0001), 0] }],
      [0xf010, { type: 11, v: [0, ...knots, ...knots.map((k) => 100 - 20 * k)] }],
    ] }]] })
    const head = new Uint8Array(108)
    head.set([...'FUJIFILMCCD-RAW '].map((c) => c.charCodeAt(0)))
    const file = new Uint8Array(108 + jpeg.length + raw.length)
    file.set(head)
    file.set(jpeg, 108)
    file.set(raw, 108 + jpeg.length)
    const dv = new DataView(file.buffer)
    dv.setUint32(84, 108)
    dv.setUint32(88, jpeg.length)
    dv.setUint32(100, 108 + jpeg.length)
    dv.setUint32(104, raw.length)
    const m = readLensMeta(file)
    expect(m).toMatchObject({ make: 'FUJIFILM', model: 'GFX100S', lens: 'GF63mmF2.8 R WR', focal: 97 })
    expect(m.embedded?.type).toBe('fuji')
    if (m.embedded?.type !== 'fuji') return
    expect(m.embedded.cropf).toBe(1.25)
    expect(m.embedded.knots.map((k) => Math.round(k * 10) / 10)).toEqual(knots)
  })

  it('never throws on damaged files', () => {
    expect(readLensMeta(new Uint8Array([0x49, 0x49, 42, 0, 255, 255, 255, 255]))).toMatchObject({ make: '', embedded: null })
    expect(readLensMeta(new Uint8Array(0))).toMatchObject({ lens: '' })
  })
})
