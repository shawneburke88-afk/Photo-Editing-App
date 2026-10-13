// darktable's noise profiles, downloaded the first time noise reduction is used and then kept for offline use, the
// way the Lensfun data is (engine/lens/lens-db.ts): LightBench's own pinned copy (web/noiseprofiles/, converted to
// one compact JSON file by web/noiseprofiles-plugin.ts), served next to the app but left out of the service
// worker's precache. After the first download it lives in Cache Storage under "noiseprofile-data" (not a
// "lightbench-" cache, which the service worker deletes on every update); a newer copy has a new file name, and
// the old one is then removed.

import type { NoiseProfileData } from './noiseprofiles'

/** Which copy this build uses (filled in by web/noiseprofiles-plugin.ts). */
export const NOISE_PROFILES_INFO: NoiseProfilesInfo | null = typeof __NOISE_PROFILES__ === 'undefined' ? null : __NOISE_PROFILES__

const CACHE = 'noiseprofile-data'
/** After a failed download, wait this long before trying again on its own (the Detail group can retry at once). */
const RETRY_MS = 30_000

let data: NoiseProfileData | null = null
let pending: Promise<NoiseProfileData | null> | null = null
let failedAt = 0
const listeners = new Set<() => void>()

const publish = () => listeners.forEach((fn) => fn())

/** The profiles if loaded, 'loading', 'failed', or null when nothing asked for them yet. */
export function noiseProfilesState(): NoiseProfileData | 'loading' | 'failed' | null {
  if (data) return data
  if (pending) return 'loading'
  return failedAt ? 'failed' : null
}

/** Calls `fn` whenever the state above changes. */
export function subscribeNoiseProfiles(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** Testing: use these profiles instead of downloading them. */
export function setNoiseProfiles(d: NoiseProfileData | null) {
  data = d
  publish()
}

/** Loads the profiles (from Cache Storage, else downloads them); null when they can't be had. */
export function loadNoiseProfiles(retry = false): Promise<NoiseProfileData | null> {
  if (data) return Promise.resolve(data)
  if (pending) return pending
  if (failedAt && !retry && Date.now() - failedAt < RETRY_MS) return Promise.resolve(null)
  pending = (async () => {
    try {
      if (!NOISE_PROFILES_INFO) throw new Error('This build has no noise profiles.')
      const url = new URL(`${import.meta.env.BASE_URL}${NOISE_PROFILES_INFO.file}`, location.href).href
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
      data = (await response.json()) as NoiseProfileData
      failedAt = 0
      return data
    } catch (e) {
      console.warn('Noise profiles unavailable:', e)
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
