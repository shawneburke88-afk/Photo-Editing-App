// The retouch worker: applies spots to tiles of the scene (run.ts) and picks sources (pick.ts) off the main thread. It
// also cuts out the inputs of the Remove fills a spot list needs (`prepare`), which the page then computes on several
// workers (fill-pool.ts; PHASE3.md, Part 22) and passes back with `run`.

import type { Spot, SpotPx, PxRect } from '../develop/spots'
import type { Completion } from './completion'
import { pickSource } from './pick'
import { fillJobs, runSpots, type FillJob } from './run'
import { TileImage, type HalfTile } from './tiles'

export type RetouchRequest =
  | {
      id: number
      kind: 'run'
      w: number
      h: number
      spots: Spot[]
      tiles: HalfTile[]
      canonical: HalfTile[] | null
      completions: [string, Completion][]
    }
  | { id: number; kind: 'pick'; w: number; h: number; tiles: HalfTile[]; region: PxRect; spot: SpotPx; bounds: PxRect; others: SpotPx[] }
  | { id: number; kind: 'prepare'; w: number; h: number; spots: Spot[]; canonical: HalfTile[]; cached: string[] }

export type RetouchReply =
  | { id: number; kind: 'progress'; spot: number; fraction: number }
  | { id: number; kind: 'run'; tiles: HalfTile[]; completions: [string, Completion][] }
  | { id: number; kind: 'pick'; offset: [number, number] }
  | { id: number; kind: 'prepare'; jobs: FillJob[] }
  | { id: number; kind: 'error'; message: string }

const post = (m: RetouchReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)

self.onmessage = (e: MessageEvent<RetouchRequest>) => {
  const m = e.data
  try {
    if (m.kind === 'pick') {
      const img = new TileImage(m.w, m.h, m.tiles)
      post({ id: m.id, kind: 'pick', offset: pickSource({ region: m.region, image: img.read(m.region), spot: m.spot, bounds: m.bounds, others: m.others }) })
      return
    }
    if (m.kind === 'prepare') {
      const cached = new Set(m.cached)
      const jobs = fillJobs(new TileImage(m.w, m.h, m.canonical), m.spots, (k) => cached.has(k))
      post({ id: m.id, kind: 'prepare', jobs }, jobs.flatMap((j) => [j.input.image.buffer as ArrayBuffer, j.input.hole.buffer as ArrayBuffer]))
      return
    }
    const img = new TileImage(m.w, m.h, m.tiles)
    const canonical = m.canonical ? new TileImage(m.w, m.h, m.canonical) : null
    let last = 0
    const computed = runSpots(img, m.spots, {
      canonical,
      completions: new Map(m.completions),
      onProgress: (spot, fraction) => {
        const now = performance.now()
        if (now - last < 100) return
        last = now
        post({ id: m.id, kind: 'progress', spot, fraction })
      },
    })
    const pristine = new Map(m.tiles.map((t) => [t.idx, t.data]))
    const tiles = img.written(pristine)
    const completions = [...computed]
    const transfer: Transferable[] = tiles.map((t) => t.data.buffer as ArrayBuffer)
    for (const [, c] of completions) transfer.push(c.centres.buffer as ArrayBuffer, c.sources.buffer as ArrayBuffer, c.weights.buffer as ArrayBuffer)
    post({ id: m.id, kind: 'run', tiles, completions }, transfer)
  } catch (err) {
    post({ id: m.id, kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
