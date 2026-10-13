// The retouch worker: applies spots to tiles of the scene (run.ts) and picks sources (pick.ts) off the main thread.

import type { Spot, SpotPx, PxRect } from '../develop/spots'
import type { Completion } from './patchmatch'
import { pickSource } from './pick'
import { runSpots } from './run'
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

export type RetouchReply =
  | { id: number; kind: 'progress'; spot: number; fraction: number }
  | { id: number; kind: 'run'; tiles: HalfTile[]; completions: [string, Completion][] }
  | { id: number; kind: 'pick'; offset: [number, number] }
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
