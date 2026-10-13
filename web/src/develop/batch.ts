// Applies copied settings to many photos in the background (Paste onto a selection, Sync, Auto Sync).
//
// Each photo is decoded and developed like in Develop: Auto re-runs on its own pixels when the copy asks for it,
// the result is added to its history as one step, and its thumbnail and sidecar are refreshed. Jobs run one photo
// at a time on their own GPU engine, so Develop stays responsive.

import { getCatalog } from '../catalog/client'
import { forgetThumbUrl, saveThumb } from '../catalog/thumbs'
import { metricsFromStats, solveAuto } from '../engine/develop/auto'
import { displayUniforms, type DevelopSettings, type SourceKind } from '../engine/develop/settings'
import { DevelopEngine } from '../engine/gpu/develop-engine'
import { isRawFile, RawDecoder } from '../engine/raw/decoder'
import { openPhotoFile } from '../platform/roots'
import { sidecars } from '../sidecar/sync'
import { current, loadHistory, record, savedForm } from './history'
import { applyPaste, mergeClipboards, type Clipboard } from './paste'
import { loadIntoEngine, multipliers, renderThumbnail, stageOptions, type SensorInfo } from './source'
import { ownFocal, rerunUpright, wantsUprightRerun } from './uprightRun'
import { fromLightroom, lrFrame, parseLrKey, UPRIGHT_CODE } from '../sidecar/lightroom'
import { withDetail } from '../engine/detail/settings'

export interface BatchJob {
  /** History step added to each photo, e.g. "Paste settings". */
  label: string
  ids: number[]
  clip: Clipboard
  /** Leave photos that already have edits alone (the preset for new photos; edits may come from their sidecars). */
  onlyUnedited?: boolean
  /**
   * Lightroom's crop, orientation and Transform to apply to each photo (sidecar/lightroom.ts `lrKey`, by photo id),
   * after the copy. An Upright mode read from Lightroom is solved again on the photo, like a pasted one.
   */
  lightroom?: Record<number, string>
}

/** The history step of a crop or Transform read from a Lightroom sidecar when a photo is added. */
/** The history step of Lightroom's settings read when a photo is added (crop, Transform, Detail). */
export const LIGHTROOM_STEP = 'Lightroom settings'
/** Its name before the Detail fields were read (Phase 3, Part 7). */
const LIGHTROOM_STEP_V1 = 'Lightroom crop & Transform'

/** An edit whose only step is the Lightroom geometry read when the photo was added (the preset for new photos still applies). */
function onlyFromLightroom(history: string): boolean {
  try {
    const h = JSON.parse(history) as { steps?: { label?: string }[] }
    return !!h.steps?.length && h.steps.every((s) => s.label === LIGHTROOM_STEP || s.label === LIGHTROOM_STEP_V1)
  } catch {
    return false
  }
}

export interface BatchStatus {
  /** The job running now, or null. */
  active: { label: string; done: number; total: number; current: string } | null
  /** Photos waiting in later jobs. */
  queued: number
  /** Summary of the last finished run, until the next starts. */
  lastResult: string
  problems: { name: string; error: string }[]
  /** Counts finished runs (the progress box uses it to know a new summary arrived). */
  runs: number
}

/** Runs Auto on the photo loaded in `engine`, as recorded in `s.auto`. */
export async function rerunAuto(engine: DevelopEngine, s: DevelopSettings, info: SensorInfo): Promise<DevelopSettings> {
  const a = s.auto
  if (!a) return s
  await engine.process(stageOptions(s, info))
  const r = await solveAuto(
    s,
    a.target,
    async (x) => metricsFromStats(await engine.renderStats(displayUniforms(x), multipliers(x, info), 256)),
    12,
    { sliders: a.sliders, strength: a.strength },
  )
  return r.settings
}

