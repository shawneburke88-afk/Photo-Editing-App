import { describe, expect, it, vi } from 'vitest'
import shipped from '../../models/manifest.json'
import { cachePath, chooseFiles, deliveryOf, filesBytes, formatBytes, modelPinned, parseManifest, sha256Hex, sourceUrl, type AiInfo, type ModelEntry } from './manifest'
import { CACHE, chunkPath, installed, installedBytes, installHf, IntegrityError, loadPart, partialDownload, rateLimitWait, remove, SpaceError, type HfProgress, type StoreEnv } from './store'
import { Sha256 } from '../lib/sha256'

// AI Remove's model delivery (PHASE3.md Part 26; owner's decisions 2026-10-21): Moebius pinned at simonw/Moebius-ONNX
// 5bf1ef5, downloaded by the app from Hugging Face after the user agrees, resumable (Range requests), each file checked
// against its size and SHA-256, keyed by commit + file name, 429s waited out, no token, nothing recorded until all is.

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

const bytes = (n: number, seed: number) => new Uint8Array(n).map((_, i) => (i * 31 + seed * 7 + (i >> 8)) & 255)
const RUNTIME = bytes(3000, 1)
const ENC = bytes(2500, 2)
const UNET = bytes(10_000, 3)
const DEC = bytes(3100, 4)
const REV = '5bf1ef5d2861ec01a727183a3f95dc64f352120e'
const CH = 1024

const moebius = () => parseManifest(shipped).models.find((m) => m.id === 'moebius')!

async function fixture(opts: { cutAfter?: number; rateLimitOnce?: boolean; ignoreRange?: boolean; corrupt?: string } = {}) {
  const real = moebius()
  const data: Record<string, Uint8Array> = { 'vae_encoder.onnx': ENC, 'unet.onnx': UNET, 'vae_decoder.onnx': DEC }
  const model: ModelEntry = {
    ...real,
    files: await Promise.all(real.files.map(async (f) => ({ ...f, bytes: data[f.path].length, sha256: await sha256Hex(data[f.path].slice()) }))),
  }
  const info: AiInfo = { models: [model], runtime: { name: 'ONNX Runtime Web', version: '1.30.0', licence: 'MIT', wasm: { path: 'ort/1.30.0/ort.wasm', bytes: RUNTIME.length, sha256: await sha256Hex(RUNTIME.slice()) } } }
  const calls: { url: string; range: string | null; headers: Record<string, string>; credentials?: string }[] = []
  let limited = false
  let served = 0
  const fetchMock = vi.fn(async (u: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({ url: u, range: headers.Range ?? null, headers, credentials: init?.credentials })
    if (u === 'http://lb.test/app/ort/1.30.0/ort.wasm') return new Response(RUNTIME.slice())
    const m = /^https:\/\/huggingface\.co\/simonw\/Moebius-ONNX\/resolve\/([0-9a-f]{40})\/(.+)$/.exec(u)
    if (!m || m[1] !== REV || !data[m[2]]) return new Response('missing', { status: 404 })
    if (opts.rateLimitOnce && !limited) {
      limited = true
      return new Response('slow down', { status: 429, headers: { ratelimit: '"resolvers";r=0;t=17' } })
    }
    let body = data[m[2]].slice()
    if (opts.corrupt === m[2]) body[body.length - 5] ^= 1
    const range = headers.Range
    let status = 200
    let start = 0
    if (range && !opts.ignoreRange) {
      start = Number(/^bytes=(\d+)-$/.exec(range)![1])
      body = body.slice(start)
      status = 206
    }
    // A connection that drops after `cutAfter` bytes in total (once).
    const cut = opts.cutAfter
    let i = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (i >= body.length) return c.close()
        const piece = body.subarray(i, Math.min(body.length, i + 700))
        i += 700
        if (cut !== undefined && served < cut && served + piece.length >= cut) {
          served += piece.length
          return c.error(new TypeError('network error'))
        }
        served += piece.length
        c.enqueue(piece)
      },
    })
    return new Response(stream, { status, headers: status === 206 ? { 'content-range': `bytes ${start}-${data[m[2]].length - 1}/${data[m[2]].length}` } : {} })
  })
  const caches = new MemCaches()
  const sleeps: number[] = []
  const estimate = vi.fn(async () => ({ quota: 50e9, usage: 1e9 }))
  const persist = vi.fn(async () => true)
  const env: StoreEnv = {
    caches: caches as unknown as CacheStorage,
    fetch: fetchMock as unknown as typeof fetch,
    base: 'http://lb.test/app/',
    storage: { estimate, persist } as unknown as StorageManager,
    sleep: async (ms) => void sleeps.push(ms),
    chunk: CH,
  }
  return { model, info, calls, fetchMock, caches, env, sleeps, estimate, persist }
}

