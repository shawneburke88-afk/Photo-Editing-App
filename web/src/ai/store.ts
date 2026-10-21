// The AI models kept on this device (docs/PHASE3.md Part 24; owner's decision 2026-10-17): downloaded once, only when
// the user says so, checked against the SHA-256 compiled into the app (ai/manifest.ts), kept in Cache Storage, used
// offline afterwards and removable in Settings.
//
// The cache is "ai-models", not a "lightbench-…" cache: the service worker deletes those on every update (sw.ts), and
// it never serves from this one (the app reads it itself). A record of what is installed sits in the same cache.
// Nothing in this file is called before the user's opt-in except `installed` and `usage`, which only read the cache.

import { cachePath, deliveryOf, downloadPlan, filesBytes, formatBytes, sha256Hex, sourceUrl, type AiInfo, type DownloadItem, type ModelEntry, type ModelFile, type Variant } from './manifest'
import { Sha256 } from '../lib/sha256'

export const CACHE = 'ai-models'
const RECORD = 'installed.json'

export interface InstalledFile {
  /** Which graph of a model made of several (AI Remove); absent for a one-file model. */
  part?: string
  /** Cache path relative to the site root (models/<id>/<commit>/<file> for a file from Hugging Face). */
  path: string
  bytes: number
  sha256: string
  /** Kept in this many parts of CHUNK bytes (files from Hugging Face). */
  chunks?: number
}

export interface InstalledModel {
  id: string
  variant: Variant
  revision: string
  /** Paths relative to the site root, as in the manifest. A model of several files: its largest one. */
  model: { path: string; bytes: number; sha256: string }
  runtime: { path: string; bytes: number; sha256: string }
  /** Every file of the model (models delivered from Hugging Face). */
  files?: InstalledFile[]
  at: number
}

/** The bytes a model and its runtime take on this device. */
export const installedBytes = (rec: InstalledModel) => (rec.files ? rec.files.reduce((n, f) => n + f.bytes, 0) : rec.model.bytes) + rec.runtime.bytes

type Record_ = { models: InstalledModel[] }

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrityError'
  }
}

/** Not enough free space for the download (said before anything is downloaded). */
export class SpaceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpaceError'
  }
}

/** Seams for tests: Cache Storage, fetch, the site root, the storage manager and waiting. */
export interface StoreEnv {
  caches: CacheStorage
  fetch: typeof fetch
  base: string
  storage?: Pick<StorageManager, 'estimate' | 'persist'> | null
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Part size for files from Hugging Face (tests use a small one). */
  chunk?: number
}

const defaultEnv = (): StoreEnv => ({
  caches: globalThis.caches,
  fetch: (...a) => globalThis.fetch(...a),
  base: new URL(import.meta.env?.BASE_URL ?? '/', globalThis.location?.href ?? 'http://localhost/').href,
  storage: globalThis.navigator?.storage ?? null,
})

const abortError = () => new DOMException('The download was cancelled.', 'AbortError')

function sleep(env: StoreEnv, ms: number, signal?: AbortSignal): Promise<void> {
  if (env.sleep) return env.sleep(ms, signal)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', stop)
      resolve()
    }, ms)
    const stop = () => {
      clearTimeout(t)
      reject(abortError())
    }
    signal?.addEventListener('abort', stop, { once: true })
  })
}

const url = (env: StoreEnv, path: string) => new URL(path, env.base).href

async function readRecord(env: StoreEnv, cache: Cache): Promise<Record_> {
  try {
    const r = await cache.match(url(env, `models/${RECORD}`))
    const j = r ? ((await r.json()) as Record_) : null
    return j && Array.isArray(j.models) ? j : { models: [] }
  } catch {
    return { models: [] }
  }
}

async function writeRecord(env: StoreEnv, cache: Cache, rec: Record_) {
  await cache.put(url(env, `models/${RECORD}`), new Response(JSON.stringify(rec), { headers: { 'Content-Type': 'application/json' } }))
}

