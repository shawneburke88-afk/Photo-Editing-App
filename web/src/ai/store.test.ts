import { describe, expect, it, vi } from 'vitest'
import shipped from '../../models/manifest.json'
import { chooseFile, downloadPlan, filePinned, modelPinned, parseManifest, servedPath, sha256Hex, sourceUrl, type AiInfo, type ModelEntry } from './manifest'
import { CACHE, install, installed, installSize, IntegrityError, load, remove, usage, type StoreEnv } from './store'

// The AI model delivery (PHASE3.md Part 24; owner's decision 2026-10-17): the pinned manifest, the file each GPU gets,
// downloading only on opt-in with SHA-256 checks, the on-device cache, offline reuse and removal.

/** Cache Storage in memory. */
class MemCache {
  entries = new Map<string, { body: ArrayBuffer; headers: [string, string][] }>()
  async match(req: string | Request) {
    const e = this.entries.get(typeof req === 'string' ? req : req.url)
    return e ? new Response(e.body.slice(0), { headers: e.headers }) : undefined
  }
  async put(req: string, res: Response) {
    this.entries.set(req, { body: await res.arrayBuffer(), headers: [...res.headers.entries()] })
  }
  async delete(req: string | Request) {
    return this.entries.delete(typeof req === 'string' ? req : req.url)
  }
  async keys() {
    return [...this.entries.keys()].map((u) => new Request(u))
  }
}
class MemCaches {
  caches = new Map<string, MemCache>()
  async open(name: string) {
    let c = this.caches.get(name)
    if (!c) this.caches.set(name, (c = new MemCache()))
    return c as unknown as Cache
  }
}

const bytes = (n: number, seed: number) => new Uint8Array(n).map((_, i) => (i * 31 + seed) & 255)
const RUNTIME = bytes(3000, 1)
const FP16 = bytes(1000, 2)
const FP32 = bytes(2000, 3)
const REV = 'feedface'.repeat(5)

async function fixture() {
  const model: ModelEntry = {
    ...(shipped.models[0] as unknown as ModelEntry),
    source: { host: 'huggingface', repo: 'onnx-community/depth-anything-v2-small', revision: REV },
    files: [
      { variant: 'fp16', path: 'onnx/model_fp16.onnx', bytes: FP16.length, sha256: await sha256Hex(FP16) },
      { variant: 'fp32', path: 'onnx/model.onnx', bytes: FP32.length, sha256: await sha256Hex(FP32) },
    ],
  }
  const info: AiInfo = { models: [model], runtime: { name: 'ONNX Runtime Web', version: '1.30.0', licence: 'MIT', wasm: { path: 'ort/1.30.0/ort.wasm', bytes: RUNTIME.length, sha256: await sha256Hex(RUNTIME) } } }
  const served: Record<string, Uint8Array> = {
    'http://lb.test/app/ort/1.30.0/ort.wasm': RUNTIME,
    [`http://lb.test/app/models/depth-anything-v2-small/feedfac/fp16.onnx`]: FP16,
    [`http://lb.test/app/models/depth-anything-v2-small/feedfac/fp32.onnx`]: FP32,
  }
  const fetchMock = vi.fn(async (url: string) => (served[url] ? new Response(served[url].slice(0)) : new Response('missing', { status: 404 })))
  const caches = new MemCaches()
  const env: StoreEnv = { caches: caches as unknown as CacheStorage, fetch: fetchMock as unknown as typeof fetch, base: 'http://lb.test/app/' }
  return { model, info, served, fetchMock, caches, env }
}

describe('the pinned manifest (web/models/manifest.json)', () => {
  it('is well formed, names the model, licence and training data, and is not pinned yet (no invented hashes)', () => {
    const m = parseManifest(shipped)
    const d = m.models[0]
    expect(d.id).toBe('depth-anything-v2-small')
    expect(d.licence.id).toBe('Apache-2.0')
    expect(d.trainingData).toMatch(/SA-1B/)
    expect(d.trainingData).toMatch(/Virtual KITTI 2/)
    expect(d.trainingData).toMatch(/non-commercial or research-only/)
    expect(d.files.map((f) => [f.variant, f.bytes])).toEqual([['fp16', 49642442], ['fp32', 99060839]])
    // Until the owner pins a revision and its hashes, nothing is offered or deployed.
    expect(d.source.revision).toBeNull()
    expect(d.files.every((f) => f.sha256 === null)).toBe(true)
    expect(modelPinned(d)).toBe(false)
    expect(chooseFile(d, { f16: true })).toBeNull()
    // Each file is under GitHub's 100 MiB file size limit, and the pair far under Pages' 1 GB site limit.
    for (const f of d.files) expect(f.bytes).toBeLessThan(100 * 2 ** 20)
  })

  it('refuses malformed manifests', () => {
    const base = JSON.parse(JSON.stringify(shipped))
    const bad = (fn: (m: typeof base) => void) => {
      const m = JSON.parse(JSON.stringify(base))
      fn(m)
      return () => parseManifest(m)
    }
    expect(bad((m) => (m.models[0].files[0].sha256 = 'ABC'))).toThrow(/sha256/)
    expect(bad((m) => (m.models[0].source.revision = 'main'))).toThrow(/revision/)
    expect(bad((m) => (m.models[0].files[1].variant = 'fp16'))).toThrow(/two fp16/)
    expect(bad((m) => (m.models[0].files[0].path = '../x'))).toThrow(/path/)
    expect(bad((m) => (m.models[0].licence = undefined))).toThrow(/licence/)
    expect(bad((m) => (m.schema = 2))).toThrow(/schema/)
  })
})

