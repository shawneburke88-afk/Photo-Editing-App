// The UI side of LightBench's AI runtime (ai/runtime.worker.ts; docs/PHASE3.md Part 24): starts the worker when a model
// is first used, loads the model from this device's cache (ai/store.ts), runs it, and ends the worker after a while
// unused, which frees its GPU memory. A failure (a lost GPU, an out-of-memory, a broken file) ends the worker too, so
// the next try starts clean; nothing of it reaches Develop's own GPU device.

import { createRpcClient, type RpcClient } from '../lib/rpc'
import type { ModelEntry, Variant } from './manifest'
import { installed, load as loadFiles } from './store'
import type { Provider, RuntimeApi } from './runtime.worker'

/** End the worker after this long without a run. */
export const IDLE_MS = 120_000

export interface GpuProbe {
  webgpu: boolean
  f16: boolean
  adapter: string
}

let worker: Worker | null = null
let rpc: RpcClient<RuntimeApi> | null = null
let loaded: { key: string; provider: Provider; inputShape: (number | string)[] } | null = null
let idle: ReturnType<typeof setTimeout> | null = null
let probed: Promise<GpuProbe> | null = null

function client(): RpcClient<RuntimeApi> {
  if (!rpc) {
    worker = new Worker(new URL('./runtime.worker.ts', import.meta.url), { type: 'module', name: 'ai-runtime' })
    rpc = createRpcClient<RuntimeApi>(worker)
  }
  return rpc
}

/** Ends the worker (and with it its GPU device and memory). */
export function stopRuntime() {
  if (idle) clearTimeout(idle)
  idle = null
  worker?.terminate()
  worker = null
  rpc = null
  loaded = null
}

function touch() {
  if (idle) clearTimeout(idle)
  idle = setTimeout(stopRuntime, IDLE_MS)
}

/**
 * What the GPU offers to models (asked once). Asked here rather than in the worker, so a panel can show it without
 * starting the runtime; the worker's own adapter is the browser's default one, the same.
 */
export function probeGpu(): Promise<GpuProbe> {
  probed ??= (async () => {
    const gpu = (globalThis.navigator as Navigator & { gpu?: GPU } | undefined)?.gpu
    const a = gpu ? await gpu.requestAdapter().catch(() => null) : null
    if (!a) return { webgpu: false, f16: false, adapter: '' }
    const i = a.info
    return { webgpu: true, f16: a.features.has('shader-f16'), adapter: [i?.vendor, i?.architecture, i?.device, i?.description].filter(Boolean).join(' ') }
  })()
  return probed
}

export interface ModelRun {
  data: Float32Array
  dims: number[]
  ms: number
  provider: Provider
  variant: Variant
}

/** Threads for the WebAssembly provider: up to 4 when the page may share memory (cross-origin isolated). */
const threads = () => (globalThis.crossOriginIsolated ? Math.min(4, Math.max(1, navigator.hardwareConcurrency || 1)) : 1)

/** The model's session in the worker, loaded (from this device's cache, its hashes checked) when it isn't yet. */
async function ensure(m: ModelEntry, provider: Provider): Promise<{ key: string; variant: Variant }> {
  const rec = await installed(m)
  if (!rec) throw new Error(`${m.name} isn’t on this device.`)
  const key = `${m.id}:${rec.variant}:${rec.revision}`
  if (loaded && loaded.key === key && loaded.provider === provider) return { key, variant: rec.variant }
  const files = await loadFiles(m)
  const d = await client().load(key, files.model, files.wasm, provider, threads())
  loaded = { key, provider, inputShape: d.inputShape }
  return { key, variant: rec.variant }
}

/** Runs an installed model once on a float32 NCHW tensor ('webgpu' unless the caller chose the CPU fallback). */
export async function runModel(m: ModelEntry, data: Float32Array, dims: number[], provider: Provider = 'webgpu'): Promise<ModelRun> {
  try {
    const { key, variant } = await ensure(m, provider)
    const r = await client().run(key, data, dims)
    touch()
    return { ...r, provider, variant }
  } catch (e) {
    // Whatever went wrong, the next run starts with a fresh worker (and GPU device).
    stopRuntime()
    probed = null
    throw e
  }
}

/** Fixed input sizes the loaded model declares (height, width), or null when they are free. */
export function modelInputShape(): [number, number] | null {
  const s = loaded?.inputShape
  if (!s || s.length !== 4 || typeof s[2] !== 'number' || typeof s[3] !== 'number' || s[2] <= 0 || s[3] <= 0) return null
  return [s[2], s[3]]
}

/** Loads the model (without running it), for its input shape. */
export async function prepareModel(m: ModelEntry, provider: Provider = 'webgpu'): Promise<[number, number] | null> {
  try {
    await ensure(m, provider)
    touch()
    return modelInputShape()
  } catch (e) {
    stopRuntime()
    probed = null
    throw e
  }
}

/** Words for a runtime failure. */
export function runtimeMessage(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e)
  if (/gpu-lost/.test(s)) return 'The GPU stopped while the model was running (the browser or the driver reset it). Develop is not affected; try again.'
  if (/requires f16|shader-f16|f16 but the device/i.test(s)) return 'This GPU can’t run the half-precision (fp16) model. Remove it in Settings → AI models and download it again: LightBench then picks the fp32 file for this GPU.'
  if (/out of memory|OOM|allocation/i.test(s)) return 'The GPU ran out of memory while running the model. Close other tabs or apps using the GPU and try again.'
  return `The model couldn’t run: ${s}`
}
