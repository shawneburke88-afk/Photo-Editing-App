// The Lensfun database, downloaded the first time a photo needs it and then kept for offline use (owner's
// decision, 2026-10-12). It is LightBench's own pinned copy (web/lensfun/, converted to one JSON file by
// web/lensfun-plugin.ts), served next to the app but left out of the service worker's precache, so installing
// LightBench doesn't download it. After the first download it lives in the browser's Cache Storage under
// "lensfun-data" (not a "lightbench-" cache, which the service worker deletes on every update); a newer copy has
// a new file name, and the old one is then removed.

import { LensfunDb } from './lensfun'
import type { LensfunData } from './lensfun-xml'

/** Which copy this build uses (filled in by web/lensfun-plugin.ts). */
export const LENSFUN_INFO: LensfunInfo | null = typeof __LENSFUN_DB__ === 'undefined' ? null : __LENSFUN_DB__

const CACHE = 'lensfun-data'
/** After a failed download, wait this long before trying again on its own (the Lens section can retry at once). */
const RETRY_MS = 30_000

let db: LensfunDb | null = null
let pending: Promise<LensfunDb | null> | null = null
let failedAt = 0
const listeners = new Set<() => void>()

const publish = () => listeners.forEach((fn) => fn())

/** The database if it is loaded, 'loading', 'failed', or null when nothing asked for it yet. */
export function lensfunState(): LensfunDb | 'loading' | 'failed' | null {
  if (db) return db
  if (pending) return 'loading'
  return failedAt ? 'failed' : null
}

/** Calls `fn` whenever the state above changes. */
export function subscribeLensfun(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** Loads the database (from Cache Storage, else downloads it); null when it can't be had. */
export function loadLensfun(retry = false): Promise<LensfunDb | null> {
  if (db) return Promise.resolve(db)
  if (pending) return pending
  if (failedAt && !retry && Date.now() - failedAt < RETRY_MS) return Promise.resolve(null)
  pending = (async () => {
    try {
      if (!LENSFUN_INFO) throw new Error('This build has no lens data.')
      const url = new URL(`${import.meta.env.BASE_URL}${LENSFUN_INFO.file}`, location.href).href
      let response: Response | undefined
      let cache: Cache | null = null
      try {
        cache = await caches.open(CACHE)
        response = await cache.match(url)
      } catch {
        cache = null // Cache Storage unavailable (e.g. private mode): download each session.
      }
      if (!response) {
        response = await fetch(url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        if (cache) {
          await cache.put(url, response.clone()).catch(() => {})
          for (const old of await cache.keys()) if (old.url !== url) await cache.delete(old)
        }
      }
      db = new LensfunDb((await response.json()) as LensfunData)
      failedAt = 0
      return db
    } catch (e) {
      console.warn('Lensfun data unavailable:', e)
      failedAt = Date.now()
      return null
    } finally {
      pending = null
      publish()
    }
  })()
  publish()
  return pending
}
