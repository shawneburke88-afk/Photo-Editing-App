// The import running now, kept outside the Import window so the window can be closed while the import goes on (the
// RAWs are in the Library first; the JPEG twins follow, docs/PHASE3.md "Import speed"). The Import window and the
// Library's left panel (ImportStatus.tsx) both show it.

import type { Catalog } from '../catalog/client'
import { importDetails } from './details'
import { runImport, type ImportItem, type ImportOptions, type ImportProgress } from './run'

export interface ImportSessionStatus {
  /** The import's progress (null before the first import, or after its summary was dismissed). */
  progress: ImportProgress | null
  running: boolean
  /** Stop was clicked: the photos being copied finish, no new one starts. */
  stopping: boolean
  /** A problem that ended the import early (e.g. the destination couldn't be opened). */
  error: string
  /** Bumped (at most about once a second while copying) when photos were added, so the Library refreshes. */
  changes: number
  runs: number
}

/** How often the Library is told about new photos while an import adds them. */
const REFRESH_MS = 1000

class ImportSession {
  status: ImportSessionStatus = { progress: null, running: false, stopping: false, error: '', changes: 0, runs: 0 }
  private abort: AbortController | null = null
  private listeners = new Set<() => void>()

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private set(patch: Partial<ImportSessionStatus>) {
    this.status = { ...this.status, ...patch }
    for (const fn of this.listeners) fn()
  }

  async start(catalog: Catalog, items: ImportItem[], opts: Omit<ImportOptions, 'onAdded'>): Promise<void> {
    if (this.status.running) return
    this.abort = new AbortController()
    this.set({ running: true, stopping: false, error: '', progress: null })
    let last = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const bump = () => {
      timer = null
      last = performance.now()
      this.set({ changes: this.status.changes + 1 })
    }
    const onAdded = () => {
      if (timer) return
      const wait = REFRESH_MS - (performance.now() - last)
      if (wait <= 0) bump()
      else timer = setTimeout(bump, wait)
    }
    try {
      await runImport(catalog, items, { ...opts, onAdded }, (p) => this.set({ progress: p }), this.abort.signal)
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) })
    }
    if (timer) clearTimeout(timer)
    this.abort = null
    this.set({ running: false, stopping: false, changes: this.status.changes + 1, runs: this.status.runs + 1 })
    // Ratings, keywords and edits from sidecars, stacks with earlier twins, presets: in the background.
    void importDetails.start()
  }

  /** Stops after the photos being copied (each is finished and added; the rest stays on the card). */
  stop() {
    if (!this.abort) return
    this.abort.abort()
    this.set({ stopping: true })
  }

  /** The finished import's summary was read. */
  dismiss() {
    if (!this.status.running) this.set({ progress: null, error: '' })
  }
}

export const importSession = new ImportSession()