class BatchDeveloper {
  status: BatchStatus = { active: null, queued: 0, lastResult: '', problems: [], runs: 0 }
  private queue: BatchJob[] = []
  private listeners = new Set<() => void>()
  private updatedListeners = new Set<(id: number) => void>()
  private running = false
  private stopped = false
  private engine: Promise<DevelopEngine> | null = null
  private decoder: RawDecoder | null = null

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  /** Called with each photo whose saved edit was just changed (Develop reloads it if it is showing it). */
  onUpdated(fn: (id: number) => void) {
    this.updatedListeners.add(fn)
    return () => void this.updatedListeners.delete(fn)
  }

  /** Photos waiting or being worked on. */
  isPending(id: number) {
    return this.queue.some((j) => j.ids.includes(id))
  }

  run(job: BatchJob) {
    if (!job.ids.length) return
    // Auto Sync sends a job per change; one still waiting for the same photos absorbs the next.
    const last = this.queue[this.queue.length - 1]
    const waiting = this.running ? this.queue.indexOf(last) > 0 : !!last
    if (last && waiting && last.label === job.label && !last.onlyUnedited === !job.onlyUnedited && last.ids.length === job.ids.length && last.ids.every((id, i) => id === job.ids[i])) {
      last.clip = mergeClipboards(last.clip, job.clip)
      if (job.lightroom) last.lightroom = { ...last.lightroom, ...job.lightroom }
    } else if (last && waiting && job.lightroom && last.lightroom && last.label === job.label && job.label === LIGHTROOM_STEP) {
      // Photos added one by one with Lightroom crops: one job for all of them.
      for (const id of job.ids) if (!last.ids.includes(id)) last.ids.push(id)
      last.lightroom = { ...last.lightroom, ...job.lightroom }
    } else {
      this.queue.push({ ...job, ids: [...job.ids] })
    }
    this.publish()
    if (!this.running) void this.loop()
  }

  /** Stops after the photo being worked on; photos already done keep their new settings. */
  stop() {
    this.stopped = true
    this.queue.splice(1)
    this.publish()
  }

  private publish(patch: Partial<BatchStatus> = {}) {
    const queued = this.queue.slice(this.running ? 1 : 0).reduce((n, j) => n + j.ids.length, 0)
    this.status = { ...this.status, ...patch, queued }
    this.listeners.forEach((fn) => fn())
  }

  private async loop() {
    this.running = true
    const problems: BatchStatus['problems'] = []
    let changed = 0
    let skipped = 0
    let label = ''
    try {
      while (this.queue.length) {
        const job = this.queue[0]
        label = job.label
        this.stopped = false
        for (const [i, id] of job.ids.entries()) {
          if (this.stopped) break
          this.publish({ active: { label: job.label, done: i, total: job.ids.length, current: '' }, lastResult: '', problems: [] })
          try {
            if (await this.applyTo(id, job, (name) => this.publish({ active: { label: job.label, done: i, total: job.ids.length, current: name } }))) changed++
            else skipped++
          } catch (e) {
            const p = await getCatalog().getPhoto(id).catch(() => null)
            problems.push({ name: p?.fileName ?? `#${id}`, error: e instanceof Error ? e.message : String(e) })
          }
        }
        this.queue.shift()
      }
    } finally {
      this.running = false
      const result = `${label}: ${changed} ${changed === 1 ? 'photo' : 'photos'} updated${skipped ? `, ${skipped} already edited and left as they were` : ''}${problems.length ? `, ${problems.length} with problems` : ''}.`
      this.publish({ active: null, lastResult: result, problems, runs: this.status.runs + 1 })
      // Free the GPU memory until the next job.
      const engine = this.engine
      this.engine = null
      void engine?.then((e) => e.destroy(), () => {})
      this.decoder?.dispose()
      this.decoder = null
    }
  }

