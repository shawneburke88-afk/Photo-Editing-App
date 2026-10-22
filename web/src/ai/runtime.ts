// The UI side of LightBench's AI runtime (ai/runtime.worker.ts; docs/PHASE3.md Part 24): starts the worker when a model
// is first used, loads the model from this device's cache (ai/store.ts), runs it, and ends the worker after a while
// unused, which frees its GPU memory. A failure (a lost GPU, an out-of-memory, a broken file) ends the worker too, so
// the next try starts clean; nothing of it reaches Develop's own GPU device.

import { AI_ADAPTER_OPTIONS, type GpuName } from './adapter'
import { createRpcClient, transfer, type RpcClient } from '../lib/rpc'
import type { ModelEntry, Variant } from './manifest'
import { installed, load as loadFiles, loadPart } from './store'
import type { Feed, NamedFeed, NamedResult, NamedRun, Provider, RuntimeApi } from './runtime.worker'

/** End the worker after this long without a run. */
export const IDLE_MS = 120_000
/**
 * A model run that hasn't finished after this long is given up (the worker, and its GPU device, ended): a lost or hung
 * device can leave ONNX Runtime waiting forever (seen on SwiftShader with a large model). A real GPU runs DA-V2 Small
 * in seconds or less.
 */
export const RUN_TIMEOUT_MS = 180_000

export class RunTimeoutError extends Error {
  constructor() {
    super('run-timeout')
    this.name = 'RunTimeoutError'
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new RunTimeoutError()), ms)))]).finally(() => clearTimeout(timer))
}

export interface GpuProbe {
  webgpu: boolean
  f16: boolean
  adapter: string
  /** The adapter's largest buffer and storage-buffer binding (bytes; 0 without WebGPU). */
  maxBufferSize?: number
  maxStorageBufferBindingSize?: number
}

let worker: Worker | null = null
let rpc: RpcClient<RuntimeApi> | null = null
let loaded: { key: string; provider: Provider; inputShape: (number | string)[]; gpu: GpuName | null } | null = null

// ---- memory policy (docs/PHASE3.md Part 27)
//
// Several models can be loaded in the one worker: the depth model, AI Remove's graphs, Object select's encoder and
// decoder. Each loaded graph is recorded with its model and the size of its weights. After a graph of one model is
// loaded, other models' graphs are freed, least recently used first, until the weights loaded add up to no more than
// RESIDENT_BYTES; models held by an open tool (`holdModel`: the masking tool's Object select) go last. A model's own
// graphs are never freed for each other here (AI Remove frees its phases itself). Freeing comes after the new graph
// has loaded, because ONNX Runtime ends its GPU device when its last session goes (Part 26). Outputs kept in the
// worker for a model (Object select's image embeddings) go with its graphs. The worker still ends after IDLE_MS
// unused, unless a model is held; any failure ends it.

/**
 * The weights the worker keeps loaded across models (bytes). SAM 2.1 Tiny (78 MB fp16, 155 MB fp32) and Depth
 * Anything V2 Small (50 / 99 MB) fit together; AI Remove's 1.24 GB doesn't, so starting it frees the others, and the
 * others free it.
 */
export const RESIDENT_BYTES = 600e6

interface Loaded {
  model: string
  provider: Provider
  bytes: number
  used: number
}
/** Graphs loaded in the worker, by key (`<model id>:<part or variant>:<revision>`). */
const graphs = new Map<string, Loaded>()
/** Outputs kept in the worker, by handle (each handle starts with its model's id and a colon). */
const keptHere = new Set<string>()
/** Models an open tool holds (not freed first, and the worker isn't ended while one is held). */
const holds = new Map<string, number>()
let idle: ReturnType<typeof setTimeout> | null = null
let probed: Promise<GpuProbe> | null = null
let useCount = 0

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
  graphs.clear()
  keptHere.clear()
}

