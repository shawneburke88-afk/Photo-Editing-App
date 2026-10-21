// Import scheduling (owner's decisions of 2026-10-20, docs/PHASE3.md "Import speed"): which files are imported, in
// which order, and how a few copies run at once while every result is still added to the library in one fixed order.
// Pure, so the order and the pool are unit-tested (schedule.test.ts).
//
// - Capture order (as the sequential import): photos sorted by capture time (else file time), then name. A photo's
//   position in it is its number for "Date + number" and "Custom name + number" names, so renaming is unchanged.
// - RAW first: with RAW+JPEG pairs stacked, every photo but the JPEG twins comes first (in capture order), then the
//   JPEG twins (in capture order), so the RAWs show in the Library while the JPEGs are still being copied.
// - Names: two photos that would write the same file name in one folder (the photo, its sidecar, or the backup copy and
//   its sidecar) are a "clash": the earlier in capture order must finish first, so it keeps the plain name and the other
//   gets the numbered one (`-1`), exactly as one at a time. A photo is never started before an earlier photo it clashes
//   with is done; when RAW first would put that earlier photo later, it is moved up instead (rare: e.g. two cameras'
//   DSC_0001.JPG on the same day).
// - The pool: up to `workers()` photos are copied at once, started in the execution order; their results are committed
//   (added to the library) strictly in that order, so ids, progress and "Stop" behave as one at a time; photos copied
//   by then go in together (one catalog transaction instead of one each). At most `window` photos are started past
//   the oldest one not yet committed, which bounds what waits in memory.

import { isJpegName, pairTwins } from '../catalog/stacks'
import { fullSidecarName, stemSidecarName } from '../sidecar/naming'

/** What the planner needs to know about a photo (in capture order). */
export interface PlanItem {
  /** Folder on the card. */
  dir: string
  /** Name on the card. */
  name: string
  /** Capture time (s), 0 when unknown. */
  capturedAt: number
  /** Destination folder (dated) and the wanted file name there. */
  folder: string
  wanted: string
  /** Owns `NAME.xmp` among its twins (sidecar/naming.ts). */
  owner: boolean
}

export interface ImportPlan {
  /** Capture-order indices in the order they are copied. */
  order: number[]
  /** For each item (capture order): the items (capture order) that must be done before it starts. */
  deps: number[][]
  /** RAW+JPEG twins in this import (both directions), when stacking. */
  twin: Map<number, number>
  /** Item → 1 (first pass) or 2 (JPEG twins, after the RAWs). */
  phase: (1 | 2)[]
}

/** Sorts photos into capture order (capture time, else the file's time; then name), as the sequential import did. */
export function captureOrder<T>(items: T[], time: (t: T) => number, name: (t: T) => string): T[] {
  return [...items].sort((a, b) => time(a) - time(b) || name(a).localeCompare(name(b)))
}

/**
 * RAW only: drops each JPEG that has a RAW twin among `items` (catalog/stacks.ts pairTwins: the same name in the same
 * folder, or the same name on the card and capture time). Returns the photos kept and the JPEGs skipped.
 */
export function rawOnly<T>(items: T[], key: (t: T) => { dir: string; name: string; capturedAt: number }): { kept: T[]; skipped: T[] } {
  const twins = new Set(pairTwins(items.map((it) => {
    const k = key(it)
    return { group: k.dir, name: k.name, capturedAt: k.capturedAt }
  })).map(([, j]) => j))
  return { kept: items.filter((_, i) => !twins.has(i)), skipped: items.filter((_, i) => twins.has(i)) }
}

/** Every file name a photo may write: in the destination folder and (with a backup) in the backup folder. */
function clashKeys(it: PlanItem, backup: boolean): string[] {
  const keys = [`d/${it.folder}/${it.wanted}`, `d/${it.folder}/${fullSidecarName(it.wanted)}`]
  if (it.owner) keys.push(`d/${it.folder}/${stemSidecarName(it.wanted)}`)
  if (backup) {
    keys.push(`b/${it.name}`, `b/${fullSidecarName(it.name)}`)
    if (it.owner) keys.push(`b/${stemSidecarName(it.name)}`)
  }
  // Folders and names ignoring case: Windows and macOS disks don't tell DSC_0001.JPG from dsc_0001.jpg.
  return keys.map((k) => k.toLowerCase())
}

/**
 * Plans an import of `items` (in capture order). `rawFirst`: the JPEG twins go after everything else (only when
 * `stackPairs`, as the owner asked). `backup`: the backup copies' names count for clashes too.
 */