  /** Returns false when the photo was left alone (already edited, for `onlyUnedited`). */
  private async applyTo(id: number, job: BatchJob, onName: (name: string) => void): Promise<boolean> {
    const catalog = getCatalog()
    const p = await catalog.getPhoto(id)
    if (!p) throw new Error('Photo not found in the library')
    if (job.onlyUnedited) {
      const edit = await catalog.getEdit(id)
      if (edit && !onlyFromLightroom(edit.history)) return false
    }
    onName(p.fileName)
    const file = await openPhotoFile(p.rootId, p.folderPath, p.fileName)
    const wantsAuto = job.clip.rerunAuto && !!job.clip.settings.auto
    // Upright's Auto, Level, Vertical and Full are detected again on each photo, like Auto tone.
    const lightroom = parseLrKey(job.lightroom?.[id])
    const wantsUpright = (job.clip.keys.includes('upright') && wantsUprightRerun(job.clip.settings)) || (!!lightroom && lightroom.upright !== UPRIGHT_CODE.off && lightroom.upright !== UPRIGHT_CODE.guided)
    let engine: DevelopEngine | null = null
    let info: SensorInfo | null = null
    if (file && 'gpu' in navigator) {
      // A device lost on an earlier photo (e.g. a driver reset) would fail every later one: start a new engine.
      if (this.engine && (await this.engine.catch(() => null))?.isLost !== false) this.engine = null
      this.engine ??= DevelopEngine.create('readback')
      engine = await this.engine
      this.decoder ??= new RawDecoder()
      info = loadIntoEngine(engine, await this.decoder.decode(file, true))
    } else if (wantsAuto || wantsUpright) {
      const what = wantsAuto ? 'Auto' : 'Upright'
      throw new Error(file ? `${what} needs WebGPU (Chrome or Edge).` : `The photo’s folder isn’t connected, so ${what} can’t look at it. Reconnect it in the Library.`)
    }
    const kind: SourceKind = info?.kind ?? (isRawFile(p.fileName) ? 'raw' : 'rgb')
    // Read the edit now rather than when the job was queued, so a change made meanwhile (e.g. in Develop) isn't lost.
    const h = loadHistory(await catalog.getEdit(id), kind)
    let next = applyPaste(current(h), job.clip, kind, engine && info ? engine.imageSize : undefined)
    if (info) next = ownFocal(next, info)
    if (job.clip.keys.includes('upright') && wantsUprightRerun(job.clip.settings) && engine && info) {
      // Lines are found on the developed scene (the RAW stage must have run).
      await engine.process(stageOptions(next, info))
      next = await rerunUpright(engine, next, info)
    }
    if (lightroom) {
      const r = fromLightroom(next.geometry, lightroom, lrFrame(p), next.detail)
      next = { ...next, geometry: r.geometry }
      if (r.detail) next = withDetail(next, r.detail)
      if (info) next = ownFocal(next, info)
      if (r.rerun && engine && info) {
        // LightBench's own Upright for the mode Lightroom used. Upright resets the straighten angle, but Lightroom's
        // crop and angle were read with it, so they are put back.
        const { crop, angle } = next.geometry
        const mode = next.geometry.transform?.lightroom
        await engine.process(stageOptions(next, info))
        next = await rerunUpright(engine, next, info)
        const t = next.geometry.transform
        next = { ...next, geometry: { ...next.geometry, crop, angle, ...(t ? { transform: { ...t, lightroom: mode } } : {}) } }
      }
    }
    if (wantsAuto && engine && info) next = await rerunAuto(engine, { ...next, auto: job.clip.settings.auto }, info)
    await catalog.saveEdit(id, JSON.stringify(next), JSON.stringify(savedForm(record(h, job.label, next))))
    sidecars.schedule([id])
    try {
      if (!engine || !info) throw new Error('Settings applied; the thumbnail wasn’t refreshed because the photo’s folder isn’t connected.')
      await engine.process(stageOptions(next, info))
      await saveThumb(id, await renderThumbnail(engine, next, info))
      forgetThumbUrl(id)
    } finally {
      this.updatedListeners.forEach((fn) => fn(id))
    }
    return true
  }
}

export const batch = new BatchDeveloper()
