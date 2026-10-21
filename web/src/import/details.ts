// Import's background details (owner's decision 2 of 2026-10-20, docs/PHASE3.md "Import speed"). An import is finished
// once every file is copied, checked and in the library with its camera preview (import/run.ts); what is left is
// applied here, in the background:
// - the sidecar's ratings, flag, label, keywords, metadata, collections, virtual copies, edits and snapshots, and
//   Lightroom's settings (run.ts applySidecar), else the JPEG's own XMP; the camera's IPTC/EXIF fields (applyEmbedded).
//   A rating, flag, label or edit the person gave the photo meanwhile wins (they may cull the RAWs while the JPEGs copy);
// - RAW+JPEG stacks: a twin pair the import stacked is checked (and stacked if the tab closed in between), and twins
//   imported earlier or in other folders are paired (catalog stackRawJpegPairs), as the sequential import did at its end;
//   then the sidecars of the stacked photos are written (only now, so they carry the ratings and keywords above);
// - the develop and metadata presets for new photos (library/added.ts photosAdded), which render the full thumbnails.
// What is still to do is kept in the catalog with each photo (`import_pending`, schema 17), so closing the tab loses
// nothing: the rest is done on the next start (LibraryView starts this pass when the library opens, like the one-time
// refresh). Background work on the CPU budget (engine/cpu-budget.ts): it waits while foreground work (the copying of
// an import, Export, Remove…) uses the slots, and works through the photos in small batches in the order they were added.

import type { Catalog } from '../catalog/client'
import type { PhotoRow } from '../catalog/types'
import { cpuBudget, type CpuBudget } from '../engine/cpu-budget'
import type { ImportDetails } from './run'

export interface DetailsStatus {
  /** The photos still to finish in this run; null when idle. */
  active: { total: number; done: number } | null
  /** Bumped after each batch, so the Library refreshes. */
  changes: number
  runs: number
}

/** The current state of a photo that a sidecar must not override (run.ts ApplyOptions.current). */
export type Current = { rating: number; flag: number; color: number; edited: boolean }

/** What the pass uses: the app's in the app, fakes in tests (details.test.ts). */
export interface DetailsEnv {
  catalog: Pick<Catalog, 'importPending' | 'importPendingCount' | 'importDone' | 'queryPhotos' | 'createStack' | 'stackRawJpegPairs'>
  /** Applies the sidecar (or embedded XMP) and the camera's metadata. */
  apply: (id: number, d: ImportDetails, current: Current | undefined) => Promise<void>
  /** Writes these photos' sidecars (sidecar/sync.ts). */
  writeSidecars: (ids: number[]) => void
  /** Tells the app the photos are finished (develop and metadata presets for new photos). */
  added: (ids: number[]) => void
  budget?: CpuBudget
  log?: (data: Record<string, unknown>) => void
}

/** Photos finished per batch. */
export const BATCH = 24

function parse(text: string): ImportDetails {
  try {
    const d = JSON.parse(text) as ImportDetails
    return d && typeof d === 'object' ? d : {}
  } catch {
    return {}
  }
}

/** Finishes one batch of pending photos; returns their ids. Exported for tests. */
export async function finishBatch(env: DetailsEnv, rows: { id: number; details: string }[]): Promise<number[]> {
  const { catalog } = env
  const items = rows.map((r) => ({ id: r.id, d: parse(r.details) }))
  const ids = items.map((i) => i.id)
  const all = [...new Set([...ids, ...items.flatMap((i) => (i.d.stackWith ? [i.d.stackWith.id] : []))])]
  const now = async () => new Map((await catalog.queryPhotos({ ids: all, ungrouped: true }) as PhotoRow[]).map((p) => [p.id, p]))
  const before = await now()
  for (const { id, d } of items) {
    const p = before.get(id)
    try {
      await env.apply(id, d, p ? { rating: p.rating, flag: p.flag, color: p.color, edited: p.edited } : undefined)
    } catch (err) {
      // A damaged sidecar doesn't stop the others: the photo is in the library either way.
      console.warn('Import: could not apply the details of a photo', err)
    }
  }
  const touched = new Set<number>()
  const after = await now()
  for (const { id, d } of items) {
    const w = d.stackWith
    if (!w) continue
    const a = after.get(id)
    const b = after.get(w.id)
    if (!a || !b) continue
    try {
      if (w.how === 'pair' && (a.stackId === null || a.stackId !== b.stackId)) await catalog.createStack([id, w.id], w.thisOnTop ? id : w.id)
      if (w.how === 'join' && (a.stackId === null || b.stackId === null)) await catalog.stackRawJpegPairs([id])
    } catch (err) {
      console.warn('RAW+JPEG stacking failed', err)
    }
    touched.add(id)
    touched.add(w.id)
  }
  // Twins imported earlier, or in another folder (by their names on the card and capture times).
  const pairs = items.filter((i) => i.d.pair).map((i) => i.id)
  if (pairs.length) {
    try {
      for (const id of await catalog.stackRawJpegPairs(pairs)) touched.add(id)
    } catch (err) {
      console.warn('RAW+JPEG stacking failed', err)
    }
  }
  if (touched.size) env.writeSidecars([...touched])
  await catalog.importDone(ids)
  env.added(ids)
  return ids
}

