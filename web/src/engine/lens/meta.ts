// What lens corrections need to know about a RAW file, read with LightBench's TIFF reader (engine/meta/exif.ts):
// the camera and lens names, focal length, aperture and focus distance, and the camera's own correction data.
// LibRaw's WebAssembly binding doesn't expose the correction tags (and its Nikon lens fields read as garbage in
// this build: checked on the D700 and D80 test files), so they are read here.
//
// Where each piece comes from (darktable reads the same tags through exiv2, src/common/exif.cc):
// - Sony: DistortionCorrParams 0x7037, ChromaticAberrationCorrParams 0x7035, VignettingCorrParams 0x7032 in the
//   raw image's IFD (exiv2 "SubImage1"; also IFD0 for DNGs darktable wrote), signed shorts, first value = knots.
// - Fujifilm (RAF): GeometricDistortionParams 0xf00b, ChromaticAberrationParams 0xf00f, VignettingParams 0xf010 in
//   the TIFF structure of the RAF's raw data (exiv2 rafimage.cpp parses the TIFF at the offset stored at byte 100),
//   and CropMode 0x104d in the maker note of the RAF's JPEG ("FUJIFILM" header).
// - Olympus / OM System: 0x150a (distortion) and 0x150c (CA) in the maker note's ImageProcessing IFD 0x2040.
// - DNG: OpcodeList3 0xc74e (WarpRectilinear and FixVignetteRadial) in the raw IFD or IFD0 (dng_opcode.c).
// - Panasonic RW2: DistortionInfo 0x0119 in IFD0, sixteen little-endian signed shorts.
// - The lens name: EXIF LensModel 0xa434 when present. darktable asks exiv2, whose maker-note lens tables
//   (Canon, Nikon, Pentax, Olympus…) LightBench doesn't have. For Nikon files without LensModel (e.g. the D700
//   and D80 test files), LightBench builds a description from the unencrypted maker-note tags Lens 0x0084 (focal
//   and aperture range) and LensType 0x0083 (D, G, E, VR, AF-P), e.g. "18-200mm f/3.5-5.6G VR", for Lensfun's
//   word matching (LightBench's choice; Nikon's encrypted lens ID isn't decoded, so e.g. a VR and a VR II
//   version of a lens can't be told apart). Otherwise LibRaw's lens name is used (decoder.worker.ts).
// - Focus distance: EXIF SubjectDistance 0x9206 when given; darktable's maker-note sources (Nikon, Canon,
//   Olympus, Sony) aren't read, so it is often unknown, and darktable's default of 1000 m is used.

import { TiffReader, type TiffEntry } from '../meta/exif'
import type { EmbeddedData } from './embedded'

export interface LensMeta {
  /** EXIF Make and Model as written by the camera (Lensfun's camera names follow these). */
  make: string
  model: string
  /** The lens name to match (see the header), and where it came from. */
  lens: string
  lensFrom: 'exif' | 'nikon' | 'libraw' | ''
  /** mm, f-number, metres (0 = unknown). */
  focal: number
  aperture: number
  distance: number
  /** 35 mm equivalent focal length (EXIF FocalLengthIn35mmFilm), 0 when unknown. */
  focal35: number
  /** The camera's own correction data, when the file has some. */
  embedded: EmbeddedData | null
}

export const EMPTY_LENS_META: LensMeta = { make: '', model: '', lens: '', lensFrom: '', focal: 0, aperture: 0, distance: 0, focal35: 0, embedded: null }

type Ifd = Map<number, TiffEntry>

/** Reads the lens metadata of a RAW file. Never throws: what can't be read stays empty. */
export function readLensMeta(bytes: Uint8Array): LensMeta {
  const meta: LensMeta = { ...EMPTY_LENS_META }
  try {
    if (ascii(bytes, 0, 8) === 'FUJIFILM') readRaf(bytes, meta)
    else {
      const t = TiffReader.open(bytes, 0)
      if (t) readTiffRaw(bytes, t.tiff, t.ifd0, meta)
    }
  } catch {
    // A damaged or unusual file: keep what was found.
  }
  return meta
}

function ascii(bytes: Uint8Array, at: number, n: number): string {
  let s = ''
  for (let i = 0; i < n && at + i < bytes.length; i++) s += String.fromCharCode(bytes[at + i])
  return s
}

