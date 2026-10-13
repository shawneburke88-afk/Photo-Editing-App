// Notices sidecars changed by other apps (Lightroom, Bridge, darktable, another LightBench) and carries out the
// user's answer. Checks run when a folder is opened or looked at again (⟳), and for the one photo shown in the Loupe
// or Develop. Only the file's date and size are looked at, unless they changed (changes.ts), so checking a folder
// doesn't read every sidecar.
//
// Owner's choice (2026-10-12): offer, don't surprise. There is no setting: LightBench always asks (SidecarBanner):
// "Read changes" takes the other app's stars, label, keywords and metadata (and LightBench develop settings, if
// another LightBench changed them, and Lightroom's crop, orientation and Transform, sidecar/lightroom.ts); "Ignore" keeps LightBench's values, which replace the other app's in the file the
// next time LightBench writes it.

import { getCatalog } from '../catalog/client'
import { batch } from '../develop/batch'
import { PASTE_ITEMS } from '../develop/paste'
import { normalizeSettings } from '../engine/develop/settings'
import { isRawFile } from '../engine/raw/decoder'
import { getDirAt, getRootHandle } from '../platform/roots'
import { fieldsFromRead, mergeForRead, parseFields } from './changes'
import { lrFrame } from './lightroom'
import { sidecarCandidates } from './naming'
import { externalChanges, inspectSidecar, locateSidecar, oursOf } from './external'
import { sidecars } from './sync'
import { isValidXmp, readXmp } from './xmp'

export interface FolderCheck {
  /** Photos whose sidecar record was looked at, sidecar files found, files read (date or size changed), changed by another app. */
  photos: number
  files: number
  read: number
  external: number
  ms: number
}

/** Sidecar files looked at in parallel. */
const PARALLEL = 16

let loaded: Promise<void> | null = null

/** Brings back photos marked in an earlier visit, so the notice isn't lost by reloading. */
export function loadExternalChanges(): Promise<void> {
  const catalog = getCatalog()
  loaded ??= catalog
    .open()
    .then(() => catalog.externalSidecars())
    .then((ids) => externalChanges.add(ids))
    .catch(() => {
      loaded = null
    })
  return loaded
}

/** The photo's folder, if LightBench can read it now (no permission prompt). */
async function photoDir(photo: { rootId: number; folderPath: string }): Promise<FileSystemDirectoryHandle | null> {
  const root = await getRootHandle(photo.rootId)
  if (!root || (await root.queryPermission({ mode: 'read' })) !== 'granted') return null
  return getDirAt(root, photo.folderPath).catch(() => null)
}

/** Quick check of one photo (shown in the Loupe or Develop): one file date, and a read only if it changed. */
export async function checkPhoto(id: number): Promise<void> {
  try {
    const catalog = getCatalog()
    const src = await catalog.sidecarSource(id)
    if (!src) return
    if (src.sidecar.external) return externalChanges.add([src.photo.id])
    const dir = await photoDir(src.photo)
    const located = dir ? await locateSidecar(dir, src.photo.fileName, src.owner) : null
    if (located) await inspectSidecar(catalog, src, located.file)
  } catch {
    // A check that fails (folder gone, catalog busy) is tried again next time.
  }
}

/**
 * Checks the sidecars of the photos under a library folder, after Open folder or ⟳ found its files. `lookup` gives
 * the sidecar file found by the scan for a photo (by its folder path in the library and its name).
 */
export async function checkFolder(rootId: number, path: string, lookup: (folderPath: string, sidecarName: string) => FileSystemFileHandle | undefined, stopped: () => boolean): Promise<FolderCheck> {
  const t0 = performance.now()
  const catalog = getCatalog()
  const rows = await catalog.sidecarStates(rootId, path)
  const out: FolderCheck = { photos: rows.length, files: 0, read: 0, external: 0, ms: 0 }
  let next = 0
  const work = async () => {
    while (next < rows.length && !stopped()) {
      const r = rows[next++]
      if (r.external) {
        externalChanges.add([r.id])
        out.external++
        continue
      }
      // The file this photo reads and writes (naming.ts): a JPEG next to its RAW watches its own name.JPG.xmp.
      const handle = sidecarCandidates(r.fileName, r.owner).reduce<FileSystemFileHandle | undefined>((found, name) => found ?? lookup(r.folderPath, name), undefined)
      if (!handle) continue
      try {
        const file = await handle.getFile()
        out.files++
        if (r.modified !== null && r.modified === file.lastModified && r.size === file.size) continue
        out.read++
        const src = await catalog.sidecarCompare(r.id)
        if (src && (await inspectSidecar(catalog, src, file)) === 'external') out.external++
      } catch {
        // gone or unreadable since the scan; looked at again next time
      }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, work))
  out.ms = performance.now() - t0
  lastFolderCheck = out
  return out
}

