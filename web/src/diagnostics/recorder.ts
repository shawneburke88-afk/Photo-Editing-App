// Diagnostics ("flight recorder", PHASE3.md "Diagnostics"): off by default. When on, Develop's actions and the GPU
// engine's events are appended to a log in the browser's storage as they happen, in small batches, so the log survives
// a crash or a power-off and can be exported on the next start. The log is a ring: only the newest entries are kept.
//
// It never holds photo names, paths or pixels: photos are numbered per session (anon.ts). Writing is asynchronous and
// batched, so it never waits in a drawing; when diagnostics is off, `log` returns at once and nothing is kept.

export interface DiagEntry {
  /** Increasing over all sessions (the ring keeps the newest). */
  seq: number
  /** Wall-clock time (ms since 1970). */
  t: number
  /** The session (page load) it was written in: that session's start time. */
  session: number
  kind: string
  data?: Record<string, unknown>
}

/** Where entries are kept (IndexedDB in the app; memory in tests). */
export interface LogStore {
  append(entries: DiagEntry[]): Promise<void>
  all(): Promise<DiagEntry[]>
  /** Removes the entries with `seq` below this. */
  trimBelow(seq: number): Promise<void>
  clear(): Promise<void>
  lastSeq(): Promise<number>
}

export const MAX_ENTRIES = 5000
/** One entry's data is cut to this many characters of JSON, so the ring stays a few MB at most. */
export const MAX_DATA_CHARS = 600
export const ENABLED_KEY = 'lightbench.diagnostics'

/** `data` made safe to keep: plain JSON, at most MAX_DATA_CHARS characters (else replaced by its cut text). */
export function boundData(data: Record<string, unknown> | undefined, max = MAX_DATA_CHARS): Record<string, unknown> | undefined {
  if (!data) return undefined
  let text: string
  try {
    text = JSON.stringify(data)
  } catch {
    return { unserializable: true }
  }
  if (text.length <= max) return JSON.parse(text) as Record<string, unknown>
  return { cut: text.slice(0, max) }
}

export class Recorder {
  private store: LogStore
  private on: boolean
  private pending: DiagEntry[] = []
  private seq = -1
  private ready: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private writing: Promise<void> = Promise.resolve()
  private listeners = new Set<() => void>()
  readonly session: number
  private readonly flushMs: number
  private readonly maxEntries: number
  private readonly persistFlag: (on: boolean) => void

  constructor(store: LogStore, opts: { enabled?: boolean; flushMs?: number; maxEntries?: number; now?: () => number; persistFlag?: (on: boolean) => void } = {}) {
    this.store = store
    this.on = !!opts.enabled
    this.flushMs = opts.flushMs ?? 500
    this.maxEntries = opts.maxEntries ?? MAX_ENTRIES
    this.now = opts.now ?? Date.now
    this.session = this.now()
    this.persistFlag = opts.persistFlag ?? (() => {})
  }

  private readonly now: () => number

  get enabled(): boolean {
    return this.on
  }

  setEnabled(on: boolean) {
    if (on === this.on) return
    if (!on) this.log('diagnostics', { on: false })
    this.on = on
    this.persistFlag(on)
    if (on) this.log('diagnostics', { on: true })
    else void this.flush()
    this.listeners.forEach((fn) => fn())
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  /**
   * Records an entry (nothing when diagnostics is off). Cheap: written later, in a batch. `maxChars`: a larger bound
   * for the rare big entry (the session's description).
   */
  log(kind: string, data?: Record<string, unknown>, maxChars = MAX_DATA_CHARS) {
    if (!this.on) return
    this.pending.push({ seq: 0, t: this.now(), session: this.session, kind, data: boundData(data, maxChars) })
    if (this.pending.length >= 200) void this.flush()
    else this.timer ??= setTimeout(() => void this.flush(), this.flushMs)
  }

  private init(): Promise<void> {
    this.ready ??= this.store.lastSeq().then(
      (s) => void (this.seq = Math.max(this.seq, s)),
      () => {},
    )
    return this.ready
  }

  /** Writes what is waiting (also called on page hide). */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const batch = this.pending
    this.pending = []
    if (!batch.length) return this.writing
    this.writing = this.writing.then(async () => {
      await this.init()
      for (const e of batch) e.seq = ++this.seq
      try {
        await this.store.append(batch)
        if (this.seq + 1 > this.maxEntries) await this.store.trimBelow(this.seq + 1 - this.maxEntries)
      } catch {
        // Storage full or blocked: diagnostics must never break editing.
      }
    })
    return this.writing
  }

  /** Everything kept, oldest first (after writing what is waiting). */
  async entries(): Promise<DiagEntry[]> {
    await this.flush()
    return (await this.store.all()).sort((a, b) => a.seq - b.seq)
  }

  async clear() {
    this.pending = []
    await this.flush()
    await this.store.clear()
  }

  /** The export: a JSON document with every entry kept. */
  async exportText(app: string): Promise<string> {
    const entries = await this.entries()
    return JSON.stringify({ format: 'lightbench-diagnostics', version: 1, app, exported: new Date(this.now()).toISOString(), entries }, null, 0).replace(/\},\{"seq"/g, '},\n{"seq"')
  }
}

export class MemoryStore implements LogStore {
  rows: DiagEntry[] = []
  async append(entries: DiagEntry[]) {
    this.rows.push(...entries.map((e) => ({ ...e })))
  }
  async all() {
    return this.rows.map((e) => ({ ...e }))
  }
  async trimBelow(seq: number) {
    this.rows = this.rows.filter((e) => e.seq >= seq)
  }
  async clear() {
    this.rows = []
  }
  async lastSeq() {
    return this.rows.reduce((a, e) => Math.max(a, e.seq), -1)
  }
}

/** IndexedDB, written with strict durability (each batch is on disk before the write completes). */
export class IdbStore implements LogStore {
  private db: Promise<IDBDatabase> | null = null

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('lightbench-diagnostics', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('log', { keyPath: 'seq' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return this.db
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const t = db.transaction('log', mode, { durability: 'strict' })
      const req = fn(t.objectStore('log'))
      t.oncomplete = () => resolve(req ? req.result : undefined)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  }

  async append(entries: DiagEntry[]) {
    await this.tx('readwrite', (s) => {
      for (const e of entries) s.put(e)
    })
  }
  async all() {
    return ((await this.tx('readonly', (s) => s.getAll() as IDBRequest<DiagEntry[]>)) ?? []) as DiagEntry[]
  }
  async trimBelow(seq: number) {
    await this.tx('readwrite', (s) => void s.delete(IDBKeyRange.upperBound(seq, true)))
  }
  async clear() {
    await this.tx('readwrite', (s) => void s.clear())
  }
  async lastSeq() {
    const db = await this.open()
    return new Promise<number>((resolve, reject) => {
      const req = db.transaction('log', 'readonly').objectStore('log').openKeyCursor(null, 'prev')
      req.onsuccess = () => resolve(req.result ? (req.result.key as number) : -1)
      req.onerror = () => reject(req.error)
    })
  }
}

function readFlag(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

function writeFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, '1')
    else localStorage.removeItem(ENABLED_KEY)
  } catch {
    // Storage blocked: on for this visit only.
  }
}

const hasIdb = typeof indexedDB !== 'undefined'

/** The app's recorder. */
export const diagnostics = new Recorder(hasIdb ? new IdbStore() : new MemoryStore(), { enabled: hasIdb && readFlag(), persistFlag: writeFlag })

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void diagnostics.flush())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void diagnostics.flush()
  })
}
