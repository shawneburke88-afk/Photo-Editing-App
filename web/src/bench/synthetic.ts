// Test images for the GPU benchmark (PHASE3.md Part 16), made in the page so the benchmark needs no photo of the
// user's and nothing is downloaded: a Bayer mosaic (24 and 45 MP), an X-Trans mosaic (26 MP) and an sRGB image
// (24 MP), all from one procedural scene. Speed doesn't depend on what a photo shows except in a few places
// (highlight reconstruction works on clipped areas, Remove on texture), so the scene has smooth gradients, colour
// patches, fine chirps for the demosaic, a clipped highlight and noise. Deterministic: the same size gives the same
// pixels on every machine.

import { XYZ_TO_SRGB, type Mat3 } from '../engine/color/matrix'
import { linearizationLut, profileToRec2020, SRGB_PROFILE } from '../engine/color/icc'
import { sonyFromTags } from '../engine/lens/meta'
import type { LensMeta } from '../engine/lens/meta'
import type { DecodeResult, RgbImage, SensorData } from '../engine/raw/types'

export type SyntheticKind = 'bayer' | 'xtrans' | 'srgb'

export interface SyntheticSpec {
  id: string
  kind: SyntheticKind
  /** Nominal size (before `?benchmp=` scaling). */
  width: number
  height: number
  label: string
}

export const SYNTHETIC: Record<'bayer24' | 'bayer45' | 'xtrans26' | 'srgb24', SyntheticSpec> = {
  bayer24: { id: 'bayer24', kind: 'bayer', width: 6000, height: 4000, label: 'Bayer 24 MP (synthetic)' },
  bayer45: { id: 'bayer45', kind: 'bayer', width: 8256, height: 5504, label: 'Bayer 45 MP (synthetic)' },
  xtrans26: { id: 'xtrans26', kind: 'xtrans', width: 6240, height: 4160, label: 'X-Trans 26 MP (synthetic)' },
  srgb24: { id: 'srgb24', kind: 'srgb', width: 6000, height: 4000, label: 'sRGB 24 MP (synthetic)' },
}

/** The X-Trans pattern LibRaw reports for the X-T2, X-T4, X100F and X100V (rows of 6; 0 R, 1 G, 2 B). */
export const FUJI_XTRANS = '110112112110201021112110110112021201'.split('').map(Number)

/** Bayer RGGB. */
const RGGB: [number, number, number, number] = [0, 1, 1, 2]

/** As-shot white balance of the synthetic RAWs (green = 1), and their black and white levels (14 bits). */
const WB: [number, number, number] = [2.1, 1, 1.55]
const BLACK = 512
const WHITE = 16383

/**
 * The size used for a spec: the nominal size, or (with `megapixels`, the `?benchmp=` override for testing) the same
 * aspect at that many megapixels, with even sides (a multiple of 6 for X-Trans, so the pattern stays whole).
 */
export function scaledSize(spec: SyntheticSpec, megapixels: number | null): [number, number] {
  if (!megapixels) return [spec.width, spec.height]
  const step = spec.kind === 'xtrans' ? 6 : 2
  const k = Math.sqrt((megapixels * 1e6) / (spec.width * spec.height))
  const w = Math.max(step * 8, Math.round((spec.width * k) / step) * step)
  const h = Math.max(step * 8, Math.round((spec.height * k) / step) * step)
  return [w, h]
}