/** A TIFF-based RAW (NEF, ARW, DNG, ORF, RW2, PEF, CR2, …). */
function readTiffRaw(bytes: Uint8Array, t: TiffReader, ifd0Off: number, meta: LensMeta) {
  const ifd0 = t.ifd(ifd0Off)
  meta.make = t.text(ifd0.get(0x010f))
  meta.model = t.text(ifd0.get(0x0110))
  const subs = (ifd: Ifd) => (t.numbers(ifd.get(0x014a), 16)).map((o) => t.ifd(o)).filter((x) => x.size)
  const sub1 = subs(ifd0)[0]
  let exif = t.ifd(t.number(ifd0.get(0x8769)))
  // Panasonic RW2 keeps EXIF in an embedded JPEG (tag 0x2e); the focal length etc. then come from LibRaw.
  if (!exif.size) exif = new Map()
  readExif(bytes, t, exif, meta)

  // DNG opcodes first, then the makers' tags, which win when both are present (darktable reads them in this order).
  const opcodes = sub1?.get(0xc74e) ?? ifd0.get(0xc74e)
  if (opcodes) meta.embedded = parseOpcodeList3(t.bytes(opcodes)) ?? meta.embedded
  const sony = sonyData(t, sub1) ?? sonyData(t, ifd0)
  if (sony) meta.embedded = sony
  const oly = olympusData(bytes, t, exif.get(0x927c))
  if (oly) meta.embedded = oly
  const pana = panasonicData(t, ifd0.get(0x0119) ?? ifd0.get(0xf119))
  if (pana) meta.embedded = pana
}

function readExif(bytes: Uint8Array, t: TiffReader, exif: Ifd, meta: LensMeta) {
  meta.focal = t.number(exif.get(0x920a))
  meta.aperture = t.number(exif.get(0x829d))
  meta.focal35 = t.number(exif.get(0xa405))
  const sd = t.number(exif.get(0x9206))
  // SubjectDistance: 0 means unknown, 0xFFFFFFFF/1 infinity.
  if (sd > 0 && Number.isFinite(sd) && sd < 1e6) meta.distance = sd
  const lens = t.text(exif.get(0xa434))
  if (lens && /[A-Za-z0-9]{2}/.test(lens)) {
    meta.lens = lens
    meta.lensFrom = 'exif'
  }
  if (!meta.lens && /^nikon/i.test(meta.make)) {
    const n = nikonLens(bytes, exif.get(0x927c))
    if (n) {
      meta.lens = n
      meta.lensFrom = 'nikon'
    }
  }
}

// ---- Nikon

/** Nikon's maker note (type 3: "Nikon\0", version, then a TIFF header at +10): a lens description from 0x0084 and 0x0083. */
export function nikonLens(bytes: Uint8Array, mn: TiffEntry | undefined): string {
  if (!mn || ascii(bytes, mn.at, 6) !== 'Nikon\0') return ''
  const t = TiffReader.open(bytes, mn.at + 10)
  if (!t) return ''
  const ifd = t.tiff.ifd(t.ifd0)
  const range = t.tiff.numbers(ifd.get(0x0084), 4)
  if (range.length < 4 || !(range[0] > 0)) return ''
  const type = t.tiff.number(ifd.get(0x0083))
  return nikonDescription(range as [number, number, number, number], type)
}

/**
 * "18-200mm f/3.5-5.6G VR" from Nikon's Lens tag (min/max focal, apertures at them) and LensType bits (exiftool's
 * Nikon LensType: bit 1 D, 2 G, 3 VR, 6 E, 7 AF-P), written as Nikon and Lensfun write Nikon lens names.
 */
export function nikonDescription([f0, f1, a0, a1]: [number, number, number, number], type: number): string {
  const n = (v: number) => String(Math.round(v * 10) / 10)
  const focal = f1 > f0 ? `${n(f0)}-${n(f1)}mm` : `${n(f0)}mm`
  const ap = a1 > a0 && f1 > f0 ? `f/${n(a0)}-${n(a1)}` : `f/${n(a0)}`
  const letter = type & 0x40 ? 'E' : type & 0x04 ? 'G' : type & 0x02 ? 'D' : ''
  return `${type & 0x80 ? 'AF-P ' : ''}${focal} ${ap}${letter}${type & 0x08 ? ' VR' : ''}`
}

/** The description without the type letters and VR (tried when the full one matches nothing, e.g. third-party lenses). */
export const nikonPlain = (s: string) => s.replace(/^AF-P /, '').replace(/([0-9.])[DGE]\b/, '$1').replace(/ VR$/, '')

// ---- Sony

function sonyData(t: TiffReader, ifd: Ifd | undefined): EmbeddedData | null {
  if (!ifd) return null
  const d = t.numbers(ifd.get(0x7037), 64)
  const c = t.numbers(ifd.get(0x7035), 64)
  const v = t.numbers(ifd.get(0x7032), 64)
  return sonyFromTags(d, c, v)
}

