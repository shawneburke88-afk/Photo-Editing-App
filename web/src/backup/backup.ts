// Library backup and restore (the idea follows LightCraft's web build: one verified ZIP that is restored into a new
// place before switching). All local: the backup is a file the user saves; nothing is sent anywhere.
//
// Back up: the catalog (a consistent copy from the catalog worker), the thumbnails and LightBench's settings go into
// one ZIP with a manifest of SHA-256 checksums. The file is then read back and every checksum checked, and its
// catalog is opened and checked by SQLite.
//
// Restore: the backup is checked (manifest, checksums, catalog version) before anything changes, then written into
// the library slot not in use (catalog/slot.ts), read back and checked again. Only then does the library switch to it.

import { getCatalog } from '../catalog/client'
import { SCHEMA_VERSION } from '../catalog/schema'
import { activeSlot, otherSlot, removeThumbsDir, setActiveSlot } from '../catalog/slot'
import { deleteHandle, handleKeys, loadHandle } from '../platform/handle-store'
import {
  applySettings, catalogHeader, CATALOG, DOWNLOAD_COPY, checkFile, checkListing, FORMAT, FORMAT_VERSION, MANIFEST, parseManifest, pickSettings, README,
  readmeText, SETTINGS, sha256, THUMBS, type BackupCounts, type BackupFile, type Manifest, type SettingsFile,
} from './manifest'
import { crc32, ZipReader, ZipWriter, type ZipEntry, type ZipSink } from './zip'

export type Progress = (step: string, done: number, total: number) => void

const encoder = new TextEncoder()
const text = (s: string) => encoder.encode(s) as Uint8Array<ArrayBuffer>
const damaged = (why: string) => new Error(`This backup is damaged (${why}). Nothing in the library was changed.`)

/** Runs tasks with up to `n` at a time (OPFS file writes are faster in parallel); the first failure is thrown. */
function limiter(n: number) {
  const running = new Set<Promise<void>>()
  let failed: { err: unknown } | null = null
  const check = () => {
    if (failed) throw failed.err
  }
  return {
    async run(task: () => Promise<void>) {
      check()
      const p: Promise<void> = task()
        .catch((err: unknown) => {
          failed ??= { err }
        })
        .finally(() => running.delete(p))
      running.add(p)
      if (running.size >= n) await Promise.race(running)
      check()
    },
    async done() {
      await Promise.all(running)
      check()
    },
  }
}

// ---------- Where the backup is written ----------

export interface BackupTarget {
  /** The file's name as the user will see it. */
  name: string
  /** True when the browser downloads the file (no save dialog), false when it was saved where the user chose. */
  download: boolean
  sink: ZipSink
  /** Finishes writing; the file is complete afterwards. */
  close(): Promise<void>
  /** Stops after a failure, discarding what was written where possible. */
  abort(): Promise<void>
  /** The written file, read back from where it was saved. */
  file(): Promise<Blob>
  /** Hands a downloaded file to the browser (only for `download`). */
  deliver(): Promise<void>
}

export const canChooseWhereToSave = () => typeof window.showSaveFilePicker === 'function'

export function backupFileName(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `LightBench backup ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}.zip`
}

/** Collects small writes into 4 MB ones. */
function buffered(write: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>, size = 4 << 20) {
  let buf = new Uint8Array(size)
  let used = 0
  const flush = async () => {
    if (!used) return
    const out = buf.slice(0, used)
    used = 0
    await write(out)
  }
  return {
    flush,
    async write(chunk: Uint8Array<ArrayBuffer>) {
      if (used + chunk.length > size) await flush()
      if (chunk.length >= size) await write(chunk)
      else {
        buf.set(chunk, used)
        used += chunk.length
      }
    },
    drop() {
      buf = new Uint8Array(0)
      used = 0
    },
  }
}

/**
 * Asks where to save the backup (Chrome and Edge's save dialog). Must be called straight from a click. Returns null
 * if the user cancels. Without the save dialog, the backup is written to the browser's private storage first and
 * then downloaded, so it is checked before it is handed over; if that storage can't be written, it is built in memory.
 */