function touch() {
  if (idle) clearTimeout(idle)
  // While a tool holds a model, the worker (and what it keeps) stays; the timer looks again later.
  idle = setTimeout(() => (holds.size ? touch() : stopRuntime()), IDLE_MS)
}

/** An open tool holds a model: it is freed last, and the worker isn't ended for being idle. Returns the release. */
export function holdModel(id: string): () => void {
  holds.set(id, (holds.get(id) ?? 0) + 1)
  let done = false
  return () => {
    if (done) return
    done = true
    const n = (holds.get(id) ?? 1) - 1
    if (n > 0) holds.set(id, n)
    else holds.delete(id)
    if (rpc) touch()
  }
}

/** The graphs loaded now (keys, model, provider, bytes), for the panels' tests and the console. */
export const loadedGraphs = () => [...graphs.entries()].map(([key, g]) => ({ key, ...g }))

/** An output the worker keeps for this handle (it goes with its model's graphs, or when the worker ends). */
export const isKept = (handle: string) => keptHere.has(handle)

function noteLoaded(key: string, model: string, provider: Provider, bytes: number) {
  graphs.set(key, { model, provider, bytes, used: ++useCount })
}

/** Frees every graph of a model (and the outputs kept for it). */
async function freeModel(id: string) {
  const keys = [...graphs.entries()].filter(([, g]) => g.model === id).map(([k]) => k)
  for (const k of keys) {
    graphs.delete(k)
    if (loaded?.key === k) loaded = null
  }
  const handles = [...keptHere].filter((h) => h.startsWith(`${id}:`))
  for (const h of handles) keptHere.delete(h)
  if (!rpc) return
  const r = rpc
  await Promise.race([
    (async () => {
      if (handles.length) await r.dropKept(`${id}:`).catch(() => {})
      for (const k of keys) await r.release(k).catch(() => {})
    })(),
    new Promise((ok) => setTimeout(ok, 10_000)),
  ])
}

/**
 * The memory policy after a graph of `id` loaded: other models freed, least recently used first (held ones last),
 * while the loaded weights exceed RESIDENT_BYTES. Returns the models freed.
 */
export function modelsToFree(list: { model: string; bytes: number; used: number }[], id: string, held: ReadonlySet<string>, budget = RESIDENT_BYTES): string[] {
  const by = new Map<string, { bytes: number; used: number }>()
  for (const g of list) {
    const x = by.get(g.model) ?? { bytes: 0, used: 0 }
    by.set(g.model, { bytes: x.bytes + g.bytes, used: Math.max(x.used, g.used) })
  }
  let total = [...by.values()].reduce((n, x) => n + x.bytes, 0)
  const order = [...by.entries()].filter(([m]) => m !== id).sort((a, b) => Number(held.has(a[0])) - Number(held.has(b[0])) || a[1].used - b[1].used)
  const out: string[] = []
  for (const [m, x] of order) {
    if (total <= budget) break
    out.push(m)
    total -= x.bytes
  }
  return out
}

async function fitMemory(id: string) {
  for (const m of modelsToFree([...graphs.values()], id, new Set(holds.keys()))) await freeModel(m)
}

/**
 * What the GPU offers to models (asked once). Asked here rather than in the worker, so a panel can show it without
 * starting the runtime; it asks for the same adapter as the worker and Develop (the high-performance one, adapter.ts).
 */
export function probeGpu(): Promise<GpuProbe> {
  probed ??= (async () => {
    const gpu = (globalThis.navigator as Navigator & { gpu?: GPU } | undefined)?.gpu
    const a = gpu ? await gpu.requestAdapter(AI_ADAPTER_OPTIONS).catch(() => null) : null
    if (!a) return { webgpu: false, f16: false, adapter: '', maxBufferSize: 0, maxStorageBufferBindingSize: 0 }
    const i = a.info
    return {
      webgpu: true,
      f16: a.features.has('shader-f16'),
      adapter: [i?.vendor, i?.architecture, i?.device, i?.description].filter(Boolean).join(' '),
      maxBufferSize: a.limits?.maxBufferSize ?? 0,
      maxStorageBufferBindingSize: a.limits?.maxStorageBufferBindingSize ?? 0,
    }
  })()
  return probed
}

