// LightBench's one AI runtime (docs/PHASE3.md Part 24): ONNX Runtime Web, pinned in package.json, in a worker of its own.
// The Depth range mask is its first model; the later Phase 4 models (PHASE4_MODELS.md) are meant to run here too.
//
// - WebGPU (ONNX Runtime's native WebGPU provider, `onnxruntime-web/webgpu`) on its own GPU device, apart from the
//   DevelopEngine's: if the model fails or its device is lost, Develop keeps working (Part 14). The worker reports the
//   loss and the client starts a fresh worker next time.
// - The WebAssembly file comes from the app's own cache (ai/store.ts), passed in as bytes (`env.wasm.wasmBinary`), so
//   nothing is fetched here and it works offline.
// - The WebAssembly CPU provider is the fallback the client may ask for when there is no WebGPU.

import * as ort from 'onnxruntime-web/webgpu'
import { exposeRpc } from '../lib/rpc'

export type Provider = 'webgpu' | 'wasm'

let wasmSet = false
const sessions = new Map<string, { session: ort.InferenceSession; provider: Provider }>()
let lostMessage: string | null = null

/** What this worker's GPU offers (for the fp16/fp32 choice). */
async function probe(): Promise<{ webgpu: boolean; f16: boolean; adapter: string }> {
  const gpu = (self.navigator as Navigator & { gpu?: GPU }).gpu
  if (!gpu) return { webgpu: false, f16: false, adapter: '' }
  const a = await gpu.requestAdapter().catch(() => null)
  if (!a) return { webgpu: false, f16: false, adapter: '' }
  const i = a.info
  return { webgpu: true, f16: a.features.has('shader-f16'), adapter: [i?.vendor, i?.architecture, i?.device, i?.description].filter(Boolean).join(' ') }
}

async function watchDevice() {
  try {
    const dev = await ort.env.webgpu.device
    void dev.lost.then((info) => {
      lostMessage = info.message || 'The GPU device was lost.'
      for (const s of sessions.values()) void s.session.release().catch(() => {})
      sessions.clear()
    })
  } catch {
    // no device: nothing to watch
  }
}

async function load(key: string, model: ArrayBuffer, wasm: ArrayBuffer, provider: Provider, threads: number): Promise<{ inputs: string[]; outputs: string[]; inputShape: (number | string)[] }> {
  if (lostMessage) throw new Error(`gpu-lost: ${lostMessage}`)
  if (!wasmSet) {
    ort.env.wasm.wasmBinary = wasm
    // Already in a worker: no second proxy worker.
    ort.env.wasm.proxy = false
    ort.env.wasm.numThreads = Math.max(1, threads)
    ort.env.logLevel = 'error'
    wasmSet = true
  }
  const old = sessions.get(key)
  if (old && old.provider === provider) return describe(old.session)
  if (old) await old.session.release().catch(() => {})
  const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: [provider], graphOptimizationLevel: 'all', logSeverityLevel: 3 })
  sessions.set(key, { session, provider })
  if (provider === 'webgpu') await watchDevice()
  return describe(session)
}

function describe(s: ort.InferenceSession) {
  const meta = s.inputMetadata?.[0]
  return { inputs: [...s.inputNames], outputs: [...s.outputNames], inputShape: meta && meta.isTensor ? [...meta.shape] : [] }
}

/** One run: a float32 NCHW image in, the first output out (float32). */
async function run(key: string, data: Float32Array, dims: number[]): Promise<{ data: Float32Array; dims: number[]; ms: number }> {
  if (lostMessage) throw new Error(`gpu-lost: ${lostMessage}`)
  const s = sessions.get(key)
  if (!s) throw new Error('The model isn’t loaded.')
  const t0 = performance.now()
  const feeds = { [s.session.inputNames[0]]: new ort.Tensor('float32', data, dims) }
  const out = await s.session.run(feeds)
  const t = out[s.session.outputNames[0]]
  const got = (await t.getData()) as Float32Array
  const res = { data: got instanceof Float32Array ? got : Float32Array.from(got as ArrayLike<number>), dims: [...t.dims], ms: performance.now() - t0 }
  t.dispose()
  if (lostMessage) throw new Error(`gpu-lost: ${lostMessage}`)
  return res
}

export type Feed = { type: 'float32'; data: Float32Array; dims: number[] } | { type: 'int64'; data: BigInt64Array; dims: number[] }

/** One run with named inputs (AI Remove's graphs: float32 and int64), the first output out (float32). */
async function runFeeds(key: string, feeds: Record<string, Feed>): Promise<{ data: Float32Array; dims: number[]; ms: number }> {
  if (lostMessage) throw new Error(`gpu-lost: ${lostMessage}`)
  const s = sessions.get(key)
  if (!s) throw new Error('The model isn’t loaded.')
  const t0 = performance.now()
  const tensors: Record<string, ort.Tensor> = {}
  for (const [name, f] of Object.entries(feeds)) tensors[name] = f.type === 'int64' ? new ort.Tensor('int64', f.data, f.dims) : new ort.Tensor('float32', f.data, f.dims)
  const out = await s.session.run(tensors)
  const t = out[s.session.outputNames[0]]
  const got = (await t.getData()) as Float32Array
  const res = { data: got instanceof Float32Array ? got : Float32Array.from(got as ArrayLike<number>), dims: [...t.dims], ms: performance.now() - t0 }
  for (const v of Object.values(out)) v.dispose()
  if (lostMessage) throw new Error(`gpu-lost: ${lostMessage}`)
  return res
}

async function release(key?: string) {
  for (const [k, s] of sessions) {
    if (key && k !== key) continue
    await s.session.release().catch(() => {})
    sessions.delete(k)
  }
}

const handlers = { probe, load, run, runFeeds, release, version: () => ort.env.versions?.web ?? '' }
export type RuntimeApi = typeof handlers
// ONNX Runtime's WebAssembly threads are workers started from this same script (in a build, its code is in this chunk)
// with the name "em-pthread…": they run ONNX Runtime's own message loop, which the RPC handler must not replace.
if (!(self as { name?: string }).name?.startsWith('em-pthread')) exposeRpc(handlers)
