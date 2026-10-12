// Lens corrections (Phase 3, Part 2): distortion, transverse chromatic aberration and vignetting, from the
// camera's own correction data when the RAW file carries it, otherwise from the Lensfun database (owner's
// decision, 2026-10-12, following darktable's lens module, whose methods are "embedded metadata" and "Lensfun
// database", src/iop/lens.cc; darktable prefers the embedded data when present, `reload_defaults`).
//
// Settings and defaults. An edit saved before lens corrections existed has no `lens` field and reads as OFF, so it
// renders exactly as before (owner's decision 3). New edits, unedited photos and Reset get Auto: corrected when a
// profile is found. This is not a process-version change: process versions are for the same settings rendering
// differently (engine/develop/process.ts), and here the settings themselves say whether the lens is corrected;
// an old edit's settings render as they always did. Turning it on for an old edit is one click (the checkbox).
//
// The correction is one more step of the geometry stage's single resample (engine/develop/geometry.ts,
// `withLens`; engine/gpu/warp.wgsl): output pixel → crop, flip, straighten, perspective (a 3×3 map) → the lens
// function → sensor position. Crop coordinates stay in the corrected frame (Part 1's convention): the corrected
// image keeps the photo's size, enlarged by the automatic scale so no empty border shows (darktable's lens
// module default; Lensfun `GetAutoScale` / darktable `_init_coeffs_md_v2`).

import { EMBEDDED_NAMES, embeddedSourcePoint, embeddedVignettingGain, embeddedWarp, type EmbeddedWarp } from './embedded'
import { cameraName, lensName, lensfunSourcePoint, lensfunVignettingGain, lensfunWarp, matchLensfun, type DbLens, type LensfunDb, type LensfunWarp } from './lensfun'
import { mlTexts, type LensfunCamera } from './lensfun-xml'
import { nikonPlain, type LensMeta } from './meta'

export interface LensSettings {
  /** Lens corrections on: Auto (corrected when a profile is found). Off for edits saved before lens corrections. */
  enabled: boolean
  /** 'auto': the camera's own corrections when the file has them, else Lensfun; 'lensfun': always Lensfun. */
  source: 'auto' | 'lensfun'
  /** A Lensfun camera and lens picked by hand (`lensfunKey`); null = matched from the file. */
  camera: string | null
  lens: string | null
  /**
   * The photo the picks were made for (`pickKey`: camera and lens as the file names them). Picks are used only
   * on photos with the same camera and lens, so a pasted pick never lands on another lens; those match their own.
   */
  pickedFor: string | null
  /** Lightroom-style amounts, 0…200 %, 100 = the profile. */
  distortion: number
  vignetting: number
  /** Remove chromatic aberration (transverse CA, from the profile). */
  ca: boolean
}

/** New edits: Auto. */
export const DEFAULT_LENS: LensSettings = { enabled: true, source: 'auto', camera: null, lens: null, pickedFor: null, distortion: 100, vignetting: 100, ca: true }

/** Edits saved before lens corrections existed: off, so they render exactly as before. */
export const LEGACY_LENS: LensSettings = { ...DEFAULT_LENS, enabled: false }

const amount = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(200, Math.max(0, v)) : 100)
const key = (v: unknown) => (typeof v === 'string' && v ? v : null)

/** Fills in stored lens settings; none at all (an older edit) is off. */
export function normalizeLens(l: Partial<LensSettings> | null | undefined): LensSettings {
  if (!l || typeof l !== 'object') return LEGACY_LENS
  return {
    enabled: l.enabled === true,
    source: l.source === 'lensfun' ? 'lensfun' : 'auto',
    camera: key(l.camera),
    lens: key(l.lens),
    pickedFor: key(l.pickedFor),
    distortion: amount(l.distortion),
    vignetting: amount(l.vignetting),
    ca: l.ca !== false,
  }
}

export const sameLens = (a: LensSettings, b: LensSettings) =>
  a.enabled === b.enabled && a.source === b.source && a.camera === b.camera && a.lens === b.lens && a.pickedFor === b.pickedFor && a.distortion === b.distortion && a.vignetting === b.vignetting && a.ca === b.ca

/** A Lensfun camera's or lens's identity for the settings: maker and model as in the database (default texts). */
export const lensfunKey = (x: LensfunCamera | DbLens) =>
  `${mlTexts(x.maker)[0] ?? ''}\u001f${mlTexts(x.model)[0] ?? ''}${'mount' in x && x.variant ? `\u001f${mlTexts(x.variant)[0] ?? ''}` : ''}`

/** What the picks are tied to: the camera and the lens as the file names them. */
export const pickKey = (meta: Pick<LensMeta, 'make' | 'model' | 'lens'>) => `${meta.make}\u001f${meta.model}\u001f${meta.lens}`

export type LensWarp = LensfunWarp | EmbeddedWarp

/** Where channel `channel` of the corrected image at (x, y) (pixel centres at whole numbers) is read in the sensor image. */
export function lensSourcePoint(w: LensWarp, x: number, y: number, channel: 0 | 1 | 2 = 1): [number, number] {
  return w.kind === 'lensfun' ? lensfunSourcePoint(w, x, y, channel) : embeddedSourcePoint(w, x, y, channel)
}

/** The vignetting gain at sensor pixel (x, y). */
export function lensVignettingGain(w: LensWarp, x: number, y: number): number {
  return w.kind === 'lensfun' ? lensfunVignettingGain(w, x, y) : embeddedVignettingGain(w, x, y)
}