export interface ModelRun {
  /** The card the model ran on (WebGPU), from the runtime's device; null for the CPU provider or when unknown. */
  gpu: GpuName | null
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
  if (loaded && loaded.key === key && loaded.provider === provider && graphs.has(key)) {
    graphs.get(key)!.used = ++useCount
    return { key, variant: rec.variant }
  }
  const files = await loadFiles(m)
  // One thread for WebGPU (the GPU does the work; no pthread workers to start), up to 4 for the CPU provider.
  const d = await withTimeout(client().load(key, files.model, files.wasm, provider, provider === 'wasm' ? threads() : 1), RUN_TIMEOUT_MS)
  loaded = { key, provider, inputShape: d.inputShape, gpu: d.gpu }
  noteLoaded(key, m.id, provider, rec.model.bytes)
  await fitMemory(m.id)
  return { key, variant: rec.variant }
}

/** Runs an installed model once on a float32 NCHW tensor ('webgpu' unless the caller chose the CPU fallback). */
export async function runModel(m: ModelEntry, data: Float32Array, dims: number[], provider: Provider = 'webgpu'): Promise<ModelRun> {
  try {
    const { key, variant } = await ensure(m, provider)
    const r = await withTimeout(client().run(key, data, dims), RUN_TIMEOUT_MS)
    touch()
    return { ...r, provider, variant, gpu: loaded?.gpu ?? null }
  } catch (e) {
    // Whatever went wrong, the next run starts with a fresh worker (and GPU device).
    stopRuntime()
    probed = null
    throw e
  }
}

// ---- models of several graphs (AI Remove: docs/PHASE3.md Part 26)

/**
 * AI Remove's watchdogs: loading a graph (the 907 MB denoiser is read from the device, checked and compiled for the
 * GPU) and each single run (one of 20 denoising steps). Per step, so a slow GPU that needs minutes in all is not
 * stopped, while a hung one is found within minutes.
 */
export const GRAPH_LOAD_TIMEOUT_MS = 300_000
export const GRAPH_RUN_TIMEOUT_MS = { webgpu: 180_000, wasm: 900_000 }

const graphKey = (m: ModelEntry, part: string, variant: Variant, revision: string) => `${m.id}:${part}${variant === 'fp32' ? '' : `-${variant}`}:${revision}`

/**
 * Loads one graph of an installed model into the worker (read from this device and checked first; with its weights
 * file when it has one). Then the memory policy frees other models if needed.
 */
export async function loadGraph(m: ModelEntry, part: string, provider: Provider): Promise<{ key: string; ms: number; gpu: GpuName | null }> {
  const t0 = performance.now()
  try {
    const rec = await installed(m)
    if (!rec) throw new Error(`${m.name} isn’t on this device.`)
    const key = graphKey(m, part, rec.variant, rec.revision)
    const have = graphs.get(key)
    if (have?.provider === provider) {
      have.used = ++useCount
      return { key, ms: 0, gpu: gpuOf.get(key) ?? null }
    }
    const files = await loadPart(m, part)
    const weights = files.file.bytes + (files.data?.bytes.byteLength ?? 0)
    const data = files.data ? { name: files.data.name, bytes: transfer(files.data.bytes) } : undefined
    const d = await withTimeout(client().load(key, transfer(files.model), files.wasm, provider, provider === 'wasm' ? threads() : 1, data), GRAPH_LOAD_TIMEOUT_MS)
    noteLoaded(key, m.id, provider, weights)
    gpuOf.set(key, d.gpu)
    await fitMemory(m.id)
    touch()
    return { key, ms: performance.now() - t0, gpu: d.gpu }
  } catch (e) {
    stopRuntime()
    probed = null
    throw e
  }
}
const gpuOf = new Map<string, GpuName | null>()

