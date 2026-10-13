// The one-time refresh after the extras bundle (docs/PHASE3.md, Parts 4 and 6). Photos added before it have no GPS
// in the catalog, and a RAW whose camera preview is Adobe RGB has a washed-out thumbnail. This reads each such photo
// again, in the background, with the same probe workers Open folder and Import use (import/probe.worker.ts), and:
// - stores its GPS position (RAW: LibRaw's parsed_gps; JPEG: the EXIF GPS IFD);
// - makes its thumbnail again only when it came from JPEG data that preview-space.ts now reads as Adobe RGB, and only
//   for photos without an edit: an edited photo's thumbnail is a render of the edit (develop/DevelopView.tsx, batch.ts).
// It changes nothing else: no rating, flag, label, keyword, edit or sidecar is touched, and no sidecar is written.
//
// Which photos: `photos.extras_read = 0` (catalog schema 13: 0 for photos already there, 1 for photos added since). A
// photo is marked done once read, so the refresh runs once per library and resumes where it stopped. Folders whose
// read permission isn't granted are skipped without asking (the browser asks only after a click); their photos are
// done the next time the folder is available (Reconnect, Open folder, or a later visit where the browser still
// allows it).

import { getCatalog } from '../catalog/client'
import { forgetThumbUrl, saveThumb } from '../catalog/thumbs'
import { ProbePool, type ProbeResult } from '../import/probe'
import { getDirAt, getRootHandle } from '../platform/roots'
import { indexer } from './indexer'

export interface RefreshStatus {
  /** The photos (files) being read in this run, in folders LightBench can read now; null when idle. */
  active: { total: number; done: number } | null
  /** Paused by the user for this visit; `left` files are still waiting. */
  paused: { left: number } | null
  /** Bumped when GPS was stored, so the views showing it refresh. */
  changes: number
  /** Summary of the last run that changed something, e.g. "Older photos updated: location for 3, 2 thumbnails". */
  lastResult: string | null
  runs: number
}

/** One file to read again and the catalog entries (original and virtual copies) it belongs to. */
export interface RefreshFile {
  rootId: number
  folderPath: string
  fileName: string
  ids: number[]
}

/** Groups pending catalog entries by file (the catalog returns them sorted by root, folder and file). */
export function groupByFile(rows: { id: number; rootId: number; folderPath: string; fileName: string }[]): RefreshFile[] {
  const out: RefreshFile[] = []
  for (const r of rows) {
    const last = out[out.length - 1]
    if (last && last.rootId === r.rootId && last.folderPath === r.folderPath && last.fileName === r.fileName) last.ids.push(r.id)
    else out.push({ rootId: r.rootId, folderPath: r.folderPath, fileName: r.fileName, ids: [r.id] })
  }
  return out
}

/** The GPS columns to store from a probe, or null when the file records no position. */
export function gpsOf(meta: ProbeResult['meta']): { lat: number; lon: number; alt: number | null } | null {
  return meta.gpsLat != null && meta.gpsLon != null ? { lat: meta.gpsLat, lon: meta.gpsLon, alt: meta.gpsAlt ?? null } : null
}

/** Whether a photo's thumbnail is replaced: only an unedited photo's, and only when the new one was converted from Adobe RGB. */
export function replacesThumb(result: Pick<ProbeResult, 'thumb' | 'thumbAdobeRgb'>, edited: boolean): boolean {
  return !edited && !!result.thumb && !!result.thumbAdobeRgb
}

