import { describe, expect, it } from 'vitest'
import { CpuBudget } from '../cpu-budget'
import { complete, prepare, search, searchRange, solve, type Completion, type Level } from './completion'
import { FILL_CASES, SPOT_CASES, fingerprint, sceneTiles } from './fill-cases'
import { computeFills, FillWorkers, planFills, type FillPlan, type FillWorkerLike } from './fill-pool'
import { BLOCK, handleFillRequest, type FillReply, type FillRequest } from './fill-split'
import { fillJobs, runSpots } from './run'
import { TileImage } from './tiles'

// Remove on several workers (PHASE3.md, Part 22) must give exactly the fills of the single-worker code.

/**
 * Fingerprints of the fills and of runSpots' output on main 5307029 (0.6.0), before this change, for the cases in
 * fill-cases.ts: patch count and FNV-1a of the match field; for spot lists, fills made, the scene's pixels after the
 * spots and the fills.
 */
const MAIN: Record<string, string> = {
  'stripes, round hole, source': '988:78114c59',
  'stripes, round hole, no source': '988:03378043',
  'waves, deep hole, grid search': '3584:9297682e',
  'bricks, wire across': '1104:44399387',
  'noise, tiny hole': '64:226b12f0',
  'noise, one pixel': '49:0b0b63bf',
  'waves, hole at the top-left corner': '372:a2d5fc4b',
  'stripes, hole at the right edge': '416:086ecd9e',
  'bricks, hole at the bottom edge': '322:4a76ee70',
  'waves, several holes': '1640:78aa7873',
  'noise, source outside the window': '592:0aaedd7a',
  'stripes, blocked pixels': '772:d3c106d1',
  'waves, radius 2': '492:e178387a',
  'noise, all hole': '0:8f6284d4',
  'one Remove spot': '1:00ab2be9:5fc01b51',
  'Remove at the corner': '1:fefcc968:673df825',
  'tiny Remove spot': '1:e28535c0:8c4ccab2',
  'Remove, Heal, Remove overlapping': '2:6f49a335:31ee8419',
  'long Remove stroke (several chunks)': '2:941e02d6:1f201b0a',
  'Remove at opacity 0, then Remove at the right edge': '1:07c3fef0:50a4d398',
}

const print = (c: Completion) => `${c.centres.length}:${fingerprint(c.centres, c.sources, c.weights)}`