export class ImportDetailsPass {
  status: DetailsStatus = { active: null, changes: 0, runs: 0 }
  private running = false
  private again = false
  private listeners = new Set<() => void>()
  private envP: Promise<DetailsEnv> | null = null
  private readonly makeEnv: () => Promise<DetailsEnv>

  constructor(makeEnv: () => Promise<DetailsEnv>) {
    this.makeEnv = makeEnv
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private set(patch: Partial<DetailsStatus>) {
    this.status = { ...this.status, ...patch }
    for (const fn of this.listeners) fn()
  }

  /** Finishes the photos waiting (safe to call often: after an import, when the library opens). */
  start(): Promise<void> {
    if (this.running) {
      this.again = true
      return Promise.resolve()
    }
    return this.loop()
  }

  private async loop() {
    this.running = true
    try {
      do {
        this.again = false
        await this.run()
      } while (this.again)
    } catch (err) {
      // The catalog failed; it says so itself (storage notice). The rest waits for the next start.
      console.warn('Import details stopped', err)
    } finally {
      this.running = false
      if (this.status.active) this.set({ active: null })
    }
  }

  private async run() {
    this.envP ??= this.makeEnv()
    const env = await this.envP
    let total = await env.catalog.importPendingCount()
    if (!total) return
    let done = 0
    this.set({ active: { total, done } })
    const lease = (env.budget ?? cpuBudget).acquire('background', 1)
    const started = performance.now()
    let waited = 0
    try {
      for (;;) {
        if (lease.slots === 0) {
          const w = performance.now()
          await lease.whenAllowed()
          waited += performance.now() - w
        }
        const rows = await env.catalog.importPending(BATCH)
        if (!rows.length) break
        await finishBatch(env, rows)
        done += rows.length
        // More may have been added meanwhile (an import still copying).
        total = Math.max(total, done + (await env.catalog.importPendingCount()))
        this.set({ active: { total, done }, changes: this.status.changes + 1 })
      }
    } finally {
      lease.release()
    }
    env.log?.({ photos: done, ms: Math.round(performance.now() - started), waitedMs: Math.round(waited) })
    this.set({ active: null, runs: this.status.runs + 1 })
  }
}

/** The app's pass. */
export const importDetails = new ImportDetailsPass(async () => {
  const [{ getCatalog }, run, { sidecars }, { photosAdded }, { diagnostics }] = await Promise.all([
    import('../catalog/client'),
    import('./run'),
    import('../sidecar/sync'),
    import('../library/added'),
    import('../diagnostics/recorder'),
  ])
  const catalog = getCatalog()
  return {
    catalog,
    apply: async (id, d, current) => {
      const text = d.sidecar?.text ?? d.xmp
      const read = text ? await run.applySidecar(catalog, id, text, !!d.sidecar?.borrowed, { skipStack: true, current }) : null
      await run.applyEmbedded(catalog, id, read, d.camera, d.iptcKeywords)
    },
    writeSidecars: (ids) => sidecars.schedule(ids),
    added: (ids) => photosAdded.emit(ids),
    log: (data) => diagnostics.log('import-details', data),
  }
})
