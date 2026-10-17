// The AI models kept on this device (docs/PHASE3.md Part 24; owner's decision 2026-10-17): downloaded once, only when
// the user says so, checked against the SHA-256 compiled into the app (ai/manifest.ts), kept in Cache Storage, used
// offline afterwards and removable in Settings.
//
// The cache is "ai-models", not a "lightbench-…" cache: the service worker deletes those on every update (sw.ts), and
// it never serves from this one (the app reads it itself). A record of what is installed sits in the same cache.
// Nothing in this file is called before the user's opt-in except `installed` and `usage`, which only read the cache.

import { downloadPlan, formatBytes, sha256Hex, type AiInfo, type DownloadItem, type ModelEntry, type ModelFile, type Variant } from './manifest'

export const CACHE = 'ai-models'
const RECORD = 'installed.json'

export interface InstalledModel {
  id: string
  variant: Variant
  revision: string
  /** Paths relative to the site root, as in the manifest. */
  model: { path: string; bytes: number; sha256: string }
  runtime: { path: string; bytes: number; sha256: string }
  at: number
}

type Record_ = { models: InstalledModel[] }

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrityError'
  }
}

/** Seams for tests: Cache Storage, fetch and the site root. */
export interface StoreEnv {
  caches: CacheStorage
  fetch: typeof fetch
  base: string
}

const defaultEnv = (): StoreEnv => ({
  caches: globalThis.caches,
  fetch: (...a) => globalThis.fetch(...a),
  base: new URL(import.meta.env?.BASE_URL ?? '/', globalThis.location?.href ?? 'http://localhost/').href,
})

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
  if (rec.revision !== m.source.revision || !m.files.some((f) => f.variant === rec.variant && f.sha256 === rec.model.sha256)) return null
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
  // Files of this model left by an interrupted install (any variant of the manifest's revision).
  for (const f of m.files) if (m.source.revision) await cache.delete(url(env, `models/${m.id}/${m.source.revision.slice(0, 7)}/${f.variant}.onnx`))
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
