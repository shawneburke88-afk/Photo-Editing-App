// The Subject mask in Develop (docs/PHASE3.md Part 30): getting BiRefNet_lite ready (asking before it is downloaded:
// ModelDialog), rendering the photo as shot, running the model once and making the matte a Subject part stores. The
// panel shows what is happening (`status`) and why it can't (`error`); Diagnostics get an `ai-mask` entry per run (sizes,
// where it ran and times only: no pixels).
//
// One result per photo is kept while the photo is open, so a second Subject mask, or "Compute for this photo" with
// several Subject parts, reuses it; "Find the subject again" makes a new one.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AsShot } from '../ai/depth'
import { chooseFiles, modelPinned, segmentInput, type ModelEntry, type ModelFile } from '../ai/manifest'
import { AI, subjectModel, subjectPlan } from '../ai/models'
import { probeGpu, runtimeMessage } from '../ai/runtime'
import { coverage } from '../ai/segment'
import { subjectRenderLong } from '../ai/subject'
import { computeSubject, SubjectInvalidError } from '../ai/subjectSelect'
import { installed, type InstalledModel } from '../ai/store'
import { diagnostics } from '../diagnostics/recorder'
import { encodeDepth } from '../engine/develop/depth-map'
import { AI_RASTER_LONG, type AiShape } from '../engine/develop/masks'
import { gpuGate } from '../engine/gpu/gate'

export interface SubjectAsk {
  model: ModelEntry
  files: ModelFile[]
  slow: boolean
  done: (rec: InstalledModel | null) => void
}

/** What a Subject part stores (masks.ts AiShape without kind and what). */
export type SubjectResult = Omit<AiShape, 'kind' | 'what'> & { raster: NonNullable<AiShape['raster']> }

/** The last runs' timings and results (for the e2e tests and the console). */
export const subjectTimings: { step: string; provider: string; variant: string; inferMs: number; postMs: number; totalMs: number; chars: number; coverage: number }[] = []

interface Options {
  /** The photo as shot, rendered with its long side chosen from its size (ai/depth.ts AsShot). */
  renderAsShot: (long: (w: number, h: number) => number) => Promise<AsShot | null>
  /** The photo shown now (its id), or null. */
  photo: () => string | null
}

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : String(e).slice(0, 300))

export function useSubject(o: Options) {
  const [ask, setAsk] = useState<SubjectAsk | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The latest options (the photo shown changes while the model runs). */
  const latest = useRef(o)
  useEffect(() => {
    latest.current = o
  })
  const busy = useRef(false)
  const last = useRef<{ photo: string; result: SubjectResult } | null>(null)

  const askFor = (model: ModelEntry, files: ModelFile[], slow: boolean) => new Promise<InstalledModel | null>((resolve) => setAsk({ model, files, slow, done: (rec) => { setAsk(null); resolve(rec) } }))

  /**
   * The subject's matte for the photo shown (the one already made for it, unless `fresh`), or null: declined,
   * unavailable or failed (`error` says why).
   */
  async function compute(step: string, fresh = false): Promise<SubjectResult | null> {
    const photo = latest.current.photo()
    if (!photo || busy.current) return null
    if (!fresh && last.current?.photo === photo) return last.current.result
    busy.current = true
    setError(null)
    const t0 = performance.now()
    try {
      const model = subjectModel()
      if (!model || !AI || !modelPinned(model)) {
        setError('The Subject mask isn’t available in this build of LightBench: its model file hasn’t been published with it yet.')
        return null
      }
      const plan = subjectPlan(model, await probeGpu())
      if (!plan.provider || !plan.variant) {
        setError(plan.why)
        return null
      }
      let rec = await installed(model)
      if (!rec || rec.variant !== plan.variant) {
        const files = chooseFiles(model, plan.gpu, plan.variant)
        if (!files.length) {
          setError('No file of the Subject model suits this computer in this build.')
          return null
        }
        rec = await askFor(model, files, !!plan.slow)
        if (!rec) return null
      }
      const input = segmentInput(model)
      setStatus(plan.slow ? (plan.large ? 'Finding the subject on the processor (this graphics card’s AI runtime can’t hold the model, so it takes longer)…' : 'Finding the subject on the processor (without a suitable graphics card this takes longer)…') : 'Finding the subject…')
      const r0 = performance.now()
      const shot = await latest.current.renderAsShot((w, h) => subjectRenderLong(input, Math.max(w, h)))
      if (!shot) return null
      const renderMs = performance.now() - r0
      const provider = plan.provider
      const run = await gpuGate.foreground(() => computeSubject(model, provider, shot, AI_RASTER_LONG))
      // The photo changed meanwhile: this matte is for another one.
      if (latest.current.photo() !== photo) return null
      const raster = await encodeDepth(run.matte.px, run.matte.w, run.matte.h)
      const totalMs = performance.now() - t0
      const cov = coverage(run.matte.px)
      subjectTimings.push({ step, provider, variant: rec.variant, inferMs: run.inferMs, postMs: run.postMs, totalMs, chars: raster.data.length, coverage: cov })
      // The times first: an entry over the recorder's size limit is kept cut, from its start.
      diagnostics.log('ai-mask', { what: 'subject', step, provider, variant: rec.variant, ...(plan.large ? { gate: 'binding' } : {}), inferMs: Math.round(run.inferMs), postMs: Math.round(run.postMs), totalMs: Math.round(totalMs), renderMs: Math.round(renderMs), loadMs: Math.round(run.loadMs), input: [input.size, input.size], matte: [run.matte.w, run.matte.h], chars: raster.data.length, model: model.id, gpu: run.gpu })
      console.info(`Subject: ${Math.round(100 * cov)} % of the photo, model ${input.size} × ${input.size} in ${Math.round(run.inferMs)} ms (${provider}, ${rec.variant}), matte ${Math.round(run.postMs)} ms, ${raster.data.length} characters in the edit`)
      const result: SubjectResult = { model: model.id, modelVersion: `${model.source.revision?.slice(0, 7) ?? 'unpinned'}/${rec.variant}`, runtime: `onnxruntime-web ${AI.runtime.version} ${provider}`, raster }
      last.current = { photo, result }
      return result
    } catch (e) {
      diagnostics.log('ai-mask', { what: 'subject', step, error: errText(e) })
      setError(e instanceof SubjectInvalidError ? `${e.message} Try again; if it keeps happening, the Subject mask can’t be used on this computer for now.` : runtimeMessage(e))
      return null
    } finally {
      busy.current = false
      setStatus(null)
    }
  }

  /** Another photo: its subject is found when it is next asked for. */
  const resetForPhoto = useCallback(() => {
    last.current = null
    setError(null)
  }, [])

  return { ask, status, error, setError, compute, resetForPhoto }
}

export type SubjectSelect = ReturnType<typeof useSubject>