/** What is installed for a model on this device (the files must still be in the cache), or null. Reads only. */
export async function installed(m: ModelEntry, env: StoreEnv = defaultEnv()): Promise<InstalledModel | null> {
  let cache: Cache
  try {
    cache = await env.caches.open(CACHE)
  } catch {
    return null
  }
  const rec = (await readRecord(env, cache)).models.find((x) => x.id === m.id)
  if (!rec) return null
  // An entry from another revision of the manifest is outdated: treated as not installed (the panel offers the new one).
  if (rec.revision !== m.source.revision) return null
  if (rec.files) {
    // Every file of the manifest, with the hash it pins, and every part of it, must be here.
    if (!m.files.every((f) => rec.files!.some((x) => x.path === cachePath(m, f) && x.sha256 === f.sha256 && x.bytes === f.bytes))) return null
    for (const f of rec.files) for (let i = 0; i < (f.chunks ?? 0); i++) if (!(await cache.match(url(env, chunkPath(f.path, i))))) return null
    if (!(await cache.match(url(env, rec.runtime.path)))) return null
    return rec
  }
  if (!m.files.some((f) => f.variant === rec.variant && f.sha256 === rec.model.sha256)) return null
  for (const p of [rec.model.path, rec.runtime.path]) if (!(await cache.match(url(env, p)))) return null
  return rec
}

/** Whether the runtime file of this build is on the device already (installing a second model doesn't fetch it again). */
async function runtimeHere(env: StoreEnv, cache: Cache, info: AiInfo): Promise<boolean> {
  return !!(await cache.match(url(env, info.runtime.wasm.path)))
}

/** The bytes the next install would download (runtime included if it isn't here yet). Reads only. */
export async function installSize(info: AiInfo, m: ModelEntry, f: ModelFile, env: StoreEnv = defaultEnv()): Promise<{ items: DownloadItem[]; bytes: number }> {
  let have = false
  try {
    have = await runtimeHere(env, await env.caches.open(CACHE), info)
  } catch {
    have = false
  }
  const items = downloadPlan(info, m, f, have)
  return { items, bytes: items.reduce((n, x) => n + x.bytes, 0) }
}

export interface Progress {
  done: number
  total: number
  what: DownloadItem['what']
}

async function fetchChecked(env: StoreEnv, item: DownloadItem, onBytes: (n: number) => void, signal?: AbortSignal): Promise<ArrayBuffer> {
  const r = await env.fetch(url(env, item.path), { signal, cache: 'no-store' })
  if (!r.ok) throw new Error(`The download failed (HTTP ${r.status}).`)
  let buf: Uint8Array<ArrayBuffer>
  if (r.body) {
    const reader = r.body.getReader()
    buf = new Uint8Array(item.bytes)
    let n = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (n + value.length > buf.length) throw new IntegrityError(`The downloaded file is larger than expected (${formatBytes(item.bytes)}).`)
      buf.set(value, n)
      n += value.length
      onBytes(value.length)
    }
    if (n !== item.bytes) throw new IntegrityError(`The downloaded file is ${formatBytes(n)}, expected ${formatBytes(item.bytes)}.`)
  } else {
    buf = new Uint8Array(await r.arrayBuffer())
    onBytes(buf.length)
  }
  if (buf.length !== item.bytes) throw new IntegrityError(`The downloaded file is ${formatBytes(buf.length)}, expected ${formatBytes(item.bytes)}.`)
  const got = await sha256Hex(buf)
  if (got !== item.sha256) throw new IntegrityError(`The downloaded file doesn’t match its SHA-256 (got ${got.slice(0, 12)}…, expected ${item.sha256.slice(0, 12)}…): it was not kept.`)
  return buf.buffer
}

/**
 * Downloads a model (and the runtime if needed), checks every file's size and SHA-256 and keeps them. Call only after
 * the user agreed. A file that doesn't match is not kept, and nothing is recorded as installed.
 */
export async function install(info: AiInfo, m: ModelEntry, f: ModelFile, onProgress: (p: Progress) => void = () => {}, signal?: AbortSignal, env: StoreEnv = defaultEnv()): Promise<InstalledModel> {
  if (!m.source.revision || !f.sha256) throw new Error(`${m.name} isn’t available in this build of LightBench.`)
  const cache = await env.caches.open(CACHE)
  const items = downloadPlan(info, m, f, await runtimeHere(env, cache, info))
  const total = items.reduce((n, x) => n + x.bytes, 0)
  let done = 0
  for (const item of items) {
    const buf = await fetchChecked(env, item, (n) => {
      done += n
      onProgress({ done, total, what: item.what })
    }, signal)
    await cache.put(url(env, item.path), new Response(buf, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.byteLength) } }))
  }
  const rec = await readRecord(env, cache)
  const entry: InstalledModel = {
    id: m.id,
    variant: f.variant,
    revision: m.source.revision,
    model: { path: items[items.length - 1].path, bytes: f.bytes, sha256: f.sha256 },
    runtime: { path: info.runtime.wasm.path, bytes: info.runtime.wasm.bytes, sha256: info.runtime.wasm.sha256 },
    at: Date.now(),
  }
  // The old files of this model (another variant or revision) go.
  const old = rec.models.find((x) => x.id === m.id)
  if (old && old.model.path !== entry.model.path) await cache.delete(url(env, old.model.path))
  await writeRecord(env, cache, { models: [...rec.models.filter((x) => x.id !== m.id), entry] })
  // Ask the browser to keep the site's storage (Chromium decides by itself and shows no prompt; MDN).
  await globalThis.navigator?.storage?.persist?.().catch(() => false)
  return entry
}