/** What the Lens section shows. */
export interface LensStatus {
  state: 'off' | 'not-raw' | 'loading' | 'no-data' | 'not-found' | 'applied'
  /** The data used, when corrected. */
  source?: 'camera' | 'lensfun'
  /** The camera's correction data in the file (e.g. "Sony"), whether used or not. */
  embedded?: string
  /** Lensfun's camera and lens (matched or picked), when Lensfun is used or was asked. */
  camera?: string
  lens?: string
  /** What the file says the lens is. */
  exifLens: string
  /** Why nothing was found, in plain words. */
  reason?: string
  done?: { distortion: boolean; tca: boolean; vignetting: boolean }
}

/** The Lensfun database, as far as it is available. */
export type LensDbState = LensfunDb | 'loading' | 'failed'

/** True when these settings need the Lensfun database for this photo. */
export const needsLensfun = (meta: LensMeta | null, s: LensSettings) => !!meta && s.enabled && (s.source === 'lensfun' || !meta.embedded)

/**
 * The correction for a photo: its metadata, the settings, the sensor image's size (w × h, sensor orientation) and
 * the Lensfun database. Returns the warp to apply (null = none) and what to show.
 */
export function resolveLens(meta: LensMeta | null, s: LensSettings, w: number, h: number, db: LensDbState | null): { warp: LensWarp | null; status: LensStatus } {
  const exifLens = meta?.lens ?? ''
  const embedded = meta?.embedded ? EMBEDDED_NAMES[meta.embedded.type] : undefined
  if (!meta) return { warp: null, status: { state: 'not-raw', exifLens } }
  if (!s.enabled) return { warp: null, status: { state: 'off', exifLens, embedded } }
  const amounts = { distortionAmount: s.distortion / 100, vignettingAmount: s.vignetting / 100 }
  if (meta.embedded && s.source === 'auto') {
    const warp = embeddedWarp(meta.embedded, w, h, { distortion: true, tca: s.ca, vignetting: true, ...amounts, caAmount: 1 })
    if (warp) return { warp, status: { state: 'applied', source: 'camera', embedded, exifLens, done: warp.done } }
    return { warp: null, status: { state: 'not-found', embedded, exifLens, reason: 'The camera’s correction data changes nothing at these settings.' } }
  }
  if (!db || db === 'loading') return { warp: null, status: { state: 'loading', embedded, exifLens } }
  if (db === 'failed') return { warp: null, status: { state: 'no-data', embedded, exifLens, reason: 'The Lensfun lens data couldn’t be downloaded. Connect to the internet once to get it.' } }
  const mine = s.pickedFor === pickKey(meta)
  const pickedCamera = mine && s.camera ? db.cameras.find((c) => lensfunKey(c) === s.camera) ?? null : null
  const picked = { camera: pickedCamera, lens: mine && s.lens ? pickLens(db, s.lens, pickedCamera ?? db.findCameras(meta.make, meta.model)[0]?.camera ?? null) : null }
  const exif = { maker: meta.make, model: meta.model, lens: meta.lens }
  let m = matchLensfun(db, exif, picked)
  // Nikon descriptions built from the maker note: without the type letters when nothing matched (e.g. third-party lenses).
  if (m.camera && !m.lens && !picked.lens && meta.lensFrom === 'nikon') m = matchLensfun(db, { ...exif, lens: nikonPlain(meta.lens) }, picked)
  const camera = m.camera ? cameraName(m.camera) : undefined
  const lens = m.lens ? lensName(m.lens) : undefined
  const base = { embedded, exifLens, camera, lens }
  if (!m.camera) return { warp: null, status: { state: 'not-found', ...base, reason: `${meta.make} ${meta.model}`.trim() ? `The camera (${`${meta.make} ${meta.model}`.trim()}) isn’t in Lensfun’s database. Pick it below.` : 'The camera is unknown. Pick it below.' } }
  if (!m.lens) return { warp: null, status: { state: 'not-found', ...base, reason: exifLens ? `No Lensfun profile matches “${exifLens}”. Pick the lens below.` : 'The file doesn’t name the lens. Pick it below.' } }
  if (!(meta.focal > 0)) return { warp: null, status: { state: 'not-found', ...base, reason: 'The file has no focal length.' } }
  // Without an aperture in the file there is no vignetting correction (Lensfun finds no calibration close enough).
  const warp = lensfunWarp(m.lens, { crop: m.crop, focal: meta.focal, aperture: meta.aperture, distance: meta.distance || 1000 }, w, h, {
    distortion: true,
    tca: s.ca,
    vignetting: true,
    ...amounts,
  })
  if (!warp) {
    const reason = m.crop / m.lens.crop < 0.96 ? `The profile of the ${lens} was made on a smaller sensor than this camera’s, so it can’t be used.` : `The profile of the ${lens} has no data for these settings.`
    return { warp: null, status: { state: 'not-found', ...base, reason } }
  }
  const done = { distortion: !!warp.distortion, tca: !!warp.tca, vignetting: !!warp.vignetting }
  return { warp, status: { state: 'applied', source: 'lensfun', ...base, done } }
}

/**
 * The database entry for a picked lens. Lensfun lists some lenses more than once, with calibrations made on
 * different sensor sizes; as Lensfun's `GetClosestCalibrationSet`, take the one whose calibration crop factor is
 * the closest at or below the camera's (crop ratio ≥ 0.96), else the first.
 */
function pickLens(db: LensfunDb, key: string, camera: LensfunCamera | null): DbLens | null {
  const all = db.lenses.filter((l) => lensfunKey(l) === key)
  if (!camera) return all[0] ?? null
  let best: DbLens | null = null
  for (const l of all) {
    const r = camera.crop / l.crop
    if (r >= 0.96 && (!best || r < camera.crop / best.crop)) best = l
  }
  return best ?? all[0] ?? null
}

/** A key identifying a warp exactly (for caching warped images). */
export const lensWarpKey = (w: LensWarp | null): string => (w ? JSON.stringify(w) : '')