/** One run of a loaded graph with named inputs; the first output. */
export async function runGraph(key: string, feeds: Record<string, Feed>): Promise<{ data: Float32Array; ms: number }> {
  try {
    const g = graphs.get(key)
    if (!g) throw new Error('The model isn’t loaded.')
    g.used = ++useCount
    const r = await withTimeout(client().runFeeds(key, feeds), GRAPH_RUN_TIMEOUT_MS[g.provider])
    touch()
    return { data: r.data, ms: r.ms }
  } catch (e) {
    stopRuntime()
    probed = null
    throw e
  }
}

/** A kept output asked for by a run is no longer in the worker (freed, or the worker ended): compute it again. */
export class KeptMissingError extends Error {
  constructor(handle: string) {
    super(`kept-missing: ${handle}`)
    this.name = 'KeptMissingError'
  }
}

/**
 * One run of a loaded graph with named inputs (sent, or kept in the worker), several named outputs back, and some
 * outputs kept in the worker under handles (each handle must start with the model's id and a colon). A kept input
 * that is gone fails with KeptMissingError, without ending the worker.
 */
export async function runGraphNamed(key: string, feeds: Record<string, NamedFeed>, o: NamedRun = {}): Promise<NamedResult> {
  const g = graphs.get(key)
  if (!g) throw new Error('The model isn’t loaded.')
  for (const f of Object.values(feeds)) if ('kept' in f && !keptHere.has(f.kept)) throw new KeptMissingError(f.kept)
  for (const h of Object.values(o.keep ?? {})) if (!h.startsWith(`${g.model}:`)) throw new Error(`A kept output’s handle must start with "${g.model}:"`)
  try {
    g.used = ++useCount
    const r = await withTimeout(client().runNamed(key, feeds, o), GRAPH_RUN_TIMEOUT_MS[g.provider])
    for (const h of Object.values(o.keep ?? {})) keptHere.add(h)
    touch()
    return r
  } catch (e) {
    if (e instanceof Error && /^kept-missing: /.test(e.message)) {
      keptHere.delete(e.message.slice('kept-missing: '.length))
      throw new KeptMissingError(e.message.slice('kept-missing: '.length))
    }
    stopRuntime()
    probed = null
    throw e
  }
}

/** Forgets kept outputs whose handle starts with `prefix`. */
export async function dropKept(prefix: string): Promise<void> {
  for (const h of [...keptHere]) if (h.startsWith(prefix)) keptHere.delete(h)
  await rpc?.dropKept(prefix).catch(() => {})
}

/** Whether a graph is loaded (its key from loadGraph) with this provider. */
export const graphLoaded = (key: string, provider?: Provider) => !!graphs.get(key) && (!provider || graphs.get(key)!.provider === provider)

/** Frees one graph (its GPU memory) without ending the worker. */
export async function releaseGraph(key: string): Promise<void> {
  if (!graphs.has(key) || !rpc) return
  graphs.delete(key)
  gpuOf.delete(key)
  // Freeing is best effort: never wait long for it (the next phase doesn't depend on it).
  await Promise.race([rpc.release(key).catch(() => {}), new Promise((r) => setTimeout(r, 10_000))])
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
  if (/run-timeout/.test(s)) return 'The model didn’t finish within 3 minutes, so it was stopped (the GPU may have been reset, or be too slow). Develop is not affected; try again, or close other tabs using the GPU.'
  if (/gpu-lost/.test(s)) return 'The GPU stopped while the model was running (the browser or the driver reset it). Develop is not affected; try again.'
  if (/requires f16|shader-f16|f16 but the device/i.test(s)) return 'This GPU can’t run the half-precision (fp16) model. Remove it in Settings → AI models and download it again: LightBench then picks the fp32 file for this GPU.'
  if (/out of memory|OOM|allocation/i.test(s)) return 'The GPU ran out of memory while running the model. Close other tabs or apps using the GPU and try again.'
  return `The model couldn’t run: ${s}`
}