/** A fill worker run in this thread (its requests answered by the worker's own code, a task later). */
class InProcess implements FillWorkerLike {
  onmessage: ((e: MessageEvent<FillReply>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  terminated = false
  postMessage(m: FillRequest) {
    setTimeout(() => handleFillRequest(m, (r) => this.onmessage?.({ data: r } as MessageEvent<FillReply>)))
  }
  terminate() {
    this.terminated = true
  }
}

const inProcess = () => new FillWorkers(() => new InProcess(), 50)

describe('Remove fills: the same as main', () => {
  it('complete() gives main’s fills', () => {
    for (const c of FILL_CASES) expect(print(complete(c.input())), c.name).toBe(MAIN[c.name])
  }, 60000)

  it('runSpots gives main’s pixels and fills', () => {
    for (const c of SPOT_CASES) {
      const rgb = c.rgb()
      const img = new TileImage(c.w, c.h, sceneTiles(c.w, c.h, rgb))
      const computed = runSpots(img, c.spots, { canonical: new TileImage(c.w, c.h, sceneTiles(c.w, c.h, rgb)), completions: new Map() })
      const pix = img.read({ x0: 0, y0: 0, x1: c.w, y1: c.h })
      const fills = [...computed.values()].flatMap((f) => [f.centres, f.sources, f.weights])
      expect(`${computed.size}:${fingerprint(pix)}:${fingerprint(...fills)}`, c.name).toBe(MAIN[c.name])
    }
  }, 60000)
})

describe('the patch search split', () => {
  it('gives the serial matches whatever the split and its order', () => {
    // Every search done in blocks, last block first: each patch's search is independent of the others.
    const backwards = (L: Level, r: number, il: [number, number] | null, around: number) => {
      const n = L.centres.length
      for (let j0 = Math.floor((n - 1) / BLOCK) * BLOCK; j0 >= 0; j0 -= BLOCK) searchRange(L, r, il, around, j0, Math.min(n, j0 + BLOCK))
    }
    const oddSplit = (L: Level, r: number, il: [number, number] | null, around: number) => {
      const n = L.centres.length
      const cuts = [0, Math.floor(n / 3), Math.floor(n / 3) + 1, n]
      for (let k = cuts.length - 2; k >= 0; k--) searchRange(L, r, il, around, cuts[k], cuts[k + 1])
    }
    for (const c of FILL_CASES.slice(0, 6)) {
      const input = c.input()
      const prep = prepare(input)
      const start = prep.init ? 'source' : 'smooth'
      const ref = solve(prep.pyramid(), prep.r, prep.init, start, () => {}, search)
      for (const s of [backwards, oddSplit]) {
        const got = solve(prep.pyramid(), prep.r, prep.init, start, () => {}, s)
        expect(print(got.completion), c.name).toBe(print(ref.completion))
        expect(got.energy).toBe(ref.energy)
      }
    }
  }, 60000)
})

describe('planning the workers', () => {
  const src = { initial: [10, 0] as [number, number] }
  const none = { initial: null }
  it('uses one worker for whole fills with one slot', () => {
    expect(planFills([src, src], 1, true)).toEqual({ serial: true, tasks: [], concurrency: 1 })
  })
  it('runs the two completions of a fill at once, and gives extra slots to their searches', () => {
    expect(planFills([src], 2, true)).toEqual({ serial: false, concurrency: 2, tasks: [{ job: 0, start: 'source', helpers: 0 }, { job: 0, start: 'smooth', helpers: 0 }] })
    const p = planFills([src], 7, true)
    expect(p.tasks.map((t) => t.helpers)).toEqual([3, 2])
    expect(p.tasks.reduce((n, t) => n + 1 + t.helpers, 0)).toBe(7)
    // Without shared memory, no helpers.
    expect(planFills([src], 7, false).tasks.map((t) => t.helpers)).toEqual([0, 0])
    // A fill without a source is one completion.
    expect(planFills([none], 4, true).tasks).toEqual([{ job: 0, start: 'smooth', helpers: 3 }])
  })
  it('queues completions when there are more than slots, without helpers', () => {
    const p = planFills([src, src, none], 3, true)
    expect(p.concurrency).toBe(3)
    expect(p.tasks.length).toBe(5)
    expect(p.tasks.every((t) => t.helpers === 0)).toBe(true)
  })
})

describe('the fill pool', () => {
  const inputs = FILL_CASES.map((c) => c.input())

  for (const [slots, shared] of [[1, false], [2, false], [5, true]] as const) {
    it(`gives complete()'s fills with ${slots} slot${slots > 1 ? 's' : ''}${shared ? ', shared memory' : ''}`, async () => {
      const plans: FillPlan[] = []
      const got = await computeFills(inputs, undefined, { budget: new CpuBudget(slots), workers: inProcess(), shared, onPlan: (p) => plans.push(p) })
      expect(plans[0].serial).toBe(slots === 1)
      got.forEach((c, i) => expect(print(c), FILL_CASES[i].name).toBe(MAIN[FILL_CASES[i].name]))
    }, 60000)
  }

  it('gives each fill on its own the same as in a batch, with helpers', async () => {
    for (const [i, c] of FILL_CASES.entries()) {
      if (i % 3) continue
      const [got] = await computeFills([c.input()], undefined, { budget: new CpuBudget(6), workers: inProcess(), shared: true })
      expect(print(got), c.name).toBe(MAIN[c.name])
    }
  }, 60000)

  it('reports progress per fill and gives its slots back', async () => {
    const budget = new CpuBudget(4)
    const seen = new Set<number>()
    await computeFills(inputs.slice(0, 3), (job, f) => {
      seen.add(job)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThanOrEqual(1)
    }, { budget, workers: inProcess(), shared: true })
    expect(budget.used).toBe(0)
    expect(seen.size).toBeGreaterThan(0)
  })

  it('fails when a worker fails, and still gives its slots back', async () => {
    const budget = new CpuBudget(2)
    const broken = new FillWorkers(() => {
      const w = new InProcess()
      w.postMessage = () => setTimeout(() => w.onerror?.({ message: 'boom' } as ErrorEvent))
      return w
    })
    await expect(computeFills(inputs.slice(0, 1), undefined, { budget, workers: broken, shared: false })).rejects.toThrow('boom')
    expect(budget.used).toBe(0)
    expect(broken.live).toBe(0)
  })

  it('makes workers on first use and ends them when idle', async () => {
    const pool = inProcess()
    expect(pool.live).toBe(0)
    await computeFills(inputs.slice(0, 2), undefined, { budget: new CpuBudget(3), workers: pool, shared: false })
    expect(pool.live).toBe(3)
    await new Promise((r) => setTimeout(r, 120))
    expect(pool.live).toBe(0)
  })
})

describe('Remove fills computed by the pool, applied by runSpots', () => {
  it('give the same pixels as runSpots computing them itself', async () => {
    for (const c of SPOT_CASES) {
      const rgb = c.rgb()
      const canon = new TileImage(c.w, c.h, sceneTiles(c.w, c.h, rgb))
      const jobs = fillJobs(canon, c.spots, () => false)
      const fills = await computeFills(jobs.map((j) => j.input), undefined, { budget: new CpuBudget(4), workers: inProcess(), shared: true })
      const img = new TileImage(c.w, c.h, sceneTiles(c.w, c.h, rgb))
      const computed = runSpots(img, c.spots, { canonical: null, completions: new Map(jobs.map((j, i) => [j.key, fills[i]])) })
      expect(computed.size).toBe(0)
      const pix = img.read({ x0: 0, y0: 0, x1: c.w, y1: c.h })
      expect(`${jobs.length}:${fingerprint(pix)}:${fingerprint(...fills.flatMap((f) => [f.centres, f.sources, f.weights]))}`, c.name).toBe(MAIN[c.name])
    }
  }, 60000)

  it('asks only for the fills not cached, each once', () => {
    const c = SPOT_CASES[3]
    const canon = new TileImage(c.w, c.h, sceneTiles(c.w, c.h, c.rgb()))
    const all = fillJobs(canon, c.spots, () => false)
    expect(all.map((j) => [j.spot, j.chunk])).toEqual([[0, 0], [2, 0]])
    expect(fillJobs(canon, c.spots, (k) => k === all[0].key).map((j) => j.spot)).toEqual([2])
  })
})
