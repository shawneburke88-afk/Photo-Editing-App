// Registers LightBench's service worker (src/pwa/sw.ts) and tracks updates for the "Update ready" notice.
// Production builds only: the dev server sends COOP/COEP itself and has no sw.js.
//
// Reloads, as coi-serviceworker did, when the page isn't cross-origin isolated yet:
//  - first visit: the worker installs (downloading the app for offline use), takes control, page reloads;
//  - after Shift+Reload, which bypasses the worker for that one load.
// Replacing coi-serviceworker needs no reload: its page was already isolated and is already this version.

import { newReleases, releaseNotes, type BuildInfo, type Release } from './notes'

export type UpdateState =
  | { kind: 'none' }
  /** A new version is downloaded and waiting for the user's Reload. */
  | { kind: 'ready'; version: string; releases: Release[] }
  /** Another LightBench window took the update; this one still runs the old version. */
  | { kind: 'elsewhere' }

let state: UpdateState = { kind: 'none' }
let waiting: ServiceWorker | null = null
let applying = false
let registration: ServiceWorkerRegistration | null = null
const listeners = new Set<() => void>()

function set(next: UpdateState) {
  state = next
  for (const fn of listeners) fn()
}

export const updates = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  get: (): UpdateState => state,
  /** Reload into the new version (the only way an update is applied). */
  apply() {
    if (state.kind === 'ready' && waiting) {
      applying = true
      // The worker activates; `controllerchange` then reloads this page.
      waiting.postMessage({ type: 'skip-waiting' })
    } else {
      location.reload()
    }
  },
  /** Looks for a new version now (e.g. when the library was saved by a newer one); "Update ready" follows if found. */
  check() {
    void registration?.update().catch(() => {})
  },
}

/** Asks a worker for its version and release notes (null if it doesn't answer). */
function buildInfo(worker: ServiceWorker): Promise<BuildInfo | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(null), 3000)
    channel.port1.onmessage = (e: MessageEvent<BuildInfo>) => {
      clearTimeout(timer)
      resolve(e.data)
    }
    worker.postMessage({ type: 'build-info' }, [channel.port2])
  })
}

export function startServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return
  const sw = navigator.serviceWorker
  const url = new URL(`${import.meta.env.BASE_URL}sw.js`, location.href).href
  const ours = (w: ServiceWorker | null) => w?.scriptURL === url

  let reloading = false
  const reload = () => {
    if (reloading) return
    reloading = true
    location.reload()
  }

  let controller = sw.controller
  sw.addEventListener('controllerchange', () => {
    const previous = controller
    controller = sw.controller
    if (applying || !window.crossOriginIsolated) reload()
    else if (ours(previous)) set({ kind: 'elsewhere' })
  })

  const offer = async (worker: ServiceWorker) => {
    // Only an update from an earlier LightBench worker waits for the user (see sw.ts).
    if (!ours(sw.controller)) return
    waiting = worker
    const info = await buildInfo(worker)
    if (waiting !== worker) return
    set({ kind: 'ready', version: info?.version ?? '', releases: newReleases(info?.releases ?? [], releaseNotes) })
  }

  sw.register(url, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' }).then(
    (reg) => {
      registration = reg
      if (reg.active && !sw.controller && !window.crossOriginIsolated) return reload()
      if (reg.waiting) void offer(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && reg.waiting === worker) void offer(worker)
        })
      })
      // An installed app can stay open for days: look for a new version every hour too.
      setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000)
    },
    (e: Error) => console.error('LightBench service worker failed to register:', e),
  )
}
