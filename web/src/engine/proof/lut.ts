// The soft-proof lookup table (docs/PHASE3.md Part 20), built with Little CMS (lcms-wasm) in a worker and sampled by
// the display shader (develop-display.wgsl `proofApply`).
//
// Input axis: LightBench's display-referred working space, linear Rec.2020 after the tone mapper and the Tone Curve,
// encoded with the sRGB curve, so the grid points follow the tones. For each grid point:
// - the proofed colour: working space → destination profile (the chosen intent, black point compensation), clamped to
//   the destination's device range as a real conversion would be, → back to linear Rec.2020 (Relative Colorimetric
//   with black point compensation, so the paper's white and the ink's black show as the screen's; with Simulate Paper
//   & Ink, Absolute Colorimetric without it, so they show as the paper's and the ink's). Stored encoded (sign kept).
// - the destination gamut test: the colour's distance (CIE76 ΔE) from its colorimetric round trip through the
//   destination (working space → destination, clamped → Lab, Relative Colorimetric, black point compensation as set),
//   0 inside the destination's gamut. A pixel is marked where it exceeds GAMUT_DE. Little CMS's own gamut check
//   (cmsCreateProofingTransform with cmsFLAGS_GAMUTCHECK, darktable's colorout.c) is the same kind of round trip with
//   its own threshold; its float output only says in or out, which interpolates badly between grid points, so the
//   tests use it as the reference instead (proof.test.ts). lcms-wasm doesn't export cmsSetAlarmCodes; the warning's
//   colour is LightBench's own (the display shader).
// - the proofed colour is made with two transforms rather than Little CMS's proofing transform because a float
//   transform doesn't clamp at a matrix profile's gamut (it would show an sRGB proof unchanged) and lcms's proofing
//   transform has no black point compensation on its way back (Simulate Paper & Ink off).
// - the destination's device values (RGB and grey destinations), for the histogram while proofing.
// The display path after the table (Display P3 or sRGB encoding, clipping indicators) is the usual one, so the table
// doesn't depend on the screen.

import type { LcmsModule } from 'lcms-wasm'
import { GAMUT_DE, INTENT_CODE, type LutOptions } from './settings'

export { GAMUT_DE }
import { iccHeader, workingIcc } from './profiles'

// lcms2.h: formatter fields and flags (lcms-wasm exports no *_FLT formats).
const PT = { GRAY: 3, RGB: 4, CMY: 5, CMYK: 6, Lab: 10 } as const
const flt = (pt: number, channels: number) => (1 << 22) | (pt << 16) | (channels << 3) | 4
const RGB_FLT = flt(PT.RGB, 3)
const LAB_FLT = flt(PT.Lab, 3)
const FLAGS_BPC = 0x2000
const INTENT_RELATIVE = 1
const INTENT_ABSOLUTE = 3
const INFO_DESCRIPTION = 0


/** Device colour spaces a destination may have, with their float range in Little CMS (ink spaces are 0…100). */
const SPACES: Record<string, { pt: number; channels: number; max: number }> = {
  RGB: { pt: PT.RGB, channels: 3, max: 1 },
  GRAY: { pt: PT.GRAY, channels: 1, max: 1 },
  CMYK: { pt: PT.CMYK, channels: 4, max: 100 },
  CMY: { pt: PT.CMY, channels: 3, max: 100 },
}

export interface ProfileInfo {
  /** The profile's description (its `desc` tag), or a fallback. */
  name: string
  /** Data colour space as Little CMS names it: RGB, CMYK, GRAY, CMY. */
  space: string
  /** ICC class signature: prtr, mntr, scnr, spac… */
  cls: string
  version: string
}

export interface ProofLut {
  size: number
  /**
   * N × N × 2N RGBA float texels, red fastest, then green, then blue; slices 0…N−1: the proofed colour (encoded linear
   * Rec.2020; alpha: the gamut test's ΔE, above GAMUT_DE outside the destination's gamut); slices N…2N−1: the destination's device
   * values 0…1 (alpha 1), when `device` is true.
   */
  data: Float32Array<ArrayBuffer>
  device: boolean
  /** The proofed colour of white, linear Rec.2020 (the paper with Simulate Paper & Ink). */
  paper: [number, number, number]
  /** Fraction of grid points outside the destination's gamut. */
  outOfGamut: number
  /** Time to build, ms. */
  ms: number
}

const encode1 = (v: number) => {
  const a = Math.abs(v)
  const e = a <= 0.0031308 ? a * 12.92 : 1.055 * a ** (1 / 2.4) - 0.055
  return v < 0 ? -e : e
}
const decode1 = (e: number) => {
  const a = Math.abs(e)
  const v = a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4
  return e < 0 ? -v : v
}
/** The sRGB curve, mirrored for negatives (how the table stores and the shader reads linear values). */
export const encodeSigned = encode1
export const decodeSigned = decode1