/** Two workers, fewer than Open folder uses, so the refresh stays in the background. */
const WORKERS = 2
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class ExtrasRefresh {
  status: RefreshStatus = { active: null, paused: null, changes: 0, lastResult: null, runs: 0 }
  private running = false
  private again = false
  private pausedNow = false
  private pool: ProbePool | null = null
  /** What changed since the last summary (a paused run's changes are added to the run that finishes). */
  private located = 0
  private thumbs = 0
  private listeners = new Set<() => void>()

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<RefreshStatus>) {
    this.status = { ...this.status, ...patch }
    for (const fn of this.listeners) fn()
  }

  /** Looks for photos still to refresh, in the folders readable now. Safe to call often (e.g. whenever folders change). */
  start() {
    if (this.pausedNow) return
    if (this.running) {
      this.again = true
      return
    }
    void this.loop()
  }

  /** Stops after the photos being read; the rest waits until Resume or LightBench's next start. */
  pause() {
    this.pausedNow = true
    this.pool?.clear()
  }

  resume() {
    this.pausedNow = false
    this.set({ paused: null })
    this.start()
  }

  private async loop() {
    this.running = true
    try {
      do {
        this.again = false
        await this.run()
      } while (this.again && !this.pausedNow)
    } catch {
      // The catalog failed; it says so itself (storage notice). Try again on the next start.
    } finally {
      this.running = false
      if (this.status.active) this.set({ active: null })
    }
  }

  private async run() {
    const catalog = getCatalog()
    const files = groupByFile(await catalog.extrasPending())
    if (!files.length) return
    // Only folders LightBench may read now; asking needs a click, so the others wait without a prompt.
    const roots = new Map<number, FileSystemDirectoryHandle | null>()
    for (const rootId of new Set(files.map((f) => f.rootId))) {
      const h = await getRootHandle(rootId).catch(() => undefined)
      roots.set(rootId, h && (await h.queryPermission({ mode: 'read' }).catch(() => 'denied')) === 'granted' ? h : null)
    }
    const todo = files.filter((f) => roots.get(f.rootId))
    if (!todo.length) return

    let done = 0
    let located = 0
    let thumbs = 0
    let lastChange = 0
    const progress = () => this.set({ active: { total: todo.length, done } })
    progress()
    const dirs = new Map<string, Promise<FileSystemDirectoryHandle>>()
    const pool = new ProbePool(WORKERS)
    this.pool = pool
    try {
      for (let i = 0; i < todo.length; i += WORKERS) {
        // Open folder and Import come first: wait while one is reading.
        while (indexer.status.active && !this.pausedNow) await sleep(1000)
        if (this.pausedNow) break
        await Promise.all(
          todo.slice(i, i + WORKERS).map(async (f) => {
            const changed = await this.refreshFile(f, roots.get(f.rootId)!, dirs, pool)
            if (changed) {
              located += changed.located
              thumbs += changed.thumbs
            }
            done++
          }),
        )
        progress()
        if (located && performance.now() - lastChange > 3000) {
          lastChange = performance.now()
          this.set({ changes: this.status.changes + 1 })
        }
        // Let the page breathe between files.
        await sleep(0)
      }
    } finally {
      pool.dispose()
      this.pool = null
    }
    this.located += located
    this.thumbs += thumbs
    const changes = this.status.changes + (located ? 1 : 0)
    if (this.pausedNow) {
      this.set({ active: null, paused: { left: groupByFile(await catalog.extrasPending()).length }, changes })
      return
    }
    // The summary, once the photos LightBench can read now are all done, and only when something changed.
    const parts = [
      this.located && `location for ${this.located} ${this.located === 1 ? 'photo' : 'photos'}`,
      this.thumbs && `${this.thumbs} ${this.thumbs === 1 ? 'thumbnail' : 'thumbnails'} with corrected colours`,
    ].filter(Boolean)
    this.located = 0
    this.thumbs = 0
    this.set({ active: null, paused: null, changes, ...(parts.length ? { lastResult: `Older photos updated: ${parts.join(', ')}.`, runs: this.status.runs + 1 } : {}) })
  }

  /**
   * Reads one file again and applies what changed. Returns null when the file can't be reached now (it stays to be
   * done later); a file the probe can't read is marked done, as Open folder would also fail on it.
   */
  private async refreshFile(f: RefreshFile, root: FileSystemDirectoryHandle, dirs: Map<string, Promise<FileSystemDirectoryHandle>>, pool: ProbePool): Promise<{ located: number; thumbs: number } | null> {
    const catalog = getCatalog()
    let file: File
    try {
      let dir = dirs.get(`${f.rootId}/${f.folderPath}`)
      if (!dir) dirs.set(`${f.rootId}/${f.folderPath}`, (dir = getDirAt(root, f.folderPath)))
      file = await (await (await dir).getFileHandle(f.fileName)).getFile()
    } catch {
      return null
    }
    let result: ProbeResult
    try {
      result = await pool.probe(file)
    } catch (e) {
      if (e instanceof Error && e.message === 'cancelled') return null
      await catalog.saveExtras(f.ids, null)
      return { located: 0, thumbs: 0 }
    }
    let thumbs = 0
    for (const id of f.ids) {
      // Checked just before writing, so an edit made meanwhile keeps its rendered thumbnail.
      if (!replacesThumb(result, await catalog.isEdited(id))) continue
      await saveThumb(id, result.thumb!)
      forgetThumbUrl(id)
      thumbs++
    }
    return { located: await catalog.saveExtras(f.ids, gpsOf(result.meta)), thumbs }
  }
}

export const extrasRefresh = new ExtrasRefresh()
