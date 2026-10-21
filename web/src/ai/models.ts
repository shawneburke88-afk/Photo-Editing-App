// The AI models this build offers and their state on this device (docs/PHASE3.md Part 24), for the panels: what is
// installed, and a way to hear about installs and removals. Reads the cache only; never downloads.

import { useEffect, useState } from 'react'
import { modelPinned, type AiInfo, type ModelEntry } from './manifest'
import { installed, remove as removeFiles, usage, type InstalledModel } from './store'
import { probeGpu, stopRuntime, type GpuProbe } from './runtime'
import type { Provider } from './runtime.worker'

/** Filled in by web/models-plugin.ts (null in a test without it). */
export const AI: AiInfo | null = typeof __LB_AI__ === 'undefined' ? null : __LB_AI__

export const depthModel = (): ModelEntry | null => AI?.models.find((m) => m.task === 'depth') ?? null
export const inpaintModel = (): ModelEntry | null => AI?.models.find((m) => m.task === 'inpaint') ?? null

/**
 * The CPU fallback (ONNX Runtime's WebAssembly provider, up to 4 threads) where there is no WebGPU. On: a random-weight
 * model in the shape of DA-V2 Small ran in about 3–5 s per photo on 4 threads of the build machine (PHASE3.md Part 24,
 * "Timing"); the real weights' speed is unmeasured. The panel says when it runs on the CPU.
 */
export const WASM_FALLBACK = true

const listeners = new Set<() => void>()
/** Tells the panels that a model was installed or removed. */
export const modelsChanged = () => listeners.forEach((fn) => fn())

export async function removeModel(m: ModelEntry) {
  stopRuntime()
  await removeFiles(m)
  modelsChanged()
}

/**
 * AI Remove's CPU fallback (no WebGPU): ONNX Runtime's WebAssembly provider. Its speed was measured by the "AI models"
 * workflow's moebius-check (PHASE3.md Part 26, "Speed"); when on, the panel says plainly that it will be slow.
 */
export const INPAINT_WASM_FALLBACK = false

const fmtMiB = (n: number) => `${Math.round(n / 2 ** 20)} MiB`

/** Why this GPU can't hold a model (its buffer limits are below what the model needs), or null. */
export function gpuShortfall(m: ModelEntry, gpu: GpuProbe): string | null {
  const need = m.gpu
  if (!need || !gpu.webgpu) return null
  const binding = gpu.maxStorageBufferBindingSize ?? 0
  const buffer = gpu.maxBufferSize ?? 0
  if (binding >= need.maxStorageBufferBindingSize && buffer >= need.maxBufferSize) return null
  return `This GPU can’t hold ${m.name}: it allows GPU buffers of up to ${fmtMiB(Math.min(binding, buffer))}, and the model needs ${fmtMiB(Math.max(need.maxStorageBufferBindingSize, need.maxBufferSize))}. A computer with a more capable graphics card (or a newer browser) can run it.`
}

/** Where a model can run here: 'webgpu', 'wasm' (the fallback, if on), or null with the reason. */
export async function providerFor(m?: ModelEntry | null): Promise<{ provider: Provider | null; gpu: GpuProbe; why: string | null; slow?: boolean }> {
  const gpu = await probeGpu()
  if (m?.task === 'inpaint') {
    if (gpu.webgpu) {
      const short = gpuShortfall(m, gpu)
      return short ? { provider: null, gpu, why: short } : { provider: 'webgpu', gpu, why: null }
    }
    if (INPAINT_WASM_FALLBACK) return { provider: 'wasm', gpu, why: null, slow: true }
    return { provider: null, gpu, why: 'AI Remove needs WebGPU, which this browser or computer doesn’t offer (Chrome or Edge on Windows, macOS or Android have it; Safari and Firefox mostly don’t yet). Remove, Heal and Clone work everywhere.' }
  }
  if (gpu.webgpu) return { provider: 'webgpu', gpu, why: null }
  if (WASM_FALLBACK) return { provider: 'wasm', gpu, why: null }
  return { provider: null, gpu, why: 'The AI Depth mask needs WebGPU, which this browser or computer doesn’t offer (Chrome or Edge on Windows, macOS or Android have it; Safari and Firefox mostly don’t yet).' }
}

export interface ModelState {
  model: ModelEntry | null
  /** The model is pinned in this build (else it can't be downloaded here). */
  available: boolean
  installed: InstalledModel | null
  /** Bytes the model cache holds on this device. */
  bytes: number
  loading: boolean
}

/** A model's state on this device, kept up to date. */
export function useModelState(model: ModelEntry | null): ModelState {
  const [s, setS] = useState<ModelState>({ model, available: !!model && modelPinned(model), installed: null, bytes: 0, loading: true })
  useEffect(() => {
    let live = true
    const read = async () => {
      const rec = model ? await installed(model) : null
      const bytes = await usage()
      if (live) setS({ model, available: !!model && modelPinned(model), installed: rec, bytes, loading: false })
    }
    void read()
    listeners.add(read)
    return () => {
      live = false
      listeners.delete(read)
    }
  }, [model])
  return s
}
