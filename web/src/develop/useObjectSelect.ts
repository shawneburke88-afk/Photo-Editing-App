// Object select in Develop (docs/PHASE3.md Part 27): getting SAM 2.1 Hiera Tiny ready (asking before it is downloaded:
// ModelDialog), encoding the photo once, the hover preview (the prompt decoder on each pointer move, dropping moves
// while one runs and keeping only the latest), and the matte for a click, a refinement or "Compute for this photo".
// The panel shows what is happening (`status`) and why it can't (`error`); Diagnostics get an `ai-mask` entry per
// encoding and per selection, and one summary per hover session (counts and times only: no prompt, no pixels).

import { useCallback, useRef, useState } from 'react'
import type { AsShot } from '../ai/depth'
import { chooseFiles, modelPinned, segmentInput, type ModelEntry, type ModelFile } from '../ai/manifest'
import { AI, objectPlan, segmentModel } from '../ai/models'
import { decodePrompt, encodePhoto, KeptMissingError, ObjectInvalidError, type Encoded } from '../ai/objectSelect'
import { holdModel, probeGpu, runtimeMessage } from '../ai/runtime'
import { coverage, matteToSensor, promptToShot, quantiles, renderLong, type Logits, type ShotPrompt } from '../ai/segment'
import { installed, type InstalledModel } from '../ai/store'
import { diagnostics } from '../diagnostics/recorder'
import { encodeDepth } from '../engine/develop/depth-map'
import { AI_RASTER_LONG, type AiPrompt, type AiShape } from '../engine/develop/masks'
import { gpuGate } from '../engine/gpu/gate'

export interface ObjectAsk {
  model: ModelEntry
  files: ModelFile[]
  slow: boolean
  done: (rec: InstalledModel | null) => void
}

/** What a selection stores (masks.ts AiShape without kind and what), or `none` when nothing is there. */
export type ObjectResult = (Omit<AiShape, 'kind' | 'what'> & { raster: NonNullable<AiShape['raster']> }) | { none: true }

/** The hover preview: the decoder's mask on the photo as shot, and how that maps to the sensor. */
export interface ObjectPreview {
  logits: Logits
  shot: Encoded['shot']
}

/** The last selections' timings (for the e2e tests and the console). */
export const objectTimings: { step: string; decodeMs: number; totalMs: number; chars: number; coverage: number }[] = []
/** Hover sessions' summaries (for the e2e tests). */
export const hoverSummaries: { moves: number; decodes: number; dropped: number; median: number; p95: number }[] = []

interface Options {
  /** The photo as shot, rendered with its long side `long` (ai/depth.ts AsShot). */
  renderAsShot: (long: number) => Promise<AsShot | null>
  /** The photo shown now (its id), or null. */
  photo: () => string | null
}

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : String(e).slice(0, 300))

