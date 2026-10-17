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

/**
 * The CPU fallback (ONNX Runtime's WebAssembly provider) where there is no WebGPU. Off: Depth Anything V2 Small's speed
 * on the CPU could not be measured with the real weights on the build machine; a random-weight model of the same shape
 * took about 20–40 s per photo there (PHASE3.md Part 24, "Timing"), so without WebGPU the panel says it needs WebGPU.
 */
export const WASM_FALLBACK = false

const listeners = new Set<() => void>()
/** Tells the panels that a model was installed or removed. */
export const modelsChanged = () => listeners.forEach((fn) => fn())

export async function removeModel(m: ModelEntry) {
  stopRuntime()
  await removeFiles(m)
  modelsChanged()
}

/** Where a model can run here: 'webgpu', 'wasm' (the fallback, if on), or null with the reason. */
export async function providerFor(): Promise<{ provider: Provider | null; gpu: GpuProbe; why: string | null }> {
  const gpu = await probeGpu()
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