export async function chooseBackupTarget(): Promise<BackupTarget | null> {
  const name = backupFileName()
  if (canChooseWhereToSave()) {
    let handle: FileSystemFileHandle
    try {
      handle = await window.showSaveFilePicker!({
        id: 'lightbench-backup',
        suggestedName: name,
        startIn: 'documents',
        types: [{ description: 'LightBench backup', accept: { 'application/zip': ['.zip'] } }],
      })
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return null
      throw err
    }
    const w = await handle.createWritable()
    const b = buffered((c) => w.write(c))
    return {
      name: handle.name,
      download: false,
      sink: b,
      close: async () => {
        await b.flush()
        await w.close()
      },
      abort: async () => {
        b.drop()
        await w.abort().catch(() => {})
      },
      file: () => handle.getFile(),
      deliver: async () => {},
    }
  }
  return downloadTarget(name)
}

const TEMP = DOWNLOAD_COPY

async function downloadTarget(name: string): Promise<BackupTarget> {
  const save = (blob: Blob) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
  }
  try {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(TEMP).catch(() => {})
    const fh = await root.getFileHandle(TEMP, { create: true })
    const w = await fh.createWritable()
    const b = buffered((c) => w.write(c))
    return {
      name,
      download: true,
      sink: b,
      close: async () => {
        await b.flush()
        await w.close()
      },
      abort: async () => {
        b.drop()
        await w.abort().catch(() => {})
        await root.removeEntry(TEMP).catch(() => {})
      },
      file: () => fh.getFile(),
      deliver: async () => {
        save(await fh.getFile())
        // The download is a copy; the temporary file is removed once the browser has had time to make it, or else
        // the next time the catalog opens (backup-db.ts).
        setTimeout(() => void root.removeEntry(TEMP).catch(() => {}), 120_000)
      },
    }
  } catch {
    // No writable private storage (older Safari): build the file in memory.
    let parts: Uint8Array<ArrayBuffer>[] = []
    let blob: Blob | null = null
    return {
      name,
      download: true,
      sink: { write: async (c) => void parts.push(c.slice()) },
      close: async () => {
        blob = new Blob(parts, { type: 'application/zip' })
        parts = []
      },
      abort: async () => {
        parts = []
      },
      file: async () => blob!,
      deliver: async () => save(blob!),
    }
  }
}

// ---------- Back up ----------

export interface BackupResult {
  name: string
  download: boolean
  bytes: number
  ms: number
  counts: BackupCounts
}

