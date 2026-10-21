// Executes an import from a card: copies files (plus an optional backup), adds them to the catalog, saves
// thumbnails; the rest is applied in the background (import/details.ts). Adding a folder where it is (no copying) is
// Open folder, in library/indexer.ts.

import type { Catalog } from '../catalog/client'
import { masksFromLightroom } from '../sidecar/lightroomMasks'
import { loadThumb, saveThumb } from '../catalog/thumbs'
import type { PhotoMeta, PhotoMetadata } from '../catalog/types'
import { getDirAt, resolveRoot } from '../platform/roots'
import { CHUNK_BYTES, copyVerified } from './copy'
import { dateFolder, joinPath, renamedFile, type RenameTemplate } from './plan'
import { captureOrder, planImport, rawOnly, runOrdered } from './schedule'
import { ImportTiming, roundTimes, summaryLine, timed, type StepTimes } from './timing'
import { cpuBudget } from '../engine/cpu-budget'
import { diagnostics } from '../diagnostics/recorder'
import type { ScannedFile } from './scan'
import { fullSidecarName, sidecarCandidates, stemOwners, stemSidecarName } from '../sidecar/naming'
import { readXmp, type SidecarRead } from '../sidecar/xmp'
import { fromSidecar } from '../develop/snapshots'
import { detailOf, geometryOf, lrDiffers, lrFrame, lrKey, lrState, mixerOf, parseLrKey, sameState } from '../sidecar/lightroom'
import { gradingOf } from '../engine/develop/colour-grading'
import { batch, lightroomStep } from '../develop/batch'
import { lrToneDiffers, lrToneKey, lrToneState, parseLrToneKey, sameLrTone, toneCurveOf } from '../sidecar/lightroomCurve'
import { effectsOf, glowFromLightroom, lrFxDiffers, lrFxKey, lrFxState, parseLrFxKey, sameLrFx } from '../sidecar/lightroomEffects'
import { defaultsFor, normalizeSettings } from '../engine/develop/settings'
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
  /** Stack each JPEG shot alongside a RAW under its RAW (default on). */
  stackPairs?: boolean
  /** RAW only: leave each JPEG that has a RAW twin on the card (default off). */
  rawOnly?: boolean
  /** With stacking: copy the JPEG twins after all the RAWs (default on). */
  rawFirst?: boolean
  /** Photos copied at once (default: COPY_WORKERS, from the CPU budget). */
  workers?: number
  /** Called after each photo is added to the library (the Library refreshes). */
  onAdded?: () => void
}

