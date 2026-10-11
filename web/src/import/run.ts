// Executes an import: copies files (plus an optional backup), adds them to the catalog, saves thumbnails.

import type { Catalog } from '../catalog/client'
import { saveThumb } from '../catalog/thumbs'
import type { PhotoMeta } from '../catalog/types'
import { getDirAt, resolveRoot } from '../platform/roots'
import { dateFolder, joinPath, numberedName, renamedFile, type RenameTemplate } from './plan'
import type { ScannedFile } from './scan'

export interface ImportItem {
  file: ScannedFile
  meta: PhotoMeta
  thumb: Uint8Array<ArrayBuffer> | null
}

export interface ImportOptions {
  mode: 'copy' | 'add'
  source: FileSystemDirectoryHandle
  destination?: FileSystemDirectoryHandle
  rename: RenameTemplate
  backup?: FileSystemDirectoryHandle
}

export interface ImportProgress {
  done: number
  total: number
  imported: number
  skipped: number
  failed: { name: string; error: string }[]
  current: string
}

/** Capture time for folder naming, falling back to the file's modified time. */
export const photoTime = (m: PhotoMeta) => m.capturedAt || m.fileModified

/** True if `dir` already holds a file called `name` of the same size (i.e. this photo was copied before). */
export async function existsSameSize(dir: FileSystemDirectoryHandle, name: string, size: number): Promise<boolean> {
  try {
    return (await (await dir.getFileHandle(name)).getFile()).size === size
  } catch {
    return false
  }
}

/** For "already imported" marking: which items already exist at their planned destination. */
export async function findAtDestination(dest: FileSystemDirectoryHandle, items: { name: string; meta: PhotoMeta }[]): Promise<boolean[]> {
  const dirs = new Map<string, FileSystemDirectoryHandle | null>()
  const out: boolean[] = []
  for (const it of items) {
    const folder = dateFolder(photoTime(it.meta))
    if (!dirs.has(folder)) dirs.set(folder, await getDirAt(dest, folder).catch(() => null))
    const dir = dirs.get(folder)
    out.push(dir ? await existsSameSize(dir, it.name, it.meta.fileSize) : false)
  }
  return out
}

/** Copies `file` into `dir`, avoiding clashes. Returns the final name, and whether a copy was made. */
async function copyInto(dir: FileSystemDirectoryHandle, name: string, file: File): Promise<{ name: string; copied: boolean }> {
  for (let n = 0; n < 1000; n++) {
    const candidate = n === 0 ? name : numberedName(name, n)
    let existing: File | null = null
    try {
      existing = await (await dir.getFileHandle(candidate)).getFile()
    } catch {
      existing = null
    }
    if (existing) {
      if (existing.size === file.size) return { name: candidate, copied: false } // copied on an earlier import
      continue
    }
    const fh = await dir.getFileHandle(candidate, { create: true })
    const w = await fh.createWritable()
    try {
      await file.stream().pipeTo(w)
    } catch (err) {
      await dir.removeEntry(candidate).catch(() => {})
      throw err
    }
    return { name: candidate, copied: true }
  }
  throw new Error(`Too many files named like ${name}`)
}

export async function runImport(
  catalog: Catalog,
  items: ImportItem[],
  opts: ImportOptions,
  onProgress: (p: ImportProgress) => void,
  signal?: AbortSignal,
): Promise<ImportProgress> {
  const ordered = [...items].sort((a, b) => photoTime(a.meta) - photoTime(b.meta) || a.file.name.localeCompare(b.file.name))
  const progress: ImportProgress = { done: 0, total: ordered.length, imported: 0, skipped: 0, failed: [], current: '' }

  const target = opts.mode === 'copy' ? opts.destination : opts.source
  if (!target) throw new Error('Choose a destination folder first')
  const { rootId, subPath } = await resolveRoot(catalog, target)

  let backupDir: FileSystemDirectoryHandle | undefined
  if (opts.mode === 'copy' && opts.backup) {
    const now = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const name = `LightBench backup ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}${p(now.getMinutes())}`
    backupDir = await opts.backup.getDirectoryHandle(name, { create: true })
  }

  for (const [index, item] of ordered.entries()) {
    if (signal?.aborted) break
    progress.current = item.file.name
    onProgress({ ...progress })
    try {
      let folderPath: string
      let fileName: string
      if (opts.mode === 'copy') {
        const folder = dateFolder(photoTime(item.meta))
        const dir = await getDirAt(target, folder, true)
        const file = await item.file.handle.getFile()
        const wanted = renamedFile(opts.rename, item.file.name, item.meta.capturedAt || item.meta.fileModified, index)
        fileName = (await copyInto(dir, wanted, file)).name
        if (backupDir) await copyInto(backupDir, item.file.name, file)
        folderPath = joinPath(subPath, folder)
      } else {
        folderPath = joinPath(subPath, item.file.dir)
        fileName = item.file.name
      }
      const [id] = await catalog.addPhotos([
        { ...item.meta, fileName, rootId, folderPath, originalName: item.file.name },
      ])
      if (id === null) {
        progress.skipped++
      } else {
        progress.imported++
        if (item.thumb) await saveThumb(id, item.thumb)
      }
    } catch (err) {
      progress.failed.push({ name: item.file.name, error: err instanceof Error ? err.message : String(err) })
    }
    progress.done++
    onProgress({ ...progress })
  }
  progress.current = ''
  onProgress({ ...progress })
  return progress
}