/** A fast deterministic hash of a pixel index → 0…1. */
function hash01(i: number): number {
  let x = (i ^ 0x9e3779b9) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

/** 24 patch colours (linear), a colour-checker-like set. */
const PATCHES: [number, number, number][] = [
  [0.17, 0.08, 0.05], [0.55, 0.3, 0.22], [0.12, 0.19, 0.33], [0.1, 0.15, 0.06], [0.24, 0.22, 0.43], [0.13, 0.5, 0.4],
  [0.68, 0.2, 0.03], [0.07, 0.1, 0.38], [0.53, 0.09, 0.12], [0.1, 0.04, 0.14], [0.35, 0.5, 0.05], [0.77, 0.36, 0.02],
  [0.03, 0.05, 0.28], [0.06, 0.29, 0.07], [0.44, 0.03, 0.04], [0.85, 0.58, 0.01], [0.5, 0.08, 0.3], [0, 0.23, 0.37],
  [0.88, 0.88, 0.86], [0.58, 0.59, 0.59], [0.36, 0.36, 0.36], [0.19, 0.19, 0.19], [0.09, 0.09, 0.09], [0.03, 0.03, 0.03],
]

/**
 * The scene, linear sRGB (1 = the sensor's white for green): per-column and per-row tables combined per pixel, so a
 * 45 MP image takes about a second. `channel` 0 R, 1 G, 2 B.
 */
function sceneRows(w: number, h: number) {
  const u = new Float32Array(w)
  const chirpX = new Float32Array(w)
  const cellX = new Uint8Array(w)
  for (let x = 0; x < w; x++) {
    u[x] = x / w
    // A chirp: from coarse to about 2 px per period across the width (demosaic stress, moiré).
    const t = x / w
    chirpX[x] = Math.sin(Math.PI * t * t * w * 0.24)
    cellX[x] = Math.min(5, Math.floor(t * 6))
  }
  const v = new Float32Array(h)
  const chirpY = new Float32Array(h)
  const cellY = new Uint8Array(h)
  for (let y = 0; y < h; y++) {
    v[y] = y / h
    const t = y / h
    chirpY[y] = Math.sin(Math.PI * t * t * h * 0.24)
    cellY[y] = Math.min(3, Math.floor(t * 4))
  }
  const cx = 0.78 * w
  const cy = 0.22 * h
  const r2 = (0.06 * Math.min(w, h)) ** 2
  return (channel: number, x: number, y: number, i: number): number => {
    const cell = cellY[y] * 6 + cellX[x]
    let val: number
    if (cell % 4 === 1) {
      // Chirp cells: fine detail.
      val = 0.25 + 0.2 * chirpX[x] * chirpY[y]
    } else if (cell % 4 === 3) {
      val = PATCHES[cell % 24][channel]
    } else {
      // Gradients.
      val = channel === 0 ? 0.04 + 0.5 * u[x] : channel === 1 ? 0.04 + 0.45 * v[y] : 0.06 + 0.4 * (1 - u[x])
    }
    // A highlight above the sensor's white: clipped in every channel at its centre, in some towards its edge.
    const dx = x - cx
    const dy = y - cy
    const d2 = dx * dx + dy * dy
    if (d2 < r2 * 4) val += 2.2 * Math.max(0, 1 - d2 / (r2 * 4)) * (channel === 2 ? 0.7 : 1)
    // Shot and read noise.
    const n = hash01(i * 3 + channel) + hash01(i * 3 + channel + 1) - 1
    return Math.max(0, val + n * (0.004 + 0.02 * Math.sqrt(Math.max(0, val))))
  }
}

/** A synthetic mosaic (Bayer RGGB or X-Trans) of w × h photosites, 14 bits, black 512. */
export function syntheticSensor(kind: 'bayer' | 'xtrans', w: number, h: number): SensorData {
  const data = new Uint16Array(w * h)
  const scene = sceneRows(w, h)
  const scale = WHITE - BLACK
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      const c = kind === 'xtrans' ? FUJI_XTRANS[(y % 6) * 6 + (x % 6)] : RGGB[((y & 1) << 1) | (x & 1)]
      const i = row + x
      const raw = BLACK + (scene(c, x, y, i) / WB[c]) * scale
      data[i] = raw >= WHITE ? WHITE : raw
    }
  }
  return {
    width: w,
    height: h,
    data,
    layout: kind,
    cfa: kind === 'xtrans' ? [FUJI_XTRANS[0], FUJI_XTRANS[1], FUJI_XTRANS[6], FUJI_XTRANS[7]] as [number, number, number, number] : RGGB,
    ...(kind === 'xtrans' ? { xtrans: FUJI_XTRANS } : {}),
    black: [BLACK, BLACK, BLACK, BLACK],
    white: WHITE,
    whiteSource: 'synthetic',
    wb: WB,
    // Camera RGB is linear sRGB here.
    camToRgb: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    xyzToCam: [...(XYZ_TO_SRGB as Mat3)],
  }
}

/** A synthetic sRGB image (8 bits per channel, like a JPEG's pixels). */
export function syntheticRgb(w: number, h: number): RgbImage {
  const pixels = new Uint8ClampedArray(w * h * 4)
  const scene = sceneRows(w, h)
  const oetf = new Uint8Array(4097)
  for (let k = 0; k <= 4096; k++) {
    const l = k / 4096
    oetf[k] = Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055))
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      for (let c = 0; c < 3; c++) {
        const l = Math.min(1, scene(c, x, y, i) * 0.85)
        pixels[4 * i + c] = oetf[(l * 4096) | 0]
      }
      pixels[4 * i + 3] = 255
    }
  }
  return {
    width: w,
    height: h,
    pixels,
    profileName: SRGB_PROFILE.name,
    toRec2020: [...profileToRec2020(SRGB_PROFILE)],
    lut: linearizationLut(SRGB_PROFILE) as Float32Array<ArrayBuffer>,
  }
}

/** Sony-style lens data (the ILCE-6300 test file's kind: distortion, lateral CA and vignetting knots). */
export function syntheticLens(): LensMeta {
  return {
    make: 'SONY',
    model: 'ILCE-6300',
    lens: 'E PZ 18-105mm F4 G OSS',
    lensFrom: 'exif',
    focal: 50,
    aperture: 8,
    distance: 0,
    focal35: 75,
    embedded: sonyFromTags(
      [11, 0, 14, 58, 144, 273, 431, 647, 906, 1236, 1653, 2185],
      [22, ...new Array(22).fill(-1408)],
      [11, 0, 64, 272, 608, 1072, 1648, 2320, 3072, 3888, 4736, 5616],
    ),
  }
}

/**
 * The synthetic image as the decoder would hand it over, so it goes through `loadIntoEngine` like a photo. The
 * Bayer image says it is a Sony ILCE-6300 at ISO 400 (so noise reduction uses a real camera profile and the lens
 * correction the camera's own data); the X-Trans image a Fujifilm X-T4; the sRGB image has no camera.
 */
export function syntheticDecode(spec: SyntheticSpec, w: number, h: number): DecodeResult {
  const base = { fileName: `${spec.id}.synthetic`, fileSize: 0, preview: null, timings: { read: 0, open: 0, preview: 0, unpack: 0 } }
  const info = { make: '', model: '', lens: '', iso: 0, shutter: 0, aperture: 0, focalLength: 0, timestamp: 0, flip: 0 }
  if (spec.kind === 'srgb') return { ...base, info, sensor: null, rgb: syntheticRgb(w, h) }
  if (spec.kind === 'xtrans') {
    return { ...base, info: { ...info, make: 'FUJIFILM', model: 'X-T4', iso: 400, shutter: 1 / 125, aperture: 8, focalLength: 23, focal35: 35 }, sensor: syntheticSensor('xtrans', w, h) }
  }
  const lens = syntheticLens()
  return {
    ...base,
    info: { ...info, make: 'SONY', model: 'ILCE-6300', lens: lens.lens, iso: 400, shutter: 1 / 125, aperture: 8, focalLength: 50, focal35: 75 },
    sensor: syntheticSensor('bayer', w, h),
    lens,
  }
}