export interface ImportProgress {
  done: number
  total: number
  imported: number
  skipped: number
  failed: { name: string; error: string }[]
  current: string
  /** JPEGs with a RAW twin left on the card (RAW only). */
  rawOnlySkipped: number
  /** Photos in the first pass: all but the JPEG twins when RAW first applies, else `total`. */
  firstPass: number
  /** When finished: "1,500 photos, 38 GB in 6 min 12 s · copying 71 % · …" (timing.ts). */
  summary: string
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

/** How a sidecar is applied to a photo already in the library (Import's background details, import/details.ts). */
export interface ApplyOptions {
  /** Leave the sidecar's stack out: Import applies it as the photo is added (runImport). */
  skipStack?: boolean
  /**
   * The photo as it is now. A rating, flag or label the person already gave it, or an edit, wins over the sidecar's
   * (they may cull the RAWs while the import is still copying); a photo nobody touched gets exactly the sidecar's.
   */
  current?: { rating: number; flag: number; color: number; edited: boolean }
}

/**
 * Applies what a sidecar says (ratings, flag, label, keywords, metadata, collections, stack, virtual copies,
 * LightBench edits and snapshots) to a newly imported photo. A `borrowed` sidecar (the RAW twin's) gives only stars, flag, label,
 * keywords and metadata: its edits, virtual copies, stack and collections are the RAW's.
 */
export async function applySidecar(catalog: Catalog, id: number, text: string, borrowed = false, o: ApplyOptions = {}): Promise<SidecarRead> {
  const r = readXmp(text)
  const cur = o.current
  if (r.metadata) await catalog.setMetadata([id], r.metadata)
  if (r.rating !== undefined && !cur?.rating) await catalog.setRating([id], r.rating)
  if (r.flag !== undefined && !cur?.flag) await catalog.setFlag([id], r.flag)
  if (r.color !== undefined && !cur?.color) await catalog.setColor([id], r.color)
  if (r.keywords?.length) await catalog.addKeywords([id], r.keywords)
  if (borrowed) return r
  if (r.collections?.length) await catalog.addToCollectionsByName(id, r.collections)
  if (r.stack && !o.skipStack) await catalog.joinStackByUid(id, r.stack.uid, r.stack.top)
  if (r.versions?.length) {
    // Virtual copies come back with the original's thumbnail until they are developed again.
    const made = await catalog.restoreVersions(id, r.versions)
    const thumb = made.length ? await loadThumb(id) : null
    if (thumb) for (const v of made) await saveThumb(v, new Uint8Array(await thumb.arrayBuffer()))
  }
  if (cur?.edited) return r
  if (r.develop) {
    const history = JSON.stringify({ steps: [{ label: 'From sidecar', settings: JSON.parse(r.develop) }], index: 0 })
    await catalog.saveEdit(id, r.develop, history)
  }
  // LightBench's snapshots (docs/PHASE3.md Part 19): read defensively, a damaged list was already left out by readXmp.
  if (r.snapshots?.length) await catalog.saveSnapshots(id, fromSidecar(r.snapshots))
  await readLightroomSettings(catalog, id, r)
  await readLightroomMasks(catalog, id, r)
  return r
}

/**
 * Lightroom's masks (crs:MaskGroupBasedCorrections), read best-effort and labelled experimental (docs/PHASE3.md Part 23):
 * added by the background developer (which also renders the thumbnail) to a photo without a LightBench edit. Masks
 * Lightroom keeps in its .acr file can't be read; Develop says when one is there.
 */
async function readLightroomMasks(catalog: Catalog, id: number, r: SidecarRead) {
  if (!r.lightroomMasks?.length || r.develop) return
  const p = await catalog.getPhoto(id)
  if (!p) return
  const read = masksFromLightroom(r.lightroomMasks, lrFrame(p).stored)
  for (const n of read.notes) console.info(`Lightroom masks of ${p.fileName}: ${n}`)
  if (!read.masks.length) return
  const kind = isRawFile(p.fileName) ? 'raw' : 'rgb'
  batch.run({
    label: 'Lightroom masks (experimental)',
    ids: [id],
    clip: { settings: { ...normalizeSettings(null, kind), masks: read.masks }, keys: ['masks'], rerunAuto: false, sourceKind: kind, sourceName: p.fileName },
  })
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
  const lx = r.lightroomFx
  const hasGeometry = !!lr && !lr.applied && Object.keys(lr.fields).length > 0
  const hasTone = !!lt && !lt.applied && Object.keys(lt.fields).length > 0
  const hasFx = !!lx && !lx.applied && (lx.fields.some((v) => v !== undefined) || Object.keys(lx.glow).length > 0)
  if (!hasGeometry && !hasTone && !hasFx) return
  const p = await catalog.getPhoto(id)
  if (!p) return
  const kind = isRawFile(p.fileName) ? 'raw' : 'rgb'
  let geometry: string | null = null
  if (hasGeometry) {
    const frame = lrFrame(p)
    const state = lrState(lr.fields, frame)
    const marker = parseLrKey(lr.marker)
    // Lightroom's Detail fields are part of this state. A photo without a LightBench edit has the defaults for its
    // kind and ISO (RAWs are sharpened by default).
    const detail = r.develop ? detailOf(r.develop) : defaultsFor(kind, p.iso).detail
    if ((!r.develop || (marker && !sameState(marker, state))) && lrDiffers(geometryOf(r.develop), state, frame, detail, mixerOf(r.develop), gradingOf(r.develop))) geometry = lrKey(state)
  }
  let tone: string | null = null
  if (hasTone) {
    const state = lrToneState(lt.fields)
    const marker = parseLrToneKey(lt.marker)
    if ((!r.develop || (marker && !sameLrTone(marker, state))) && lrToneDiffers(toneCurveOf(r.develop), state)) tone = lrToneKey(state)
  }
  // Lightroom's Effects (Part 25): read at import, by the same rule; Glow's fields (read only) only with no LightBench edit.
  let fx: { key: string; glow?: string } | null = null
  if (hasFx) {
    const state = lrFxState(lx.fields)
    const marker = parseLrFxKey(lx.marker)
    const glow = r.develop ? undefined : glowFromLightroom(lx.glow)
    if ((!r.develop || (marker && !sameLrFx(marker, state))) && (lrFxDiffers(effectsOf(r.develop), state) || glow)) fx = { key: lrFxKey(state), ...(glow ? { glow: JSON.stringify(glow) } : {}) }
  }
  if (!geometry && !tone && !fx) return
  batch.run({
    label: lightroomStep(!!geometry || !!fx, !!tone),
    ids: [id],
    clip: { settings: normalizeSettings(null, kind), keys: [], rerunAuto: false, sourceKind: kind, sourceName: p.fileName },
    ...(geometry ? { lightroom: { [id]: geometry } } : {}),
    ...(tone ? { lightroomTone: { [id]: tone } } : {}),
    ...(fx ? { lightroomFx: { [id]: fx } } : {}),
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

/** What Import leaves for the background details (import/details.ts), kept in the catalog with the photo (JSON). */
export interface ImportDetails {
  /** The sidecar read on the card. `borrowed`: the RAW twin's `NAME.xmp` (library fields only). */
  sidecar?: { text: string; borrowed: boolean }
  /** XMP embedded in a JPEG, used when there is no sidecar. */
  xmp?: string
  camera?: Partial<PhotoMetadata>
  iptcKeywords?: string[]
  /** Stack RAW+JPEG twins (the import's option): also with twins imported earlier or elsewhere, by name and time. */
  pair?: boolean
  /**
   * The twin of this import added before this photo, stacked with it as it was added: `pair` a new stack of the two
   * (`thisOnTop`: this photo is the RAW), `join` this photo joined the stack the twin's sidecar made.
   */
  stackWith?: { id: number; how: 'pair' | 'join'; thisOnTop: boolean }
}

/** How many photos are copied at once: up to 3, at least 2 (foreground work on the CPU budget, engine/cpu-budget.ts). */
export const COPY_WORKERS = { want: 3, min: 2 }

/** `?importWorkers=N` (testing and measurements): copy N photos at once instead. */
function workersOverride(): number | null {
  try {
    const n = Number(new URLSearchParams(globalThis.location?.search ?? '').get('importWorkers'))
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
  } catch {
    return null
  }
}

interface Copied {
  ok: boolean
  error?: string
  fileName?: string
  folder?: string
  sidecar?: FoundSidecar | null
  bytes: number
  t: StepTimes
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Imports photos from a card (owner's decisions of 2026-10-20, docs/PHASE3.md "Import speed"):
 * - a few photos are copied at once (schedule.ts), each copy (and backup copy) read back and checked (copy.ts), and
 *   added to the library in a fixed order with its camera preview as thumbnail, its sidecar's stack and its RAW+JPEG
 *   twin's stack; names, numbering (`-1`), folders and sidecars are those of the import one at a time;
 * - RAW first: with RAW+JPEG stacking on, the JPEG twins are copied after every RAW, each joining its RAW's stack;
 * - RAW only (`rawOnly`): JPEGs with a RAW twin are left on the card and counted;
 * - the rest (the sidecar's ratings, keywords, edits…, the camera's metadata, pairing with twins imported earlier,
 *   the develop and metadata presets for new photos) is applied afterwards in the background (import/details.ts),
 *   from what is kept with each photo in the catalog, so it resumes after the tab is closed;
 * - every step is timed (timing.ts) and logged to Diagnostics.
 * The import is finished when every file is copied, checked and in the library.
 */
export async function runImport(
  catalog: Catalog,
  items: ImportItem[],
  opts: ImportOptions,
  onProgress: (p: ImportProgress) => void,
  signal?: AbortSignal,
): Promise<ImportProgress> {
  const started = performance.now()
  const stackPairs = opts.stackPairs !== false
  const split = opts.rawOnly ? rawOnly(items, (it) => ({ dir: it.file.dir, name: it.file.name, capturedAt: it.meta.capturedAt })) : { kept: items, skipped: [] }
  const ordered = captureOrder(split.kept, (it) => photoTime(it.meta), (it) => it.file.name)
  const progress: ImportProgress = { done: 0, total: ordered.length, imported: 0, skipped: 0, failed: [], current: '', rawOnlySkipped: split.skipped.length, firstPass: ordered.length, summary: '' }

  const target = opts.destination
  const { rootId, subPath } = await resolveRoot(catalog, target)

  let backupDir: FileSystemDirectoryHandle | undefined
  if (opts.backup) {
    const now = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const name = `LightBench backup ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}${p(now.getMinutes())}`
    backupDir = await opts.backup.getDirectoryHandle(name, { create: true })
  }

  // Which file of RAW+JPEG twins on the card owns `NAME.xmp` (sidecar/naming.ts).
  const owners = stemOwners(ordered.map((it) => it.file))
  const isOwner = (it: ImportItem) => owners.has(`${it.file.dir}/${it.file.name}`)
  const planned = ordered.map((it, index) => ({
    dir: it.file.dir,
    name: it.file.name,
    capturedAt: it.meta.capturedAt,
    folder: dateFolder(photoTime(it.meta)),
    wanted: renamedFile(opts.rename, it.file.name, it.meta.capturedAt || it.meta.fileModified, index),
    owner: isOwner(it),
  }))
  // RAW+JPEG pairs, by their names on the card (renaming may give them different numbers) and capture times
  // (catalog/stacks.ts). Each pair is stacked as soon as both are in the library, so a stopped or interrupted import
  // keeps the stacks it made; twins imported earlier are paired by the background details.
  const plan = planImport(planned, { stackPairs, rawFirst: opts.rawFirst !== false, backup: !!backupDir })
  progress.firstPass = plan.phase.filter((ph) => ph === 1).length
  const added = new Map<number, number>()
  /** Photos whose sidecar put them in a stack already: their twin joins that stack instead. */
  const sidecarStacked = new Set<number>()
  const timing = new ImportTiming()

  const dirs = new Map<string, Promise<FileSystemDirectoryHandle>>()
  const destDir = (folder: string) => {
    let d = dirs.get(folder)
    if (!d) {
      d = getDirAt(target, folder, true)
      dirs.set(folder, d)
      d.catch(() => dirs.delete(folder))
    }
    return d
  }
  const sourceDirs = new Map<string, Promise<FileSystemDirectoryHandle | null>>()
  const sourceDir = (dir: string) => {
    let d = sourceDirs.get(dir)
    if (!d) sourceDirs.set(dir, (d = getDirAt(opts.source, dir).catch(() => null)))
    return d
  }

  /** Copies one photo (and its sidecar, and the backups): runs a few at a time. */
  const copyOne = async (index: number): Promise<Copied> => {
    const item = ordered[index]
    const { folder, wanted } = planned[index]
    const t: StepTimes = {}
    let bytes = 0
    try {
      // An existing sidecar (from Lightroom, darktable, or LightBench itself) carries ratings, labels and edits.
      const src = await sourceDir(item.file.dir)
      const sidecar = src ? await timed(t, 'sidecar', () => findSidecar(src, item.file.name, isOwner(item))) : null
      const dir = await destDir(folder)
      const file = await item.file.handle.getFile()
      bytes = file.size
      // Each copy is read back and compared with the card (copy.ts); a mismatch fails this photo.
      const copy = await copyVerified(dir, wanted, file, undefined, CHUNK_BYTES, t)
      const fileName = copy.name
      if (backupDir) {
        const bd = backupDir
        await timed(t, 'backup', () => copyVerified(bd, item.file.name, file, copy.digest))
      }
      if (sidecar && !sidecar.borrowed) {
        // The sidecar travels with the photo, renamed to match it (in the same naming style). An existing one there
        // is kept. A borrowed one is the RAW's, which travels with the RAW.
        await timed(t, 'sidecar', async () => {
          const stem = sidecar.name.toLowerCase() === stemSidecarName(item.file.name).toLowerCase()
          const name = stem ? stemSidecarName(fileName) : fullSidecarName(fileName)
          const exists = await dir.getFileHandle(name).then(() => true, () => false)
          if (!exists) {
            const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
            await w.write(sidecar.text)
            await w.close()
          }
        })
        if (backupDir) {
          const bd = backupDir
          await timed(t, 'backup', () => copyVerified(bd, sidecar.name, new File([sidecar.text], sidecar.name)))
        }
      }
      return { ok: true, fileName, folder, sidecar, bytes, t }
    } catch (err) {
      return { ok: false, error: message(err), bytes, t }
    }
  }

  /** Adds a copied photo to the library: one at a time, in the planned order. */
  const commit = async (index: number, r: Copied) => {
    const item = ordered[index]
    progress.current = item.file.name
    const t = r.t
    let outcome = 'failed'
    if (!r.ok) {
      progress.failed.push({ name: item.file.name, error: r.error ?? 'failed' })
    } else {
      try {
        const sidecar = r.sidecar
        // The sidecar's stack is applied with the photo (its twin may join it at once); the rest in the background.
        const own = sidecar && !sidecar.borrowed ? readXmp(sidecar.text) : null
        const ownStack = own?.stack
        const other = plan.twin.get(index)
        const otherId = other === undefined ? undefined : added.get(other)
        const pairNow = otherId !== undefined && other !== undefined && !ownStack && !sidecarStacked.has(other)
        const raw = isRawFile(item.file.name)
        const details: ImportDetails = {
          ...(sidecar ? { sidecar: { text: sidecar.text, borrowed: sidecar.borrowed } } : item.xmp ? { xmp: item.xmp } : {}),
          ...(item.camera ? { camera: item.camera } : {}),
          ...(item.iptcKeywords?.length ? { iptcKeywords: item.iptcKeywords } : {}),
          ...(stackPairs ? { pair: true } : {}),
        }
        const folderPath = joinPath(subPath, r.folder!)
        const meta = { ...item.meta, fileName: r.fileName!, rootId, folderPath, originalName: item.file.name }
        // The row and what is still to do go in together, so nothing is lost if the tab closes now.
        if (otherId !== undefined) details.stackWith = { id: otherId, how: pairNow ? 'pair' : 'join', thisOnTop: raw }
        const [id] = await timed(t, 'catalog', () => catalog.addPhotos([{ ...meta, importDetails: JSON.stringify(details) }]))
        if (id === null) {
          progress.skipped++
          outcome = 'skipped'
        } else {
          progress.imported++
          outcome = 'added'
          added.set(index, id)
          if (item.thumb) await timed(t, 'thumbnail', () => saveThumb(id, item.thumb!))
          if (ownStack) {
            await timed(t, 'stacking', () => catalog.joinStackByUid(id, ownStack.uid, ownStack.top))
            sidecarStacked.add(index)
          }
          if (otherId !== undefined) {
            // A failed stack doesn't fail the photo: it is in the library either way (the background details try again).
            await timed(t, 'stacking', () =>
              (pairNow ? catalog.createStack([id, otherId], raw ? id : otherId) : catalog.stackRawJpegPairs([id])).then(
                () => {},
                (err) => console.warn('RAW+JPEG stacking failed', err),
              ),
            )
          }
        }
      } catch (err) {
        progress.failed.push({ name: item.file.name, error: message(err) })
      }
    }
    progress.done++
    timing.add(t, r.ok ? r.bytes : 0)
    diagnostics.log('import-photo', { n: progress.done, kind: isRawFile(item.file.name) ? 'RAW' : 'JPEG', pass: plan.phase[index], bytes: r.bytes, outcome, ms: roundTimes(t) })
    opts.onAdded?.()
    onProgress({ ...progress })
  }

  onProgress({ ...progress })
  const override = opts.workers ?? workersOverride()
  const lease = override ? null : cpuBudget.acquire('foreground', COPY_WORKERS.want, COPY_WORKERS.min)
  const workers = () => override ?? Math.min(COPY_WORKERS.want, Math.max(COPY_WORKERS.min, lease!.slots))
  try {
    await runOrdered({ order: plan.order, deps: plan.deps, workers, run: copyOne, commit, signal, onWake: (wake) => lease?.onChange(wake) ?? (() => {}) })
  } finally {
    lease?.release()
  }
  const totals = timing.totals(performance.now() - started)
  progress.summary = summaryLine(totals)
  progress.current = ''
  diagnostics.log('import-done', {
    photos: ordered.length, imported: progress.imported, skipped: progress.skipped, failed: progress.failed.length, rawOnlySkipped: progress.rawOnlySkipped,
    stopped: !!signal?.aborted && progress.done < progress.total, workers: override ?? `${COPY_WORKERS.min}-${COPY_WORKERS.want}`, rawFirst: progress.firstPass < progress.total,
    backup: !!backupDir, bytes: totals.bytes, wallMs: totals.wallMs, mbPerS: totals.mbPerS, ms: totals.steps, pct: totals.shares,
  })
  onProgress({ ...progress })
  return progress
}