/** Writes the whole library to `target`, then reads it back and checks it. Throws with a message for the user. */
export async function writeBackup(target: BackupTarget, onProgress: Progress): Promise<BackupResult> {
  const t0 = performance.now()
  const catalog = getCatalog()
  let closed = false
  try {
    onProgress('Copying the catalog', 0, 1)
    const { bytes: catalogBytes, summary, photoIds } = await catalog.exportCatalog()
    let settings: SettingsFile = { localStorage: {} }
    try {
      settings = pickSettings(localStorage)
    } catch {
      // localStorage blocked: no settings to save.
    }

    onProgress('Finding thumbnails', 0, 1)
    const slot = await activeSlot()
    const thumbsDir = await (await navigator.storage.getDirectory()).getDirectoryHandle(slot.thumbsDir, { create: true })
    const ids = new Set(photoIds)
    const thumbs: { id: number; handle: FileSystemFileHandle }[] = []
    for await (const entry of thumbsDir.values()) {
      const m = /^(\d+)\.jpg$/.exec(entry.name)
      if (entry.kind === 'file' && m && ids.has(Number(m[1]))) thumbs.push({ id: Number(m[1]), handle: entry })
    }
    thumbs.sort((a, b) => a.id - b.id)

    const zip = new ZipWriter(target.sink)
    const files: BackupFile[] = []
    const add = async (path: string, data: Uint8Array<ArrayBuffer>, compress: boolean, hash?: string) => {
      files.push({ path, size: data.length, sha256: hash ?? (await sha256(data)) })
      await zip.add(path, data, { compress })
    }
    const createdAt = new Date().toISOString()
    const appVersion = __APP_VERSION__
    const counts: BackupCounts = {
      photos: summary.photos,
      thumbnails: 0,
      folders: summary.folders,
      collections: summary.collections,
      keywords: summary.keywords,
      edits: summary.edits,
      presets: summary.presets,
      settings: Object.keys(settings.localStorage).length,
    }

    onProgress('Writing the catalog', 0, 1)
    await add(CATALOG, catalogBytes, true)
    await add(SETTINGS, text(JSON.stringify(settings, null, 1)), true)
    // Thumbnails are read (and hashed) up to 16 ahead of the one being written, in order; null if removed since the
    // catalog was copied.
    const AHEAD = 16
    const reads: (Promise<{ data: Uint8Array<ArrayBuffer>; hash: string } | null> | undefined)[] = []
    const startRead = (i: number) => {
      if (i < thumbs.length) {
        reads[i] = thumbs[i].handle.getFile()
          .then(async (f) => {
            const data = new Uint8Array(await f.arrayBuffer())
            return { data, hash: await sha256(data) }
          })
          .catch(() => null)
      }
    }
    for (let i = 0; i < AHEAD; i++) startRead(i)
    for (let i = 0; i < thumbs.length; i++) {
      const read = await reads[i]
      reads[i] = undefined
      startRead(i + AHEAD)
      if (!read) continue
      await add(`${THUMBS}${thumbs[i].id}.jpg`, read.data, false, read.hash)
      counts.thumbnails++
      if ((i + 1) % 50 === 0) onProgress('Writing thumbnails', i + 1, thumbs.length)
    }
    await add(README, text(readmeText({ createdAt, appVersion, counts })), false)
    const manifest: Manifest = { format: FORMAT, formatVersion: FORMAT_VERSION, appVersion, schemaVersion: summary.schemaVersion, createdAt, counts, files }
    const manifestText = JSON.stringify(manifest, null, 1)
    await zip.add(MANIFEST, text(manifestText), { compress: false })
    const bytes = await zip.finish()
    await target.close()
    closed = true

    await verifyBackup(await target.file(), manifestText, onProgress)
    await target.deliver()
    return { name: target.name, download: target.download, bytes, ms: performance.now() - t0, counts }
  } catch (err) {
    if (!closed) await target.abort()
    throw err
  }
}

/** Reads a written backup back and checks it against what was written. */
async function verifyBackup(blob: Blob, manifestText: string, onProgress: Progress) {
  onProgress('Checking the backup', 0, 1)
  const info = await openBackup(blob, onProgress)
  if (JSON.stringify(info.manifest, null, 1) !== manifestText) throw new Error('The backup read back differs from what was written.')
}

// ---------- Restore ----------

export interface OpenedBackup {
  manifest: Manifest
  reader: ZipReader
}

/** Checks a backup before restoring: manifest, file list, every checksum and the catalog's version. Changes nothing. */
export async function openBackup(file: Blob, onProgress: Progress): Promise<OpenedBackup> {
  let reader: ZipReader
  try {
    reader = await ZipReader.open(file)
  } catch {
    throw new Error('This file is not a LightBench library backup (it is not a ZIP file, or it is incomplete).')
  }
  const me = reader.get(MANIFEST)
  if (!me) throw new Error('This file is not a LightBench library backup.')
  const raw = await reader.read(me)
  if (crc32(raw) !== me.crc) throw damaged('manifest.json')
  const manifest = parseManifest(new TextDecoder().decode(raw), SCHEMA_VERSION)
  checkListing(manifest, reader.entries)
  const byPath = new Map(manifest.files.map((f) => [f.path, f]))
  const entries = reader.entries.filter((e) => e.name !== MANIFEST)
  let done = 0
  await reader.readEach(entries, async (e, data) => {
    await checkFile(byPath.get(e.name)!, data)
    if (e.name === CATALOG) {
      const h = catalogHeader(data)
      if (!h.ok) throw damaged('the catalog is not an SQLite database')
      if (h.userVersion !== manifest.schemaVersion) throw damaged('the catalog version differs from the manifest')
      const summary = await getCatalog().checkCatalogImage(data)
      if (summary.photos !== manifest.counts.photos) throw damaged('photo count')
    }
    if (++done % 50 === 0 || done === entries.length) onProgress('Checking the backup', done, entries.length)
  })
  return { manifest, reader }
}

