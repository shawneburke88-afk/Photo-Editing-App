// ICC colour profiles for non-raw input: reads matrix/TRC ("matrix-shaper") profiles embedded in JPEGs, and
// provides the standard profiles LightBench falls back to.
//
// Input profile choice follows darktable's colorin (src/iop/colorin.c): the embedded ICC profile first, then
// the EXIF interoperability index ("R03" = Adobe RGB), otherwise sRGB ("untagged files are sRGB").
// LUT-based ICC profiles (rare in photos) are not supported yet and fall back to sRGB.

import { invert, mul, XYZ_TO_REC2020, type Mat3 } from './matrix'

/** A tone response curve: maps an encoded value 0…1 to linear light. */
export type Curve =
  | { type: 'gamma'; gamma: number }
  | { type: 'table'; values: number[] } // evenly spaced samples over 0…1
  | { type: 'para'; fn: number; params: number[] } // ICC parametricCurveType

export interface MatrixProfile {
  name: string
  /** Row-major: linear profile RGB → XYZ, PCS-relative (D50), as stored in the profile. */
  toXyzD50: Mat3
  trc: [Curve, Curve, Curve]
}

/** sRGB per IEC 61966-2-1, as ICC parametric curve type 3. */
const SRGB_TRC: Curve = { type: 'para', fn: 3, params: [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045] }

// Colorants of the standard profiles, D50-adapted with Bradford (as ICC profiles store them).
export const SRGB_PROFILE: MatrixProfile = {
  name: 'sRGB',
  toXyzD50: [0.4360747, 0.3850649, 0.1430804, 0.2225045, 0.7168786, 0.0606169, 0.0139322, 0.0971045, 0.7141733],
  trc: [SRGB_TRC, SRGB_TRC, SRGB_TRC],
}

/** Adobe RGB (1998): gamma 563/256. */
export const ADOBE_RGB_PROFILE: MatrixProfile = {
  name: 'Adobe RGB (1998)',
  toXyzD50: [0.6097559, 0.2052401, 0.149224, 0.3111242, 0.6256560, 0.0632197, 0.0194811, 0.0608902, 0.7448387],
  trc: [
    { type: 'gamma', gamma: 563 / 256 },
    { type: 'gamma', gamma: 563 / 256 },
    { type: 'gamma', gamma: 563 / 256 },
  ],
}

/** Bradford chromatic adaptation D50 → D65 (ICC PCS white → working space white). */
const BRADFORD_D50_TO_D65: Mat3 = [
  0.9555766, -0.0230393, 0.0631636,
  -0.0282895, 1.0099416, 0.0210077,
  0.0122982, -0.0204830, 1.3299098,
]

/** Matrix from the profile's linear RGB to LightBench's working space (linear Rec.2020, D65). */
export function profileToRec2020(p: MatrixProfile): Mat3 {
  return mul(XYZ_TO_REC2020, mul(BRADFORD_D50_TO_D65, p.toXyzD50))
}

export function evalCurve(c: Curve, x: number): number {
  x = Math.min(1, Math.max(0, x))
  switch (c.type) {
    case 'gamma':
      return x ** c.gamma
    case 'table': {
      const n = c.values.length
      if (n === 0) return x
      const f = x * (n - 1)
      const i = Math.min(n - 2, Math.floor(f))
      if (n === 1) return c.values[0]
      return c.values[i] + (c.values[i + 1] - c.values[i]) * (f - i)
    }
    case 'para': {
      const [g, a = 1, b = 0, cc = 0, d = 0, e = 0, f = 0] = c.params
      switch (c.fn) {
        case 0:
          return x ** g
        case 1:
          return x >= -b / a ? (a * x + b) ** g : 0
        case 2:
          return x >= -b / a ? (a * x + b) ** g + cc : cc
        case 3:
          return x >= d ? (a * x + b) ** g : cc * x
        case 4:
          return x >= d ? (a * x + b) ** g + e : cc * x + f
        default:
          return x
      }
    }
  }
}

/** Lookup table (n entries per channel, channel-major) from encoded value i/(n−1) to linear light. */
export function linearizationLut(p: MatrixProfile, n = 256): Float32Array {
  const lut = new Float32Array(3 * n)
  for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) lut[c * n + i] = evalCurve(p.trc[c], i / (n - 1))
  return lut
}

