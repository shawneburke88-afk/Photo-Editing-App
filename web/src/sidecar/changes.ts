// Sidecars changed by other apps (owner's decision, 2026-10-12): LightBench notices when Lightroom, Bridge,
// darktable or another copy of LightBench changes a photo's .xmp file, offers to read the changes, and never
// silently overwrites them.
//
// How a change is noticed (LightBench's own design):
//  - After every read or write, the catalog keeps the sidecar's file date (lastModified) and size, and the fields
//    LightBench cares about as they were in the file then (the "base").
//  - A sidecar whose date and size are the same hasn't changed, so it isn't read. Otherwise it is read and its fields
//    compared with the base. Changes to fields LightBench doesn't use (e.g. Lightroom's crs: develop settings, or
//    xmp:MetadataDate) don't count; those are kept anyway when LightBench rewrites the file.
//  - It is a change by another app when its fields differ from the base and from LightBench's own values.
//  - Reading changes is a three-way merge: only the fields the other app changed are taken, so LightBench's own
//    changes to other fields (e.g. a rating not yet written) are kept. Where both changed the same field, the other
//    app's value is taken, because the user chose to read its changes.
//
// This file holds the comparisons and the merge, without any file or catalog access, so they can be unit-tested.

import type { MetadataKey, PhotoMetadata } from '../catalog/types'
import { creatorList, EMPTY_METADATA, joinCreators, METADATA_KEYS } from '../library/metadata'
import { geometryOf, lrKey, lrState, sameLrKey, toLightroom, type LrFrame } from './lightroom'
import type { SidecarRead } from './xmp'

/** The fields a sidecar is compared on: the standard ones, and LightBench's develop settings. */
export interface SidecarFields {
  /** Stars, 0–5. */
  rating: number
  /** −1 rejected, 0 none, 1 picked; null when the sidecar doesn't say (picks are only in lightbench:Flag). */
  flag: number | null
  /** 0 none, 1 red … 5 purple. */
  color: number
  /** Keyword paths ("Places|Canada|Ottawa"). */
  keywords: string[]
  metadata: PhotoMetadata
  /** LightBench's develop settings (JSON, key order normalised), or null when the sidecar has none. */
  develop: string | null
  /**
   * Lightroom's crop, orientation and Transform (sidecar/lightroom.ts `lrKey`, every field resolved). Undefined in
   * records made before LightBench read them, and when the photo's size isn't known: then it isn't compared.
   */
  geometry?: string
}

/** A field that can differ: the rating, flag, label, keywords, develop settings, Lightroom's geometry, or one metadata field. */
export type FieldKey = 'rating' | 'flag' | 'color' | 'keywords' | 'develop' | 'geometry' | MetadataKey

/** What the catalog remembers about a photo's sidecar file. */
export interface SidecarState {
  /** The file's lastModified (ms) and size when LightBench last read or wrote it; null = no record yet. */
  modified: number | null
  size: number | null
  /** SidecarFields as JSON, as they were in the file then. */
  fields: string | null
  /** Changed by another app, waiting for the user to read or ignore the changes. */
  external: boolean
  /** When LightBench last wrote the sidecar, and when the photo was added (Unix seconds). */
  writtenAt: number | null
  importedAt: number
}

/** A file is only counted as changed after LightBench's last write or read if it is this much newer (clock rounding). */
export const NEWER_MS = 2000

const canonical = (json: string | undefined | null): string | null => {
  if (!json) return null
  try {
    return JSON.stringify(JSON.parse(json))
  } catch {
    return json
  }
}

const metaValue = (key: MetadataKey, v: string | undefined) => (key === 'creator' ? joinCreators(creatorList(v ?? '')) : (v ?? '').trim())

function normalMetadata(m: Partial<PhotoMetadata> | undefined): PhotoMetadata {
  const out = { ...EMPTY_METADATA }
  for (const k of METADATA_KEYS) out[k] = metaValue(k, m?.[k])
  return out
}

/**
 * The fields as a sidecar says them (readXmp's result). Missing stars, label, keywords or metadata count as none.
 * With the photo's `frame`, Lightroom's geometry too (absent fields resolved as Lightroom shows them; an
 * already-applied file's settings count as none).
 */
