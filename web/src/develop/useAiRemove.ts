// AI Remove for the Remove brush (docs/PHASE3.md Part 26): make sure Moebius is on this device (asking first:
// ModelDialog), then generate one spot's patch with it. The panel shows what is happening, a Cancel, and why it can't
// run (no WebGPU, a GPU too small, not in this build). Each run is logged for Diagnostics (no file names, no pixels).

import { useRef, useState } from 'react'
import { AiInvalidError, makeAiFill } from '../ai/aiRemove'
import { chooseFiles, modelPinned, type ModelEntry, type ModelFile } from '../ai/manifest'
import { AI, inpaintModel, providerFor } from '../ai/models'
import { runtimeMessage } from '../ai/runtime'
import { installed, type InstalledModel } from '../ai/store'
import { diagnostics } from '../diagnostics/recorder'
import type { AiFill } from '../engine/develop/ai-patch'
import type { PxRect, Spot } from '../engine/develop/spots'

export interface AiAsk {
  model: ModelEntry
  files: ModelFile[]
  /** No WebGPU here: it would run on the processor, slowly. */
  slow: boolean
  done: (rec: InstalledModel | null) => void
}

export interface AiBusy {
  text: string
  /** 0…1 when known. */
  fraction?: number
}

/** The last runs' timings (for the e2e tests and the console). */
export const aiRemoveTimings: Record<string, unknown>[] = []

/** Words for an AI Remove failure. */
export function aiRemoveMessage(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e)
  if (e instanceof AiInvalidError) return `${e.message} Try again; if it keeps happening, this GPU may not suit AI Remove.`
  if (/run-timeout/.test(s)) return 'AI Remove didn’t finish within its time limit (a step took over 3 minutes, or loading the model over 5), so it was stopped: the GPU may have been reset, or be too slow for this model. Nothing was changed and Develop is not affected; try again, or close other tabs using the GPU.'
  if (/out of memory|OOM|allocation|too large|exceeds|maxBufferSize|maxStorageBufferBindingSize/i.test(s)) return 'The GPU doesn’t have enough memory for AI Remove’s model (about 1 GB). Nothing was changed. Close other tabs or apps using the GPU and try again; a computer with more graphics memory may be needed.'
  return runtimeMessage(e).replace('The model couldn’t run', 'AI Remove couldn’t run')
}

export function useAiRemove() {
  const [ask, setAsk] = useState<AiAsk | null>(null)
  const [busy, setBusy] = useState<AiBusy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  const askFor = (model: ModelEntry, files: ModelFile[], slow: boolean) => new Promise<InstalledModel | null>((resolve) => setAsk({ model, files, slow, done: (rec) => { setAsk(null); resolve(rec) } }))

  /**
   * A patch for `spot` (in the w × h scene), or null (declined, unavailable, cancelled or failed: `error` says why).
   * `readCrop` gives the photo's pixels with the spots before this one.
   */
  async function fill(spot: Spot, size: [number, number], readCrop: (r: PxRect) => Promise<Float32Array>): Promise<AiFill | null> {
    if (abort.current) return null
    setError(null)
    const ctl = new AbortController()
    abort.current = ctl
    try {
      const model = inpaintModel()
      if (!model || !AI || !modelPinned(model)) {
        setError('AI Remove isn’t available in this build of LightBench: its model isn’t published with it.')
        return null
      }
      const p = await providerFor(model)
      if (!p.provider) {
        setError(p.why)
        return null
      }
      if (!(await installed(model))) {
        const files = chooseFiles(model, p.gpu)
        if (!files.length) {
          setError('AI Remove’s model isn’t available for this computer in this build.')
          return null
        }
        if (!(await askFor(model, files, p.provider === 'wasm'))) return null
      }
      if (ctl.signal.aborted) return null
      const cpu = p.provider === 'wasm' ? ' (on the processor, without WebGPU: this takes several minutes)' : ''
      setBusy({ text: `AI Remove: getting ready${cpu}…` })
      const r = await makeAiFill(model, spot, size, readCrop, {
        seed: spot.seed,
        provider: p.provider,
        runtimeVersion: AI.runtime.version,
        signal: ctl.signal,
        onProgress: (q) => {
          if (q.phase === 'load') setBusy({ text: `AI Remove: loading the model${cpu}…` })
          else if (q.phase === 'encode') setBusy({ text: `AI Remove: looking at the photo${cpu}…`, fraction: 0 })
          else if (q.phase === 'denoise' && q.step) setBusy({ text: `AI Remove: step ${q.step} of ${q.steps}${cpu}…`, fraction: q.step / (q.steps ?? 20) })
          else if (q.phase === 'decode') setBusy({ text: 'AI Remove: finishing…', fraction: 1 })
        },
      })
      aiRemoveTimings.push(r.log)
      diagnostics.log('ai-remove', { model: model.id, version: r.fill.modelVersion, adapter: p.gpu.adapter.slice(0, 80), ...r.log })
      console.info(`AI Remove: ${r.log.steps} steps of ${r.log.stepMs} ms, total ${r.log.totalMs} ms (${r.log.provider}); patch ${r.log.patch.join(' × ')}, ${r.log.chars} characters in the edit`)
      return r.fill
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        diagnostics.log('ai-remove', { cancelled: true })
        return null
      }
      diagnostics.log('ai-remove', { error: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : String(e).slice(0, 300) })
      setError(aiRemoveMessage(e))
      return null
    } finally {
      abort.current = null
      setBusy(null)
    }
  }

  return {
    ask,
    busy,
    error,
    setError,
    running: () => !!abort.current,
    fill,
    cancel: () => abort.current?.abort(),
  }
}

export type AiRemove = ReturnType<typeof useAiRemove>
