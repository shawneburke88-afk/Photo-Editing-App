// Open folder: adds a folder to the library where it is (no copying) and indexes its photos in the
// background, so the grid fills in while the user starts culling. There is one library model: an opened
// folder is an ordinary library folder, and every library feature works on it (owner's decision after the
// round-2 research, docs/USABILITY.md). Opening it again, or "Look for new photos", adds files that
// appeared since.
//
// Like darktable's default ("use raw file instead of embedded JPEG from size: never"), thumbnails come from
// the camera's embedded preview; the RAW itself is rendered only in Develop.

import { getCatalog } from '../catalog/client'
import { photosAdded } from './added'
import { saveThumb } from '../catalog/thumbs'
import { ProbePool } from '../import/probe'
import { applySidecar, findSidecar } from '../import/run'
import { joinPath } from '../import/plan'
import { scanSource, type ScannedFile } from '../import/scan'
import { getDirAt, getRootHandle, resolveRoot } from '../platform/roots'
import { filesToAdd } from './index-plan'
import { readXmp } from '../sidecar/xmp'
import { sidecars } from '../sidecar/sync'
import type { ProbeResult } from '../import/probe'

export interface IndexStatus {
  /** The folder being indexed now, or null when idle. */
  active: {
    name: string
    phase: 'scanning' | 'reading'
    /** Photos found so far while scanning. */
    found: number
    /** New photos to read, and how many have been read. */
    total: number
    done: number
  } | null
  /** Folders waiting their turn. */
  queued: number
  /** Photos added since the page loaded. */
  added: number
  /** Bumped whenever the library changed (photos or keywords added), so views refresh. */
  changes: number
  /** Photos that could not be read in the last run. */
  failed: { name: string; error: string }[]
  /** Summary of the last finished run, e.g. "Added 120 photos from Trip". */
  lastResult: string | null
  /** Counts finished runs, so a summary dismissed by the user isn't confused with an identical later one. */
  runs: number
}

interface Job {
  dir: FileSystemDirectoryHandle
  rootId: number
  subPath: string
}

/** How often read photos are written to the catalog, so the grid fills in steadily. */
const FLUSH_MS = 400
const FLUSH_COUNT = 48

