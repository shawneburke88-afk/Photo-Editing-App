// Getting a photo's depth map for the Depth range mask (docs/PHASE3.md Part 24): reuse the one the photo has; else make
// sure the model is on this device (asking first: ModelDialog), render the photo as shot, run the model and return what
// a Depth range stores. The panel shows what is happening and why it can't (no WebGPU, not in this build, …).

import { useRef, useState } from 'react'
import { computeDepth, Fp16InvalidError, renderSize, type AsShot } from '../ai/depth'
import { chooseFile, modelPinned, type ModelEntry, type ModelFile, type Variant } from '../ai/manifest'
import { AI, depthModel, providerFor } from '../ai/models'
import { runtimeMessage } from '../ai/runtime'
import { installed, type InstalledModel } from '../ai/store'
import { diagnostics } from '../diagnostics/recorder'
import type { DepthShape } from '../engine/develop/masks'
import { gpuGate } from '../engine/gpu/gate'

export type DepthMap = Omit<DepthShape, 'range'>

export interface DepthAsk {
  model: ModelEntry
  file: ModelFile
  done: (rec: InstalledModel | null) => void
}

export interface LastRun {
  inferMs: number
  totalMs: number
  provider: string
  variant: string
  size: [number, number]
  bytes: number
}

/** The last depth run's timings (for the e2e tests and the console). */
export const depthTimings: LastRun[] = []

export function useDepth(renderAsShot: (input: ModelEntry['input']) => Promise<AsShot | null>) {
  const [ask, setAsk] = useState<DepthAsk | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)

  /** Asks to download the model (resolves with what was installed, or null when declined). */
  const askFor = (model: ModelEntry, file: ModelFile) => new Promise<InstalledModel | null>((resolve) => setAsk({ model, file, done: (rec) => { setAsk(null); resolve(rec) } }))

  /** A depth map for the photo shown, or null (declined, unavailable, failed: `error` says why). */
  async function obtain(prefer?: Variant): Promise<DepthMap | null> {
    if (busy.current) return null
    busy.current = true
    setError(null)
    try {
      const model = depthModel()
      if (!model || !AI || !modelPinned(model)) {
        setError('The AI Depth model isn’t available in this build of LightBench: its files haven’t been published with it yet.')
        return null
      }
      const p = await providerFor()
      if (!p.provider) {
        setError(p.why)
        return null
      }
      let rec = await installed(model)
      if (!rec || (prefer && rec.variant !== prefer)) {
        const file = chooseFile(model, p.gpu, prefer)
        if (!file) {
          setError('No file of the AI Depth model suits this GPU in this build.')
          return null
        }
        rec = await askFor(model, file)
        if (!rec) return null
      }
      setStatus(p.provider === 'wasm' ? 'Computing the depth map on the CPU (once for this photo; no WebGPU here, so it takes longer)…' : 'Computing the depth map (once for this photo)…')
      const r0 = performance.now()
      const shot = await renderAsShot(model.input)
      if (!shot) return null
      const renderMs = performance.now() - r0
      // The model's GPU work counts as Develop's (Part 14's foreground gate): background work (Export, the batch
      // developer) waits for it, up to the gate's limit, as it waits for Develop's drawings.
      const provider = p.provider
      const version = AI.runtime.version
      const res = await gpuGate.foreground(() => computeDepth(model, shot, provider, version))
      const run: LastRun = { inferMs: res.inferMs, totalMs: res.totalMs, provider: res.provider, variant: rec.variant, size: res.size, bytes: res.depth.raster.data.length }
      depthTimings.push(run)
      // Diagnostics (PHASE3.md "Diagnostics"): the run's durations and where it ran; no pixels or names.
      diagnostics.log('ai-depth', { model: model.id, variant: rec.variant, provider: res.provider, size: res.size, renderMs: Math.round(renderMs), loadMs: Math.round(res.loadMs), inferMs: Math.round(res.inferMs), totalMs: Math.round(res.totalMs), bytes: run.bytes })
      console.info(`Depth map: ${res.size[0]} × ${res.size[1]}, model ${Math.round(res.inferMs)} ms, total ${Math.round(res.totalMs)} ms (${res.provider}, ${rec.variant}), ${res.depth.raster.data.length} characters in the edit`)
      return res.depth
    } catch (e) {
      diagnostics.log('ai-depth', { error: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : String(e).slice(0, 300) })
      if (e instanceof Fp16InvalidError) {
        setError(`${e.message} The fp32 file works on every GPU: download it instead (Settings → AI models, Remove, then Download), or try again to be asked.`)
        // The next attempt asks for the fp32 file.
        preferNext.current = 'fp32'
      } else setError(runtimeMessage(e))
      return null
    } finally {
      busy.current = false
      setStatus(null)
    }
  }
  const preferNext = useRef<Variant | undefined>(undefined)

  return {
    ask,
    status,
    error,
    setError,
    obtain: () => obtain(preferNext.current),
  }
}

export { renderSize }
export type Depth = ReturnType<typeof useDepth>
