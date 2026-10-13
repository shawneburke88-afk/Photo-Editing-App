// Executes an import from a card: copies files (plus an optional backup), adds them to the catalog, saves
// thumbnails. Adding a folder where it is (no copying) is Open folder, in library/indexer.ts.

import type { Catalog } from '../catalog/client'
import { photosAdded } from '../library/added'
import { loadThumb, saveThumb } from '../catalog/thumbs'
import type { PhotoMeta, PhotoMetadata } from '../catalog/types'
import { getDirAt, resolveRoot } from '../platform/roots'
import { copyVerified } from './copy'
import { baseNameOf, dateFolder, extensionOf, JPEG_EXTENSIONS, joinPath, renamedFile, type RenameTemplate } from './plan'
import type { ScannedFile } from './scan'
import { fullSidecarName, sidecarCandidates, stemOwners, stemSidecarName } from '../sidecar/naming'
import { readXmp, type SidecarRead } from '../sidecar/xmp'
import { geometryOf, lrDiffers, lrFrame, lrKey, lrState, parseLrKey, sameState } from '../sidecar/lightroom'
import { batch, lightroomStep } from '../develop/batch'
import { lrToneDiffers, lrToneKey, lrToneState, parseLrToneKey, sameLrTone, toneCurveOf } from '../sidecar/lightroomCurve'
import { normalizeSettings } from '../engine/develop/settings'
import { isRawFile } from '../engine/raw/decoder'

export interface ImportItem {
  file: ScannedFile
  meta: PhotoMeta
  thumb: Uint8Array<ArrayBuffer> | null
  /** XMP embedded in a JPEG, used when there is no sidecar. */
  xmp?: string
  /** Title, caption, creator… from the file's IPTC or EXIF, filling fields the sidecar leaves empty. */
  camera?: Partial<PhotoMetadata>
  /** Keywords from the file's IPTC, used when the sidecar has none. */
  iptcKeywords?: string[]
}

