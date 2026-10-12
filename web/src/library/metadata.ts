// Descriptive metadata: the fields LightBench edits, how several photos' values combine in the panel, metadata
// presets and their {year} token.
//
// Owner's decisions (2026-10-12): the "core set" below, edited in the Library's right panel; with several photos
// selected, fields that differ show as mixed (Lightroom's "< mixed >") and only edited fields are written; presets
// hold chosen fields and can fill in new photos without overwriting what a photo already has.

import type { MetadataKey, PhotoMetadata } from '../catalog/types'

export interface MetadataField {
  key: MetadataKey
  label: string
  /** Tooltip: what the field is for. */
  help: string
  multiline?: boolean
}

/** The editable fields, in the panel's order (the owner's list). */
export const METADATA_FIELDS: MetadataField[] = [
  { key: 'title', label: 'Title', help: 'A short name for the photo' },
  { key: 'caption', label: 'Caption', help: 'A description of the photo: who, what, where', multiline: true },
  { key: 'creator', label: 'Creator', help: 'The photographer. Separate several names with “;”' },
  { key: 'copyright', label: 'Copyright', help: 'The copyright notice, e.g. © 2026 Your Name' },
  { key: 'copyrightUrl', label: 'Copyright URL', help: 'A web page with the photo’s licence or usage terms' },
  { key: 'headline', label: 'Headline', help: 'A one-line summary of the caption' },
  { key: 'city', label: 'City', help: 'Where the photo was taken' },
  { key: 'state', label: 'State / Province', help: 'Where the photo was taken' },
  { key: 'country', label: 'Country', help: 'Where the photo was taken' },
]

export const METADATA_KEYS: MetadataKey[] = METADATA_FIELDS.map((f) => f.key)

export const EMPTY_METADATA: PhotoMetadata = {
  title: '', caption: '', creator: '', copyright: '', copyrightUrl: '', headline: '', city: '', state: '', country: '',
}

/** The fields that have a value, e.g. what a sidecar or a camera says. */
export function nonEmpty(m: Partial<PhotoMetadata>): Partial<PhotoMetadata> {
  const out: Partial<PhotoMetadata> = {}
  for (const k of METADATA_KEYS) {
    const v = m[k]?.trim()
    if (v) out[k] = v
  }
  return out
}

/** Value shown for a field across the photos being edited: their common value, or null when they differ ("mixed"). */
export type CombinedMetadata = Record<MetadataKey, string | null>

export function combineMetadata(rows: PhotoMetadata[]): CombinedMetadata {
  const out = { ...EMPTY_METADATA } as CombinedMetadata
  for (const k of METADATA_KEYS) {
    const values = new Set(rows.map((r) => r[k]))
    out[k] = values.size > 1 ? null : (rows[0]?.[k] ?? '')
  }
  return out
}

/**
 * Creator names as XMP stores them (dc:creator is an ordered list): split on “;”, trimmed. Several names typed as
 * "A; B" become two entries, and two entries read back as "A; B". (LightBench's choice for showing the list in one
 * text field.)
 */
export function creatorList(text: string): string[] {
  return text.split(';').map((s) => s.trim()).filter(Boolean)
}

export const joinCreators = (names: string[]) => names.join('; ')

// ---- presets

export interface MetadataPreset {
  /** The catalog row id, as text. */
  id: string
  name: string
  /** Only the fields the preset sets (values may hold {year}). */
  fields: Partial<PhotoMetadata>
}

export function metadataPresetFromRow(row: { id: number; name: string; preset: string }): MetadataPreset | null {
  try {
    const d = JSON.parse(row.preset) as { fields?: Partial<PhotoMetadata> }
    const fields: Partial<PhotoMetadata> = {}
    for (const k of METADATA_KEYS) if (typeof d.fields?.[k] === 'string') fields[k] = d.fields[k]
    return { id: String(row.id), name: row.name, fields }
  } catch {
    return null
  }
}

/**
 * Replaces {year} with the year the photo was taken. Without a capture date, the file's date is used, as Import does
 * for its dated folders; with neither, the token is left as typed so it is easy to spot. (LightBench's choice.)
 */
export function expandTokens(text: string, photo: { capturedAt: number; fileModified: number }): string {
  if (!/\{year\}/i.test(text)) return text
  // capturedAt is camera-local time stored as if it were UTC; fileModified is a real moment, shown in local time.
  const year = photo.capturedAt > 0 ? new Date(photo.capturedAt * 1000).getUTCFullYear() : photo.fileModified > 0 ? new Date(photo.fileModified * 1000).getFullYear() : null
  return year === null ? text : text.replace(/\{year\}/gi, String(year))
}

/** A preset's fields for one photo, with tokens expanded. */
export function presetValues(fields: Partial<PhotoMetadata>, photo: { capturedAt: number; fileModified: number }): Partial<PhotoMetadata> {
  const out: Partial<PhotoMetadata> = {}
  for (const k of METADATA_KEYS) {
    const v = fields[k]
    if (v !== undefined) out[k] = expandTokens(v, photo).trim()
  }
  return out
}

/** Groups photos that get the same values (e.g. by year), so each group is one catalog call. */
export function groupByValues<T extends { id: number; capturedAt: number; fileModified: number }>(
  photos: T[],
  fields: Partial<PhotoMetadata>,
): { ids: number[]; values: Partial<PhotoMetadata> }[] {
  const groups = new Map<string, { ids: number[]; values: Partial<PhotoMetadata> }>()
  for (const p of photos) {
    const values = presetValues(fields, p)
    const key = JSON.stringify(values)
    const g = groups.get(key) ?? { ids: [], values }
    g.ids.push(p.id)
    groups.set(key, g)
  }
  return [...groups.values()]
}

/** Short summary of a preset's fields for menus, e.g. "Creator, Copyright". */
export function presetSummary(p: MetadataPreset): string {
  return METADATA_FIELDS.filter((f) => p.fields[f.key] !== undefined).map((f) => f.label).join(', ')
}
