// The AI models this build offers and their state on this device (docs/PHASE3.md Part 24), for the panels: what is
// installed, and a way to hear about installs and removals. Reads the cache only; never downloads.

import { useEffect, useState } from 'react'
import { modelPinned, variantPinned, type AiInfo, type ModelEntry, type Variant } from './manifest'
import { installed, remove as removeFiles, usage, type InstalledModel } from './store'
import { probeGpu, stopRuntime, type GpuProbe } from './runtime'
import type { Provider } from './runtime.worker'

/** Filled in by web/models-plugin.ts (null in a test without it). */
export const AI: AiInfo | null = typeof __LB_AI__ === 'undefined' ? null : __LB_AI__

export const depthModel = (): ModelEntry | null => AI?.models.find((m) => m.task === 'depth') ?? null
export const inpaintModel = (): ModelEntry | null => AI?.models.find((m) => m.task === 'inpaint') ?? null
export const segmentModel = (): ModelEntry | null => AI?.models.find((m) => m.task === 'segment') ?? null

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
 * AI Remove's CPU fallback (no WebGPU): ONNX Runtime's WebAssembly provider, 4 threads. On. The "AI models" workflow
 * ran the real graphs with this same runtime's WebAssembly in Node (PHASE3.md Part 26, "Speed"): finite results, the
 * encoder 14–23 s, one denoising step 12–20 s and the decoder 31–50 s on a 4-core runner, so about 5–8 minutes per
 * spot. The download dialog and the panel say plainly that it is slow. Its memory use in a browser tab is unmeasured.
 */
export const INPAINT_WASM_FALLBACK = true

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

// ---- Object select (SAM 2.1 Hiera Tiny; PHASE3.md Part 27)

/**
 * SAM 2.1's fp32 graphs on WebGPU: off. On Mesa's software Vulkan (lavapipe) ONNX Runtime 1.30.0's WebGPU provider gave
 * the encoder's third image embedding wrong (about ±6600 where the CPU gives ±1.8; MASKS_PREP.md), so the mask came
 * out wrong; fp16 matched the CPU. The cause is being investigated; once fixed and checked, this turns on.
 */
export const SAM_FP32_WEBGPU = false

/**
 * Object select on the processor (ONNX Runtime's WebAssembly provider, up to 4 threads) when there is no GPU it can
 * use: on, under the rule the owner kept (AI masks decision 7): a heavy model's CPU fallback is on when one run takes
 * 15 s or less (OBJECT_CPU_LIMIT_MS). Measured on the real SAM 2.1 Tiny fp32 encoder with the app's own WebAssembly
 * runtime, 4 threads, on GitHub's runner (the "AI models" workflow's sam-check, PHASE3.md Part 27 "Speed"); the prompt
 * decoder then runs on every pointer move.
 */
export const OBJECT_WASM_FALLBACK = true
export const OBJECT_CPU_LIMIT_MS = 15_000

export interface ObjectPlan {
  provider: Provider | null
  variant: Variant | null
  gpu: GpuProbe
  /** Why it can't run here (provider null). */
  why: string | null
  /** On the processor: slower; the panel says so. */
  slow?: boolean
}

/**
 * Where Object select runs here and which files it needs: the one place that decides (so the fp32-on-WebGPU fix
 * changes only SAM_FP32_WEBGPU). fp16 on WebGPU where the GPU has `shader-f16`; fp32 on WebGPU without it only when
 * SAM_FP32_WEBGPU; else fp32 on the processor if OBJECT_WASM_FALLBACK; else not here, said plainly.
 */
export function objectPlan(m: ModelEntry, gpu: GpuProbe): ObjectPlan {
  if (gpu.webgpu && gpu.f16 && variantPinned(m, 'fp16')) return { provider: 'webgpu', variant: 'fp16', gpu, why: null }
  if (gpu.webgpu && SAM_FP32_WEBGPU && variantPinned(m, 'fp32')) return { provider: 'webgpu', variant: 'fp32', gpu, why: null }
  if (OBJECT_WASM_FALLBACK && variantPinned(m, 'fp32')) return { provider: 'wasm', variant: 'fp32', gpu, why: null, slow: true }
  return {
    provider: null,
    variant: null,
    gpu,
    why: gpu.webgpu
      ? 'Object select needs a graphics card with half-precision (fp16) support, and this one doesn’t offer it to the browser. The other masks work as before.'
      : 'Object select needs a graphics card with half-precision (fp16) support through WebGPU, which this browser or computer doesn’t offer (Chrome or Edge on Windows, macOS or Android have WebGPU). The other masks work as before.',
  }
}

/** Where a model can run here: 'webgpu', 'wasm' (the fallback, if on), or null with the reason. */
export async function providerFor(m?: ModelEntry | null): Promise<{ provider: Provider | null; gpu: GpuProbe; why: string | null; slow?: boolean; variant?: Variant }> {
  const gpu = await probeGpu()
  if (m?.task === 'segment') {
    const p = objectPlan(m, gpu)
    return { provider: p.provider, gpu, why: p.why, ...(p.slow ? { slow: true } : {}), ...(p.variant ? { variant: p.variant } : {}) }
  }
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
