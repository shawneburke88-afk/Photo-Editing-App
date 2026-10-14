// Soft proofing settings (docs/PHASE3.md Part 20). They are a way of viewing, not part of the edit: remembered in this
// browser (localStorage), never written to the catalog's edits, the history or sidecars, and never used by Export or
// thumbnails.

export type ProofIntent = 'perceptual' | 'relative' | 'saturation' | 'absolute'

export interface ProofSettings {
  /** Soft proofing shown (S). */
  on: boolean
  /** `builtin:<id>` (profiles.ts) or `user:<hash>` (a profile loaded from disk, store.ts). */
  profile: string
  intent: ProofIntent
  /** Black point compensation (ignored with Absolute Colorimetric). */
  bpc: boolean
  /** Simulate Paper & Ink: the paper's white and the ink's black instead of the screen's. */
  simulatePaper: boolean
  /** Destination gamut warning (Shift+S): colours the destination can't reproduce. */
  destWarning: boolean
  /** Screen gamut warning: proofed colours outside the canvas's colour space (sRGB or Display P3). */
  screenWarning: boolean
}

/** Owner's decision (2026-10-14): Relative Colorimetric with black point compensation by default. */
export const DEFAULT_PROOF: ProofSettings = {
  on: false,
  profile: 'builtin:srgb',
  intent: 'relative',
  bpc: true,
  simulatePaper: false,
  destWarning: false,
  screenWarning: false,
}

export const PROOF_STORAGE_KEY = 'lightbench.proof'

export const INTENT_LABELS: Record<ProofIntent, string> = {
  perceptual: 'Perceptual',
  relative: 'Relative Colorimetric',
  saturation: 'Saturation',
  absolute: 'Absolute Colorimetric',
}

/** Little CMS's intent numbers (lcms2.h INTENT_*). */
export const INTENT_CODE: Record<ProofIntent, number> = { perceptual: 0, relative: 1, saturation: 2, absolute: 3 }

const INTENTS = Object.keys(INTENT_LABELS) as ProofIntent[]

/** Stored settings as they are read back: anything missing or malformed takes its default. */
export function cleanProof(v: unknown): ProofSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof ProofSettings, unknown>>
  const bool = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d)
  const profile = typeof o.profile === 'string' && /^(builtin|user):[\w.-]{1,64}$/.test(o.profile) ? o.profile : DEFAULT_PROOF.profile
  return {
    on: bool(o.on, DEFAULT_PROOF.on),
    profile,
    intent: INTENTS.includes(o.intent as ProofIntent) ? (o.intent as ProofIntent) : DEFAULT_PROOF.intent,
    bpc: bool(o.bpc, DEFAULT_PROOF.bpc),
    simulatePaper: bool(o.simulatePaper, DEFAULT_PROOF.simulatePaper),
    destWarning: bool(o.destWarning, DEFAULT_PROOF.destWarning),
    screenWarning: bool(o.screenWarning, DEFAULT_PROOF.screenWarning),
  }
}

/** What the lookup table depends on (the warnings don't: they are drawn by the display shader from the same table). */
export interface LutOptions {
  intent: ProofIntent
  /** Effective: false with Absolute Colorimetric, which doesn't use black point compensation. */
  bpc: boolean
  simulatePaper: boolean
}

export function lutOptions(s: Pick<ProofSettings, 'intent' | 'bpc' | 'simulatePaper'>): LutOptions {
  return { intent: s.intent, bpc: s.intent !== 'absolute' && s.bpc, simulatePaper: s.simulatePaper }
}

/**
 * Grid points per axis of the proof table. Measured (proof.test.ts, Node 22, lcms-wasm 1.0.5): 33³ builds in about
 * 70 ms and its trilinear interpolation differs from Little CMS per pixel by 0.15–0.19 8-bit levels on average, at
 * most about 2; 65³ builds in 0.3–0.5 s and differs by 0.04–0.06 on average, at most about 1. 65³ (8.8 MB on the GPU,
 * both slice sets): built once per profile and options in a worker, so the extra time is rarely seen.
 */
export const LUT_SIZE = 65

/**
 * The cache key of a proof table: the destination profile's bytes (by hash), the options and the grid size. Two keys
 * are equal exactly when the tables would be.
 */
export function proofKey(profileHash: string, o: LutOptions, size = LUT_SIZE): string {
  return `${profileHash}|${o.intent}|bpc${o.bpc ? 1 : 0}|paper${o.simulatePaper ? 1 : 0}|${size}`
}

/**
 * Round-trip distance (CIE76 ΔE) above which a colour counts as outside the destination's gamut. Inside a matrix
 * profile's gamut the round trip is exact (0); a printer profile's tables give small errors inside its gamut (measured
 * for the test printer in proof.test.ts). 2 ΔE is LightBench's choice, near the often-quoted just-noticeable difference
 * of about 2.3 ΔE76 (general knowledge, not checked here).
 */
export const GAMUT_DE = 2
