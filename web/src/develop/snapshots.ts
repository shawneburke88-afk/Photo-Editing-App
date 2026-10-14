// Snapshots (docs/PHASE3.md Part 19): named copies of a photo's full develop settings, process version included, with
// the time they were made. Owner's decisions (2026-10-14):
//  - One snapshot = the whole DevelopSettings (so an old snapshot renders exactly as it did) + a name + when it was made.
//    The default name is a date and time stamp (Lightroom's default is one too, per a secondary source); it can be renamed.
//  - Kept in the catalog (table `snapshots`, schema 15) and in the photo's .xmp sidecar as `lightbench:Snapshots` (JSON,
//    like `lightbench:Develop`); a virtual copy's are inside its entry in `lightbench:Versions`. Lightroom's own snapshot
//    field is undocumented, so no `crs:` field is read or written.
//  - Each virtual copy has its own; Copy/Paste, Sync and presets never carry them (they aren't part of DevelopSettings).
//
// This file holds the pure parts: names, the stored and sidecar forms, reading them defensively, the key change
// detection compares, and the three-way merge "Read changes" uses. No catalog or file access, so it is unit-tested.

import type { DevelopSettings } from '../engine/develop/settings'

export interface Snapshot {
  /** Stable id (kept by rename and update), so a sidecar's list can be merged with the catalog's. */
  id: string
  name: string
  /** When it was made (ms since 1970). */
  created: number
  /** The full develop settings, process version included, as stored (normalised when applied). */
  settings: DevelopSettings
}

/** One snapshot as written in a sidecar (`lightbench:Snapshots`, or `snapshots` in a virtual copy's entry). */
export interface SidecarSnapshot {
  id: string
  name: string
  /** ISO 8601 (UTC). */
  created: string
  settings: Record<string, unknown>
}

/** Longest name kept (longer ones are cut). */
export const MAX_NAME = 120

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The default name: the local date and time, "2026-10-14 13:05:22". Lightroom names snapshots with a date/time stamp
 * too (Julieanne Kost's blog, secondary); its exact format isn't known here, so this one is LightBench's.
 */
export function defaultSnapshotName(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** A trimmed name, '' when nothing is left. */
export const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)

/** `wanted`, or "wanted (2)", "(3)"… so no two snapshots of a photo share a name (case-insensitive). `except` is the one renamed. */
export function uniqueName(wanted: string, list: readonly Snapshot[], except?: string): string {
  const taken = new Set(list.filter((s) => s.id !== except).map((s) => s.name.toLowerCase()))
  if (!taken.has(wanted.toLowerCase())) return wanted
  for (let i = 2; ; i++) {
    const n = `${wanted} (${i})`
    if (!taken.has(n.toLowerCase())) return n
  }
}

export function newSnapshotId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** A new snapshot of `settings` (copied, so later changes to the photo don't reach it). */
export function makeSnapshot(settings: DevelopSettings, list: readonly Snapshot[], name?: string, now = new Date()): Snapshot {
  const wanted = cleanName(name ?? '') || defaultSnapshotName(now)
  return { id: newSnapshotId(), name: uniqueName(wanted, list), created: now.getTime(), settings: JSON.parse(JSON.stringify(settings)) as DevelopSettings }
}

/** Listed newest first, like the History panel (equal times: by name). */
export function sortSnapshots(list: readonly Snapshot[]): Snapshot[] {
  return [...list].sort((a, b) => b.created - a.created || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

const iso = (ms: number) => new Date(Number.isFinite(ms) ? ms : 0).toISOString().replace(/\.000Z$/, 'Z')

/** The sidecar form, oldest first (a stable order, so the file only changes when a snapshot does). */
export function toSidecar(list: readonly Snapshot[]): SidecarSnapshot[] {
  return [...list]
    .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
    .map((s) => ({ id: s.id, name: s.name, created: iso(s.created), settings: s.settings as unknown as Record<string, unknown> }))
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Reads a sidecar's list defensively: anything that isn't a list gives null (ignored, the photo's snapshots stay as they
 * are); entries without a name or settings are left out; a missing id is made from the name and time (so the same file
 * gives the same id every time); a missing or bad time reads as 0 (1970); repeated ids keep the first.
 */
export function readSidecarSnapshots(v: unknown): SidecarSnapshot[] | null {
  if (!Array.isArray(v)) return null
  const out: SidecarSnapshot[] = []
  const seen = new Set<string>()
  for (const e of v) {
    if (!isObject(e) || typeof e.name !== 'string' || !isObject(e.settings)) continue
    const name = cleanName(e.name)
    if (!name) continue
    const t = typeof e.created === 'string' ? Date.parse(e.created) : typeof e.created === 'number' ? e.created : NaN
    const created = iso(Number.isFinite(t) ? t : 0)
    const id = typeof e.id === 'string' && e.id.trim() ? e.id.trim().slice(0, 64) : `sidecar:${created}:${name}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, name, created, settings: e.settings })
  }
  return out
}

/** `lightbench:Snapshots`' text read defensively (damaged JSON gives null). */
export function parseSidecarSnapshots(text: string | null | undefined): SidecarSnapshot[] | null {
  if (!text) return null
  try {
    return readSidecarSnapshots(JSON.parse(text))
  } catch {
    return null
  }
}

/** Sidecar entries as snapshots (settings as written; they are normalised when applied). */
export const fromSidecar = (list: readonly SidecarSnapshot[]): Snapshot[] =>
  list.map((s) => ({ id: s.id, name: s.name, created: Date.parse(s.created) || 0, settings: s.settings as unknown as DevelopSettings }))

/**
 * The key change detection compares (sidecar/changes.ts): the sidecar form as JSON. Equal lists give equal keys whatever
 * their order.
 */
export const snapshotsKey = (list: readonly Snapshot[]): string => JSON.stringify(toSidecar(list))

/** A key back to snapshots (null when it isn't one). */
export function parseSnapshotsKey(key: string | undefined | null): Snapshot[] | null {
  const l = parseSidecarSnapshots(key)
  return l ? fromSidecar(l) : null
}

const same = (a: Snapshot | undefined, b: Snapshot | undefined) => JSON.stringify(a && toSidecar([a])) === JSON.stringify(b && toSidecar([b]))

/**
 * Read changes, by snapshot (id): what the other app added, changed or deleted since the base is taken; what LightBench
 * added or changed meanwhile and the other app didn't touch stays. When both changed the same snapshot, the other app's
 * wins, because the user chose to read its changes (the rule for every other field).
 */
export function mergeSnapshots(base: readonly Snapshot[], ours: readonly Snapshot[], theirs: readonly Snapshot[]): Snapshot[] {
  const b = new Map(base.map((s) => [s.id, s]))
  const o = new Map(ours.map((s) => [s.id, s]))
  const t = new Map(theirs.map((s) => [s.id, s]))
  const out: Snapshot[] = []
  for (const id of new Set([...o.keys(), ...t.keys(), ...b.keys()])) {
    const was = b.get(id)
    const mine = o.get(id)
    const other = t.get(id)
    // Added, changed or deleted by the other app: its version (or none). Otherwise LightBench's (or none, if deleted here).
    if (!same(was, other)) {
      if (other) out.push(other)
    } else if (mine) out.push(mine)
  }
  return sortSnapshots(out)
}
