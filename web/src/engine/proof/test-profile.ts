// Test only (not imported by the app): a printer-like LUT-based ICC profile, so soft proofing's tests go through a CMM
// the way a real printer profile does. Not a real device: a gamut smaller than sRGB's in greens and blues, gamma 1.8, an
// ink black at about L* 12.5 and a paper white darker and warmer than D50. Written as ICC v2.4 output-class profiles
// with lut16Type (mft2) tables, Lab PCS (ICC.1:2001-04 section 6.5.7; the legacy 16-bit Lab encoding).
// The same model is generated with Little CMS itself for the end-to-end test (scratch script make_printer_icc.py).

const D50 = [0.9642, 1, 0.8249]
const PRIMARIES: [number, number][] = [[0.6, 0.33], [0.31, 0.55], [0.17, 0.13]]
const GAMMA = 1.8
const BLACK = 0.015
const PAPER = [0.9642 * 0.87, 0.89, 0.8249 * 0.8]

function solve3(m: number[], v: number[]): number[] {
  const det = (a: number[]) => a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6])
  const d = det(m)
  return [0, 1, 2].map((c) => {
    const mm = [...m]
    for (let r = 0; r < 3; r++) mm[3 * r + c] = v[r]
    return det(mm) / d
  })
}

const M = (() => {
  const cols = PRIMARIES.map(([x, y]) => [x / y, 1, (1 - x - y) / y])
  const P = [cols[0][0], cols[1][0], cols[2][0], cols[0][1], cols[1][1], cols[2][1], cols[0][2], cols[1][2], cols[2][2]]
  const S = solve3(P, D50)
  return [P[0] * S[0], P[1] * S[1], P[2] * S[2], P[3] * S[0], P[4] * S[1], P[5] * S[2], P[6] * S[0], P[7] * S[1], P[8] * S[2]]
})()