export function useObjectSelect(o: Options) {
  const [ask, setAsk] = useState<ObjectAsk | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [preview, setPreview] = useState<ObjectPreview | null>(null)
  const opts = useRef(o)
  opts.current = o
  const enc = useRef<Encoded | null>(null)
  const preparing = useRef<Promise<Encoded | null> | null>(null)
  const hold = useRef<(() => void) | null>(null)
  const pending = useRef<AiPrompt | null>(null)
  const running = useRef(false)
  const stats = useRef({ moves: 0, decodes: 0, dropped: 0, ms: [] as number[] })
  const live = useRef(true)
  /** Decoder runs one at a time (a session runs one call at a time): the hover loop's and a click's queue here. */
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.current.then(fn, fn)
    chain.current = run.catch(() => {})
    return run
  }

  const askFor = (model: ModelEntry, files: ModelFile[], slow: boolean) => new Promise<InstalledModel | null>((resolve) => setAsk({ model, files, slow, done: (rec) => { setAsk(null); resolve(rec) } }))

  /**
   * The model on this device and the photo encoded (asking to download first). Null: declined, unavailable or failed.
   * `quiet` (People's outlines, Part 28): only when the model is already on this device, without asking, holding it or
   * showing a message.
   */
  const prepare = useCallback(async (quiet = false): Promise<Encoded | null> => {
    const photo = opts.current.photo()
    if (!photo) return null
    if (enc.current?.photo === photo) return enc.current
    if (preparing.current) return preparing.current
    const run = (async (): Promise<Encoded | null> => {
      if (!quiet) setError(null)
      const model = segmentModel()
      if (!model || !AI || !modelPinned(model)) {
        if (!quiet) setError('Object select isn’t available in this build of LightBench: its model files haven’t been published with it yet.')
        return null
      }
      try {
        const plan = objectPlan(model, await probeGpu())
        if (!plan.provider || !plan.variant) {
          if (!quiet) setError(plan.why)
          return null
        }
        let rec = await installed(model)
        if (quiet && (!rec || rec.variant !== plan.variant)) return null
        if (!rec || rec.variant !== plan.variant) {
          const files = chooseFiles(model, plan.gpu, plan.variant)
          if (!files.length) {
            setError('No files of the Object select model suit this computer in this build.')
            return null
          }
          setStatus(null)
          rec = await askFor(model, files, !!plan.slow)
          if (!rec) return null
        }
        if (!quiet) hold.current ??= holdModel(model.id)
        if (!quiet) setStatus(plan.slow ? 'Preparing the photo for selection on the processor (once for this photo; without a suitable graphics card this takes longer)…' : 'Preparing the photo for selection (once for this photo)…')
        const t0 = performance.now()
        const shot = await opts.current.renderAsShot(renderLong(segmentInput(model), Number.POSITIVE_INFINITY))
        if (!shot) return null
        const renderMs = performance.now() - t0
        const provider = plan.provider
        const variant = plan.variant
        const e = await gpuGate.foreground(() => encodePhoto(model, variant, provider, shot, photo))
        // The photo changed meanwhile: this encoding is for another one.
        if (opts.current.photo() !== photo) return null
        diagnostics.log('ai-mask', { what: 'object', step: 'encode', model: model.id, variant, provider, gpu: e.gpu, input: [segmentInput(model).size, segmentInput(model).size], renderMs: Math.round(renderMs), loadMs: Math.round(e.loadMs), encodeMs: Math.round(e.encodeMs), totalMs: Math.round(performance.now() - t0) })
        console.info(`Object select: photo encoded in ${Math.round(e.encodeMs)} ms (${provider}, ${variant}; loading ${Math.round(e.loadMs)} ms)`)
        enc.current = e
        if (live.current) setReady(true)
        return e
      } catch (err) {
        diagnostics.log('ai-mask', { what: 'object', step: 'encode', error: errText(err) })
        if (!quiet) setError(runtimeMessage(err))
        return null
      } finally {
        setStatus(null)
      }
    })()
    preparing.current = run
    try {
      return await run
    } finally {
      preparing.current = null
    }
  }, [])

  /** The decoder on the encoded photo, one run at a time. */
  const decode = (prompt: AiPrompt) => serial(() => decodeNow((e) => promptToShot(prompt, e.shot.uvToSensor)))

  /** The decoder on the encoded photo; the embeddings gone (freed for another model): encoded again, once. */
  async function decodeNow(prompt: (e: Encoded) => ShotPrompt, quiet = false): Promise<{ logits: Logits; ms: number; e: Encoded } | null> {
    const model = segmentModel()
    let e = await prepare(quiet)
    if (!model || !e) return null
    try {
      const r = await gpuGate.foreground(() => decodePrompt(model, e!, prompt(e!)))
      return { ...r, e }
    } catch (err) {
      if (!(err instanceof KeptMissingError)) throw err
      enc.current = null
      setReady(false)
      e = await prepare(quiet)
      if (!e) return null
      const r = await gpuGate.foreground(() => decodePrompt(model, e!, prompt(e!)))
      return { ...r, e }
    }
  }

  /**
   * People's outlines (Part 28): SAM 2.1's mask for each box (as-shot uv) on this photo, when Object select's model is
   * already on this device (never asked for here). Null: not on this device, or it failed (People then uses its own).
   */
  async function outlines(boxes: [number, number, number, number][]): Promise<{ logits: Logits[]; variant: string; provider: string; encodeMs: number; decodeMs: number } | null> {
    try {
      const fresh = !enc.current || enc.current.photo !== opts.current.photo()
      const out: Logits[] = []
      let decodeMs = 0
      let e: Encoded | null = null
      for (const box of boxes) {
        const r = await serial(() => decodeNow(() => ({ points: [], box }), true))
        if (!r) return null
        out.push(r.logits)
        decodeMs += r.ms
        e = r.e
      }
      if (!e) return null
      return { logits: out, variant: e.variant, provider: e.provider, encodeMs: fresh ? e.encodeMs : 0, decodeMs }
    } catch (err) {
      diagnostics.log('ai-mask', { what: 'person', step: 'outline', error: errText(err) })
      return null
    }
  }

  async function loop() {
    running.current = true
    try {
      while (pending.current && enc.current) {
        const p = pending.current
        pending.current = null
        const r = await decode(p)
        if (!r) break
        stats.current.decodes++
        stats.current.ms.push(r.ms)
        // A newer move waits: this preview is already old, show the next one instead.
        if (!pending.current && live.current) setPreview({ logits: r.logits, shot: r.e.shot })
      }
    } catch (err) {
      diagnostics.log('ai-mask', { what: 'object', step: 'hover', error: errText(err) })
      setError(err instanceof ObjectInvalidError ? `${err.message} Object select can’t be used on this graphics card for now.` : runtimeMessage(err))
      pending.current = null
    } finally {
      running.current = false
    }
  }

  /** A pointer move over the photo (the prompt in the sensor frame), or null when it left: the preview follows. */
  const hover = useCallback((p: AiPrompt | null) => {
    if (!p) {
      pending.current = null
      setPreview(null)
      return
    }
    stats.current.moves++
    if (!enc.current) return
    if (pending.current) stats.current.dropped++
    pending.current = p
    if (!running.current) void loop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** The matte for a prompt (sensor frame), to store; `none` when the model finds nothing there; null: failed. */
  async function compute(prompt: AiPrompt, step: string): Promise<ObjectResult | null> {
    const model = segmentModel()
    if (!model || !AI) return null
    const t0 = performance.now()
    // A click: the hover previews still waiting are dropped (the click's result replaces them).
    pending.current = null
    try {
      const r = await decode(prompt)
      if (!r) return null
      if (r.logits.object <= 0) {
        diagnostics.log('ai-mask', { what: 'object', step, none: true, decodeMs: Math.round(r.ms) })
        return { none: true }
      }
      const m = matteToSensor(r.logits, r.e.shot.uvToSensor, r.e.shot.sensor, AI_RASTER_LONG)
      const raster = await encodeDepth(m.px, m.w, m.h)
      const cov = coverage(m.px)
      const totalMs = performance.now() - t0
      objectTimings.push({ step, decodeMs: r.ms, totalMs, chars: raster.data.length, coverage: cov })
      diagnostics.log('ai-mask', { what: 'object', step, model: model.id, variant: r.e.variant, provider: r.e.provider, matte: [m.w, m.h], chars: raster.data.length, decodeMs: Math.round(r.ms), totalMs: Math.round(totalMs) })
      return { model: model.id, modelVersion: `${model.source.revision?.slice(0, 7) ?? 'unpinned'}/${r.e.variant}`, runtime: `onnxruntime-web ${AI.runtime.version} ${r.e.provider}`, raster }
    } catch (err) {
      diagnostics.log('ai-mask', { what: 'object', step, error: errText(err) })
      setError(err instanceof ObjectInvalidError ? `${err.message} Object select can’t be used on this graphics card for now.` : runtimeMessage(err))
      return null
    }
  }

  /** The picker ends: one summary of the hover session in Diagnostics, the preview gone, the model no longer held. */
  const end = useCallback(() => {
    const s = stats.current
    if (s.moves) {
      const q = quantiles(s.ms)
      hoverSummaries.push({ moves: s.moves, decodes: s.decodes, dropped: s.dropped, median: q.median, p95: q.p95 })
      console.info(`Object select: hover: ${s.moves} moves, ${s.decodes} previews, ${s.dropped} dropped while one ran; ${q.median} ms median, ${q.p95} ms p95`)
      diagnostics.log('ai-mask', { what: 'object', step: 'hover', moves: s.moves, decodes: s.decodes, dropped: s.dropped, medianMs: q.median, p95Ms: q.p95 })
    }
    stats.current = { moves: 0, decodes: 0, dropped: 0, ms: [] }
    pending.current = null
    setPreview(null)
    hold.current?.()
    hold.current = null
  }, [])

  /** Another photo: its embeddings are made when the picker is next used. */
  const resetForPhoto = useCallback(() => {
    end()
    enc.current = null
    setReady(false)
    setError(null)
  }, [end])

  return { ask, status, error, setError, ready, preview, prepare, hover, compute, outlines, end, resetForPhoto, encoded: () => enc.current }
}

export type ObjectSelect = ReturnType<typeof useObjectSelect>