// ---- Models downloaded from Hugging Face (AI Remove's Moebius: docs/PHASE3.md Part 26; owner's decision 2026-10-21)
//
// Three files, 1.24 GB together, downloaded by the browser itself from the commit-pinned `/resolve/<commit>/<file>` URLs
// (they answer with a redirect to a signed CDN address; both allow LightBench's origin, and the CDN answers Range
// requests: the "AI models" workflow's hf-check, run 39644358791). A download that long over a home connection will be
// interrupted, so each file is kept in parts of CHUNK bytes as they arrive; the next try (after a network error, a
// Cancel or a closed tab) asks only for the rest with a Range request. Each file's SHA-256 is worked out part by part
// and compared with the manifest's before the model is recorded as installed: a file that doesn't match is deleted and
// nothing is recorded. The parts are keyed by the pinned commit and file name, never by the signed address. No token is
// sent (anonymous downloads are allowed; HF's limit is 3,000 file requests per 5 minutes per address). A 429 answer is
// waited out: its RateLimit header's t= seconds when the browser may read it, else Retry-After, else a minute.

/** The part size of a file kept from Hugging Face (32 MiB). */
export const CHUNK = 32 << 20
/** Network errors in a row before the download stops (it continues where it stopped next time). */
const RETRIES = 4
/** 429 answers in a row before it stops. */
const RATE_RETRIES = 6

export const chunkPath = (path: string, i: number) => `${path}/part-${String(i).padStart(4, '0')}`
const chunkCount = (bytes: number, size: number) => Math.max(1, Math.ceil(bytes / size))

/** Seconds to wait after a 429: RateLimit's `t=` (IETF draft, as HF sends it), else Retry-After, else 60; at most 300. */
export function rateLimitWait(h: Headers): number {
  const rl = h.get('ratelimit')
  const t = rl ? /(?:^|;)\s*t=(\d+)/.exec(rl) : null
  const ra = h.get('retry-after')
  const s = t ? Number(t[1]) : ra && /^\d+$/.test(ra.trim()) ? Number(ra.trim()) : 60
  return Math.min(300, Math.max(1, s))
}

export interface HfProgress extends Progress {
  /** The file being downloaded (its name). */
  file?: string
  /** Bytes found already downloaded when this install started (a resumed download). */
  resumed?: number
  /** Waiting for Hugging Face's rate limit, or before retrying after a network error: seconds. */
  waiting?: number
  /** Why it waits. */
  reason?: 'rate-limit' | 'network'
}

/** Bytes of a model's files already kept (from an install that stopped part way), and its total. Reads only. */
export async function partialDownload(m: ModelEntry, files: ModelFile[], env: StoreEnv = defaultEnv()): Promise<{ done: number; total: number }> {
  const total = filesBytes(files)
  if (deliveryOf(m) !== 'huggingface' || !m.source.revision) return { done: 0, total }
  let done = 0
  try {
    const cache = await env.caches.open(CACHE)
    for (const f of files) {
      const base = cachePath(m, f)
      for (let i = 0; i < chunkCount(f.bytes, env.chunk ?? CHUNK); i++) {
        const r = await cache.match(url(env, chunkPath(base, i)))
        if (!r) break
        done += Number(r.headers.get('Content-Length') ?? 0)
      }
    }
  } catch {
    done = 0
  }
  return { done, total }
}

/** Says plainly when the device hasn't room for `need` more bytes (Storage API estimate; skipped where unknown). */
async function checkSpace(env: StoreEnv, need: number) {
  let est: StorageEstimate | null = null
  try {
    est = (await env.storage?.estimate?.()) ?? null
  } catch {
    est = null
  }
  if (!est || typeof est.quota !== 'number' || typeof est.usage !== 'number') return
  const free = est.quota - est.usage
  // A margin for the browser's own bookkeeping.
  const want = need + Math.max(64e6, need * 0.03)
  if (free < want) {
    throw new SpaceError(`There isn’t enough storage space: the download needs about ${formatBytes(want)}, and this browser lets LightBench use about ${formatBytes(Math.max(0, free))} more on this device. Free some disk space (or remove other AI models in Settings → AI models) and try again.`)
  }
}