export interface ImportOptions {
  source: FileSystemDirectoryHandle
  destination: FileSystemDirectoryHandle
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

/**
 * True if `dir` already holds a file called `name` of the same size (this photo was probably copied before). Used
 * only to mark photos "Already imported" in the Import window; importing compares the content (copy.ts).
 */
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

/** A sidecar found for a photo. `borrowed`: its RAW twin's `NAME.xmp`, read because the photo has none of its own. */
export interface FoundSidecar {
  name: string
  text: string
  modified: number
  size: number
  borrowed: boolean
}

/**
 * Finds an existing sidecar for a photo (sidecar/naming.ts): the owner of `NAME.xmp` reads it, else darktable's
 * `NAME.ext.xmp`; a JPEG next to its RAW reads its own `NAME.JPG.xmp`. Without one, the JPEG borrows the RAW's
 * `NAME.xmp` when it is added (as LightBench always did, and as LightCraft does), but only for the library fields
 * (see applySidecar). Returns null when there is none.
 */
export async function findSidecar(dir: FileSystemDirectoryHandle, photoName: string, owner = true): Promise<FoundSidecar | null> {
  const names = sidecarCandidates(photoName, owner).map((name) => ({ name, borrowed: false }))
  if (!owner) names.push({ name: stemSidecarName(photoName), borrowed: true })
  for (const { name, borrowed } of names) {
    try {
      const file = await (await dir.getFileHandle(name)).getFile()
      return { name, text: await file.text(), modified: file.lastModified, size: file.size, borrowed }
    } catch {
      // not there; try the next naming style
    }
  }
  return null
}

/**
 * Applies what a sidecar says (ratings, flag, label, keywords, metadata, collections, stack, virtual copies,
 * LightBench edits) to a newly imported photo. A `borrowed` sidecar (the RAW twin's) gives only stars, flag, label,
 * keywords and metadata: its edits, virtual copies, stack and collections are the RAW's.
 */
export async function applySidecar(catalog: Catalog, id: number, text: string, borrowed = false): Promise<SidecarRead> {
  const r = readXmp(text)
  if (r.metadata) await catalog.setMetadata([id], r.metadata)
  if (r.rating !== undefined) await catalog.setRating([id], r.rating)
  if (r.flag !== undefined) await catalog.setFlag([id], r.flag)
  if (r.color !== undefined) await catalog.setColor([id], r.color)
  if (r.keywords?.length) await catalog.addKeywords([id], r.keywords)
  if (borrowed) return r
  if (r.collections?.length) await catalog.addToCollectionsByName(id, r.collections)
  if (r.stack) await catalog.joinStackByUid(id, r.stack.uid, r.stack.top)
  if (r.versions?.length) {
    // Virtual copies come back with the original's thumbnail until they are developed again.
    const made = await catalog.restoreVersions(id, r.versions)
    const thumb = made.length ? await loadThumb(id) : null
    if (thumb) for (const v of made) await saveThumb(v, new Uint8Array(await thumb.arrayBuffer()))
  }
  if (r.develop) {
    const history = JSON.stringify({ steps: [{ label: 'From sidecar', settings: JSON.parse(r.develop) }], index: 0 })
    await catalog.saveEdit(id, r.develop, history)
  }
  await readLightroomSettings(catalog, id, r)
  return r
}

/**
 * Lightroom's crop, straighten, orientation and Transform (sidecar/lightroom.ts) and its tone curve
 * (sidecar/lightroomCurve.ts), when they would change the photo. They are applied by the background developer, which
 * also solves a Lightroom Upright mode again on the photo and makes the thumbnail. A LightBench edit in the same sidecar
 * wins (so edits saved before LightBench read these fields stay as they were), unless Lightroom changed its fields
 * after LightBench last wrote them (the markers).
 */
async function readLightroomSettings(catalog: Catalog, id: number, r: SidecarRead) {
  const lr = r.lightroom
  const lt = r.lightroomTone
  const hasGeometry = !!lr && !lr.applied && Object.keys(lr.fields).length > 0
  const hasTone = !!lt && !lt.applied && Object.keys(lt.fields).length > 0
  if (!hasGeometry && !hasTone) return
  const p = await catalog.getPhoto(id)
  if (!p) return
  let geometry: string | null = null
  if (hasGeometry) {
    const frame = lrFrame(p)
    const state = lrState(lr.fields, frame)
    const marker = parseLrKey(lr.marker)
    if ((!r.develop || (marker && !sameState(marker, state))) && lrDiffers(geometryOf(r.develop), state, frame)) geometry = lrKey(state)
  }
  let tone: string | null = null
  if (hasTone) {
    const state = lrToneState(lt.fields)
    const marker = parseLrToneKey(lt.marker)
    if ((!r.develop || (marker && !sameLrTone(marker, state))) && lrToneDiffers(toneCurveOf(r.develop), state)) tone = lrToneKey(state)
  }
  if (!geometry && !tone) return
  const kind = isRawFile(p.fileName) ? 'raw' : 'rgb'
  batch.run({
    label: lightroomStep(!!geometry, !!tone),
    ids: [id],
    clip: { settings: normalizeSettings(null, kind), keys: [], rerunAuto: false, sourceKind: kind, sourceName: p.fileName },
    ...(geometry ? { lightroom: { [id]: geometry } } : {}),
    ...(tone ? { lightroomTone: { [id]: tone } } : {}),
  })
}

/**
 * Fills a newly added photo's metadata and keywords from the file itself (IPTC, EXIF), where its XMP said nothing:
 * Adobe's XMP Toolkit order (XMP over IPTC over EXIF; IPTC keywords only without XMP keywords).
 */
export async function applyEmbedded(catalog: Catalog, id: number, read: SidecarRead | null, camera?: Partial<PhotoMetadata>, iptcKeywords?: string[]) {
  if (iptcKeywords?.length && !read?.keywords?.length) await catalog.addKeywords([id], iptcKeywords)
  if (camera) await catalog.fillMetadata([id], camera)
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

  const target = opts.destination
  const { rootId, subPath } = await resolveRoot(catalog, target)

  let backupDir: FileSystemDirectoryHandle | undefined
  if (opts.backup) {
    const now = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const name = `LightBench backup ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}${p(now.getMinutes())}`
    backupDir = await opts.backup.getDirectoryHandle(name, { create: true })
  }

  // RAW+JPEG pairs, by their names on the card (renaming may give them different numbers), stacked at the end.
  const pairKey = (f: ScannedFile) => `${f.dir}/${baseNameOf(f.name).toLowerCase()}`
  const raws = new Map<string, number>()
  const jpegs = new Map<string, number>()
  // Which file of RAW+JPEG twins on the card owns `NAME.xmp` (sidecar/naming.ts).
  const owners = stemOwners(ordered.map((it) => it.file))

  for (const [index, item] of ordered.entries()) {
    if (signal?.aborted) break
    progress.current = item.file.name
    onProgress({ ...progress })
    try {
      // An existing sidecar (from Lightroom, darktable, or LightBench itself) carries ratings, labels and edits.
      const sourceDir = await getDirAt(opts.source, item.file.dir).catch(() => null)
      const sidecar = sourceDir ? await findSidecar(sourceDir, item.file.name, owners.has(`${item.file.dir}/${item.file.name}`)) : null
      const folder = dateFolder(photoTime(item.meta))
      const dir = await getDirAt(target, folder, true)
      const file = await item.file.handle.getFile()
      const wanted = renamedFile(opts.rename, item.file.name, item.meta.capturedAt || item.meta.fileModified, index)
      // Each copy is read back and compared with the card (copy.ts); a mismatch fails this photo.
      const copy = await copyVerified(dir, wanted, file)
      const fileName = copy.name
      if (backupDir) await copyVerified(backupDir, item.file.name, file, copy.digest)
      if (sidecar && !sidecar.borrowed) {
        // The sidecar travels with the photo, renamed to match it (in the same naming style). An existing one there
        // is kept. A borrowed one is the RAW's, which travels with the RAW.
        const stem = sidecar.name.toLowerCase() === stemSidecarName(item.file.name).toLowerCase()
        const name = stem ? stemSidecarName(fileName) : fullSidecarName(fileName)
        const exists = await dir.getFileHandle(name).then(() => true, () => false)
        if (!exists) {
          const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
          await w.write(sidecar.text)
          await w.close()
        }
        if (backupDir) await copyVerified(backupDir, sidecar.name, new File([sidecar.text], sidecar.name))
      }
      const folderPath = joinPath(subPath, folder)
      const [id] = await catalog.addPhotos([
        { ...item.meta, fileName, rootId, folderPath, originalName: item.file.name },
      ])
      if (id === null) {
        progress.skipped++
      } else {
        progress.imported++
        ;(JPEG_EXTENSIONS.includes(extensionOf(item.file.name)) ? jpegs : raws).set(pairKey(item.file), id)
        if (item.thumb) await saveThumb(id, item.thumb)
        const xmpText = sidecar?.text ?? item.xmp
        const read = xmpText ? await applySidecar(catalog, id, xmpText, !!sidecar?.borrowed) : null
        await applyEmbedded(catalog, id, read, item.camera, item.iptcKeywords)
      }
    } catch (err) {
      progress.failed.push({ name: item.file.name, error: err instanceof Error ? err.message : String(err) })
    }
    progress.done++
    onProgress({ ...progress })
  }
  for (const [key, jpeg] of jpegs) {
    const raw = raws.get(key)
    if (raw !== undefined) await catalog.createStack([raw, jpeg], raw).catch(() => {})
  }
  photosAdded.emit([...raws.values(), ...jpegs.values()])
  progress.current = ''
  onProgress({ ...progress })
  return progress
}