class FolderIndexer {
  status: IndexStatus = { active: null, queued: 0, added: 0, changes: 0, failed: [], lastResult: null, runs: 0 }
  private queue: Job[] = []
  private running = false
  private stopped = false
  private pool: ProbePool | null = null
  private listeners = new Set<() => void>()

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<IndexStatus>) {
    this.status = { ...this.status, ...patch }
    for (const fn of this.listeners) fn()
  }

  /** Adds a folder the user just picked; returns where it sits in the library so the view can select it. */
  async open(dir: FileSystemDirectoryHandle): Promise<{ rootId: number; path: string }> {
    const { rootId, subPath } = await resolveRoot(getCatalog(), dir)
    this.enqueue({ dir, rootId, subPath })
    return { rootId, path: subPath }
  }

  /** Looks for photos added to a library folder since it was last indexed. */
  async rescan(rootId: number, path: string): Promise<boolean> {
    const root = await getRootHandle(rootId)
    if (!root || (await root.requestPermission({ mode: 'read' })) !== 'granted') return false
    this.enqueue({ dir: await getDirAt(root, path), rootId, subPath: path })
    return true
  }

  /** Stops the current folder after the photos already being read; queued folders are dropped. */
  stop() {
    this.stopped = true
    this.queue = []
    this.pool?.clear()
    this.set({ queued: 0 })
  }

  private enqueue(job: Job) {
    this.queue.push(job)
    if (this.running) this.set({ queued: this.queue.length })
    void this.drain()
  }

  private async drain() {
    if (this.running) return
    this.running = true
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        this.stopped = false
        this.set({ queued: this.queue.length, failed: [] })
        try {
          await this.run(job)
        } catch (e) {
          this.set({ lastResult: `Could not read “${job.dir.name}”: ${e instanceof Error ? e.message : String(e)}`, runs: this.status.runs + 1 })
        }
      }
    } finally {
      this.running = false
      this.set({ active: null })
    }
  }

  private async run({ dir, rootId, subPath }: Job) {
    const catalog = getCatalog()
    const name = dir.name
    this.set({ active: { name, phase: 'scanning', found: 0, total: 0, done: 0 } })
    const files = await scanSource(dir, (found) => this.set({ active: { name, phase: 'scanning', found, total: 0, done: 0 } }))
    if (this.stopped) return
    const todo = filesToAdd(files, new Set(await catalog.listFiles(rootId, subPath)), subPath)
    let done = 0
    let added = 0
    const failed: IndexStatus['failed'] = []
    const progress = () => this.set({ active: { name, phase: 'reading', found: files.length, total: todo.length, done } })
    progress()

    const batch: { file: ScannedFile; result: ProbeResult }[] = []
    const dirs = new Map<string, FileSystemDirectoryHandle | null>()
    let writing: Promise<void> = Promise.resolve()
    let lastFlush = performance.now()

    // Writes read photos to the catalog in order, one batch at a time.
    const flush = () => {
      const items = batch.splice(0)
      lastFlush = performance.now()
      if (!items.length) return writing
      writing = writing.then(async () => {
        const ids = await catalog.addPhotos(
          items.map(({ file, result }) => ({
            ...result.meta,
            fileName: file.name,
            originalName: file.name,
            rootId,
            folderPath: joinPath(subPath, file.dir),
          })),
        )
        for (const [i, id] of ids.entries()) {
          if (id === null) continue
          added++
          const { file, result } = items[i]
          if (result.thumb) await saveThumb(id, result.thumb)
          // A sidecar from Lightroom, darktable or LightBench brings its ratings, labels and edits along.
          if (!dirs.has(file.dir)) dirs.set(file.dir, await getDirAt(dir, file.dir).catch(() => null))
          const folder = dirs.get(file.dir)
          const sidecar = folder ? await findSidecar(folder, file.name) : null
          const xmpText = sidecar?.text ?? result.xmp
          if (xmpText) await applySidecar(catalog, id, xmpText).catch(() => {})
        }
        // RAW+JPEG pairs become stacks with the RAW on top (darktable-style).
        const newIds = ids.filter((id): id is number => id !== null)
        if (newIds.length) sidecars.schedule(await catalog.stackRawJpegPairs(newIds))
        this.set({ added: this.status.added + newIds.length, changes: this.status.changes + 1 })
        photosAdded.emit(newIds)
      })
      return writing
    }

    const pool = new ProbePool()
    this.pool = pool
    try {
      await Promise.all(
        todo.map((file) =>
          file.handle
            .getFile()
            .then((f) => (this.stopped ? Promise.reject(new Error('cancelled')) : pool.probe(f)))
            .then((result) => {
              batch.push({ file, result })
              if (batch.length >= FLUSH_COUNT || performance.now() - lastFlush > FLUSH_MS) void flush()
            })
            .catch((e: Error) => {
              if (e.message !== 'cancelled') failed.push({ name: joinPath(file.dir, file.name), error: e.message })
            })
            .finally(() => {
              done++
              progress()
            }),
        ),
      )
      await flush()
    } finally {
      pool.dispose()
      this.pool = null
    }

    // Photos added before LightBench had keywords: bring in their sidecar keywords now.
    for (const p of await catalog.photosWithUnreadKeywords(rootId, subPath)) {
      if (this.stopped) break
      const folder = await getDirAt(dir, relativeTo(subPath, p.folderPath)).catch(() => null)
      const sidecar = folder ? await findSidecar(folder, p.fileName) : null
      const kws = sidecar ? readXmp(sidecar.text).keywords : undefined
      if (kws?.length) await catalog.addKeywords([p.id], kws)
      await catalog.markKeywordsRead(p.id)
      if (kws?.length) this.set({ changes: this.status.changes + 1 })
    }

    const where = `“${name}”`
    const result = this.stopped
      ? `Stopped: added ${added} of ${todo.length} new photos from ${where}`
      : todo.length === 0
        ? `No new photos in ${where}`
        : `Added ${added} ${added === 1 ? 'photo' : 'photos'} from ${where}`
    this.set({ failed, lastResult: failed.length ? `${result} · ${failed.length} could not be read` : result, runs: this.status.runs + 1 })
  }
}

/** `path` relative to `base` (both relative to the same library root). */
function relativeTo(base: string, path: string): string {
  return base && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : base === path ? '' : path
}

export const indexer = new FolderIndexer()