function parseSettings(data: Uint8Array): SettingsFile {
  const s = JSON.parse(new TextDecoder().decode(data)) as SettingsFile
  if (!s || typeof s.localStorage !== 'object' || !Object.values(s.localStorage).every((v) => typeof v === 'string')) throw damaged('settings')
  return s
}

/**
 * Replaces the library in this browser with a checked backup. Everything is written to the unused slot and read
 * back first; on any failure that slot is cleared and the library in use is unchanged. Afterwards the page must be
 * reloaded. Returns warnings (things restored only in part).
 */
export async function restoreBackup({ manifest, reader }: OpenedBackup, onProgress: Progress): Promise<string[]> {
  const catalog = getCatalog()
  const active = await activeSlot()
  const target = otherSlot(active)
  const byPath = new Map(manifest.files.map((f) => [f.path, f]))
  const entry = (path: string): ZipEntry => reader.get(path)!
  const readChecked = async (path: string) => {
    const data = await reader.read(entry(path))
    await checkFile(byPath.get(path)!, data)
    return data
  }
  let settings: SettingsFile
  let roots: { id: number; name: string }[]
  try {
    onProgress('Restoring the catalog', 0, 1)
    const summary = await catalog.stageCatalog(await readChecked(CATALOG))
    if (summary.photos !== manifest.counts.photos) throw damaged('photo count')
    roots = summary.roots
    settings = parseSettings(await readChecked(SETTINGS))

    const thumbs = reader.entries.filter((e) => e.name.startsWith(THUMBS))
    await removeThumbsDir(target)
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(target.thumbsDir, { create: true })
    let done = 0
    const writes = limiter(8)
    await reader.readEach(thumbs, async (e, data) => {
      await checkFile(byPath.get(e.name)!, data)
      await writes.run(async () => {
        const w = await (await dir.getFileHandle(e.name.slice(THUMBS.length), { create: true })).createWritable()
        await w.write(data)
        await w.close()
        if (++done % 50 === 0) onProgress('Restoring thumbnails', done, thumbs.length)
      })
    })
    await writes.done()

    // Read every thumbnail back from storage before switching.
    done = 0
    const reads = limiter(8)
    for (const e of thumbs) {
      await reads.run(async () => {
        const data = new Uint8Array(await (await (await dir.getFileHandle(e.name.slice(THUMBS.length))).getFile()).arrayBuffer())
        await checkFile(byPath.get(e.name)!, data)
        if (++done % 50 === 0) onProgress('Checking restored thumbnails', done, thumbs.length)
      })
    }
    await reads.done()

    onProgress('Switching to the restored library', 0, 1)
    await setActiveSlot(target.id)
  } catch (err) {
    await catalog.discardStagedCatalog().catch(() => {})
    await removeThumbsDir(target).catch(() => {})
    throw err
  }

  // The library is now the backup's. Its settings and folder records follow.
  const warnings: string[] = []
  try {
    applySettings(localStorage, settings)
  } catch {
    warnings.push('LightBench’s settings could not be restored (this browser’s storage refused them).')
  }
  try {
    await forgetFolderRecords(roots)
  } catch {
    warnings.push('Some folder records could not be updated; if a folder shows the wrong photos, remove it and open it again.')
  }
  return warnings
}

/**
 * Folder access is kept by the browser, not the catalog, under the catalog's folder ids. After a restore those ids
 * belong to the backup: a record is kept only when its folder has the same id and name in the backup, and import
 * presets' folders are forgotten. The user reconnects the rest.
 */
async function forgetFolderRecords(roots: { id: number; name: string }[]) {
  const names = new Map(roots.map((r) => [r.id, r.name]))
  for (const key of await handleKeys()) {
    if (key.startsWith('import-preset:')) {
      await deleteHandle(key)
      continue
    }
    const m = /^root:(\d+)$/.exec(key)
    if (!m) continue
    const handle = await loadHandle(key)
    if (!handle || handle.name !== names.get(Number(m[1]))) await deleteHandle(key)
  }
}