/** The last folder check, for measuring. */
export let lastFolderCheck: FolderCheck | null = null

/** Result of Read changes / Ignore, for the notice. */
export interface Answer {
  done: number
  /** Photos whose sidecar couldn't be read now (folder not connected, file not valid XMP); still marked. */
  skipped: number
}

/**
 * Read changes: applies what the other app changed to each photo (changes.ts mergeForRead), remembers the file as
 * read, and rewrites the sidecar if LightBench has changes of its own to add. Develop settings from another LightBench
 * become a new history step (so the earlier edit can be undone back to), through the same background job as Paste;
 * Develop keeps unsaved changes of its own.
 */
export async function readChanges(ids: number[]): Promise<Answer> {
  const catalog = getCatalog()
  const answer: Answer = { done: 0, skipped: 0 }
  const done: number[] = []
  for (const id of ids) {
    const src = await catalog.sidecarSource(id)
    if (!src) {
      externalChanges.remove([id])
      continue
    }
    const dir = await photoDir(src.photo)
    const located = dir ? await locateSidecar(dir, src.photo.fileName, src.owner).catch(() => null) : null
    if (!dir) {
      answer.skipped++
      continue
    }
    if (!located) {
      // The file is gone: nothing to read. LightBench writes a new one with its values.
      await catalog.setSidecarExternal([id], false)
      done.push(id)
      continue
    }
    const text = await located.file.text()
    if (!isValidXmp(text)) {
      answer.skipped++
      continue
    }
    const p = mergeForRead(parseFields(src.sidecar.fields), oursOf(src), fieldsFromRead(readXmp(text), lrFrame(src.photo)))
    if (p.rating !== undefined) await catalog.setRating([id], p.rating)
    if (p.flag !== undefined) await catalog.setFlag([id], p.flag)
    if (p.color !== undefined) await catalog.setColor([id], p.color)
    if (p.addKeywords.length) await catalog.addKeywords([id], p.addKeywords)
    if (p.removeKeywords.length) await catalog.removeKeywords([id], p.removeKeywords)
    if (Object.keys(p.metadata).length) await catalog.setMetadata([id], p.metadata)
    await catalog.recordSidecar(id, located.file.lastModified, located.file.size, JSON.stringify(p.record))
    if (p.develop || p.geometry || p.toneCurve) {
      // LightBench settings from another LightBench are pasted whole; Lightroom's crop, orientation, Transform and tone
      // curve are then applied on top (its Upright solved again on the photo).
      const kind = isRawFile(src.photo.fileName) ? 'raw' : 'rgb'
      batch.run({
        label: 'Read from sidecar',
        ids: [id],
        clip: p.develop
          ? { settings: normalizeSettings(JSON.parse(p.develop), kind), keys: PASTE_ITEMS.map((i) => i.key), rerunAuto: false, sourceKind: kind, sourceName: located.name }
          : { settings: normalizeSettings(null, kind), keys: [], rerunAuto: false, sourceKind: kind, sourceName: located.name },
        ...(p.geometry ? { lightroom: { [id]: p.geometry } } : {}),
        ...(p.toneCurve ? { lightroomTone: { [id]: p.toneCurve } } : {}),
      })
    }
    done.push(id)
  }
  externalChanges.remove(done)
  externalChanges.takeHeld(done)
  // LightBench's own changes to other fields (and its pick flag) go back into the file.
  sidecars.schedule(done)
  answer.done = done.length
  return answer
}

/**
 * Ignore: keeps LightBench's values and remembers the file as it is now, so it isn't reported again. The file is
 * rewritten with LightBench's values the next time LightBench writes it (straight away for photos whose write was
 * held back by the other app's change).
 */
export async function ignoreChanges(ids: number[]): Promise<Answer> {
  const catalog = getCatalog()
  const answer: Answer = { done: 0, skipped: 0 }
  const done: number[] = []
  for (const id of ids) {
    const src = await catalog.sidecarSource(id)
    if (!src) {
      externalChanges.remove([id])
      continue
    }
    const dir = await photoDir(src.photo)
    const located = dir ? await locateSidecar(dir, src.photo.fileName, src.owner).catch(() => null) : null
    if (!dir) {
      answer.skipped++
      continue
    }
    const text = located ? await located.file.text() : null
    if (located && text !== null && isValidXmp(text)) {
      const p = mergeForRead(parseFields(src.sidecar.fields), oursOf(src), fieldsFromRead(readXmp(text), lrFrame(src.photo)))
      await catalog.recordSidecar(id, located.file.lastModified, located.file.size, JSON.stringify(p.record))
    } else {
      await catalog.setSidecarExternal([id], false)
    }
    done.push(id)
  }
  externalChanges.remove(done)
  sidecars.schedule(externalChanges.takeHeld(done))
  answer.done = done.length
  return answer
}
