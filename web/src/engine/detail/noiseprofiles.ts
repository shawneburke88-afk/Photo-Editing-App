// darktable's per-camera noise profiles (data/noiseprofiles.json, GPL like LightBench) and how darktable picks one
// for a photo (src/common/noiseprofiles.c `dt_noiseprofile_get_matching`, `dt_noiseprofile_interpolate`;
// src/iop/denoiseprofile.c `dt_iop_denoiseprofile_get_auto_profile`, lines 2810-2895).
//
// A profile is a fit of the sensor's noise per ISO: variance = a · signal + b per colour channel (Poissonian part a,
// Gaussian part b), on raw data normalised to 0…1. LightBench ships its own pinned copy (web/noiseprofiles/), which
// each build converts to one compact JSON file (web/noiseprofiles-plugin.ts, `compactNoiseProfiles` below),
// downloaded the first time noise reduction is used and kept for offline use (noise-db.ts).

/** One profile: ISO and the a, b fits per colour channel (R, G, B). */
export interface NoiseProfile {
  iso: number
  a: [number, number, number]
  b: [number, number, number]
}

/** The compact file: makers in darktable's order, each with its models and their profiles. */
export interface NoiseProfileData {
  source: { repo: string; commit: string; date: string; licence: string }
  /** [maker, [[model, [[iso, a0, a1, a2, b0, b1, b2], …]], …]] in the file's order; `skip` entries left out. */
  makers: [string, [string, number[][]][]][]
}

/** darktable's `dt_noiseprofile_generic` ("generic poissonian"): a = 0.0001, b = 0 (noiseprofiles.c, line 26). */
export const GENERIC_PROFILE: NoiseProfile = { iso: 0, a: [0.0001, 0.0001, 0.0001], b: [0, 0, 0] }

/** The nearest float32 written with as few digits as round-trip it (darktable reads the values into floats). */
export function f32Text(v: number): number {
  const f = Math.fround(v)
  for (let p = 6; p < 10; p++) {
    const t = Number(f.toPrecision(p))
    if (Math.fround(t) === f) return t
  }
  return f
}

interface DtFile {
  version: number
  noiseprofiles: { maker: string; models: { model: string; profiles: { iso: number; a: number[]; b: number[]; skip?: boolean }[] }[] }[]
}

/**
 * darktable's file → the compact form: names and comments dropped, `skip` profiles dropped (darktable skips them
 * when matching, noiseprofiles.c lines 286-298), ISO as darktable's int, a and b as float32 values.
 */
export function compactNoiseProfiles(text: string, source: NoiseProfileData['source']): NoiseProfileData {
  const d = JSON.parse(text) as DtFile
  // darktable refuses other file versions (noiseprofiles.c, line 116).
  if (d.version !== 0) throw new Error(`Unknown noise profile file version ${d.version}`)
  return {
    source,
    makers: d.noiseprofiles.map((mk) => [
      mk.maker,
      mk.models.map((m) => [m.model, m.profiles.filter((p) => !p.skip).map((p) => [Math.trunc(p.iso), ...p.a.map(f32Text), ...p.b.map(f32Text)])] as [string, number[][]]),
    ]),
  }
}

/** The profiles darktable finds for a camera, sorted by ISO (`dt_noiseprofile_get_matching`). */
export function matchingProfiles(data: NoiseProfileData, maker: string, model: string): { maker: string; model: string; profiles: NoiseProfile[] } | null {
  for (const [mk, models] of data.makers) {
    // The file's maker must occur in the photo's maker (g_strstr_len(camera_maker, -1, maker), line 252).
    if (!maker.includes(mk)) continue
    for (const [md, rows] of models) {
      // The model must be equal (g_strcmp0, line 268); the first such model ends the search (goto end).
      if (md !== model) continue
      // darktable prepends each profile and then sorts by ISO with g_list_sort (a stable merge sort), so of two
      // profiles with the same ISO the later one in the file comes first.
      const profiles = rows.map((r) => ({ iso: r[0], a: [r[1], r[2], r[3]], b: [r[4], r[5], r[6]] }) as NoiseProfile).reverse()
      profiles.sort((p, q) => p.iso - q.iso)
      return { maker: mk, model: md, profiles }
    }
  }
  return null
}

/** darktable's linear interpolation between two ISOs (`dt_noiseprofile_interpolate`, float maths). */
export function interpolateProfile(p1: NoiseProfile, p2: NoiseProfile, iso: number): NoiseProfile {
  const f = Math.fround
  const t = Math.min(1, Math.max(0, f(f(iso - p1.iso) / f(p2.iso - p1.iso))))
  const mix = (x: number, y: number) => f(f(f(1 - t) * x) + f(t * y))
  return { iso, a: [0, 1, 2].map((k) => mix(p1.a[k], p2.a[k])) as NoiseProfile['a'], b: [0, 1, 2].map((k) => mix(p1.b[k], p2.b[k])) as NoiseProfile['b'] }
}

/** What was used for a photo, and how it was found (shown in the Noise Reduction section). */
export interface ProfileChoice {
  profile: NoiseProfile
  /**
   * 'found': a profile for exactly this ISO; 'interpolated': between two ISOs; 'generic': darktable's generic
   * profile, with `reason` saying why.
   */
  kind: 'found' | 'interpolated' | 'generic'
  reason?: 'camera' | 'iso' | 'not-raw' | 'no-data'
  /** The camera as the profile file names it (when the camera was found). */
  camera?: string
  /** ISO range the camera's profiles cover. */
  range?: [number, number]
  iso: number
}

/**
 * darktable's automatic profile (`dt_iop_denoiseprofile_get_auto_profile`): the camera's profile for this ISO, or
 * the linear interpolation between the two neighbouring ISOs, else the generic profile — also for an ISO outside
 * the camera's profiled range (darktable does the same: only exact or in-between ISOs match). darktable's ISO shift
 * for in-camera highlight preservation (Fujifilm DR200/DR400, Canon Highlight Tone Priority, Nikon HLG/Active
 * D-Lighting; `_get_iso_highlight_preservation_shift`) isn't applied: LightBench doesn't read those maker notes.
 *
 * `kind` 'rgb' (JPEGs) always gets the generic profile: the camera's profiles describe its raw sensor data, not a
 * processed JPEG (LightBench's choice; darktable would match a JPEG by its EXIF camera too).
 */
export function chooseProfile(data: NoiseProfileData | null, photo: { maker: string; model: string; iso: number; kind: 'raw' | 'rgb' }): ProfileChoice {
  const iso = Math.trunc(photo.iso || 0)
  if (photo.kind === 'rgb') return { profile: GENERIC_PROFILE, kind: 'generic', reason: 'not-raw', iso }
  if (!data) return { profile: GENERIC_PROFILE, kind: 'generic', reason: 'no-data', iso }
  const m = matchingProfiles(data, photo.maker, photo.model)
  if (!m || !m.profiles.length) return { profile: GENERIC_PROFILE, kind: 'generic', reason: 'camera', iso }
  const camera = `${m.maker} ${m.model}`
  const range: [number, number] = [m.profiles[0].iso, m.profiles[m.profiles.length - 1].iso]
  let last: NoiseProfile | null = null
  for (const p of m.profiles) {
    if (p.iso === iso) return { profile: p, kind: 'found', camera, range, iso }
    if (last && last.iso < iso && p.iso > iso) return { profile: interpolateProfile(last, p, iso), kind: 'interpolated', camera, range, iso }
    last = p
  }
  return { profile: GENERIC_PROFILE, kind: 'generic', reason: 'iso', camera, range, iso }
}
