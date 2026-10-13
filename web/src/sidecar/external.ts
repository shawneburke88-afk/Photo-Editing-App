// Shared by the sidecar writer (sync.ts) and the checks (watch.ts): finding a photo's sidecar file, judging whether
// another app changed it (changes.ts), and the list of photos waiting for the user's answer.

import type { Catalog } from '../catalog/client'
import { fieldsFromCatalog, fieldsFromRead, judge, needsRead } from './changes'
import { lrFrame } from './lightroom'
import { sidecarCandidates } from './naming'
import { isValidXmp, readXmp } from './xmp'

type Source = NonNullable<Awaited<ReturnType<Catalog['sidecarCompare']>>>

/**
 * A photo's sidecar (naming.ts): for the file that owns it, Lightroom-style `name.xmp` (what LightBench writes), else
 * darktable's `name.ext.xmp`; for a JPEG next to its RAW, only its own `name.JPG.xmp` (the RAW's isn't its own).
 */
export async function locateSidecar(dir: FileSystemDirectoryHandle, photoName: string, owner = true): Promise<{ name: string; file: File } | null> {
  for (const name of sidecarCandidates(photoName, owner)) {
    try {
      return { name, file: await (await dir.getFileHandle(name)).getFile() }
    } catch {
      // not there; try the next naming style
    }
  }
  return null
}

export const oursOf = (src: Source) =>
  fieldsFromCatalog({ rating: src.photo.rating, flag: src.photo.flag, color: src.photo.color, keywords: src.keywords, metadata: src.metadata, develop: src.settings }, lrFrame(src.photo))

/**
 * Looks at a photo's sidecar file. 'same': unchanged since LightBench last read or wrote it (not read); 'adopted':
 * it changed, but not in a way that needs asking (remembered as the new base); 'external': another app changed it
 * (marked in the catalog and added to the notice); 'unreadable': not valid XMP (perhaps being written), left alone.
 */
export async function inspectSidecar(catalog: Catalog, src: Source, file: File): Promise<'same' | 'adopted' | 'external' | 'unreadable'> {
  const id = src.photo.id
  if (src.sidecar.external) {
    externalChanges.add([id])
    return 'external'
  }
  if (!needsRead(src.sidecar, file)) return 'same'
  const text = await file.text()
  if (!isValidXmp(text)) return 'unreadable'
  const verdict = judge(src.sidecar, file, fieldsFromRead(readXmp(text), lrFrame(src.photo)), oursOf(src))
  if (verdict.external) {
    await catalog.setSidecarExternal([id], true)
    externalChanges.add([id])
    return 'external'
  }
  await catalog.recordSidecar(id, file.lastModified, file.size, JSON.stringify(verdict.record))
  return 'adopted'
}

type Listener = () => void

/** Photos whose sidecar another app changed, waiting for "Read changes" or "Ignore". */
class ExternalChanges {
  private ids = new Set<number>()
  private held = new Set<number>()
  private snapshot: number[] = []
  private listeners = new Set<Listener>()
  private showListeners = new Set<(ids: number[]) => void>()

  get = () => this.snapshot

  add(ids: number[]) {
    const before = this.ids.size
    for (const id of ids) this.ids.add(id)
    if (this.ids.size !== before) this.emit()
  }

  remove(ids: number[]) {
    const before = this.ids.size
    for (const id of ids) this.ids.delete(id)
    if (this.ids.size !== before) this.emit()
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  /** A write of this photo's sidecar was held back because of the other app's change. */
  hold(id: number) {
    this.held.add(id)
  }

  /** Of `ids`, those whose sidecar write was held back (forgotten here). */
  takeHeld(ids: number[]): number[] {
    const out = ids.filter((id) => this.held.has(id))
    for (const id of ids) this.held.delete(id)
    return out
  }

  /** "Show photos": the Library shows just these photos. */
  show(ids: number[]) {
    this.showListeners.forEach((fn) => fn(ids))
  }

  onShow(fn: (ids: number[]) => void) {
    this.showListeners.add(fn)
    return () => void this.showListeners.delete(fn)
  }

  private emit() {
    this.snapshot = [...this.ids]
    this.listeners.forEach((fn) => fn())
  }
}

export const externalChanges = new ExternalChanges()