/** darktable's checks: nc ≤ 16, the CA tag has 2·nc values, the vignetting tag nc. */
export function sonyFromTags(d: number[], c: number[], v: number[]): EmbeddedData | null {
  if (!d.length || !c.length || !v.length) return null
  const nc = d[0]
  if (!(nc > 1 && nc <= 16 && 2 * nc === c[0] && nc === v[0])) return null
  if (d.length < nc + 1 || c.length < 2 * nc + 1 || v.length < nc + 1) return null
  return { type: 'sony', distortion: d.slice(1, nc + 1), caR: c.slice(1, nc + 1), caB: c.slice(nc + 1, 2 * nc + 1), vignetting: v.slice(1, nc + 1) }
}

// ---- Fujifilm

function readRaf(bytes: Uint8Array, meta: LensMeta) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 108) return
  const jpg = v.getUint32(84)
  const tiffAt = v.getUint32(100)
  let cropMode = 0
  // The JPEG's EXIF: names, focal length, and the maker note's CropMode.
  const app1 = findExifInJpeg(bytes, jpg)
  if (app1 >= 0) {
    const t = TiffReader.open(bytes, app1)
    if (t) {
      const ifd0 = t.tiff.ifd(t.ifd0)
      meta.make = t.tiff.text(ifd0.get(0x010f))
      meta.model = t.tiff.text(ifd0.get(0x0110))
      const exif = t.tiff.ifd(t.tiff.number(ifd0.get(0x8769)))
      readExif(bytes, t.tiff, exif, meta)
      const mn = exif.get(0x927c)
      if (mn && ascii(bytes, mn.at, 8) === 'FUJIFILM') {
        // Fujifilm maker note: little-endian, IFD offset at +8, offsets relative to the maker note.
        const f = new TiffReader(v, mn.at, true)
        cropMode = f.number(f.ifd(f.u32(mn.at + 8)).get(0x104d))
      }
    }
  }
  const t = TiffReader.open(bytes, tiffAt)
  if (!t) return
  const found = new Map<number, number[]>()
  const seen = new Set<number>()
  const walk = (off: number, depth: number) => {
    if (depth > 4 || seen.has(off)) return
    seen.add(off)
    const ifd = t.tiff.ifd(off)
    for (const tag of [0xf00b, 0xf00f, 0xf010]) if (ifd.has(tag) && !found.has(tag)) found.set(tag, t.tiff.numbers(ifd.get(tag), 64))
    for (const tag of [0xf000, 0x014a]) for (const o of t.tiff.numbers(ifd.get(tag), 8)) walk(o, depth + 1)
  }
  walk(t.ifd0, 0)
  const fuji = fujiFromTags(found.get(0xf00b) ?? [], found.get(0xf00f) ?? [], found.get(0xf010) ?? [], cropMode)
  if (fuji) meta.embedded = fuji
}

/** The position of the TIFF header inside a JPEG's EXIF APP1 segment, or −1. */
function findExifInJpeg(bytes: Uint8Array, at: number): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (at + 4 > bytes.length || v.getUint16(at) !== 0xffd8) return -1
  let off = at + 2
  while (off + 4 <= bytes.length) {
    const marker = v.getUint16(off)
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return -1
    const len = v.getUint16(off + 2)
    if (marker === 0xffe1 && ascii(bytes, off + 4, 6) === 'Exif\0\0') return off + 10
    off += 2 + len
  }
  return -1
}

/** darktable's Fujifilm reading: X-Trans IV/V layouts (19/29/19 values) and I/II/III (23/31/23); knots must agree. */
export function fujiFromTags(d: number[], c: number[], v: number[], cropMode: number): EmbeddedData | null {
  const cropf = cropMode === 2 || cropMode === 4 ? 1.25 : 1
  const knots: number[] = []
  const distortion: number[] = []
  const caR: number[] = []
  const caB: number[] = []
  const vignetting: number[] = []
  if (d.length === 19 && c.length === 29 && v.length === 19) {
    for (let i = 0; i < 9; i++) {
      const kd = d[i + 1]
      if (kd !== c[i + 1] || kd !== v[i + 1]) return null
      knots.push(kd)
      distortion.push(d[i + 10])
      caR.push(c[i + 10])
      caB.push(c[i + 19])
      vignetting.push(v[i + 10])
    }
  } else if (d.length === 23 && c.length === 31 && v.length === 23) {
    for (let i = 0; i < 11; i++) {
      const kd = d[i + 1]
      // The CA data has no knot at 0.
      const kc = i ? c[i] : 0
      if (kd !== kc || kd !== v[i + 1]) return null
      knots.push(kd)
      distortion.push(d[i + 12])
      caR.push(i ? c[i + 10] : 0)
      caB.push(i ? c[i + 20] : 0)
      vignetting.push(v[i + 12])
    }
  } else return null
  return { type: 'fuji', knots, distortion, caR, caB, vignetting, cropf }
}