describe('which file a GPU gets', () => {
  it('fp16 only with shader-f16, else fp32; a forced variant only if the GPU can run it', async () => {
    const { model } = await fixture()
    expect(chooseFile(model, { f16: true })?.variant).toBe('fp16')
    expect(chooseFile(model, { f16: false })?.variant).toBe('fp32')
    expect(chooseFile(model, { f16: true }, 'fp32')?.variant).toBe('fp32')
    expect(chooseFile(model, { f16: false }, 'fp16')).toBeNull()
    const only16 = { ...model, files: model.files.filter((f) => f.variant === 'fp16') }
    expect(chooseFile(only16, { f16: false })).toBeNull()
    expect(filePinned(model, model.files[0])).toBe(true)
  })

  it('serves from LightBench’s own site and fetches (at deploy) from the pinned commit', async () => {
    const { model, info } = await fixture()
    expect(servedPath(model, model.files[1])).toBe('models/depth-anything-v2-small/feedfac/fp32.onnx')
    expect(sourceUrl(model, model.files[1])).toBe(`https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/${REV}/onnx/model.onnx`)
    expect(downloadPlan(info, model, model.files[1], false).map((x) => x.what)).toEqual(['runtime', 'model'])
    expect(downloadPlan(info, model, model.files[1], true).map((x) => x.what)).toEqual(['model'])
  })
})

describe('the on-device store', () => {
  it('reads the cache only until the user opts in: no network request', async () => {
    const { model, info, fetchMock, env } = await fixture()
    expect(await installed(model, env)).toBeNull()
    const size = await installSize(info, model, model.files[1], env)
    expect(size.bytes).toBe(RUNTIME.length + FP32.length)
    expect(await usage(env)).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('downloads, checks and keeps the files; loads them offline afterwards', async () => {
    const { model, info, fetchMock, env, caches } = await fixture()
    const seen: number[] = []
    const rec = await install(info, model, model.files[1], (p) => seen.push(p.done), undefined, env)
    expect(rec.variant).toBe('fp32')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(seen.at(-1)).toBe(RUNTIME.length + FP32.length)
    expect(caches.caches.has(CACHE)).toBe(true)
    expect(await installed(model, env)).toEqual(rec)
    // Offline: the network is gone, the model still loads (and its hashes are checked again).
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch')
    })
    const got = await load(model, env)
    expect(new Uint8Array(got.model)).toEqual(FP32)
    expect(new Uint8Array(got.wasm)).toEqual(RUNTIME)
    expect(await usage(env)).toBeGreaterThanOrEqual(RUNTIME.length + FP32.length)
  })

  it('refuses a file that doesn’t match its SHA-256 or size, and keeps nothing', async () => {
    const { model, info, served, env } = await fixture()
    served['http://lb.test/app/models/depth-anything-v2-small/feedfac/fp32.onnx'] = bytes(FP32.length, 9)
    await expect(install(info, model, model.files[1], () => {}, undefined, env)).rejects.toBeInstanceOf(IntegrityError)
    expect(await installed(model, env)).toBeNull()
    served['http://lb.test/app/models/depth-anything-v2-small/feedfac/fp32.onnx'] = FP32.slice(0, 100)
    await expect(install(info, model, model.files[1], () => {}, undefined, env)).rejects.toThrow(/expected/)
    expect(await installed(model, env)).toBeNull()
  })

  it('a second variant reuses the runtime and replaces the first; a damaged cache entry is reported', async () => {
    const { model, info, fetchMock, env, caches } = await fixture()
    await install(info, model, model.files[1], () => {}, undefined, env)
    fetchMock.mockClear()
    const rec = await install(info, model, model.files[0], () => {}, undefined, env)
    expect(rec.variant).toBe('fp16')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const c = caches.caches.get(CACHE)!
    expect([...c.entries.keys()].some((k) => k.endsWith('fp32.onnx'))).toBe(false)
    // Damage the stored model.
    c.entries.get('http://lb.test/app/models/depth-anything-v2-small/feedfac/fp16.onnx')!.body = bytes(FP16.length, 5).buffer
    await expect(load(model, env)).rejects.toBeInstanceOf(IntegrityError)
  })

  it('removes a model (and the runtime with the last one)', async () => {
    const { model, info, env, caches } = await fixture()
    await install(info, model, model.files[1], () => {}, undefined, env)
    await remove(model, env)
    expect(await installed(model, env)).toBeNull()
    expect(caches.caches.get(CACHE)!.entries.size).toBe(0)
    expect(await usage(env)).toBe(0)
  })

  it('an unpinned model can’t be installed (and nothing is fetched)', async () => {
    const { info, fetchMock, env } = await fixture()
    const m = parseManifest(shipped).models[0]
    await expect(install(info, m, m.files[0], () => {}, undefined, env)).rejects.toThrow(/isn’t available/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