const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29)
const finv = (t: number) => (t > 6 / 29 ? t ** 3 : 3 * (6 / 29) ** 2 * (t - 4 / 29))
const xyzToLab = (x: number, y: number, z: number) => {
  const [fx, fy, fz] = [f(x / D50[0]), f(y / D50[1]), f(z / D50[2])]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
const labToXyz = (L: number, a: number, b: number) => {
  const fy = (L + 16) / 116
  return [D50[0] * finv(fy + a / 500), D50[1] * finv(fy), D50[2] * finv(fy - b / 200)]
}

/** Device RGB (0…1) → PCS Lab, relative to the paper (white L* 100). */
export function printerRgbToLab(rgb: number[]): number[] {
  const lin = rgb.map((c) => Math.min(1, Math.max(0, c)) ** GAMMA)
  const xyz = [0, 1, 2].map((r) => M[3 * r] * lin[0] + M[3 * r + 1] * lin[1] + M[3 * r + 2] * lin[2])
  const [x, y, z] = xyz.map((v, i) => BLACK * D50[i] + (1 - BLACK) * v)
  return xyzToLab(x, y, z)
}

/** PCS Lab → device RGB, clipping to the gamut; `squeeze` < 1 pulls chroma in first (a crude perceptual table). */
export function printerLabToRgb(lab: number[], squeeze = 1): number[] {
  const [x, y, z] = labToXyz(lab[0], lab[1] * squeeze, lab[2] * squeeze).map((v, i) => (v - BLACK * D50[i]) / (1 - BLACK))
  return solve3(M, [x, y, z]).map((c) => Math.min(1, Math.max(0, c)) ** (1 / GAMMA))
}

type Encoder = (out: number[], inp: number[]) => void

/** An mft2 tag: identity curves, a CLUT of `grid` points per input sampled from `fn` (inputs 0…1, outputs 0…65535). */
function mft2(inCh: number, outCh: number, grid: number, fn: Encoder): Uint8Array {
  const entries = 2
  const clut = grid ** inCh * outCh
  const size = 52 + 2 * (inCh * entries + clut + outCh * entries)
  const b = new DataView(new ArrayBuffer(size))
  b.setUint32(0, 0x6d667432) // 'mft2'
  b.setUint8(8, inCh)
  b.setUint8(9, outCh)
  b.setUint8(10, grid)
  ;[1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => b.setInt32(12 + 4 * i, v * 65536))
  b.setUint16(48, entries)
  b.setUint16(50, entries)
  let at = 52
  const put = (v: number) => {
    b.setUint16(at, Math.max(0, Math.min(65535, Math.round(v))))
    at += 2
  }
  for (let c = 0; c < inCh; c++) [0, 65535].forEach(put)
  const idx = new Array(inCh).fill(0)
  const out = new Array(outCh).fill(0)
  for (let k = 0; k < grid ** inCh; k++) {
    // The first input channel varies slowest.
    let r = k
    for (let c = inCh - 1; c >= 0; c--) {
      idx[c] = r % grid
      r = Math.floor(r / grid)
    }
    fn(out, idx.map((i) => i / (grid - 1)))
    out.forEach(put)
  }
  for (let c = 0; c < outCh; c++) [0, 65535].forEach(put)
  return new Uint8Array(b.buffer)
}

// The legacy (v2) 16-bit Lab encoding of lut16Type: L* 0…100 → 0…0xFF00, a*/b* −128…127.996 → 0…0xFFFF.
const labEnc = (lab: number[]) => [lab[0] * 652.8, (lab[1] + 128) * 256, (lab[2] + 128) * 256]
const labDec = (v: number[]) => [(v[0] * 65535) / 652.8, (v[1] * 65535) / 256 - 128, (v[2] * 65535) / 256 - 128]

function textTag(s: string): Uint8Array {
  const a = new TextEncoder().encode(s)
  const out = new Uint8Array(8 + a.length + 1)
  new DataView(out.buffer).setUint32(0, 0x74657874)
  out.set(a, 8)
  return out
}

function descTag(s: string): Uint8Array {
  const a = new TextEncoder().encode(s)
  const out = new Uint8Array(12 + a.length + 1 + 4 + 4 + 2 + 1 + 67)
  const v = new DataView(out.buffer)
  v.setUint32(0, 0x64657363)
  v.setUint32(8, a.length + 1)
  out.set(a, 12)
  return out
}

function xyzTag(x: number, y: number, z: number): Uint8Array {
  const v = new DataView(new ArrayBuffer(20))
  v.setUint32(0, 0x58595a20)
  ;[x, y, z].forEach((n, i) => v.setInt32(8 + 4 * i, Math.round(n * 65536)))
  return new Uint8Array(v.buffer)
}

/**
 * The test printer as an ICC profile. `kind` 'rgb' (an RGB-driven inkjet, like most photo printer profiles) or 'cmyk'
 * (CMY plus black by 50 % grey component replacement). The perceptual tables (A2B0/B2A0) squeeze chroma to 85 % before
 * clipping; the colorimetric ones (A2B1/B2A1) clip.
 */
export function testPrinterProfile(kind: 'rgb' | 'cmyk', name = `LightBench test printer (${kind.toUpperCase()})`): Uint8Array<ArrayBuffer> {
  const nch = kind === 'cmyk' ? 4 : 3
  const toRgb = (d: number[]) => (nch === 4 ? [(1 - d[0]) * (1 - d[3]), (1 - d[1]) * (1 - d[3]), (1 - d[2]) * (1 - d[3])] : d)
  const fromRgb = (rgb: number[]) => {
    if (nch === 3) return rgb
    const [c, m, y] = rgb.map((v) => 1 - v)
    const k = 0.5 * Math.min(c, m, y)
    return [...[c, m, y].map((x) => (k < 1 ? 1 - (1 - x) / (1 - k) : 0)), k]
  }
  const a2b = mft2(nch, 3, nch === 4 ? 9 : 17, (out, d) => labEnc(printerRgbToLab(toRgb(d))).forEach((v, i) => (out[i] = v)))
  const b2a = (squeeze: number) => mft2(3, nch, 17, (out, e) => fromRgb(printerLabToRgb(labDec(e), squeeze)).forEach((v, i) => (out[i] = v * 65535)))
  const b2a0 = b2a(0.85)
  const b2a1 = b2a(1)
  const tags: [string, Uint8Array][] = [
    ['desc', descTag(name)],
    ['cprt', textTag('No copyright, use freely (test profile)')],
    ['wtpt', xyzTag(PAPER[0], PAPER[1], PAPER[2])],
    ['A2B0', a2b],
    ['A2B1', a2b],
    ['B2A0', b2a0],
    ['B2A1', b2a1],
  ]
  const pad4 = (n: number) => (n + 3) & ~3
  let off = pad4(128 + 4 + 12 * tags.length)
  const placed: number[] = []
  for (const [, d] of tags) {
    placed.push(off)
    off = pad4(off + d.length)
  }
  const out = new Uint8Array(off)
  const v = new DataView(out.buffer)
  v.setUint32(0, off)
  v.setUint32(8, 0x02400000)
  v.setUint32(12, 0x70727472) // prtr
  v.setUint32(16, nch === 4 ? 0x434d594b : 0x52474220)
  v.setUint32(20, 0x4c616220) // 'Lab '
  v.setUint32(36, 0x61637370) // acsp
  ;[0.9642, 1, 0.8249].forEach((x, i) => v.setInt32(68 + 4 * i, Math.round(x * 65536)))
  v.setUint32(128, tags.length)
  tags.forEach(([sig, d], i) => {
    const at = 132 + 12 * i
    for (let k = 0; k < 4; k++) out[at + k] = sig.charCodeAt(k)
    v.setUint32(at + 4, placed[i])
    v.setUint32(at + 8, d.length)
    out.set(d, placed[i])
  })
  return out
}
