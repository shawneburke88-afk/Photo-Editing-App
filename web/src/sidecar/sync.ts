// Keeps XMP sidecars up to date. Every rating, flag, label, keyword, metadata or edit change schedules the photo;
// changes are batched (like darktable's background sidecar queue) and a file is rewritten only when its content
// changes.
//
// Before writing, LightBench checks that no other app changed the sidecar since LightBench last read or wrote it
// (external.ts). If one did, the photo is held, and the user is asked whether to read the changes or ignore them.
//
// Writing needs read-write permission on the photo's library folder. The browser only lets LightBench ask
// for it after a click, so photos waiting for permission are held per folder until the user allows it.

import { getCatalog } from '../catalog/client'
import { QUIET_MS } from '../catalog/storage'
import { getDirAt, getRootHandle } from '../platform/roots'
import { fieldsFromRead, parseFields } from './changes'
import { snapshotsChanged } from '../develop/snapshotStore'
import { fromSidecar, toSidecar } from '../develop/snapshots'
import { externalChanges, inspectSidecar, locateSidecar } from './external'
import { detailOf, geometryOf, lrFrame, mixerOf, planLightroomWrite } from './lightroom'
import { gradingOf } from '../engine/develop/colour-grading'
import { planToneWrite, toneCurveOf } from './lightroomCurve'
import { sidecarFor } from './naming'
import { readXmp, writeXmp } from './xmp'

export interface SidecarStatus {
  /** Library folders where LightBench is waiting for permission to write sidecars. */
  needsPermission: { rootId: number; name: string }[]
  /** The last problem, e.g. a sidecar that isn't valid XMP (left unchanged) or a write that failed. */
  lastError: string | null
  /** Sidecars not saved since the notice was last hidden (shown as "and n more"). */
  failed: number
  /** Sidecar files written since the page loaded. */
  written: number
}

const DELAY_MS = 800

class SidecarSync {
  private pending = new Set<number>()
  private blocked = new Map<number, Set<number>>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private listeners = new Set<() => void>()
  status: SidecarStatus = { needsPermission: [], lastError: null, failed: 0, written: 0 }
  /** After the notice is hidden, failures within QUIET_MS are counted but don't bring it back. */
  private quietUntil = 0
  private hiddenFailures = 0

