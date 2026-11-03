import { describe, expect, it, vi } from 'vitest'
import shipped from '../../models/manifest.json'
import { chooseFiles, downloadPlan, filesOf, modelPinned, parseManifest, segmentInput, servedPath, sha256Hex, sourceUrl, variantPinned, type AiInfo, type ModelEntry, type ModelFile } from './manifest'
import { CACHE, install, installed, loadPart, remove, type StoreEnv } from './store'
import { modelsToFree, RESIDENT_BYTES } from './runtime'

// Manifest schema 2 and the groundwork for AI masks (PHASE3.md Part 27): models of several graphs with their weights in
// files beside them, served from LightBench's site; SAM 2.1 Hiera Tiny pinned by the owner; installing one variant;
// loading a graph with its weights; the memory policy for several loaded models.

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

const bytes = (n: number, seed: number): Uint8Array<ArrayBuffer> => new Uint8Array(n).map((_, i) => (i * 31 + seed) & 255)
const REV = 'feedface'.repeat(5)
const sam = () => parseManifest(shipped).models.find((m) => m.task === 'segment')!

describe('manifest schema 2', () => {
  it('ships SAM 2.1 Hiera Tiny for Object select: pinned by the owner from the checked run, served from the site', () => {
    const m = sam()
    expect(m.id).toBe('sam2-1-hiera-tiny')
    expect(m.delivery).toBe('site')
    expect(m.source).toEqual({ host: 'huggingface', repo: 'onnx-community/sam2.1-hiera-tiny-ONNX', revision: '814a066640debee5a91e70aa401fb8e17e030503', pinnedBy: 'owner' })
    expect(m.licence.id).toBe('Apache-2.0')
    expect(m.licence.statement).toMatch(/licensed under Apache 2\.0/)
    // The training data in plain words (owner's option B): the two named sets and the unpublished share.
    expect(m.trainingData).toMatch(/SA-1B/)
    expect(m.trainingData).toMatch(/research use only/)
    expect(m.trainingData).toMatch(/SA-V/)
    expect(m.trainingData).toMatch(/CC BY 4\.0/)
    expect(m.trainingData).toMatch(/about 15 % of Meta’s own licensed videos, which are not published/)
    expect(segmentInput(m)).toEqual({ size: 1024, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] })
    // MASKS_PREP.md (run 39653265084): each file's size and SHA-256 as its Git LFS pointer gave them.
    const pins = Object.fromEntries(m.files.map((f) => [f.path, [f.bytes, f.sha256]]))
    expect(pins).toEqual({
      'onnx/vision_encoder_fp16.onnx': [314925, '7773e79d589dada8e1e630cc7eb18b17b2c5b4faeb1eaab5ebf9df618ecbd50a'],
      'onnx/vision_encoder_fp16.onnx_data': [67005504, 'a4dd3759e9b6a476d991fb3493787992e78777e51462695e1bede71ae258103e'],
      'onnx/prompt_encoder_mask_decoder_fp16.onnx': [229799, '00ac7200451f246e8307aa1a1648113f47dc45625738406403a0e6b86c69fc55'],
      'onnx/prompt_encoder_mask_decoder_fp16.onnx_data': [10454016, '027b457a53f5bd76bb401c59555448451d04b4eab6d2f6a6758406b40133ee2c'],
      'onnx/vision_encoder.onnx': [354238, '4f30aacd3aaefbca81a0b7fe4c1fc96345570ea0a6f80ced599493d1b3be2e8c'],
      'onnx/vision_encoder.onnx_data': [134084864, 'e83df9866a5afe68ea7f0f721f18f65137fc3acbf0da1c74e946d363e09c69cc'],
      'onnx/prompt_encoder_mask_decoder.onnx': [213114, '874414704c5d686db7d206a35f6e15d26563d50c8c4468fccc6739bd7e491dcf'],
      'onnx/prompt_encoder_mask_decoder.onnx_data': [20958208, 'e9874d900dd4134ed60eab1e97910327c2419e0b2954485d8fd6e7f1a1470f47'],
    })
    expect(modelPinned(m)).toBe(true)
    expect(variantPinned(m, 'fp16') && variantPinned(m, 'fp32')).toBe(true)
    // Per device: 77.5 MB (fp16) or 155.1 MB (fp32).
    expect(filesOf(m, 'fp16').reduce((n, f) => n + f.bytes, 0)).toBe(78004244)
    expect(filesOf(m, 'fp32').reduce((n, f) => n + f.bytes, 0)).toBe(155610424)
    // Served under each file's own name; fetched by the deploy from the pinned commit.
    const data = m.files.find((f) => f.path === 'onnx/vision_encoder_fp16.onnx_data')!
    expect(data.data).toBe(true)
    expect(data.part).toBe('encoder')
    expect(servedPath(m, data)).toBe('models/sam2-1-hiera-tiny/814a066/vision_encoder_fp16.onnx_data')
    expect(sourceUrl(m, data)).toBe('https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX/resolve/814a066640debee5a91e70aa401fb8e17e030503/onnx/vision_encoder_fp16.onnx_data')
  })

  it('keeps the depth model\'s and AI Remove\'s paths as they were', () => {
    const d = parseManifest(shipped).models.find((m) => m.task === 'depth')!
    expect(servedPath(d, d.files[0])).toBe(`models/depth-anything-v2-small/${d.source.revision!.slice(0, 7)}/fp16.onnx`)
    const moebius = parseManifest(shipped).models.find((m) => m.task === 'inpaint')!
    expect(chooseFiles(moebius, { f16: true }).map((f) => f.part)).toEqual(['vae_encoder', 'unet', 'vae_decoder'])
  })

  it('chooses all files of one variant: the one asked for, else fp16 with shader-f16 and fp32 without', () => {
    const m = sam()
    expect(chooseFiles(m, { f16: true }).map((f) => f.path)).toEqual(['onnx/vision_encoder_fp16.onnx', 'onnx/vision_encoder_fp16.onnx_data', 'onnx/prompt_encoder_mask_decoder_fp16.onnx', 'onnx/prompt_encoder_mask_decoder_fp16.onnx_data'])
    expect(chooseFiles(m, { f16: false }).every((f) => f.variant === 'fp32')).toBe(true)
    expect(chooseFiles(m, { f16: true }, 'fp32').every((f) => f.variant === 'fp32')).toBe(true)
    const info: AiInfo = { models: [m], runtime: { name: 'ONNX Runtime Web', version: '1.30.0', licence: 'MIT', wasm: { path: 'ort/1.30.0/x.wasm', bytes: 10, sha256: 'ab'.repeat(32) } } }
    expect(downloadPlan(info, m, chooseFiles(m, { f16: true }), false).map((x) => [x.what, x.path])).toEqual([
      ['runtime', 'ort/1.30.0/x.wasm'],
      ['model', 'models/sam2-1-hiera-tiny/814a066/vision_encoder_fp16.onnx'],
      ['model', 'models/sam2-1-hiera-tiny/814a066/vision_encoder_fp16.onnx_data'],
      ['model', 'models/sam2-1-hiera-tiny/814a066/prompt_encoder_mask_decoder_fp16.onnx'],
      ['model', 'models/sam2-1-hiera-tiny/814a066/prompt_encoder_mask_decoder_fp16.onnx_data'],
    ])
  })

  it('refuses malformed schema-2 entries', () => {
    const edit = (fn: (s: ReturnType<typeof samJson>) => void) => {
      const j = JSON.parse(JSON.stringify(shipped))
      fn(j.models.find((x: { id: string }) => x.id === 'sam2-1-hiera-tiny'))
      return () => parseManifest(j)
    }
    const samJson = () => JSON.parse(JSON.stringify(shipped)).models[2] as Record<string, unknown> & { files: Record<string, unknown>[]; input: Record<string, unknown>; source: Record<string, unknown> }
    expect(edit(() => {})).not.toThrow()
    // A variant without its decoder graph.
    expect(edit((s) => (s.files = s.files.filter((f) => !(f.variant === 'fp16' && f.part === 'decoder' && !f.data))))).toThrow(/weights for fp16 decoder|needs the graphs/)
    // A weights file that names no graph.
    expect(edit((s) => delete s.files[1].part)).toThrow(/must name its graph/)
    // Two files served under one name.
    expect(edit((s) => (s.files[2].path = 'other/vision_encoder_fp16.onnx'))).toThrow(/same name|two fp16 decoder/)
    expect(edit((s) => (s.input = { size: 0, mean: [0, 0, 0], std: [1, 1, 1] }))).toThrow(/input/)
    expect(edit((s) => (s.task = 'landscape'))).toThrow(/unknown task/)
    expect(edit((s) => (s.source.pinnedBy = 'someone'))).toThrow(/pinnedBy/)
    // A one-file model can't have parts.
    const j = JSON.parse(JSON.stringify(shipped))
    j.models[0].files[0].part = 'encoder'
    expect(() => parseManifest(j)).toThrow(/one file per variant/)
  })
})