export function planImport(items: PlanItem[], opts: { stackPairs: boolean; rawFirst: boolean; backup: boolean }): ImportPlan {
  const twin = new Map<number, number>()
  if (opts.stackPairs) {
    for (const [r, j] of pairTwins(items.map((it) => ({ group: it.dir, name: it.name, capturedAt: it.capturedAt })))) {
      twin.set(r, j)
      twin.set(j, r)
    }
  }
  const phase = items.map((it, i): 1 | 2 => (opts.stackPairs && opts.rawFirst && twin.has(i) && isJpegName(it.name) ? 2 : 1))
  // Clashes: each item waits for the previous item (capture order) sharing any name with it.
  const last = new Map<string, number>()
  const deps = items.map((it, i) => {
    const d = new Set<number>()
    for (const k of clashKeys(it, opts.backup)) {
      const prev = last.get(k)
      if (prev !== undefined) d.add(prev)
      last.set(k, i)
    }
    return [...d].sort((a, b) => a - b)
  })
  // An item an earlier-phase item waits for moves up to that phase. Dependencies always point back in capture order,
  // so one pass from the end settles it, and sorting by (phase, capture index) keeps every dependency first.
  const eff = [...phase] as number[]
  for (let i = items.length - 1; i >= 0; i--) for (const d of deps[i]) eff[d] = Math.min(eff[d], eff[i])
  const order = items.map((_, i) => i).sort((a, b) => eff[a] - eff[b] || a - b)
  return { order, deps, twin, phase: eff as (1 | 2)[] }
}

export interface PoolOptions<R> {
  /** Capture-order indices in execution order (ImportPlan.order). */
  order: number[]
  /** ImportPlan.deps. */
  deps: number[][]
  /** How many may run at once now (read before each start, so it can follow the CPU budget). */
  workers: () => number
  /** At most this many started past the oldest not yet committed (default 2 × workers). */
  window?: number
  /** Copies one item. Should not throw: failures are part of its result. */
  run: (index: number) => Promise<R>
  /**
   * Called with the finished items, strictly in execution order: consecutive finished items together (up to
   * `maxBatch`, default 1), so the library can add them in one transaction.
   */
  commit: (batch: { index: number; result: R }[]) => Promise<void>
  maxBatch?: number
  /** Whether `index` may join a batch holding `batch` (default: yes). */
  joins?: (batch: number[], index: number) => boolean
  /** Stops starting new items (the ones running finish and are committed). */
  signal?: AbortSignal
  /** Called when the number of workers may have changed (e.g. a CPU-budget change); wakes the pool. */
  onWake?: (wake: () => void) => () => void
}

/**
 * Runs the items a few at a time and commits their results in order. Resolves with how many were started (all of them
 * were committed). An item starts only after the items it depends on were committed.
 */
export function runOrdered<R>(o: PoolOptions<R>): Promise<number> {
  const pos = new Map(o.order.map((idx, p) => [idx, p]))
  const results = new Map<number, R>()
  let next = 0 // next position to start
  let committed = 0 // positions committed so far
  let running = 0
  let committing = false
  let done = false
  return new Promise<number>((resolve, reject) => {
    const unsubscribe = o.onWake?.(() => pump())
    const finish = () => {
      if (done) return
      done = true
      unsubscribe?.()
      resolve(next)
    }
    const stopped = () => !!o.signal?.aborted
    const depsDone = (idx: number) => o.deps[idx].every((d) => {
      const p = pos.get(d)
      return p === undefined || p < committed
    })
    const pump = () => {
      if (done) return
      const width = Math.max(1, o.workers())
      const window = o.window ?? width * 2
      while (!stopped() && next < o.order.length && running < width && next - committed < window && depsDone(o.order[next])) {
        const p = next++
        const idx = o.order[p]
        running++
        o.run(idx).then(
          (r) => {
            results.set(p, r)
            running--
            void drain()
          },
          (e: unknown) => {
            done = true
            unsubscribe?.()
            reject(e)
          },
        )
      }
      if (committed === next && running === 0 && (stopped() || next === o.order.length)) finish()
    }
    const drain = async () => {
      if (committing) return
      committing = true
      try {
        while (results.has(committed)) {
          const batch: { index: number; result: R }[] = []
          let p = committed
          while (results.has(p) && batch.length < (o.maxBatch ?? 1) && (!batch.length || (o.joins?.(batch.map((b) => b.index), o.order[p]) ?? true))) {
            batch.push({ index: o.order[p], result: results.get(p) as R })
            results.delete(p)
            p++
          }
          await o.commit(batch)
          committed = p
        }
      } catch (e) {
        done = true
        unsubscribe?.()
        reject(e)
        return
      } finally {
        committing = false
      }
      pump()
    }
    o.signal?.addEventListener('abort', () => pump())
    pump()
  })
}