  /** Queues photos whose sidecar should reflect their current catalog state. */
  schedule(ids: Iterable<number>) {
    for (const id of ids) this.pending.add(id)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, DELAY_MS)
  }

  /** Writes everything queued now (e.g. before leaving the page). */
  async flush(): Promise<void> {
    if (this.running) {
      this.schedule([])
      return
    }
    this.running = true
    try {
      while (this.pending.size) {
        const [id] = this.pending
        this.pending.delete(id)
        try {
          await this.writeOne(id)
        } catch (e) {
          this.failed(e instanceof Error ? e.message : String(e))
        }
      }
    } finally {
      this.running = false
    }
  }

  private async writeOne(id: number) {
    const catalog = getCatalog()
    const src = await catalog.sidecarSource(id)
    if (!src) return
    const { photo } = src
    // RAW+JPEG twins (naming.ts): the RAW writes name.xmp, the JPEG its own name.JPG.xmp.
    const name = sidecarFor(photo.fileName, src.owner)
    const root = await getRootHandle(photo.rootId)
    // The browser forgot the folder (e.g. its site data was cleared): say so rather than skipping silently.
    if (!root) throw new Error(`${name}: LightBench no longer has access to this photo's folder. Open the folder again with Open folder.`)
    if ((await root.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      const waiting = this.blocked.get(photo.rootId) ?? new Set<number>()
      waiting.add(id)
      if (!this.blocked.has(photo.rootId)) {
        this.blocked.set(photo.rootId, waiting)
        const name = (await catalog.listRoots()).find((r) => r.id === photo.rootId)?.name ?? root.name
        this.status = { ...this.status, needsPermission: [...this.status.needsPermission, { rootId: photo.rootId, name }] }
        this.emit()
      }
      return
    }
    const where = photo.folderPath ? `${name} (in ${photo.folderPath})` : name
    const dir = await getDirAt(root, photo.folderPath).catch((e: Error) => {
      throw new Error(`${where}: ${e.name === 'NotFoundError' ? 'the folder can’t be found (was it moved or renamed?)' : e.message}`, { cause: e })
    })
    // Changed by another app since LightBench last read or wrote it: don't overwrite it, ask (SidecarBanner).
    const located = await locateSidecar(dir, photo.fileName, src.owner)
    if (src.sidecar.external || (located && (await inspectSidecar(catalog, src, located.file)) === 'external')) {
      externalChanges.add([photo.id])
      externalChanges.hold(photo.id)
      return
    }
    // For the RAW (or a photo alone), darktable's name.ext.xmp is read but never written: LightBench writes its own
    // name.xmp. A JPEG next to its RAW writes name.JPG.xmp, which is also darktable's name for that JPEG's sidecar;
    // darktable's fields in it are kept (writeXmp merges).
    const existing = located?.name === name ? await located.file.text() : null
    let keywords = src.keywords
    if (!src.keywordsRead) {
      // Added before LightBench had keywords: take the sidecar's keywords into the library first, so
      // rewriting the sidecar doesn't drop keywords written by Lightroom, darktable or another app.
      const found = existing ? (readXmp(existing).keywords ?? []) : []
      const missing = found.filter((k) => !keywords.some((have) => have.toLowerCase() === k.toLowerCase()))
      if (missing.length) await catalog.addKeywords([id], missing)
      await catalog.markKeywordsRead(id)
      keywords = [...keywords, ...missing]
    }
    let metadata = src.metadata
    if (!src.metadataRead) {
      // Added before LightBench had title, caption…: the same, so another app's values aren't dropped. Fields
      // already set in LightBench win.
      const found = existing ? readXmp(existing).metadata : undefined
      if (found) await catalog.fillMetadata([photo.id], found)
      await catalog.markMetadataRead(photo.id)
      metadata = await catalog.photoMetadata(photo.id)
    }
    // Lightroom's crop, orientation, Transform and Detail fields: written only where LightBench changed them (lightroom.ts).
    const frame = lrFrame(photo)
    const read = existing ? readXmp(existing) : null
    const lightroom = planLightroomWrite(read?.lightroom, read?.develop ? geometryOf(read.develop) : null, geometryOf(src.settings), frame, detailOf(read?.develop), detailOf(src.settings), mixerOf(read?.develop), mixerOf(src.settings), gradingOf(read?.develop), gradingOf(src.settings))
    // Lightroom's tone curve, by the same rules (lightroomCurve.ts).
    const lightroomTone = planToneWrite(read?.lightroomTone, toneCurveOf(read?.develop), toneCurveOf(src.settings))
    // Snapshots (docs/PHASE3.md Part 19). While the record doesn't know them (made before snapshots existed, or taken
    // silently from an older file), snapshots in the file that the catalog doesn't have are taken into the library
    // first, so rewriting the file doesn't drop snapshots another LightBench wrote. A damaged list stays in the file
    // until this photo has snapshots of its own.
    let snapshots = src.snapshots
    if (read?.snapshots?.length && parseFields(src.sidecar.fields)?.snapshots === undefined) {
      const have = new Set(snapshots.map((x) => x.id))
      const missing = read.snapshots.filter((x) => !have.has(x.id))
      if (missing.length) {
        const list = fromSidecar([...snapshots, ...missing])
        await catalog.saveSnapshots(photo.id, list)
        snapshots = toSidecar(list)
        snapshotsChanged.emit(photo.id)
      }
    }
    let text: string | null
    try {
      text = writeXmp(existing, {
        rating: photo.rating, flag: photo.flag, color: photo.color, develop: src.settings, keywords, collections: src.collections, stack: src.stack,
        versions: src.versions, metadata, lightroom, lightroomTone, snapshots: read?.snapshotsDamaged && !snapshots.length ? undefined : snapshots,
      })
    } catch (e) {
      throw new Error(`${where}: ${e instanceof Error ? e.message : e}`, { cause: e })
    }
    if (text === null) return
    let written: File
    try {
      const handle = await dir.getFileHandle(name, { create: true })
      const w = await handle.createWritable()
      await w.write(text)
      await w.close()
      written = await handle.getFile()
    } catch (e) {
      throw new Error(`${where}: ${e instanceof Error ? e.message : e}`, { cause: e })
    }
    // Remember the file as written (date, size, fields), so a later change by another app can be told apart.
    await catalog.recordSidecar(photo.id, written.lastModified, written.size, JSON.stringify(fieldsFromRead(readXmp(text), frame)), Math.floor(Date.now() / 1000))
    this.status = { ...this.status, written: this.status.written + 1 }
    this.emit()
  }

  /** Asks for write permission on a library folder (call from a click), then writes what was waiting. */
  async allow(rootId: number): Promise<boolean> {
    const root = await getRootHandle(rootId)
    if (!root) return false
    let ok = false
    try {
      ok = (await root.requestPermission({ mode: 'readwrite' })) === 'granted'
    } catch {
      ok = false
    }
    if (ok) {
      const waiting = this.blocked.get(rootId) ?? new Set<number>()
      this.blocked.delete(rootId)
      this.status = { ...this.status, needsPermission: this.status.needsPermission.filter((r) => r.rootId !== rootId) }
      this.emit()
      this.schedule(waiting)
    }
    return ok
  }

  /** Hides the permission request for now; the photos are asked about again on their next change. */
  dismiss(rootId: number) {
    this.blocked.delete(rootId)
    this.status = { ...this.status, needsPermission: this.status.needsPermission.filter((r) => r.rootId !== rootId) }
    this.emit()
  }

  private failed(message: string, now = Date.now()) {
    if (!this.status.lastError && now < this.quietUntil) {
      this.hiddenFailures++
      return
    }
    this.status = { ...this.status, lastError: message, failed: this.status.failed + this.hiddenFailures + 1 }
    this.hiddenFailures = 0
    this.emit()
  }

  clearError() {
    this.quietUntil = Date.now() + QUIET_MS
    this.status = { ...this.status, lastError: null, failed: 0 }
    this.emit()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }
}

export const sidecars = new SidecarSync()