describe('installing a model of several files from the site', () => {
  async function fixture() {
    const enc = bytes(700, 1)
    const encData = bytes(5000, 2)
    const dec = bytes(300, 3)
    const decData = bytes(900, 4)
    const enc32 = bytes(800, 5)
    const encData32 = bytes(9000, 6)
    const dec32 = bytes(310, 7)
    const decData32 = bytes(1800, 8)
    const runtime = bytes(3000, 9)
    const f = async (variant: 'fp16' | 'fp32', part: string, path: string, b: Uint8Array<ArrayBuffer>, data?: true): Promise<ModelFile> => ({ variant, part, ...(data ? { data } : {}), path, bytes: b.length, sha256: await sha256Hex(b) })
    const model: ModelEntry = {
      ...sam(),
      source: { host: 'huggingface', repo: 'onnx-community/sam2.1-hiera-tiny-ONNX', revision: REV, pinnedBy: 'owner' },
      files: [
        await f('fp16', 'encoder', 'onnx/vision_encoder_fp16.onnx', enc),
        await f('fp16', 'encoder', 'onnx/vision_encoder_fp16.onnx_data', encData, true),
        await f('fp16', 'decoder', 'onnx/prompt_encoder_mask_decoder_fp16.onnx', dec),
        await f('fp16', 'decoder', 'onnx/prompt_encoder_mask_decoder_fp16.onnx_data', decData, true),
        await f('fp32', 'encoder', 'onnx/vision_encoder.onnx', enc32),
        await f('fp32', 'encoder', 'onnx/vision_encoder.onnx_data', encData32, true),
        await f('fp32', 'decoder', 'onnx/prompt_encoder_mask_decoder.onnx', dec32),
        await f('fp32', 'decoder', 'onnx/prompt_encoder_mask_decoder.onnx_data', decData32, true),
      ],
    }
    const info: AiInfo = { models: [model], runtime: { name: 'ONNX Runtime Web', version: '1.30.0', licence: 'MIT', wasm: { path: 'ort/1.30.0/ort.wasm', bytes: runtime.length, sha256: await sha256Hex(runtime) } } }
    const base = 'http://lb.test/app/'
    const served: Record<string, Uint8Array> = { [`${base}ort/1.30.0/ort.wasm`]: runtime }
    const all = { enc, encData, dec, decData, enc32, encData32, dec32, decData32 }
    const order = [enc, encData, dec, decData, enc32, encData32, dec32, decData32]
    model.files.forEach((x, i) => (served[`${base}${servedPath(model, x)}`] = order[i]))
    const fetchMock = vi.fn(async (u: string) => (served[u] ? new Response(served[u].slice(0)) : new Response('missing', { status: 404 })))
    const caches = new MemCaches()
    const env: StoreEnv = { caches: caches as unknown as CacheStorage, fetch: fetchMock as unknown as typeof fetch, base }
    return { model, info, served, fetchMock, caches, env, all, base }
  }

  it('downloads only the chosen variant\'s files (and the runtime), checks each and loads a graph with its weights', async () => {
    const { model, info, fetchMock, env, all } = await fixture()
    expect(await installed(model, env)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    const rec = await install(info, model, chooseFiles(model, { f16: true }), () => {}, undefined, env)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'http://lb.test/app/ort/1.30.0/ort.wasm',
      'http://lb.test/app/models/sam2-1-hiera-tiny/feedfac/vision_encoder_fp16.onnx',
      'http://lb.test/app/models/sam2-1-hiera-tiny/feedfac/vision_encoder_fp16.onnx_data',
      'http://lb.test/app/models/sam2-1-hiera-tiny/feedfac/prompt_encoder_mask_decoder_fp16.onnx',
      'http://lb.test/app/models/sam2-1-hiera-tiny/feedfac/prompt_encoder_mask_decoder_fp16.onnx_data',
    ])
    expect(rec.variant).toBe('fp16')
    expect(rec.files!.map((f) => [f.part, f.data ?? false])).toEqual([['encoder', false], ['encoder', true], ['decoder', false], ['decoder', true]])
    expect((await installed(model, env))?.variant).toBe('fp16')
    // Offline afterwards: the graph and its weights (named as the graph refers to them), checked again.
    fetchMock.mockImplementation(async () => {
      throw new TypeError('offline')
    })
    const enc = await loadPart(model, 'encoder', env)
    expect(new Uint8Array(enc.model)).toEqual(all.enc)
    expect(enc.data?.name).toBe('vision_encoder_fp16.onnx_data')
    expect(new Uint8Array(enc.data!.bytes)).toEqual(all.encData)
    const dec = await loadPart(model, 'decoder', env)
    expect(dec.data?.name).toBe('prompt_encoder_mask_decoder_fp16.onnx_data')
  })

  it('a weights file that doesn\'t match is refused and nothing is recorded; another variant replaces the first', async () => {
    const { model, info, served, env, base, caches } = await fixture()
    const key = `${base}models/sam2-1-hiera-tiny/feedfac/vision_encoder_fp16.onnx_data`
    const good = served[key]
    served[key] = Uint8Array.from(good).fill(0, 0, 1)
    await expect(install(info, model, chooseFiles(model, { f16: true }), () => {}, undefined, env)).rejects.toThrow(/SHA-256/)
    expect(await installed(model, env)).toBeNull()
    served[key] = good
    await install(info, model, chooseFiles(model, { f16: true }), () => {}, undefined, env)
    await install(info, model, chooseFiles(model, { f16: false }), () => {}, undefined, env)
    const rec = await installed(model, env)
    expect(rec?.variant).toBe('fp32')
    // The fp16 files are gone from the device.
    const keys = (await (await caches.open(CACHE)).keys()).map((r) => r.url)
    expect(keys.some((u) => u.includes('fp16'))).toBe(false)
    // A damaged weights file on the device is reported, never run.
    const c = (await caches.open(CACHE)) as unknown as MemCache
    const e = c.entries.get(`${base}models/sam2-1-hiera-tiny/feedfac/vision_encoder.onnx_data`)!
    new Uint8Array(e.body)[3] ^= 1
    await expect(loadPart(model, 'encoder', env)).rejects.toThrow(/damaged/)
    // A missing weights file makes the model not installed.
    await c.delete(`${base}models/sam2-1-hiera-tiny/feedfac/prompt_encoder_mask_decoder.onnx_data`)
    expect(await installed(model, env)).toBeNull()
    await remove(model, env)
    expect((await (await caches.open(CACHE)).keys()).length).toBe(0)
  })
})

