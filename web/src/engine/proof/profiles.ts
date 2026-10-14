// The profiles soft proofing ships with, and the two working-space profiles its lookup table is built between.
//
// None is a copy of anyone's ICC file: each is written by LightBench's own ICC writer (icc.ts `buildIcc`, the one
// Export uses to embed its profiles) from published primaries, white point and tone curve:
// - sRGB: IEC 61966-2-1 (primaries 0.64/0.33, 0.30/0.60, 0.15/0.06, D65, the sRGB curve); icc.ts `SRGB_PROFILE`.
// - Adobe RGB (1998)-compatible: the primaries, white point and gamma 563/256 published in Adobe's "Adobe RGB (1998)
//   Color Image Encoding" specification (0.64/0.33, 0.21/0.71, 0.15/0.06, D65); icc.ts `ADOBE_RGB_PROFILE`. Named as
//   compatible so it isn't taken for Adobe's own file.
// - Display P3: DCI-P3 primaries (0.680/0.320, 0.265/0.690, 0.150/0.060) with D65 and the sRGB curve, as Apple's Display
//   P3 is described; icc.ts `DISPLAY_P3_PROFILE`.
// - Rec.2020 (ITU-R BT.2020 primaries 0.708/0.292, 0.170/0.797, 0.131/0.046, D65): LightBench's working space, with the
//   sRGB curve (the table's input axis) and linear (its output).
// The colorants are D50-adapted with Bradford, as ICC profiles store them; buildIcc writes ICC v2.1 matrix/TRC profiles
// (parametric curves as 1024-entry tables).

import { ADOBE_RGB_PROFILE, buildIcc, colorantsFromPrimaries, DISPLAY_P3_PROFILE, SRGB_PROFILE, type MatrixProfile } from '../color/icc'

export interface BuiltinProfile {
  /** `builtin:<id>` in the settings. */
  id: string
  label: string
  /** Where its numbers come from (shown in the profile menu's tooltip). */
  source: string
  profile: MatrixProfile
}

const COPYRIGHT = 'No copyright, use freely. Written by LightBench from published primaries.'

export const BUILTIN_PROFILES: BuiltinProfile[] = [
  { id: 'srgb', label: 'sRGB', source: 'IEC 61966-2-1 primaries, D65 and tone curve', profile: { ...SRGB_PROFILE, name: 'sRGB (LightBench)' } },
  {
    id: 'adobe-rgb-compatible',
    label: 'Adobe RGB (1998)-compatible',
    source: 'Primaries, D65 and gamma 563/256 from the published Adobe RGB (1998) encoding specification; written by LightBench, not Adobe’s file',
    profile: { ...ADOBE_RGB_PROFILE, name: 'Adobe RGB (1998)-compatible (LightBench)' },
  },
  { id: 'display-p3', label: 'Display P3', source: 'DCI-P3 primaries, D65 and the sRGB tone curve', profile: { ...DISPLAY_P3_PROFILE, name: 'Display P3 (LightBench)' } },
]

export function builtinProfile(id: string): BuiltinProfile | null {
  return BUILTIN_PROFILES.find((p) => p.id === id) ?? null
}

/** The ICC bytes of a built-in profile. */
export function builtinIcc(id: string): Uint8Array<ArrayBuffer> {
  const p = builtinProfile(id)
  if (!p) throw new Error(`Unknown built-in profile ${id}`)
  return buildIcc(p.profile, COPYRIGHT)
}

const D65: [number, number] = [0.3127, 0.329]
const REC2020_COLORANTS = colorantsFromPrimaries([0.708, 0.292], [0.17, 0.797], [0.131, 0.046], D65)
const SRGB_CURVE = SRGB_PROFILE.trc[0]
const LINEAR = { type: 'gamma', gamma: 1 } as const

/**
 * The working space as the proof table sees it: Rec.2020 encoded with the sRGB curve (`encoded`: the table's input axis,
 * so grid points are spread like the tones) or linear (`linear`: the table's output, display-referred linear Rec.2020).
 */
export function workingIcc(kind: 'encoded' | 'linear'): Uint8Array<ArrayBuffer> {
  const trc = kind === 'encoded' ? SRGB_CURVE : LINEAR
  return buildIcc({ name: `LightBench working space (Rec.2020, ${kind === 'encoded' ? 'sRGB curve' : 'linear'})`, toXyzD50: REC2020_COLORANTS, trc: [trc, trc, trc] }, COPYRIGHT)
}

/** A profile's identity for caches: SHA-256 of its bytes, the first 16 hex digits. */
export async function profileHash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...d.slice(0, 8)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** What an ICC header says (ICC.1 section 7.2): its class, data colour space, PCS and version. Null if it isn't one. */
export function iccHeader(bytes: Uint8Array): { cls: string; space: string; pcs: string; version: string; size: number } | null {
  if (bytes.length < 132) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sig = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]).trim()
  if (sig(36) !== 'acsp') return null
  const size = v.getUint32(0)
  if (size > bytes.length || size < 132) return null
  return { cls: sig(12), space: sig(16), pcs: sig(20), version: `${bytes[8]}.${bytes[9] >> 4}`, size }
}

export const CLASS_NAMES: Record<string, string> = {
  prtr: 'output (printer)',
  mntr: 'display',
  scnr: 'input',
  link: 'device link',
  spac: 'colour space',
  abst: 'abstract',
  nmcl: 'named colour',
}
