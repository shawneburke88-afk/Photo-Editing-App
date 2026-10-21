/// <reference lib="webworker" />
// LightBench's service worker. It does two jobs, because only one service worker can control the site:
//
// 1. Cross-origin isolation. GitHub Pages cannot send the COOP/COEP headers that make the page
//    `crossOriginIsolated` (needed for SharedArrayBuffer, i.e. WebAssembly threads), so every response
//    this worker serves gets them added, as coi-serviceworker (MIT, Guido Zuidhof and contributors) did
//    before. This replaces coi-serviceworker; its header logic is reproduced in `isolate` below.
// 2. Offline use. Installing it downloads the whole app (code, CSS, icons, and every WebAssembly and
//    worker file) into one cache per build, and the app is served from that cache from then on, online
//    or not. Photos and the catalog already live on the user's computer (folders, OPFS).
//
// Updates: a new build installs in the background and then waits. The page shows "Update ready" with
// the new build's notes, and only the user's Reload click activates it (src/pwa/register.ts). On the
// first visit, and when replacing coi-serviceworker, it takes over at once instead (nothing to wait for).
//
// Built by the `serviceWorker` plugin in vite.config.ts, which fills in the placeholders below. Not used by
// the dev server (`npx vite` sends COOP/COEP itself).

import type { BuildInfo } from './notes'

declare const self: ServiceWorkerGlobalScope

/** Every file of this build (paths relative to this worker) with the start of its SHA-256. */
declare const __LB_PRECACHE__: { url: string; rev: string }[]
/** One name per build, so an update never mixes files of two versions. */
declare const __LB_CACHE__: string
declare const __LB_BUILD__: BuildInfo

const CACHE_PREFIX = 'lightbench-'
const PRECACHE = __LB_PRECACHE__.map(({ url, rev }) => ({ url: new URL(url, self.location.href).href, rev }))
const SCOPE = new URL(self.registration.scope)
const INDEX = new URL('index.html', SCOPE).href

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await precache()
      // An earlier LightBench worker keeps running until the user clicks Reload. With no worker yet, or
      // with coi-serviceworker (headers only, no cache, a different script URL), take over now.
      const active = self.registration.active
      if (!active || active.scriptURL !== self.location.href) await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(CACHE_PREFIX) && name !== __LB_CACHE__) await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  const type = (event.data as { type?: string } | null)?.type
  if (type === 'skip-waiting') void self.skipWaiting()
  else if (type === 'build-info') event.ports[0]?.postMessage(__LB_BUILD__)
  // Messages from coi-serviceworker's page script ("coepCredentialless", "deregister") may still arrive
  // from a tab opened before the switch; they are ignored.
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  // As coi-serviceworker: these requests can't be answered by a service worker.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return
  // AI Remove's model downloads and update check (PHASE3.md Part 26): CORS requests to Hugging Face, 1.24 GB with
  // Range requests, kept by the app itself. Left to the browser, untouched (they need no isolation headers).
  if (isHuggingFace(request.url)) return
  event.respondWith(respond(request).then(isolate))
})

function isHuggingFace(u: string): boolean {
  try {
    const h = new URL(u).hostname
    return h === 'huggingface.co' || h.endsWith('.huggingface.co') || h.endsWith('.hf.co')
  } catch {
    return false
  }
}

async function respond(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return fetch(request)
  // The app is one page: opening it (with any query, e.g. a launched file) gives this build's index.html,
  // so nothing changes until the user takes an update.
  if (request.mode === 'navigate' && (url.pathname === SCOPE.pathname || url.href.split(/[?#]/)[0] === INDEX)) {
    const page = await (await caches.open(__LB_CACHE__)).match(INDEX)
    if (page) return page
  }
  return (await cached(request)) ?? fetch(request)
}

/** This build's copy, else one from a build still open in another tab (its files are deleted at activation). */
async function cached(request: Request): Promise<Response | undefined> {
  const names = (await caches.keys()).filter((n) => n.startsWith(CACHE_PREFIX))
  for (const name of [__LB_CACHE__, ...names.filter((n) => n !== __LB_CACHE__)]) {
    const hit = await (await caches.open(name)).match(request, { ignoreVary: true })
    if (hit) return hit
  }
  return undefined
}

/** Adds the headers that make the page cross-origin isolated (coi-serviceworker's require-corp mode). */
function isolate(response: Response): Response {
  if (response.status === 0) return response // opaque: headers can't be changed
  const headers = new Headers(response.headers)
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/**
 * Fills this build's cache. Files unchanged since the previous build are copied from its cache; the rest
 * are downloaded past the HTTP cache. Each file must match the hash recorded at build time, so a deploy
 * still in progress (new sw.js, old files) fails the install and the browser tries again later.
 */
async function precache() {
  const cache = await caches.open(__LB_CACHE__)
  const older = (await caches.keys()).filter((n) => n.startsWith(CACHE_PREFIX) && n !== __LB_CACHE__)
  await Promise.all(
    PRECACHE.map(async ({ url, rev }) => {
      if (await cache.match(url)) return // from an earlier, interrupted attempt at this same build
      for (const name of older) {
        const hit = await (await caches.open(name)).match(url)
        if (hit && (await revision(hit.clone())) === rev) return cache.put(url, hit)
      }
      const response = await fetch(url, { cache: 'reload' })
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
      if ((await revision(response.clone())) !== rev) throw new Error(`${url} does not match this build`)
      await cache.put(url, response)
    }),
  )
}

/** First 16 hex digits of the SHA-256 of a response body (the build computes the same). */
async function revision(response: Response): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer()))
  return [...digest.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