describe('the shipped Moebius entry', () => {
  it('pins simonw/Moebius-ONNX at 5bf1ef5 with the owner’s three fp32 files (about 1.24 GB), from Hugging Face', () => {
    const m = moebius()
    expect(m.task).toBe('inpaint')
    expect(deliveryOf(m)).toBe('huggingface')
    expect(m.source).toEqual({ host: 'huggingface', repo: 'simonw/Moebius-ONNX', revision: REV })
    expect(m.files.map((f) => [f.part, f.path, f.bytes, f.sha256])).toEqual([
      ['vae_encoder', 'vae_encoder.onnx', 136757093, 'b8b81d41e757222a0707665ba9d826703987855e5bed056036b90b988968042f'],
      ['unet', 'unet.onnx', 906698976, 'e3f90f52f72378339b990459fadb29a68d3c7b5c6851545ba42774f489160b08'],
      ['vae_decoder', 'vae_decoder.onnx', 198078671, 'd90ef0b7f6c8c8b7234459c8b449d70be0033bf1576c842e8b9991baf3934280'],
    ])
    expect(m.files.every((f) => f.variant === 'fp32')).toBe(true)
    expect(filesBytes(m.files)).toBe(1_241_534_740)
    expect(formatBytes(filesBytes(m.files))).toBe('1.24 GB')
    expect(modelPinned(m)).toBe(true)
    // Never the Conv3d export (9f6cfb3) or earlier.
    expect(m.source.revision).not.toMatch(/^9f6cfb3|^82c258b/)
    expect(m.checkpoint).toEqual({ name: 'ft_places2', source: expect.stringMatching(/^export script, not model card/) })
    expect(m.licence.id).toBe('Apache-2.0')
    expect(m.licence.statement).toMatch(/b88d462/)
    expect(m.licence.notes).toMatch(/tagged MIT/)
    expect(m.trainingData).toMatch(/not all of its training data is named publicly/)
    expect(m.trainingData).toMatch(/exception/)
    expect(m.updates?.upstream).toEqual({ repo: 'hustvl/Moebius', revision: 'cd01f47fb648219d3fa605806c5ce00b713faa5e', path: 'ft_places2/diffusion_pytorch_model.bin', bytes: 905298356, sha256: '6525afb888e55f9b5c74fa0a5d19ca0762d720d6c716fb0f8422fbeb6868a09a' })
    // Every GPU gets all three graphs, in the order they run.
    expect(chooseFiles(m, { f16: true }).map((f) => f.part)).toEqual(['vae_encoder', 'unet', 'vae_decoder'])
    expect(chooseFiles(m, { f16: false }).map((f) => f.part)).toEqual(['vae_encoder', 'unet', 'vae_decoder'])
  })

  it('downloads from the commit-pinned /resolve/ URL and keys the cache by commit + file name', () => {
    const m = moebius()
    const unet = m.files[1]
    expect(sourceUrl(m, unet)).toBe(`https://huggingface.co/simonw/Moebius-ONNX/resolve/${REV}/unet.onnx`)
    expect(cachePath(m, unet)).toBe(`models/moebius/${REV}/unet.onnx`)
  })

  it('refuses an inpainting entry without its three graphs', () => {
    const j = JSON.parse(JSON.stringify(shipped))
    const mo = j.models.find((x: { id: string }) => x.id === 'moebius')
    mo.files = mo.files.slice(0, 2)
    expect(() => parseManifest(j)).toThrow(/vae_encoder, unet and vae_decoder/)
    const k = JSON.parse(JSON.stringify(shipped))
    k.models.find((x: { id: string }) => x.id === 'moebius').delivery = 'ftp'
    expect(() => parseManifest(k)).toThrow(/delivery/)
  })
})