describe('the memory policy for several loaded models', () => {
  it('frees other models, least recently used first and held ones last, until the weights fit', () => {
    const list = [
      { model: 'depth-anything-v2-small', bytes: 50e6, used: 1 },
      { model: 'sam2-1-hiera-tiny', bytes: 67e6, used: 2 },
      { model: 'sam2-1-hiera-tiny', bytes: 11e6, used: 3 },
    ]
    // SAM and the depth model fit together.
    expect(modelsToFree(list, 'sam2-1-hiera-tiny', new Set())).toEqual([])
    // AI Remove's 1.04 GB denoiser and encoder: both others go, the least recently used first.
    const big = [...list, { model: 'moebius', bytes: 907e6, used: 4 }, { model: 'moebius', bytes: 137e6, used: 5 }]
    expect(modelsToFree(big, 'moebius', new Set())).toEqual(['depth-anything-v2-small', 'sam2-1-hiera-tiny'])
    // A held model goes last: with a smaller budget only the depth model has to go.
    expect(modelsToFree(list, 'moebius', new Set(['depth-anything-v2-small']), 70e6)).toEqual(['sam2-1-hiera-tiny'])
    // The loading model's own graphs are never freed here.
    expect(modelsToFree(big, 'moebius', new Set(), 1)).not.toContain('moebius')
    expect(RESIDENT_BYTES).toBeGreaterThanOrEqual(155610424 + 99060839)
  })
})