// ---- parsing

const s15 = (v: DataView, o: number) => v.getInt32(o) / 65536

function readCurve(v: DataView, o: number, len: number): Curve | null {
  const sig = v.getUint32(o)
  if (sig === 0x63757276 /* curv */) {
    const n = v.getUint32(o + 8)
    if (n === 0) return { type: 'gamma', gamma: 1 }
    if (n === 1) return { type: 'gamma', gamma: v.getUint16(o + 12) / 256 }
    if (12 + 2 * n > len) return null
    return { type: 'table', values: Array.from({ length: n }, (_, i) => v.getUint16(o + 12 + 2 * i) / 65535) }
  }
  if (sig === 0x70617261 /* para */) {
    const fn = v.getUint16(o + 8)
    const count = [1, 3, 4, 5, 7][fn]
    if (count === undefined || 12 + 4 * count > len) return null
    return { type: 'para', fn, params: Array.from({ length: count }, (_, i) => s15(v, o + 12 + 4 * i)) }
  }
  return null
}

function readDescription(v: DataView, o: number, len: number): string {
  const sig = v.getUint32(o)
  const bytes = new Uint8Array(v.buffer, v.byteOffset + o, len)
  if (sig === 0x64657363 /* desc (v2) */) {
    const n = v.getUint32(o + 8)
    return new TextDecoder('latin1').decode(bytes.subarray(12, 12 + Math.max(0, n - 1)))
  }
  if (sig === 0x6d6c7563 /* mluc (v4) */) {
    const records = v.getUint32(o + 8)
    if (records < 1) return ''
    const strLen = v.getUint32(o + 20)
    const strOff = v.getUint32(o + 24)
    const u16 = []
    for (let i = 0; i + 1 < strLen; i += 2) u16.push(v.getUint16(o + strOff + i))
    return String.fromCharCode(...u16)
  }
  return ''
}

/** Parses an RGB matrix/TRC ICC profile. Returns null for other kinds (LUT-based, grey, CMYK) or bad data. */
export function parseIcc(data: Uint8Array): MatrixProfile | null {
  try {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (v.byteLength < 132 || v.getUint32(36) !== 0x61637370 /* acsp */) return null
    if (v.getUint32(16) !== 0x52474220 /* 'RGB ' */) return null
    const count = v.getUint32(128)
    const tags = new Map<string, { off: number; len: number }>()
    for (let i = 0; i < count; i++) {
      const at = 132 + 12 * i
      if (at + 12 > v.byteLength) return null
      const sig = String.fromCharCode(...data.subarray(at, at + 4))
      const off = v.getUint32(at + 4)
      const len = v.getUint32(at + 8)
      if (off + len > v.byteLength) return null
      tags.set(sig, { off, len })
    }
    const xyz = (sig: string) => {
      const t = tags.get(sig)
      if (!t || t.len < 20 || v.getUint32(t.off) !== 0x58595a20 /* 'XYZ ' */) return null
      return [s15(v, t.off + 8), s15(v, t.off + 12), s15(v, t.off + 16)]
    }
    const r = xyz('rXYZ')
    const g = xyz('gXYZ')
    const b = xyz('bXYZ')
    if (!r || !g || !b) return null
    const curve = (sig: string) => {
      const t = tags.get(sig)
      return t ? readCurve(v, t.off, t.len) : null
    }
    const rc = curve('rTRC')
    const gc = curve('gTRC')
    const bc = curve('bTRC')
    if (!rc || !gc || !bc) return null
    const desc = tags.get('desc')
    const name = (desc && readDescription(v, desc.off, desc.len).trim()) || 'Embedded profile'
    // Columns are the colorants: XYZ = [r g b] · rgb.
    const toXyzD50: Mat3 = [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]]
    invert(toXyzD50) // throws for a degenerate matrix
    return { name, toXyzD50, trc: [rc, gc, bc] }
  } catch {
    return null
  }
}