/** Reads a profile's description and colour space; throws a message for people if it can't be a proof destination. */
export function inspectProfile(lcms: LcmsModule, bytes: Uint8Array): ProfileInfo {
  const head = iccHeader(bytes)
  if (!head) throw new Error('This file isn’t an ICC colour profile.')
  if (head.cls === 'link' || head.cls === 'abst' || head.cls === 'nmcl') throw new Error(`This is a ${head.cls === 'link' ? 'device link' : head.cls === 'abst' ? 'abstract' : 'named colour'} profile; soft proofing needs a printer or display profile.`)
  const chain = new ProofChain(lcms, bytes, { intent: 'relative', bpc: true, simulatePaper: false }, false)
  try {
    return { name: chain.name || 'Unnamed profile', space: chain.space, cls: head.cls, version: head.version }
  } finally {
    chain.close()
  }
}

/**
 * Little CMS transforms from the working space to a destination profile and back (see the file's comment). `run`
 * transforms encoded working-space colours; the same chain builds the table and the per-pixel reference in the tests.
 */
export class ProofChain {
  readonly space: string
  readonly name: string
  readonly device: boolean
  private readonly profiles: number[] = []
  private readonly transforms: number[] = []
  private readonly fmt: { pt: number; channels: number; max: number }
  private toDest = 0
  private fromDest = 0
  private toLab = 0
  private toDestRel = 0
  private destToLab = 0
  private readonly lcms: LcmsModule

  constructor(lcms: LcmsModule, dest: Uint8Array, o: LutOptions, withGamut = true) {
    this.lcms = lcms
    try {
      const open = (b: Uint8Array) => {
        const h = lcms.cmsOpenProfileFromMem(b, b.length)
        if (!h) throw new Error('Little CMS couldn’t read this profile.')
        this.profiles.push(h)
        return h
      }
      const hDest = open(dest)
      const space = lcms.cmsGetColorSpaceASCII(hDest) ?? 'unknown'
      const fmt = SPACES[space]
      if (!fmt) throw new Error(`Profiles for ${space} colour aren’t supported (RGB, CMYK, CMY and grey are).`)
      this.space = space
      this.fmt = fmt
      this.name = lcms.cmsGetProfileInfoASCII(hDest, INFO_DESCRIPTION, 'en', 'US').trim()
      this.device = space === 'RGB' || space === 'GRAY'
      const hIn = open(workingIcc('encoded'))
      const hOut = open(workingIcc('linear'))
      const devFmt = flt(fmt.pt, fmt.channels)
      const bpc = o.bpc ? FLAGS_BPC : 0
      const make = (t: number, what: string) => {
        if (!t) throw new Error(`Little CMS couldn’t make a transform ${what} with this profile (it may be an input-only profile).`)
        this.transforms.push(t)
        return t
      }
      this.toDest = make(lcms.cmsCreateTransform(hIn, RGB_FLT, hDest, devFmt, INTENT_CODE[o.intent], bpc), 'to it')
      this.fromDest = make(
        o.simulatePaper
          ? lcms.cmsCreateTransform(hDest, devFmt, hOut, RGB_FLT, INTENT_ABSOLUTE, 0)
          : lcms.cmsCreateTransform(hDest, devFmt, hOut, RGB_FLT, INTENT_RELATIVE, FLAGS_BPC),
        'from it',
      )
      if (withGamut) {
        // The gamut test: a colorimetric round trip through the destination (lcms's own gamut check works the same way,
        // see the file's comment), measured as CIE76 ΔE against the colour itself.
        const lab = lcms.cmsCreateLab4Profile(null)
        if (!lab) throw new Error('Little CMS couldn’t make a Lab profile.')
        this.profiles.push(lab)
        this.toLab = make(lcms.cmsCreateTransform(hIn, RGB_FLT, lab, LAB_FLT, INTENT_RELATIVE, 0), 'to Lab')
        this.toDestRel = o.intent === 'relative' ? this.toDest : make(lcms.cmsCreateTransform(hIn, RGB_FLT, hDest, devFmt, INTENT_RELATIVE, bpc), 'to it (colorimetric)')
        this.destToLab = make(lcms.cmsCreateTransform(hDest, devFmt, lab, LAB_FLT, INTENT_RELATIVE, bpc), 'from it to Lab')
      }
    } catch (e) {
      this.close()
      throw e
    }
  }