/** One file from Hugging Face, kept in parts, resumed from the parts already kept; returns its part count. */
async function downloadHfFile(env: StoreEnv, cache: Cache, m: ModelEntry, f: ModelFile, onBytes: (n: number, p: Partial<HfProgress>) => void, signal?: AbortSignal): Promise<number> {
  const base = cachePath(m, f)
  const size = env.chunk ?? CHUNK
  const n = chunkCount(f.bytes, size)
  const partSize = (i: number) => Math.min(size, f.bytes - i * size)
  let hash = new Sha256()
  let have = 0
  // The parts already here, in order; anything after the first gap (or a part of the wrong size) is dropped.
  for (; have < n; have++) {
    const r = await cache.match(url(env, chunkPath(base, have)))
    if (!r) break
    const b = new Uint8Array(await r.arrayBuffer())
    if (b.length !== partSize(have)) {
      await cache.delete(url(env, chunkPath(base, have)))
      break
    }
    hash.update(b)
  }
  for (let i = have; i < n; i++) await cache.delete(url(env, chunkPath(base, i)))
  const dropAll = async () => {
    for (let i = 0; i < n; i++) await cache.delete(url(env, chunkPath(base, i)))
  }

  const src = sourceUrl(m, f)
  let fails = 0
  let limited = 0
  while (have < n) {
    if (signal?.aborted) throw abortError()
    const start = have * size
    let r: Response
    try {
      r = await env.fetch(src, { signal, cache: 'no-store', credentials: 'omit', headers: start ? { Range: `bytes=${start}-` } : {} })
    } catch (e) {
      if ((e as Error).name === 'AbortError' || signal?.aborted) throw abortError()
      if (++fails > RETRIES) throw new Error(`The connection to Hugging Face failed (${(e as Error).message}). What was downloaded is kept: Download continues where it stopped.`)
      const wait = 2 ** fails
      onBytes(0, { waiting: wait, reason: 'network' })
      await sleep(env, wait * 1000, signal)
      continue
    }
    if (r.status === 429) {
      await r.body?.cancel().catch(() => {})
      if (++limited > RATE_RETRIES) throw new Error('Hugging Face kept asking LightBench to wait (too many downloads from this network). What was downloaded is kept: try again in a few minutes.')
      const wait = rateLimitWait(r.headers)
      onBytes(0, { waiting: wait, reason: 'rate-limit' })
      await sleep(env, wait * 1000, signal)
      continue
    }
    limited = 0
    let at = start
    if (start && r.status === 200) {
      // The server sent the whole file instead of the rest: start this file again from its first byte.
      await dropAll()
      hash = new Sha256()
      onBytes(-start, {})
      have = 0
      at = 0
    } else if (start ? r.status !== 206 : !r.ok) {
      await r.body?.cancel().catch(() => {})
      throw new Error(`Hugging Face answered HTTP ${r.status} for ${f.path}.`)
    } else if (start) {
      const cr = r.headers.get('content-range')
      const got = cr ? /^bytes (\d+)-/.exec(cr) : null
      if (got && Number(got[1]) !== start) {
        await r.body?.cancel().catch(() => {})
        throw new Error(`Hugging Face sent the wrong part of ${f.path}.`)
      }
    }
    if (!r.body) throw new Error('The download has no body.')
    const reader = r.body.getReader()
    let part = new Uint8Array(partSize(have))
    let fillAt = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (signal?.aborted) throw abortError()
        if (done) break
        let v = value
        while (v.length) {
          if (have >= n) throw new IntegrityError(`${f.path} is larger than expected (${formatBytes(f.bytes)}): it was not kept.`)
          const take = Math.min(v.length, part.length - fillAt)
          part.set(v.subarray(0, take), fillAt)
          fillAt += take
          at += take
          v = v.subarray(take)
          onBytes(take, {})
          if (fillAt === part.length) {
            await cache.put(url(env, chunkPath(base, have)), new Response(part, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(part.length) } }))
            hash.update(part)
            have++
            fails = 0
            fillAt = 0
            if (have < n) part = new Uint8Array(partSize(have))
          }
        }
      }
    } catch (e) {
      await reader.cancel().catch(() => {})
      // The part being filled is lost; the kept ones stay.
      onBytes(-fillAt, {})
      if (e instanceof IntegrityError) {
        await dropAll()
        throw e
      }
      if ((e as Error).name === 'AbortError' || signal?.aborted) throw abortError()
      if (++fails > RETRIES) throw new Error(`The download from Hugging Face was interrupted (${(e as Error).message}). What was downloaded is kept: Download continues where it stopped.`)
      const wait = 2 ** fails
      onBytes(0, { waiting: wait, reason: 'network' })
      await sleep(env, wait * 1000, signal)
      continue
    }
    if (have < n) {
      // The answer ended early (the connection dropped): ask for the rest.
      onBytes(-fillAt, {})
      if (++fails > RETRIES) throw new Error(`The download of ${f.path} kept stopping early. What was downloaded is kept: Download continues where it stopped.`)
      const wait = 2 ** fails
      onBytes(0, { waiting: wait, reason: 'network' })
      await sleep(env, wait * 1000, signal)
    }
  }
  const got = hash.hex()
  if (got !== f.sha256) {
    await dropAll()
    throw new IntegrityError(`${f.path} doesn’t match its SHA-256 (got ${got.slice(0, 12)}…, expected ${f.sha256!.slice(0, 12)}…): it was not kept.`)
  }
  return n
}