/** Joins the APP2 "ICC_PROFILE" chunks of a JPEG in sequence order. Returns null if there is no profile. */
export function extractJpegIcc(bytes: Uint8Array): Uint8Array | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null
  const chunks: { seq: number; data: Uint8Array }[] = []
  let off = 2
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off)
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda || marker === 0xffd9) break
    const len = v.getUint16(off + 2)
    if (marker === 0xffe2 && len > 16) {
      const sig = new TextDecoder('latin1').decode(bytes.subarray(off + 4, off + 16))
      if (sig === 'ICC_PROFILE\0') chunks.push({ seq: bytes[off + 16], data: bytes.subarray(off + 18, off + 2 + len) })
    }
    off += 2 + len
  }
  if (!chunks.length) return null
  chunks.sort((a, b) => a.seq - b.seq)
  const total = chunks.reduce((n, c) => n + c.data.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c.data, at)
    at += c.data.length
  }
  return out
}

/** darktable colorin order: embedded ICC → EXIF interop index "R03" (Adobe RGB) → sRGB. */
export function chooseInputProfile(icc: Uint8Array | null, interopIndex: string | null): { profile: MatrixProfile; note?: string } {
  if (icc) {
    const p = parseIcc(icc)
    if (p) return { profile: p }
    return { profile: SRGB_PROFILE, note: 'The embedded colour profile is a kind LightBench can’t read yet; sRGB is assumed.' }
  }
  if (interopIndex === 'R03') return { profile: ADOBE_RGB_PROFILE }
  return { profile: SRGB_PROFILE }
}

// ---- writing (for embedding the output profile in exported files)

/**
 * Builds an ICC v2.1 display profile (matrix/TRC) for embedding in exported images. Parametric curves are
 * written as 1024-entry tables, since v2 has no parametricCurveType.
 */
export function buildIcc(p: MatrixProfile, copyright = 'No copyright, use freely'): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder()
  const ascii = (s: string) => enc.encode(s.replace(/[^\x20-\x7e]/g, '?'))
  const pad4 = (n: number) => (n + 3) & ~3

  const xyzTag = (x: number, y: number, z: number) => {
    const b = new DataView(new ArrayBuffer(20))
    b.setUint32(0, 0x58595a20)
    ;[x, y, z].forEach((v, i) => b.setInt32(8 + 4 * i, Math.round(v * 65536)))
    return new Uint8Array(b.buffer)
  }
  const curveTag = (c: Curve) => {
    if (c.type === 'gamma') {
      const b = new DataView(new ArrayBuffer(14))
      b.setUint32(0, 0x63757276)
      b.setUint32(8, 1)
      b.setUint16(12, Math.round(c.gamma * 256))
      return new Uint8Array(b.buffer)
    }
    const n = c.type === 'table' ? c.values.length : 1024
    const b = new DataView(new ArrayBuffer(12 + 2 * n))
    b.setUint32(0, 0x63757276)
    b.setUint32(8, n)
    for (let i = 0; i < n; i++) {
      const v = c.type === 'table' ? c.values[i] : evalCurve(c, i / (n - 1))
      b.setUint16(12 + 2 * i, Math.round(Math.min(1, Math.max(0, v)) * 65535))
    }
    return new Uint8Array(b.buffer)
  }
  const descTag = (s: string) => {
    const a = ascii(s)
    const b = new DataView(new ArrayBuffer(12 + a.length + 1 + 4 + 4 + 2 + 1 + 67))
    b.setUint32(0, 0x64657363)
    b.setUint32(8, a.length + 1)
    new Uint8Array(b.buffer).set(a, 12)
    return new Uint8Array(b.buffer)
  }
  const textTag = (s: string) => {
    const a = ascii(s)
    const b = new Uint8Array(8 + a.length + 1)
    new DataView(b.buffer).setUint32(0, 0x74657874)
    b.set(a, 8)
    return b
  }

  const m = p.toXyzD50
  const trcSame = JSON.stringify(p.trc[0]) === JSON.stringify(p.trc[1]) && JSON.stringify(p.trc[1]) === JSON.stringify(p.trc[2])
  const red = curveTag(p.trc[0])
  const entries: [string, Uint8Array][] = [
    ['desc', descTag(p.name)],
    ['cprt', textTag(copyright)],
    ['wtpt', xyzTag(0.9642, 1, 0.8249)],
    ['rXYZ', xyzTag(m[0], m[3], m[6])],
    ['gXYZ', xyzTag(m[1], m[4], m[7])],
    ['bXYZ', xyzTag(m[2], m[5], m[8])],
    ['rTRC', red],
    ['gTRC', trcSame ? red : curveTag(p.trc[1])],
    ['bTRC', trcSame ? red : curveTag(p.trc[2])],
  ]
  // Lay out tag data (shared curves point at the same bytes).
  let off = pad4(128 + 4 + 12 * entries.length)
  const placed = new Map<Uint8Array, number>()
  for (const [, data] of entries) {
    if (placed.has(data)) continue
    placed.set(data, off)
    off = pad4(off + data.length)
  }
  const out = new Uint8Array(off)
  const v = new DataView(out.buffer)
  v.setUint32(0, off)
  v.setUint32(8, 0x02100000)
  v.setUint32(12, 0x6d6e7472) // mntr
  v.setUint32(16, 0x52474220) // 'RGB '
  v.setUint32(20, 0x58595a20) // 'XYZ '
  const now = new Date()
  ;[now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()].forEach((x, i) =>
    v.setUint16(24 + 2 * i, x),
  )
  v.setUint32(36, 0x61637370) // acsp
  ;[0.9642, 1, 0.8249].forEach((x, i) => v.setInt32(68 + 4 * i, Math.round(x * 65536)))
  v.setUint32(128, entries.length)
  entries.forEach(([sig, data], i) => {
    const at = 132 + 12 * i
    out.set(ascii(sig), at)
    v.setUint32(at + 4, placed.get(data)!)
    v.setUint32(at + 8, data.length)
  })
  for (const [data, at] of placed) out.set(data, at)
  return out
}

