// The culling analysis for photos already in the library (docs/PHASE3.md Part 18). Photos added from now on are
// measured while Open folder or Import reads them (import/probe.worker.ts); this measures the others once, in the
// background, with the same probe workers, as the one-time refresh does (refresh.ts):
// - which photos: originals with no row in `photo_analysis`, or one made by an older ANALYSIS_ALGO (virtual copies use
//   their original's), so the pass resumes where it stopped and runs again only when the measures change;
// - folders whose read permission isn't granted are skipped without asking (the browser asks only after a click);
//   their photos wait until the folder can be read (Reconnect, Open folder, or a later visit where it still can);
// - two workers, a yield between files, and it waits while Open folder or the one-time refresh is reading;
// - Pause stops after the files being read; Resume (or the next visit) goes on.
// It writes only `photo_analysis` rows: no thumbnail, rating, flag, edit or sidecar is touched, and nothing is written
// to sidecars.

import { getCatalog } from '../catalog/client'
import { ProbePool } from '../import/probe'
import { getDirAt, getRootHandle } from '../platform/roots'
import { indexer } from './indexer'
import { extrasRefresh } from './refresh'

export interface AnalysisStatus {
  /** Photos being measured in this run, in folders LightBench can read now; null when idle. */
  active: { total: number; done: number } | null
  /** Paused by the user for this visit; `left` photos are still waiting. */
  paused: { left: number } | null
  /** Bumped when results were stored, so the views showing badges refresh. */
  changes: number
  /** Summary of the last run that measured something. */
  lastResult: string | null
  runs: number
}

export interface AnalysisFile {
  id: number
  rootId: number
  folderPath: string
  fileName: string
}

/** Two workers, fewer than Open folder uses, so the pass stays in the background. */
const WORKERS = 2
/** Results are stored in batches of this many. */
const BATCH = 8
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Splits pending photos into those in folders readable now and the number waiting for permission. */
export function readable<T extends { rootId: number }>(files: T[], roots: Map<number, unknown>): { todo: T[]; waiting: number } {
  const todo = files.filter((f) => roots.get(f.rootId))
  return { todo, waiting: files.length - todo.length }
}

class AnalysisPass {
  status: AnalysisStatus = { active: null, paused: null, changes: 0, lastResult: null, runs: 0 }
  private running = false
  private again = false
  private pausedNow = false
  private pool: ProbePool | null = null
  private measured = 0
  private listeners = new Set<() => void>()

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<AnalysisStatus>) {
    this.status = { ...this.status, ...patch }
    for (const fn of this.listeners) fn()
  }

  /** Looks for photos still to measure, in the folders readable now. Safe to call often. */
  start() {
    if (this.pausedNow) return
    if (this.running) {
      this.again = true
      return
    }
    void this.loop()
  }

  pause() {
    this.pausedNow = true
    this.pool?.clear()
  }

  resume() {
    this.pausedNow = false
    this.set({ paused: null })
    this.start()
  }

  get isPaused() {
    return this.pausedNow
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
    const files = await catalog.analysisPending()
    if (!files.length) return
    const roots = new Map<number, FileSystemDirectoryHandle | null>()
    for (const rootId of new Set(files.map((f) => f.rootId))) {
      const h = await getRootHandle(rootId).catch(() => undefined)
      roots.set(rootId, h && (await h.queryPermission({ mode: 'read' }).catch(() => 'denied')) === 'granted' ? h : null)
    }
    const { todo } = readable(files, roots)
    if (!todo.length) return

    let done = 0
    let measured = 0
    let lastChange = performance.now()
    const progress = () => this.set({ active: { total: todo.length, done } })
    progress()
    const dirs = new Map<string, Promise<FileSystemDirectoryHandle>>()
    const pool = new ProbePool(WORKERS)
    this.pool = pool
    let pending: { id: number; a: Awaited<ReturnType<ProbePool['probe']>>['analysis'] | null }[] = []
    const store = async () => {
      const batch = pending
      pending = []
      if (!batch.length) return
      await catalog.saveAnalyses(batch.map((b) => ({ id: b.id, a: b.a ?? null })))
      measured += batch.filter((b) => b.a).length
    }
    try {
      for (let i = 0; i < todo.length; i += WORKERS) {
        // Open folder and the one-time refresh come first: wait while they read.
        while ((indexer.status.active || extrasRefresh.status.active) && !this.pausedNow) await sleep(1000)
        if (this.pausedNow) break
        await Promise.all(
          todo.slice(i, i + WORKERS).map(async (f) => {
            const r = await this.measure(f, roots.get(f.rootId)!, dirs, pool)
            if (r) pending.push({ id: f.id, a: r.a })
            done++
          }),
        )
        if (pending.length >= BATCH) await store()
        progress()
        if (performance.now() - lastChange > 3000) {
          await store()
          lastChange = performance.now()
          this.set({ changes: this.status.changes + 1 })
        }
        // Let the page breathe between files.
        await sleep(0)
      }
      await store()
    } finally {
      pool.dispose()
      this.pool = null
    }
    this.measured += measured
    const changes = this.status.changes + 1
    if (this.pausedNow) {
      this.set({ active: null, paused: { left: (await catalog.analysisPending()).length }, changes })
      return
    }
    const n = this.measured
    this.measured = 0
    this.set({
      active: null,
      paused: null,
      changes,
      ...(n ? { lastResult: `Culling analysis done: ${n} ${n === 1 ? 'photo' : 'photos'} measured for sharpness, exposure and look-alikes.`, runs: this.status.runs + 1 } : {}),
    })
  }

  /**
   * Reads one file and measures its preview. Null when the file can't be reached now (it waits for later); a file the
   * probe can't read gives { a: null } and is marked as not measurable, as Open folder would also fail on it.
   */
  private async measure(f: AnalysisFile, root: FileSystemDirectoryHandle, dirs: Map<string, Promise<FileSystemDirectoryHandle>>, pool: ProbePool) {
    let file: File
    try {
      let dir = dirs.get(`${f.rootId}/${f.folderPath}`)
      if (!dir) dirs.set(`${f.rootId}/${f.folderPath}`, (dir = getDirAt(root, f.folderPath)))
      file = await (await (await dir).getFileHandle(f.fileName)).getFile()
    } catch {
      return null
    }
    try {
      return { a: (await pool.probe(file)).analysis ?? null }
    } catch (e) {
      if (e instanceof Error && e.message === 'cancelled') return null
      return { a: null }
    }
  }
}

export const analysisPass = new AnalysisPass()