/**
 * Installs a model delivered from Hugging Face: the runtime from LightBench's own site if it isn't here, then each
 * file from Hugging Face, resumed where an earlier try stopped, each checked against its size and SHA-256. Call only
 * after the user agreed. Nothing is recorded as installed unless every file matched.
 */
export async function installHf(info: AiInfo, m: ModelEntry, files: ModelFile[], onProgress: (p: HfProgress) => void = () => {}, signal?: AbortSignal, env: StoreEnv = defaultEnv()): Promise<InstalledModel> {
  if (!m.source.revision || !files.length || files.some((f) => !f.sha256)) throw new Error(`${m.name} isn’t available in this build of LightBench.`)
  const cache = await env.caches.open(CACHE)
  const needRuntime = !(await runtimeHere(env, cache, info))
  const runtimeItem: DownloadItem = { what: 'runtime', path: info.runtime.wasm.path, bytes: info.runtime.wasm.bytes, sha256: info.runtime.wasm.sha256 }
  const partial = await partialDownload(m, files, env)
  const total = partial.total + (needRuntime ? runtimeItem.bytes : 0)
  await checkSpace(env, total - partial.done)
  // Ask the browser to keep the site's storage before 1.24 GB goes in (Chromium decides by itself, without a prompt).
  await env.storage?.persist?.().catch(() => false)
  let done = partial.done
  onProgress({ done, total, what: 'model', resumed: partial.done })
  if (needRuntime) {
    const buf = await fetchChecked(env, runtimeItem, (n) => {
      done += n
      onProgress({ done, total, what: 'runtime' })
    }, signal)
    await cache.put(url(env, runtimeItem.path), new Response(buf, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.byteLength) } }))
  }
  const kept: InstalledFile[] = []
  for (const f of files) {
    const chunks = await downloadHfFile(env, cache, m, f, (n, extra) => {
      done += n
      onProgress({ done, total, what: 'model', file: f.path, ...extra })
    }, signal)
    kept.push({ ...(f.part ? { part: f.part } : {}), path: cachePath(m, f), bytes: f.bytes, sha256: f.sha256!, chunks })
  }
  const rec = await readRecord(env, cache)
  const largest = kept.reduce((a, b) => (b.bytes > a.bytes ? b : a))
  const entry: InstalledModel = {
    id: m.id,
    variant: files[0].variant,
    revision: m.source.revision,
    model: { path: largest.path, bytes: largest.bytes, sha256: largest.sha256 },
    runtime: { path: info.runtime.wasm.path, bytes: info.runtime.wasm.bytes, sha256: info.runtime.wasm.sha256 },
    files: kept,
    at: Date.now(),
  }
  // Files of another revision of this model go (their keys hold the commit).
  const prefix = url(env, `models/${m.id}/`)
  const mine = new Set(kept.flatMap((f) => Array.from({ length: f.chunks ?? 0 }, (_, i) => url(env, chunkPath(f.path, i)))))
  for (const k of await cache.keys()) if (k.url.startsWith(prefix) && !mine.has(k.url)) await cache.delete(k)
  await writeRecord(env, cache, { models: [...rec.models.filter((x) => x.id !== m.id), entry] })
  await env.storage?.persist?.().catch(() => false)
  return entry
}