  /**
   * `input`: n colours, encoded Rec.2020 (sRGB curve), 3 floats each. Returns the proofed colours (linear Rec.2020), the
   * device values (0…1, as many channels as the destination has) and, with the gamut test, each colour's distance (CIE76
   * ΔE) from its colorimetric round trip through the destination: 0 inside its gamut.
   */
  run(input: Float32Array, n: number): { proof: Float32Array; device: Float32Array; outside: Float32Array | null } {
    const { lcms, fmt } = this
    const device = lcms.cmsDoTransform(this.toDest, input, n)
    // A real conversion clamps to the device's range; Little CMS's float transforms don't (matrix profiles are unbounded).
    for (let i = 0; i < device.length; i++) device[i] = Math.min(fmt.max, Math.max(0, device[i]))
    const proof = lcms.cmsDoTransform(this.fromDest, device, n)
    if (fmt.max !== 1) for (let i = 0; i < device.length; i++) device[i] /= fmt.max
    let outside: Float32Array | null = null
    if (this.toLab) {
      const lab = lcms.cmsDoTransform(this.toLab, input, n)
      let rel = device
      if (this.toDestRel !== this.toDest) {
        rel = lcms.cmsDoTransform(this.toDestRel, input, n)
        for (let i = 0; i < rel.length; i++) rel[i] = Math.min(fmt.max, Math.max(0, rel[i]))
      } else if (fmt.max !== 1) {
        rel = device.map((v) => v * fmt.max)
      }
      const back = lcms.cmsDoTransform(this.destToLab, rel, n)
      outside = new Float32Array(n)
      for (let i = 0; i < n * 3; i += 3) outside[i / 3] = Math.hypot(lab[i] - back[i], lab[i + 1] - back[i + 1], lab[i + 2] - back[i + 2])
    }
    return { proof, device, outside }
  }

  get channels(): number {
    return this.fmt.channels
  }

  close() {
    for (const t of this.transforms) this.lcms.cmsDeleteTransform(t)
    for (const p of this.profiles) this.lcms.cmsCloseProfile(p)
    this.transforms.length = 0
    this.profiles.length = 0
  }
}

/** The grid's input colours (encoded Rec.2020), red fastest. */
export function gridColours(size: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(size * size * size * 3)
  let i = 0
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    out[i++] = r / (size - 1)
    out[i++] = g / (size - 1)
    out[i++] = b / (size - 1)
  }
  return out
}

/** Builds the proof table for a destination profile (bytes) and options. */
export function buildProofLut(lcms: LcmsModule, dest: Uint8Array, o: LutOptions, size: number): ProofLut {
  const t0 = performance.now()
  const chain = new ProofChain(lcms, dest, o)
  try {
    const n = size * size * size
    const { proof, device, outside } = chain.run(gridColours(size), n)
    const data = new Float32Array(n * 8)
    const ch = chain.channels
    let out = 0
    for (let i = 0; i < n; i++) {
      data[i * 4] = encode1(proof[i * 3])
      data[i * 4 + 1] = encode1(proof[i * 3 + 1])
      data[i * 4 + 2] = encode1(proof[i * 3 + 2])
      data[i * 4 + 3] = outside![i]
      if (outside![i] > GAMUT_DE) out++
      if (chain.device) {
        const d = (n + i) * 4
        data[d] = device[i * ch]
        data[d + 1] = device[i * ch + Math.min(1, ch - 1)]
        data[d + 2] = device[i * ch + Math.min(2, ch - 1)]
        data[d + 3] = 1
      }
    }
    const w = (n - 1) * 3
    return { size, data, device: chain.device, paper: [proof[w], proof[w + 1], proof[w + 2]], outOfGamut: out / n, ms: performance.now() - t0 }
  } finally {
    chain.close()
  }
}

/**
 * The shader's lookup (develop-display.wgsl `proofTex`) on the CPU: trilinear interpolation of slice set `layer`
 * (0 colour, 1 device) at an encoded colour, clamped to 0…1. Returns the raw RGBA.
 */
export function sampleLut(lut: Pick<ProofLut, 'size' | 'data'>, layer: 0 | 1, e: [number, number, number]): [number, number, number, number] {
  const n = lut.size
  const f = e.map((v) => Math.min(1, Math.max(0, v)) * (n - 1))
  const i0 = f.map((v) => Math.min(n - 2, Math.floor(v)))
  const t = f.map((v, k) => v - i0[k])
  const at = (r: number, g: number, b: number, c: number) => lut.data[((((b + layer * n) * n + g) * n) + r) * 4 + c]
  const out: [number, number, number, number] = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) {
    const c00 = at(i0[0], i0[1], i0[2], c) * (1 - t[0]) + at(i0[0] + 1, i0[1], i0[2], c) * t[0]
    const c10 = at(i0[0], i0[1] + 1, i0[2], c) * (1 - t[0]) + at(i0[0] + 1, i0[1] + 1, i0[2], c) * t[0]
    const c01 = at(i0[0], i0[1], i0[2] + 1, c) * (1 - t[0]) + at(i0[0] + 1, i0[1], i0[2] + 1, c) * t[0]
    const c11 = at(i0[0], i0[1] + 1, i0[2] + 1, c) * (1 - t[0]) + at(i0[0] + 1, i0[1] + 1, i0[2] + 1, c) * t[0]
    out[c] = (c00 * (1 - t[1]) + c10 * t[1]) * (1 - t[2]) + (c01 * (1 - t[1]) + c11 * t[1]) * t[2]
  }
  return out
}
