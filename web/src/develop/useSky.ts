// The Sky mask in Develop (docs/PHASE3.md Part 29): getting EfficientViT-Seg B1 (ADE20K) ready (asking before it is
// downloaded: ModelDialog), rendering the photo as shot, running the model once and making the matte a Sky part stores.
// The panel shows what is happening (`status`) and why it can't (`error`); Diagnostics get an `ai-mask` entry per run
// (sizes, where it ran and times only: no pixels).
//
// One result per photo is kept while the photo is open, so a second Sky mask, or "Compute for this photo" with several
// Sky parts, reuses it; "Compute again" makes a new one.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AsShot } from '../ai/depth'
import { chooseFiles, modelPinned, skyInput, type ModelEntry, type ModelFile } from '../ai/manifest'
import { AI, skyModel, skyPlan } from '../ai/models'
import { probeGpu, runtimeMessage } from '../ai/runtime'
import { coverage } from '../ai/segment'
import { skyLargestTensor, skyModelSize, skyRenderLong } from '../ai/sky'
import { computeSky, SkyInvalidError } from '../ai/skySelect'
import { installed, type InstalledModel } from '../ai/store'
import { diagnostics } from '../diagnostics/recorder'
import { encodeDepth } from '../engine/develop/depth-map'
import { AI_RASTER_LONG, type AiShape } from '../engine/develop/masks'
import { gpuGate } from '../engine/gpu/gate'

export interface SkyAsk {
  model: ModelEntry
  files: ModelFile[]
  slow: boolean
  done: (rec: InstalledModel | null) => void
}

/** What a Sky part stores (masks.ts AiShape without kind and what). */
export type SkyResult = Omit<AiShape, 'kind' | 'what'> & { raster: NonNullable<AiShape['raster']> }

/** The last runs' timings and results (for the e2e tests and the console). */
export const skyTimings: { step: string; provider: string; size: [number, number]; inferMs: number; postMs: number; totalMs: number; chars: number; coverage: number }[] = []

interface Options {
  /** The photo as shot, rendered with its long side chosen from its size (ai/depth.ts AsShot). */
  renderAsShot: (long: (w: number, h: number) => number) => Promise<AsShot | null>
  /** The photo shown now (its id), or null. */
  photo: () => string | null
}

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : String(e).slice(0, 300))

export function useSky(o: Options) {
  const [ask, setAsk] = useState<SkyAsk | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The latest options (the photo shown changes while the model runs). */
  const latest = useRef(o)
  useEffect(() => {
    latest.current = o
  })
  const busy = useRef(false)
  const last = useRef<{ photo: string; result: SkyResult } | null>(null)

  const askFor = (model: ModelEntry, files: ModelFile[], slow: boolean) => new Promise<InstalledModel | null>((resolve) => setAsk({ model, files, slow, done: (rec) => { setAsk(null); resolve(rec) } }))

  /**
   * The sky's matte for the photo shown (the one already made for it, unless `fresh`), or null: declined, unavailable
   * or failed (`error` says why).
   */
  async function compute(step: string, fresh = false): Promise<SkyResult | null> {
    const photo = latest.current.photo()
    if (!photo || busy.current) return null
    if (!fresh && last.current?.photo === photo) return last.current.result
    busy.current = true
    setError(null)
    const t0 = performance.now()
    try {
      const model = skyModel()
      if (!model || !AI || !modelPinned(model)) {
        setError('The Sky mask isn’t available in this build of LightBench: its model file hasn’t been published with it yet.')
        return null
      }
      const gpu = await probeGpu()
      // Where it runs is decided once the photo's size is known (below); the file is the same either way.
      const first = skyPlan(gpu, 0)
      if (!first.provider) {
        setError(first.why)
        return null
      }
      let rec = await installed(model)
      if (!rec) {
        const files = chooseFiles(model, gpu)
        if (!files.length) {
          setError('No file of the Sky model suits this computer in this build.')
          return null
        }
        rec = await askFor(model, files, !!first.slow)
        if (!rec) return null
      }
      const input = skyInput(model)
      setStatus('Finding the sky…')
      const r0 = performance.now()
      const shot = await latest.current.renderAsShot((w, h) => skyRenderLong(Math.max(w, h), skyModelSize(w, h, input)))
      if (!shot) return null
      const renderMs = performance.now() - r0
      const [mw, mh] = skyModelSize(shot.width, shot.height, input)
      // The GPU limit gate (part 1's): a photo whose largest tensor wouldn't fit one storage-buffer binding runs on the
      // processor.
      const plan = skyPlan(gpu, skyLargestTensor(mw, mh, input))
      if (!plan.provider) {
        setError(plan.why)
        return null
      }
      if (plan.slow) setStatus(plan.large ? 'Finding the sky on the processor (this photo is too large for this graphics card’s AI runtime, so it takes a little longer)…' : 'Finding the sky on the processor (without a suitable graphics card it takes a little longer)…')
      const provider = plan.provider
      const run = await gpuGate.foreground(() => computeSky(model, provider, shot, AI_RASTER_LONG))
      // The photo changed meanwhile: this matte is for another one.
      if (latest.current.photo() !== photo) return null
      const raster = await encodeDepth(run.matte.px, run.matte.w, run.matte.h)
      const totalMs = performance.now() - t0
      const cov = coverage(run.matte.px)
      skyTimings.push({ step, provider, size: run.size, inferMs: run.inferMs, postMs: run.postMs, totalMs, chars: raster.data.length, coverage: cov })
      diagnostics.log('ai-mask', { what: 'sky', step, model: model.id, variant: rec.variant, provider, gpu: run.gpu, input: run.size, ...(plan.large ? { gate: 'binding' } : {}), matte: [run.matte.w, run.matte.h], chars: raster.data.length, renderMs: Math.round(renderMs), loadMs: Math.round(run.loadMs), inferMs: Math.round(run.inferMs), postMs: Math.round(run.postMs), totalMs: Math.round(totalMs) })
      console.info(`Sky: ${Math.round(100 * cov)} % of the photo, model ${run.size[0]} × ${run.size[1]} in ${Math.round(run.inferMs)} ms (${provider}), matte ${Math.round(run.postMs)} ms, ${raster.data.length} characters in the edit`)
      const result: SkyResult = { model: model.id, modelVersion: `${model.source.revision?.slice(0, 7) ?? 'unpinned'}/${rec.variant}`, runtime: `onnxruntime-web ${AI.runtime.version} ${provider}`, raster }
      last.current = { photo, result }
      return result
    } catch (e) {
      diagnostics.log('ai-mask', { what: 'sky', step, error: errText(e) })
      setError(e instanceof SkyInvalidError ? `${e.message} Try again; if it keeps happening, the Sky mask can’t be used on this computer for now.` : runtimeMessage(e))
      return null
    } finally {
      busy.current = false
      setStatus(null)
    }
  }

  /** Another photo: its sky is found when it is next asked for. */
  const resetForPhoto = useCallback(() => {
    last.current = null
    setError(null)
  }, [])

  return { ask, status, error, setError, compute, resetForPhoto }
}

export type SkySelect = ReturnType<typeof useSky>