export function fieldsFromRead(r: SidecarRead, frame?: LrFrame): SidecarFields {
  const out: SidecarFields = {
    rating: r.rating ?? 0,
    flag: r.flag ?? null,
    color: r.color ?? 0,
    keywords: r.keywords ?? [],
    metadata: normalMetadata(r.metadata),
    develop: canonical(r.develop),
  }
  if (frame) out.geometry = lrKey(lrState(r.lightroom && !r.lightroom.applied ? r.lightroom.fields : undefined, frame))
  return out
}

/** The geometry of LightBench's develop settings (JSON) as Lightroom's fields would state it. */
export const geometryKey = (develop: string | null, frame: LrFrame): string => lrKey(toLightroom(geometryOf(develop), frame))

/** LightBench's own values for a photo, as the catalog has them (with `frame`, its geometry as Lightroom's fields). */
export function fieldsFromCatalog(c: { rating: number; flag: number; color: number; keywords: string[]; metadata: PhotoMetadata; develop: string | null }, frame?: LrFrame): SidecarFields {
  const out: SidecarFields = { rating: c.rating, flag: c.flag, color: c.color, keywords: c.keywords, metadata: normalMetadata(c.metadata), develop: canonical(c.develop) }
  if (frame) out.geometry = geometryKey(c.develop, frame)
  return out
}

export function parseFields(json: string | null): SidecarFields | null {
  if (!json) return null
  try {
    const f = JSON.parse(json) as SidecarFields
    if (!(f && typeof f.rating === 'number' && Array.isArray(f.keywords) && f.metadata)) return null
    const out: SidecarFields = { ...f, metadata: normalMetadata(f.metadata) }
    if (typeof out.geometry !== 'string') delete out.geometry
    return out
  } catch {
    return null
  }
}

const keySet = (list: string[]) => new Set(list.map((k) => k.toLowerCase()))

const sameKeywords = (a: string[], b: string[]) => {
  const x = keySet(a)
  const y = keySet(b)
  return x.size === y.size && [...x].every((k) => y.has(k))
}

/** The fields where `a` and `b` differ. */
export function diffFields(a: SidecarFields, b: SidecarFields): FieldKey[] {
  const out: FieldKey[] = []
  if (a.rating !== b.rating) out.push('rating')
  if (a.flag !== b.flag) out.push('flag')
  if (a.color !== b.color) out.push('color')
  if (!sameKeywords(a.keywords, b.keywords)) out.push('keywords')
  for (const k of METADATA_KEYS) if (a.metadata[k] !== b.metadata[k]) out.push(k)
  if (a.develop !== b.develop) out.push('develop')
  // Lightroom's geometry counts only when both sides know it (old records don't).
  if (a.geometry !== undefined && b.geometry !== undefined && !sameLrKey(a.geometry, b.geometry)) out.push('geometry')
  return out
}

/**
 * Fills in what a sidecar doesn't say, from the base:
 *  - No pick/reject information: LightBench always writes a rejection as xmp:Rating −1, so the photo isn't rejected;
 *    a pick stays as it was.
 *  - No LightBench develop settings (e.g. an app that drops other namespaces): LightBench's edits stay. Edits are
 *    never removed because another app left them out.
 */
export function resolve(theirs: SidecarFields, base: SidecarFields): SidecarFields {
  return {
    ...theirs,
    flag: theirs.flag ?? (base.flag === -1 ? 0 : base.flag),
    develop: theirs.develop ?? base.develop,
  }
}

/**
 * A record made before LightBench read Lightroom's geometry has none: it is taken to be what the file says now, so
 * a Lightroom crop that LightBench didn't read before isn't reported as a new change by another app.
 */
const withGeometry = (base: SidecarFields, theirs: SidecarFields): SidecarFields => (base.geometry === undefined ? { ...base, geometry: theirs.geometry } : base)

/** Whether the sidecar file must be read to know if it changed. */
export function needsRead(state: Pick<SidecarState, 'modified' | 'size'>, file: { lastModified: number; size: number }): boolean {
  return state.modified === null || state.modified !== file.lastModified || state.size !== file.size
}

