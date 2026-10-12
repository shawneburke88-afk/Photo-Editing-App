// Process versions (owner's decision, 2026-10-12; Lightroom works this way): every edit records the version of
// LightBench's rendering it was made with, so a later change to the rendering never silently changes an
// existing edit. Rendering code reads the version's parameters (`processParams`) instead of fixed constants.
//
// What a version covers: everything that turns the same settings into different pixels — the RAW stage
// (white level choice, highlight reconstruction, demosaic), colour (camera matrix → Rec.2020, white balance
// maths), the slider mappings (exposure, the contrast → sigmoid mapping, the tone-equalizer bands behind
// Highlights/Shadows/Whites/Blacks, Vibrance/Saturation), the display transform, and the geometry stage (crop
// rounding and the warp kernel). A change to any of them that would alter a saved edit's pixels needs a new
// version; bug fixes that only affect broken output and new tools that are off by default don't.
//
// This is separate from `DevelopSettings.version`, which numbers the settings' JSON layout (the schema).
//
// Edits saved before process versions existed are version 1 (that rendering). New edits get the current
// version. An edit from a newer LightBench (a version this build doesn't know) is rendered with the newest
// version known here and is never changed unless the user asks.

/** Tone-equalizer band weights of the four tone sliders (−8 … 0 EV, 9 bands). */
export interface BandWeights {
  blacks: readonly number[]
  shadows: readonly number[]
  highlights: readonly number[]
  whites: readonly number[]
}

export interface ProcessParams {
  /** Max tone-equalizer gain at full slider travel, in EV. */
  toneRange: number
  /**
   * How strongly each slider moves each tone-equalizer band (−8 … 0 EV of pixel brightness after exposure; with
   * the +0.7 EV default, middle grey sits near −1.8 EV and clipped white above 0).
   */
  bandWeights: BandWeights
  /** Contrast slider → sigmoid contrast: 1.5 × 2^(slider/100 × spread). */
  contrastSpread: number
}

export interface ProcessVersion {
  version: number
  /** What changed in this version, in plain words. */
  summary: string
  params: ProcessParams
}

const V1: ProcessParams = {
  toneRange: 1.5,
  bandWeights: {
    blacks: [1, 1, 0.5, 0.1, 0, 0, 0, 0, 0],
    shadows: [0, 0.1, 0.3, 0.8, 1, 0.5, 0.1, 0, 0],
    highlights: [0, 0, 0, 0, 0, 0.1, 0.5, 1, 0.4],
    whites: [0, 0, 0, 0, 0, 0, 0, 0.35, 1],
  },
  contrastSpread: 0.6,
}

export const PROCESS_VERSIONS: ProcessVersion[] = [
  { version: 1, summary: 'LightBench’s first rendering (0.1.0 to 0.3.0): darktable’s RCD, inpaint opposed, tone equalizer and sigmoid.', params: V1 },
]

// Test scaffolding, development server only: `?simulateProcess=2` adds a copy of the newest version under that
// number, so the "Update to current process" offer can be tried before a second rendering exists. Production
// builds drop this (import.meta.env.DEV is false there).
if (import.meta.env.DEV && typeof location !== 'undefined') {
  const n = Number(new URLSearchParams(location.search).get('simulateProcess'))
  const last = PROCESS_VERSIONS[PROCESS_VERSIONS.length - 1]
  if (Number.isInteger(n) && n > last.version) PROCESS_VERSIONS.push({ version: n, summary: 'Simulated for testing (same rendering as the previous version).', params: last.params })
}

/** The version of edits saved before process versions existed. */
export const LEGACY_PROCESS = 1

/** The version new edits get. */
export const CURRENT_PROCESS = PROCESS_VERSIONS[PROCESS_VERSIONS.length - 1].version

/** A stored version, or the legacy one when missing or malformed. */
export const validProcess = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : LEGACY_PROCESS)

/** The rendering parameters of a version (a newer, unknown version uses the newest known). */
export function processParams(version: number): ProcessParams {
  let best = PROCESS_VERSIONS[0]
  for (const p of PROCESS_VERSIONS) if (p.version <= version) best = p
  return best.params
}

/** How a photo's version compares with this build's. */
export function processStatus(version: number): 'current' | 'older' | 'newer' {
  return version === CURRENT_PROCESS ? 'current' : version < CURRENT_PROCESS ? 'older' : 'newer'
}