// ---- standard output spaces

/** RGB → XYZ (D50, Bradford-adapted) from chromaticities, as ICC profiles store colorants. */
export function colorantsFromPrimaries(r: [number, number], g: [number, number], b: [number, number], white: [number, number]): Mat3 {
  const xyz = ([x, y]: [number, number]) => [x / y, 1, (1 - x - y) / y]
  const [R, G, B, W] = [xyz(r), xyz(g), xyz(b), xyz(white)]
  const P: Mat3 = [R[0], G[0], B[0], R[1], G[1], B[1], R[2], G[2], B[2]]
  const Pi = invert(P)
  const S = [0, 1, 2].map((i) => Pi[3 * i] * W[0] + Pi[3 * i + 1] * W[1] + Pi[3 * i + 2] * W[2])
  const M: Mat3 = [P[0] * S[0], P[1] * S[1], P[2] * S[2], P[3] * S[0], P[4] * S[1], P[5] * S[2], P[6] * S[0], P[7] * S[1], P[8] * S[2]]
  return mul(invert(BRADFORD_D50_TO_D65), M)
}

const D65: [number, number] = [0.3127, 0.329]

/** Display P3 (DCI-P3 primaries, D65, sRGB tone curve), as used by Apple and modern wide-gamut screens. */
export const DISPLAY_P3_PROFILE: MatrixProfile = {
  name: 'Display P3',
  toXyzD50: colorantsFromPrimaries([0.68, 0.32], [0.265, 0.69], [0.15, 0.06], D65),
  trc: [SRGB_TRC, SRGB_TRC, SRGB_TRC],
}

export type OutputSpace = 'srgb' | 'display-p3' | 'adobe-rgb'

export const OUTPUT_SPACES: Record<OutputSpace, { profile: MatrixProfile; label: string; cicp?: [number, number] }> = {
  srgb: { profile: SRGB_PROFILE, label: 'sRGB (web, most screens)', cicp: [1, 13] },
  'display-p3': { profile: DISPLAY_P3_PROFILE, label: 'Display P3 (wide gamut screens)', cicp: [12, 13] },
  'adobe-rgb': { profile: ADOBE_RGB_PROFILE, label: 'Adobe RGB (print workflows)' },
}

/** Matrix from linear Rec.2020 (the working space) to a profile's linear RGB, for export. */
export function rec2020ToProfile(p: MatrixProfile): Mat3 {
  return invert(profileToRec2020(p))
}

/** The output tone curve of a profile, as the export shader encodes it. */
export function outputTrc(p: MatrixProfile): { type: 'srgb' } | { type: 'gamma'; gamma: number } {
  const c = p.trc[0]
  return c.type === 'gamma' ? { type: 'gamma', gamma: c.gamma } : { type: 'srgb' }
}