/** One file of an installed model from Hugging Face, put together from its parts and checked against its SHA-256. */
export async function loadPart(m: ModelEntry, part: string, env: StoreEnv = defaultEnv()): Promise<{ model: ArrayBuffer; wasm: ArrayBuffer; rec: InstalledModel; file: InstalledFile }> {
  const rec = await installed(m, env)
  if (!rec?.files) throw new Error(`${m.name} isn’t on this device.`)
  const file = rec.files.find((f) => f.part === part)
  if (!file) throw new Error(`${m.name} has no ${part} file on this device.`)
  const cache = await env.caches.open(CACHE)
  const missing = () => new Error(`${m.name}’s files are missing on this device. Download it again in Settings → AI models.`)
  const out = new Uint8Array(file.bytes)
  let at = 0
  for (let i = 0; i < (file.chunks ?? 0); i++) {
    const r = await cache.match(url(env, chunkPath(file.path, i)))
    if (!r) throw missing()
    const b = new Uint8Array(await r.arrayBuffer())
    if (at + b.length > out.length) throw new IntegrityError(`${m.name}’s files on this device are damaged. Remove it in Settings → AI models and download it again.`)
    out.set(b, at)
    at += b.length
  }
  const damaged = () => new IntegrityError(`${m.name}’s files on this device are damaged. Remove it in Settings → AI models and download it again.`)
  if (at !== file.bytes || (await sha256Hex(out)) !== file.sha256) throw damaged()
  const w = await cache.match(url(env, rec.runtime.path))
  if (!w) throw missing()
  const wasm = await w.arrayBuffer()
  if ((await sha256Hex(wasm)) !== rec.runtime.sha256) throw damaged()
  return { model: out.buffer, wasm, rec, file }
}

/** The installed files' bytes, checked against their SHA-256 again (a damaged cache entry is reported, not used). */
export async function load(m: ModelEntry, env: StoreEnv = defaultEnv()): Promise<{ model: ArrayBuffer; wasm: ArrayBuffer; rec: InstalledModel }> {
  const rec = await installed(m, env)
  if (!rec) throw new Error(`${m.name} isn’t on this device.`)
  const cache = await env.caches.open(CACHE)
  const get = async (p: { path: string; sha256: string }) => {
    const r = await cache.match(url(env, p.path))
    if (!r) throw new Error(`${m.name}’s files are missing on this device. Download it again in Settings → AI models.`)
    const buf = await r.arrayBuffer()
    if ((await sha256Hex(buf)) !== p.sha256) throw new IntegrityError(`${m.name}’s files on this device are damaged. Remove it in Settings → AI models and download it again.`)
    return buf
  }
  return { model: await get(rec.model), wasm: await get(rec.runtime), rec }
}

/** Removes a model from this device; the runtime too when no other model uses it. */
export async function remove(m: ModelEntry, env: StoreEnv = defaultEnv()): Promise<void> {
  const cache = await env.caches.open(CACHE)
  const rec = await readRecord(env, cache)
  const mine = rec.models.find((x) => x.id === m.id)
  const rest = rec.models.filter((x) => x.id !== m.id)
  if (mine) await cache.delete(url(env, mine.model.path))
  // Files of this model left by an interrupted install (any variant of the manifest's revision), and every part kept
  // from Hugging Face (a stopped download included).
  for (const f of m.files) if (m.source.revision && deliveryOf(m) === 'site') await cache.delete(url(env, `models/${m.id}/${m.source.revision.slice(0, 7)}/${f.variant}.onnx`))
  const prefix = url(env, `models/${m.id}/`)
  for (const k of await cache.keys()) if (k.url.startsWith(prefix)) await cache.delete(k)
  if (!rest.length) {
    for (const k of await cache.keys()) await cache.delete(k)
    return
  }
  await writeRecord(env, cache, { models: rest })
}

/** Bytes the cache holds (models and runtime). Reads only. */
export async function usage(env: StoreEnv = defaultEnv()): Promise<number> {
  try {
    const cache = await env.caches.open(CACHE)
    let n = 0
    for (const k of await cache.keys()) {
      const r = await cache.match(k)
      n += Number(r?.headers.get('Content-Length') ?? 0)
    }
    return n
  } catch {
    return 0
  }
}