describe('the download from Hugging Face', () => {
  it('fetches nothing before the user agrees: installed and partialDownload only read the cache', async () => {
    const { model, env, fetchMock } = await fixture()
    expect(await installed(model, env)).toBeNull()
    expect(await partialDownload(model, model.files, env)).toEqual({ done: 0, total: filesBytes(model.files) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('downloads the runtime and the three files, checks them, keeps them in parts keyed by commit + name, asks to persist', async () => {
    const { model, info, env, calls, caches, persist, estimate } = await fixture()
    const seen: HfProgress[] = []
    const rec = await installHf(info, model, model.files, (p) => seen.push(p), undefined, env)
    expect(rec.files!.map((f) => [f.part, f.path, f.chunks])).toEqual([
      ['vae_encoder', `models/moebius/${REV}/vae_encoder.onnx`, 3],
      ['unet', `models/moebius/${REV}/unet.onnx`, 10],
      ['vae_decoder', `models/moebius/${REV}/vae_decoder.onnx`, 4],
    ])
    expect(installedBytes(rec)).toBe(ENC.length + UNET.length + DEC.length + RUNTIME.length)
    // The runtime from LightBench's own site, the model from Hugging Face's pinned URLs; no token, no cookies.
    expect(calls.map((c) => c.url)).toEqual([
      'http://lb.test/app/ort/1.30.0/ort.wasm',
      `https://huggingface.co/simonw/Moebius-ONNX/resolve/${REV}/vae_encoder.onnx`,
      `https://huggingface.co/simonw/Moebius-ONNX/resolve/${REV}/unet.onnx`,
      `https://huggingface.co/simonw/Moebius-ONNX/resolve/${REV}/vae_decoder.onnx`,
    ])
    for (const c of calls.slice(1)) {
      expect(c.credentials).toBe('omit')
      expect(Object.keys(c.headers).map((h) => h.toLowerCase())).not.toContain('authorization')
    }
    expect(estimate).toHaveBeenCalled()
    expect(persist).toHaveBeenCalled()
    const last = seen[seen.length - 1]
    expect(last.done).toBe(last.total)
    const keys = [...caches.caches.get(CACHE)!.entries.keys()]
    expect(keys).toContain(`http://lb.test/app/models/moebius/${REV}/unet.onnx/part-0009`)
    expect(keys.some((k) => /cdn|xet|Signature/.test(k))).toBe(false)
    expect(await installed(model, env)).toEqual(rec)
    // Each file put back together and checked again before the runtime gets it; works with the network gone.
    env.fetch = (() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch
    const unet = await loadPart(model, 'unet', env)
    expect(new Uint8Array(unet.model)).toEqual(UNET)
    expect(new Uint8Array(unet.wasm)).toEqual(RUNTIME)
  })

  it('resumes an interrupted download with a Range request from the last kept part', async () => {
    const { model, info, env, calls } = await fixture({ cutAfter: ENC.length + 4200 })
    const rec = await installHf(info, model, model.files, () => {}, undefined, env)
    const unetCalls = calls.filter((c) => c.url.endsWith('unet.onnx'))
    // 3,500 bytes of the UNet arrived before the connection dropped: 3 whole parts (3,072 bytes) were kept, and the
    // rest is asked from byte 3,072.
    expect(unetCalls.map((c) => c.range)).toEqual([null, 'bytes=3072-'])
    expect(rec.files!.find((f) => f.part === 'unet')!.sha256).toBe(model.files[1].sha256)
    expect(new Uint8Array((await loadPart(model, 'unet', env)).model)).toEqual(UNET)
  })

  it('a stopped install records nothing, keeps its parts, and the next one continues from them', async () => {
    const { model, info, env, calls } = await fixture()
    const ctl = new AbortController()
    let n = 0
    await expect(installHf(info, model, model.files, (p) => {
      if (p.file === 'unet.onnx' && ++n === 3) ctl.abort()
    }, ctl.signal, env)).rejects.toMatchObject({ name: 'AbortError' })
    expect(await installed(model, env)).toBeNull()
    const part = await partialDownload(model, model.files, env)
    expect(part.done).toBeGreaterThan(ENC.length)
    expect(part.done).toBeLessThan(part.total)
    calls.length = 0
    const seen: HfProgress[] = []
    await installHf(info, model, model.files, (p) => seen.push(p), undefined, env)
    expect(seen[0].resumed).toBe(part.done)
    // Not the encoder again, nor the runtime: the UNet from its first missing part.
    expect(calls.map((c) => [c.url.replace(/^.*\//, ''), c.range])).toEqual([['unet.onnx', `bytes=${part.done - ENC.length}-`], ['vae_decoder.onnx', null]])
    expect(await installed(model, env)).not.toBeNull()
  })

  it('waits out a 429 for the RateLimit header’s t= seconds, then continues', async () => {
    const { model, info, env, sleeps } = await fixture({ rateLimitOnce: true })
    const seen: HfProgress[] = []
    await installHf(info, model, model.files, (p) => seen.push(p), undefined, env)
    expect(sleeps).toEqual([17_000])
    expect(seen.some((p) => p.reason === 'rate-limit' && p.waiting === 17)).toBe(true)
    expect(rateLimitWait(new Headers({ ratelimit: '"resolvers";r=0;t=29' }))).toBe(29)
    expect(rateLimitWait(new Headers({ 'retry-after': '12' }))).toBe(12)
    expect(rateLimitWait(new Headers())).toBe(60)
    expect(rateLimitWait(new Headers({ ratelimit: '"api";r=0;t=9999' }))).toBe(300)
  })

  it('starts a file again when the server ignores the Range request', async () => {
    const { model, info, env } = await fixture({ cutAfter: ENC.length + 4200, ignoreRange: true })
    await installHf(info, model, model.files, () => {}, undefined, env)
    expect(new Uint8Array((await loadPart(model, 'unet', env)).model)).toEqual(UNET)
  })

  it('a file that doesn’t match its SHA-256 is deleted and nothing is recorded', async () => {
    const { model, info, env, caches } = await fixture({ corrupt: 'unet.onnx' })
    await expect(installHf(info, model, model.files, () => {}, undefined, env)).rejects.toBeInstanceOf(IntegrityError)
    expect(await installed(model, env)).toBeNull()
    const keys = [...caches.caches.get(CACHE)!.entries.keys()]
    expect(keys.some((k) => k.includes('unet.onnx'))).toBe(false)
    expect(keys.some((k) => k.endsWith('installed.json'))).toBe(false)
  })

  it('says plainly when there isn’t enough space, before downloading anything', async () => {
    const { model, info, env, fetchMock } = await fixture()
    env.storage = { estimate: async () => ({ quota: 1e9, usage: 0.99e9 }), persist: async () => true } as unknown as StorageManager
    await expect(installHf(info, model, model.files, () => {}, undefined, env)).rejects.toBeInstanceOf(SpaceError)
    await expect(installHf(info, model, model.files, () => {}, undefined, env)).rejects.toThrow(/isn’t enough storage space/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('removal deletes every part, kept or partial', async () => {
    const { model, info, env, caches } = await fixture()
    await installHf(info, model, model.files, () => {}, undefined, env)
    await remove(model, env)
    expect(caches.caches.get(CACHE)!.entries.size).toBe(0)
    expect(await installed(model, env)).toBeNull()
  })

  it('a damaged part on the device is reported, never run', async () => {
    const { model, info, env, caches } = await fixture()
    await installHf(info, model, model.files, () => {}, undefined, env)
    const c = caches.caches.get(CACHE)!
    const k = `http://lb.test/app/models/moebius/${REV}/unet.onnx/part-0002`
    const e = c.entries.get(k)!
    const b = new Uint8Array(e.body.slice(0))
    b[0] ^= 1
    c.entries.set(k, { ...e, body: b.buffer })
    await expect(loadPart(model, 'unet', env)).rejects.toBeInstanceOf(IntegrityError)
  })
})

describe('SHA-256 in parts', () => {
  it('matches the platform’s digest whatever the pieces', async () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 70_000]) {
      const b = bytes(n, n)
      const h = new Sha256()
      for (let i = 0; i < n; ) {
        const k = Math.min(n - i, 1 + ((i * 7) % 97))
        h.update(b.subarray(i, i + k))
        i += k
      }
      expect(h.hex()).toBe(await sha256Hex(b.slice()))
    }
    expect(chunkPath('models/x/y.onnx', 3)).toBe('models/x/y.onnx/part-0003')
  })
})
