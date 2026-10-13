// Applies copied settings to many photos in the background (Paste onto a selection, Sync, Auto Sync).
//
// Each photo is decoded and developed like in Develop: Auto re-runs on its own pixels when the copy asks for it,
// the result is added to its history as one step, and its thumbnail and sidecar are refreshed. Jobs run one photo
// at a time on their own GPU engine, so Develop stays responsive.
//
// GPU failures and memory (PHASE3.md, Part 14): the engine is the batch's own, so its work is checked with the
// engine's error scopes (`guarded`). A photo whose device was lost, ran out of memory or failed internally is tried
// once more on a fresh engine: the step that failed is repeated (working out the settings, or the thumbnail after
// they were saved), so a retry never adds a second history step. Each GPU step waits while Develop is busy
// (engine/gpu/gate.ts), and the photo's textures are freed when it is done (`unload`).

import { getCatalog } from '../catalog/client'
import { forgetThumbUrl, saveThumb } from '../catalog/thumbs'
import { metricsFromStats, solveAuto } from '../engine/develop/auto'
import { displayUniforms, type DevelopSettings, type SourceKind } from '../engine/develop/settings'
import { DevelopEngine, retryableGpuError } from '../engine/gpu/develop-engine'
import { gpuGate } from '../engine/gpu/gate'
import { isRawFile, RawDecoder } from '../engine/raw/decoder'
import type { DecodeResult } from '../engine/raw/types'
import { openPhotoFile } from '../platform/roots'
import { sidecars } from '../sidecar/sync'
import { current, loadHistory, record, savedForm, type History } from './history'
import { applyPaste, mergeClipboards, type Clipboard } from './paste'
import { loadIntoEngine, multipliers, renderThumbnail, stageOptions, type SensorInfo } from './source'
import { ownFocal, rerunUpright, wantsUprightRerun } from './uprightRun'
import { fromLightroom, lrFrame, parseLrKey, UPRIGHT_CODE } from '../sidecar/lightroom'

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
export const LIGHTROOM_STEP = 'Lightroom crop & Transform'

/** An edit whose only step is the Lightroom geometry read when the photo was added (the preset for new photos still applies). */
function onlyFromLightroom(history: string): boolean {
  try {
    const h = JSON.parse(history) as { steps?: { label?: string }[] }
    return !!h.steps?.length && h.steps.every((s) => s.label === LIGHTROOM_STEP)
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

  /** The batch engine, made again when its device was lost (e.g. a driver reset on an earlier photo). */
  private async liveEngine(): Promise<DevelopEngine> {
    if (this.engine && (await this.engine.catch(() => null))?.isLost !== false) this.dropEngine()
    this.engine ??= DevelopEngine.create('readback')
    return this.engine
  }

  /** Destroys the engine; the next GPU step makes a new one. */
  private dropEngine() {
    const engine = this.engine
    this.engine = null
    void engine?.then((e) => e.destroy(), () => {})
  }

  /**
   * Runs one GPU step; after a lost device, out-of-memory or internal error (or a device found lost afterwards), runs
   * it once more on a fresh engine. `reset` forgets what was loaded on the old one.
   */
  private async retrying<T>(step: () => Promise<T>, reset: () => void): Promise<T> {
    try {
      return await step()
    } catch (e) {
      const lost = (await this.engine?.catch(() => null))?.isLost === true
      if (!retryableGpuError(e) && !lost) throw e
      console.warn('Batch: trying the photo again on a new graphics device:', e)
      this.dropEngine()
      reset()
      return step()
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
    let decoded: DecodeResult | null = null
    if (file && 'gpu' in navigator) {
      this.decoder ??= new RawDecoder()
      decoded = await this.decoder.decode(file, true)
    } else if (wantsAuto || wantsUpright) {
      const what = wantsAuto ? 'Auto' : 'Upright'
      throw new Error(file ? `${what} needs WebGPU (Chrome or Edge).` : `The photo’s folder isn’t connected, so ${what} can’t look at it. Reconnect it in the Library.`)
    }

    // The photo loaded on the batch engine (again after a retry on a fresh one).
    let loaded: { engine: DevelopEngine; info: SensorInfo } | null = null
    const onGpu = <T>(step: (engine: DevelopEngine, info: SensorInfo) => Promise<T>): Promise<T> =>
      this.retrying(async () => {
        if (!loaded || loaded.engine.isLost) {
          const engine = await this.liveEngine()
          loaded = { engine, info: loadIntoEngine(engine, decoded!) }
        }
        const { engine, info } = loaded
        await gpuGate.background()
        return engine.guarded(() => step(engine, info))
      }, () => (loaded = null))

    /** The photo's new settings (`engine` and `info` are null without the file or WebGPU). */
    const develop = async (engine: DevelopEngine | null, info: SensorInfo | null): Promise<{ h: History; next: DevelopSettings }> => {
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
        const r = fromLightroom(next.geometry, lightroom, lrFrame(p))
        next = { ...next, geometry: r.geometry }
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
      return { h, next }
    }

    try {
      const { h, next } = decoded ? await onGpu(develop) : await develop(null, null)
      await catalog.saveEdit(id, JSON.stringify(next), JSON.stringify(savedForm(record(h, job.label, next))))
      sidecars.schedule([id])
      try {
        if (!decoded) throw new Error('Settings applied; the thumbnail wasn’t refreshed because the photo’s folder isn’t connected.')
        // Saved already: a retry from here repeats only the thumbnail, never the history step.
        const thumb = await onGpu(async (engine, info) => {
          await engine.process(stageOptions(next, info))
          return renderThumbnail(engine, next, info)
        }).catch((e: unknown) => {
          throw new Error(`Settings applied; the thumbnail wasn’t refreshed. ${e instanceof Error ? e.message : String(e)}`)
        })
        await saveThumb(id, thumb)
        forgetThumbUrl(id)
      } finally {
        this.updatedListeners.forEach((fn) => fn(id))
      }
      return true
    } finally {
      // Frees the photo's textures until the next photo (PHASE3.md, Part 14).
      const l = loaded as { engine: DevelopEngine } | null
      if (l && !l.engine.isLost) l.engine.unload()
    }
  }
}

export const batch = new BatchDeveloper()