export type Verdict =
  /** Nothing another app changed that LightBench doesn't already have: remember `record` as the new base. */
  | { external: false; record: SidecarFields }
  /** Changed by another app: ask. `changed` are the fields it changed, `conflicts` those LightBench changed too. */
  | { external: true; changed: FieldKey[]; conflicts: FieldKey[] }

/**
 * Judges a sidecar that was read because its date or size changed (or there was no record).
 *
 * With no record (photos added before LightBench watched sidecars, or a sidecar that appeared later), the file only
 * counts as changed by another app if it is newer than LightBench's last write, or than when the photo was added.
 * Otherwise it is taken as the base silently, and LightBench's values are the base when they are compared.
 */
export function judge(state: SidecarState, file: { lastModified: number }, theirsRead: SidecarFields, ours: SidecarFields): Verdict {
  const recorded = state.modified === null ? null : parseFields(state.fields)
  if (!recorded) {
    const since = Math.max(state.writtenAt ?? 0, state.importedAt) * 1000
    if (file.lastModified <= since + NEWER_MS) return { external: false, record: resolve(theirsRead, ours) }
  }
  const base = recorded ? withGeometry(recorded, theirsRead) : ours
  const theirs = resolve(theirsRead, base)
  const changed = diffFields(base, theirs)
  if (!changed.length || !diffFields(ours, theirs).length) return { external: false, record: theirs }
  const ourChanges = new Set(diffFields(base, ours))
  return { external: true, changed, conflicts: changed.filter((k) => ourChanges.has(k)) }
}

/** What "Read changes" does to a photo in the catalog. */
export interface ReadPatch {
  rating?: number
  flag?: number
  color?: number
  addKeywords: string[]
  /** Keyword paths as the catalog has them. */
  removeKeywords: string[]
  metadata: Partial<PhotoMetadata>
  /** Develop settings to add to the photo's history as a new step. */
  develop?: string
  /** Lightroom's geometry (lrKey) to apply to the photo, when Lightroom changed its crop, orientation or Transform. */
  geometry?: string
  /** The sidecar's fields, to remember as the new base. */
  record: SidecarFields
}

/**
 * Read changes: takes the fields the other app changed since the base, and keeps LightBench's value for every other
 * field. Keywords are merged as sets: those the other app added are added and those it removed are removed, and
 * keywords LightBench added meanwhile stay.
 */
export function mergeForRead(recorded: SidecarFields | null, ours: SidecarFields, theirsRead: SidecarFields): ReadPatch {
  const base = recorded ? withGeometry(recorded, theirsRead) : ours
  const theirs = resolve(theirsRead, base)
  const patch: ReadPatch = { addKeywords: [], removeKeywords: [], metadata: {}, record: theirs }
  const changed = new Set(diffFields(base, theirs))
  if (changed.has('rating') && theirs.rating !== ours.rating) patch.rating = theirs.rating
  if (changed.has('flag') && theirs.flag !== null && theirs.flag !== ours.flag) patch.flag = theirs.flag
  if (changed.has('color') && theirs.color !== ours.color) patch.color = theirs.color
  if (changed.has('keywords')) {
    const was = keySet(base.keywords)
    const now = keySet(theirs.keywords)
    const have = keySet(ours.keywords)
    patch.addKeywords = theirs.keywords.filter((k) => !was.has(k.toLowerCase()) && !have.has(k.toLowerCase()))
    patch.removeKeywords = ours.keywords.filter((k) => was.has(k.toLowerCase()) && !now.has(k.toLowerCase()))
  }
  for (const k of METADATA_KEYS) if (changed.has(k) && theirs.metadata[k] !== ours.metadata[k]) patch.metadata[k] = theirs.metadata[k]
  if (changed.has('develop') && theirs.develop && theirs.develop !== ours.develop) patch.develop = theirs.develop
  if (changed.has('geometry') && theirs.geometry && !sameLrKey(theirs.geometry, ours.geometry)) patch.geometry = theirs.geometry
  return patch
}