// ---- Olympus / OM System

function olympusData(bytes: Uint8Array, t: TiffReader, mn: TiffEntry | undefined): EmbeddedData | null {
  if (!mn) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let reader: TiffReader
  let ifdOff: number
  const head = ascii(bytes, mn.at, 12)
  if (head.startsWith('OLYMPUS\0') || head.startsWith('OM SYSTEM\0')) {
    // New style: byte order after the name, IFD at +12 (+16 for OM SYSTEM), offsets relative to the maker note.
    const om = head.startsWith('OM SYSTEM')
    const bo = om ? mn.at + 12 : mn.at + 8
    reader = new TiffReader(v, mn.at, v.getUint16(bo) === 0x4949)
    ifdOff = om ? 16 : 12
  } else if (head.startsWith('OLYMP\0')) {
    // Old style: IFD at +8, offsets relative to the file's TIFF header.
    reader = t
    ifdOff = mn.at + 8 - t.base
  } else return null
  const main = reader.ifd(ifdOff)
  const ip = main.get(0x2040)
  if (!ip) return null
  // The ImageProcessing IFD is either pointed to (LONG / IFD) or stored in place (UNDEFINED).
  const ipOff = ip.type === 7 ? ip.at - reader.base : reader.number(ip)
  const ipIfd = reader.ifd(ipOff)
  return olympusFromTags(reader.numbers(ipIfd.get(0x150a), 8), reader.numbers(ipIfd.get(0x150c), 8))
}

/** darktable: distortion needs 4 values with one of the first three non-zero; CA 6 values with one non-zero. */
export function olympusFromTags(dist: number[], ca: number[]): EmbeddedData | null {
  const d = dist.length === 4 && dist.slice(0, 3).some((x) => x !== 0) ? dist : null
  const c = ca.length === 6 && ca.some((x) => x !== 0) ? ca : null
  return d || c ? { type: 'olympus', dist: d, ca: c } : null
}

// ---- Panasonic

function panasonicData(t: TiffReader, e: TiffEntry | undefined): EmbeddedData | null {
  if (!e) return null
  const b = t.bytes(e)
  if (b.length !== 32) return null
  const v = new DataView(b.buffer, b.byteOffset, 32)
  return panasonicFromWords(Array.from({ length: 16 }, (_, i) => v.getInt16(2 * i, true)))
}

/** darktable: enabled when the low nibble of word 7 is 1; scale = 1 / (1 + w5/32768), a = w8, b = w4, c = w11 (/32768). */
export function panasonicFromWords(w: number[]): EmbeddedData | null {
  if ((w[7] & 0x0f) !== 1) return null
  return { type: 'panasonic', scale: 1 / (1 + w[5] / 32768), a: w[8] / 32768, b: w[4] / 32768, c: w[11] / 32768 }
}

// ---- DNG

/** dng_opcode.c `dt_dng_opcode_process_opcode_list_3`: WarpRectilinear (1) and FixVignetteRadial (3). Big-endian. */
export function parseOpcodeList3(buf: Uint8Array): EmbeddedData | null {
  if (buf.length < 4) return null
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let count = v.getUint32(0)
  let off = 4
  let warp: number[][] | null = null
  let planes = 0
  let vignette: number[] | null = null
  while (count-- > 0 && off + 16 <= buf.length) {
    const id = v.getUint32(off)
    const size = v.getUint32(off + 12)
    const p = off + 16
    if (p + size > buf.length) return null
    if (id === 1) {
      const n = v.getUint32(p)
      if (n !== 1 && n !== 3) return null
      planes = n
      warp = []
      for (let c = 0; c < n; c++) warp.push(Array.from({ length: 6 }, (_, i) => v.getFloat64(p + 4 + 8 * (i + c * 6))))
    } else if (id === 3) {
      vignette = Array.from({ length: 5 }, (_, i) => v.getFloat64(p + 8 * i))
    }
    off = p + size
  }
  return warp || vignette ? { type: 'dng', planes: planes || 1, warp, vignette } : null
}
