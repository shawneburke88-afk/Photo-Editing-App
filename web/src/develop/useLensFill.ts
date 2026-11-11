// Lens Blur's AI fill (docs/PHASE3.md Part 32): make sure AI Remove's model is on this device (asking first, with the
// same download dialog and consent as AI Remove), then fill the hidden background behind near edges of the original photo
// (ai/lensFill.ts). The panel shows the progress, a Cancel, and why it can't run. Each run is logged for Diagnostics (no
// file names, no pixels).

import { useRef, useState } from 'react'
import { makePlate, type PlateInput } from '../ai/lensFill'
import type { MoebiusRunner } from '../ai/inpaint'
import { chooseFiles, modelPinned, type ModelEntry, type ModelFile } from '../ai/manifest'
import { AI, inpaintModel, providerFor } from '../ai/models'
import { loadGraph, releaseGraph, runGraph } from '../ai/runtime'
import { installed, type InstalledModel } from '../ai/store'
import { diagnostics } from '../diagnostics/recorder'
import type { LensBlurPlate } from '../engine/develop/lens-blur'
import { gpuGate } from '../engine/gpu/gate'
import type { Provider } from '../ai/runtime.worker'
import { aiRemoveMessage, type AiAsk, type AiBusy } from './useAiRemove'

/** Whether AI Remove's model is on this device and runs on the GPU here (the AI fill's default: Part 32). */
export async function aiFillReady(): Promise<boolean> {
  try {
    const model = inpaintModel()
    if (!model || !AI || !modelPinned(model)) return false
    if (!(await installed(model))) return false
    const p = await providerFor(model)
    return p.provider === 'webgpu'
  } catch {
    return false
  }
}

/** The three graphs through the shared runtime worker, each run held as foreground GPU work (as AI Remove's). */
function runner(m: ModelEntry, provider: Provider, onLoad: () => void): { run: MoebiusRunner; free: () => void } {
  const keys: Record<string, string> = {}
  const load = async (part: string) => {
    onLoad()
    const r = await loadGraph(m, part, provider)
    keys[part] = r.key
    return r.key
  }
  const run = async (part: string, feeds: Parameters<typeof runGraph>[1]) => {
    const key = keys[part] ?? (await load(part))
    return (await gpuGate.foreground(() => runGraph(key, feeds))).data
  }
  const free = async (part: string) => {
    if (keys[part]) await releaseGraph(keys[part])
    delete keys[part]
  }
  return {
    run: {
      phase: async (name) => {
        if (name === 'encode') await load('vae_encoder')
        if (name === 'denoise') {
          // The denoiser first, then the encoder freed: ONNX Runtime ends its GPU device when its last session goes.
          await load('unet')
          await free('vae_encoder')
        }
        if (name === 'decode') await load('vae_decoder')
      },
      encode: (image) => run('vae_encoder', { image: { type: 'float32', data: image, dims: [1, 3, 512, 512] } }),
      unet: (latent, timesteps, ids) => run('unet', { latent: { type: 'float32', data: latent, dims: [2, 9, 64, 64] }, timesteps: { type: 'int64', data: timesteps, dims: [2] }, input_ids: { type: 'int64', data: ids, dims: [2, 10] } }),
      decode: async (latent) => {
        const out = await run('vae_decoder', { latent: { type: 'float32', data: latent, dims: [1, 4, 64, 64] } })
        await free('vae_decoder')
        return out
      },
    },
    free: () => {
      void free('vae_decoder')
      void free('vae_encoder')
    },
  }
}

export function useLensFill() {
  const [ask, setAsk] = useState<AiAsk | null>(null)
  const [busy, setBusy] = useState<AiBusy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  const askFor = (model: ModelEntry, files: ModelFile[], slow: boolean) => new Promise<InstalledModel | null>((resolve) => setAsk({ model, files, slow, done: (rec) => { setAsk(null); resolve(rec) } }))

  /**
   * The AI fill for the photo (`input` gives the original photo and its depth map), or null (declined, unavailable,
   * nothing to fill, cancelled or failed: `error` says why).
   */
  async function make(input: () => Promise<PlateInput | null>, seed: number): Promise<LensBlurPlate | null> {
    if (abort.current) return null
    setError(null)
    const ctl = new AbortController()
    abort.current = ctl
    const t0 = performance.now()
    try {
      const model = inpaintModel()
      if (!model || !AI || !modelPinned(model)) {
        setError('The AI fill isn’t available in this build of LightBench: AI Remove’s model isn’t published with it.')
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
      const cpu = p.provider === 'wasm' ? ' (on the processor: this takes several minutes)' : ''
      setBusy({ text: `AI fill: getting ready${cpu}…` })
      const inp = await input()
      if (!inp) return null
      const r = runner(model, p.provider, () => setBusy((b) => ({ text: `AI fill: loading the model${cpu}…`, fraction: b?.fraction })))
      let squares = 0
      const plate = await makePlate(r.run, inp, {
        seed,
        signal: ctl.signal,
        onProgress: (q) => {
          squares = q.squares
          const part = q.squares > 1 ? ` (part ${q.square} of ${q.squares})` : ''
          const frac = ((q.square - 1) + (q.step ?? 0) / (q.steps ?? 20)) / q.squares
          setBusy({ text: q.step ? `AI fill: step ${q.step} of ${q.steps}${part}${cpu}…` : `AI fill: looking at the photo${part}${cpu}…`, fraction: frac })
        },
      }).finally(() => r.free())
      if (!plate) {
        setError('This photo’s depth has no near edges to fill behind, so the AI fill has nothing to draw.')
        return null
      }
      const out: LensBlurPlate = {
        model: model.id,
        modelVersion: `${model.source.revision?.slice(0, 7) ?? 'unpinned'}/${model.files[0].variant}`,
        runtime: `onnxruntime-web ${AI.runtime.version} ${p.provider}`,
        ...plate,
      }
      diagnostics.log('lens-fill', { model: model.id, version: out.modelVersion, provider: p.provider, squares, size: [plate.width, plate.height], chars: plate.data.length + plate.region.data.length, totalMs: Math.round(performance.now() - t0) })
      return out
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        diagnostics.log('lens-fill', { cancelled: true })
        return null
      }
      diagnostics.log('lens-fill', { error: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : String(e).slice(0, 300) })
      setError(aiRemoveMessage(e).replace(/AI Remove/g, 'The AI fill'))
      return null
    } finally {
      abort.current = null
      setBusy(null)
    }
  }

  return { ask, busy, error, setError, running: () => !!abort.current, make, cancel: () => abort.current?.abort() }
}

export type LensFill = ReturnType<typeof useLensFill>
