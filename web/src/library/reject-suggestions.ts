// Applying suggested rejects (docs/PHASE3.md Part 18), and undoing it. Apply only sets reject flags, in one catalog
// transaction, and schedules the photos' sidecar writes (lightbench:Flag and xmp:Rating -1, as the X key does). Undo
// puts back each photo's flag from before, except on photos whose flag was changed since. No file is deleted or changed
// other than the .xmp sidecar, exactly as for a flag set by hand.

import type { PhotoQuery, PhotoRow } from '../catalog/types'

/** What applying needs from the catalog (the worker's handlers or the RPC client). */
export interface FlagCatalog {
  queryPhotos(q: PhotoQuery): PhotoRow[] | Promise<PhotoRow[]>
  setFlag(ids: number[], value: number): void | Promise<void>
}

export interface AppliedRejects {
  ids: number[]
  /** Each photo's flag before Apply. */
  before: Map<number, number>
}

export async function applyRejects(catalog: FlagCatalog, ids: number[], schedule: (ids: number[]) => void): Promise<AppliedRejects> {
  const before = new Map((await catalog.queryPhotos({ ids, ungrouped: true })).map((r) => [r.id, r.flag as number]))
  const present = ids.filter((id) => before.has(id))
  await catalog.setFlag(present, -1)
  schedule(present)
  return { ids: present, before }
}

/** Returns how many photos got their flag back. */
export async function undoRejects(catalog: FlagCatalog, applied: AppliedRejects, schedule: (ids: number[]) => void): Promise<number> {
  const now = await catalog.queryPhotos({ ids: applied.ids, ungrouped: true })
  const byValue = new Map<number, number[]>()
  for (const r of now) {
    // Changed since (picked, or unflagged by hand): left as it is now.
    if (r.flag !== -1) continue
    const v = applied.before.get(r.id) ?? 0
    byValue.set(v, [...(byValue.get(v) ?? []), r.id])
  }
  let n = 0
  for (const [v, ids] of byValue) {
    // A photo already rejected before Apply keeps its flag (and needs no sidecar write).
    if (v === -1) continue
    await catalog.setFlag(ids, v)
    schedule(ids)
    n += ids.length
  }
  return n
}
