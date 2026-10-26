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
/** People (Part 28): the person finder, the face finder and the parts model. */
export const detectModel = (): ModelEntry | null => AI?.models.find((m) => m.task === 'detect') ?? null
export const faceModel = (): ModelEntry | null => AI?.models.find((m) => m.task === 'face') ?? null
export const parseModel = (): ModelEntry | null => AI?.models.find((m) => m.task === 'parse') ?? null

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
 * SAM 2.1's fp32 graphs on WebGPU only where the GPU binds at least this much in one storage buffer (512 MiB). ONNX
 * Runtime 1.30.0's WebGPU provider splits a tensor larger than the adapter's `maxStorageBufferBindingSize` into 128 MiB
 * segments, and its Softmax (also LayerNormalization, Pad, Where) ignores them: the result is silently wrong
 * (MASKS_PREP_2.md, runs 39658959631 and 39712936224; onnxruntime PR #32897 is the upstream fix, not merged). SAM 2.1
 * fp32's global-attention Softmax is 256 MiB: correct in a browser at a 1 GiB limit, wrong at 128 MiB. In fp16 it is
 * exactly 128 MiB, so the fp16 file is unaffected. 512 MiB leaves room above the 256 MiB tensor.
 */
export const SAM_FP32_MIN_BINDING = 512 * 2 ** 20

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
 * Where Object select runs here and which files it needs: the one place that decides. fp16 on WebGPU where the GPU has
 * `shader-f16`; fp32 on WebGPU without it where the GPU binds at least SAM_FP32_MIN_BINDING; else fp32 on the
 * processor if OBJECT_WASM_FALLBACK; else not here, said plainly.
 */
export function objectPlan(m: ModelEntry, gpu: GpuProbe): ObjectPlan {
  if (gpu.webgpu && gpu.f16 && variantPinned(m, 'fp16')) return { provider: 'webgpu', variant: 'fp16', gpu, why: null }
  if (gpu.webgpu && (gpu.maxStorageBufferBindingSize ?? 0) >= SAM_FP32_MIN_BINDING && variantPinned(m, 'fp32')) return { provider: 'webgpu', variant: 'fp32', gpu, why: null }
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

// ---- People and faces (RF-DETR-Seg Nano, YuNet, MediaPipe Selfie Multiclass; PHASE3.md Part 28)

/**
 * Where each People model runs. RF-DETR-Seg Nano (122.6 MB, the heavy one) on WebGPU where the GPU binds its largest
 * tensor in one storage buffer (the manifest's `gpu` need, measured by the "AI models" workflow's people-check; ONNX
 * Runtime 1.30.0 computes a tensor over the adapter's binding limit wrong: SAM_FP32_MIN_BINDING's note), else on the
 * processor. YuNet (0.23 MB) and MediaPipe Selfie Multiclass (16.5 MB, run once per person) always on the processor:
 * they take milliseconds there (MASKS_PREP.md: 2 ms and 28 ms on the runner's CPU), and the processor keeps them off
 * the GPU's limits. The processor is the fallback for all three (People's whole run is about a second there).
 */
export const PEOPLE_WASM_FALLBACK = true

export interface PeoplePlan {
  detect: Provider | null
  face: Provider
  parse: Provider
  gpu: GpuProbe
  why: string | null
  slow?: boolean
}

export function peoplePlan(detect: ModelEntry, gpu: GpuProbe): PeoplePlan {
  const onGpu = gpu.webgpu && !gpuShortfall(detect, gpu)
  if (onGpu) return { detect: 'webgpu', face: 'wasm', parse: 'wasm', gpu, why: null }
  if (PEOPLE_WASM_FALLBACK) return { detect: 'wasm', face: 'wasm', parse: 'wasm', gpu, why: null, slow: true }
  return { detect: null, face: 'wasm', parse: 'wasm', gpu, why: 'People needs WebGPU, which this browser or computer doesn’t offer. The other masks work as before.' }
}

/** Where a model can run here: 'webgpu', 'wasm' (the fallback, if on), or null with the reason. */
export async function providerFor(m?: ModelEntry | null): Promise<{ provider: Provider | null; gpu: GpuProbe; why: string | null; slow?: boolean; variant?: Variant }> {
  const gpu = await probeGpu()
  if (m?.task === 'segment') {
    const p = objectPlan(m, gpu)
    return { provider: p.provider, gpu, why: p.why, ...(p.slow ? { slow: true } : {}), ...(p.variant ? { variant: p.variant } : {}) }
  }
  if (m?.task === 'detect') {
    const p = peoplePlan(m, gpu)
    return { provider: p.detect, gpu, why: p.why, ...(p.slow ? { slow: true } : {}) }
  }
  if (m?.task === 'face' || m?.task === 'parse') return { provider: 'wasm', gpu, why: null }
  if (m?.task === 'inpaint') {
    if (gpu.webgpu) {
      const short = gpuShortfall(m, gpu)
      if (!short) return { provider: 'webgpu', gpu, why: null }
      // A GPU below the model's limits (its tensors wouldn't fit one binding, and ONNX Runtime 1.30.0 would then compute
      // them wrong: SAM_FP32_MIN_BINDING's note) runs it on the processor, as without WebGPU.
      if (INPAINT_WASM_FALLBACK) return { provider: 'wasm', gpu, why: null, slow: true }
      return { provider: null, gpu, why: short }
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
