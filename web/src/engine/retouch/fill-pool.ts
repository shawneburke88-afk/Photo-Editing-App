// Remove's fills on several cores (PHASE3.md, Part 22). The page asks for the fills a spot list needs (the retouch
// stage, engine/gpu/retouch-stage.ts) and this pool computes them on fill workers (fill.worker.ts), as many as the CPU
// budget gives foreground work (engine/cpu-budget.ts), with exactly the matches the single-worker code gives.
//
// What runs at once:
//   - Fills of different chunks (several spots, or a long stroke's pieces) don't depend on each other: each is
//     computed from the canonical scene and the spots' shapes alone.
//   - Each fill with a source (every Remove spot has one) is two completions, one starting from the source and one
//     smooth, of which `complete` keeps the better (completion.ts, `pick`); they don't depend on each other either.
//   - Within a completion, each search's target patches are split among the completion's helpers (fill-split.ts),
//     when the page can share memory with its workers (cross-origin isolated, as LightBench's pages are).
// What stays sequential, inside each completion: the pyramid's levels (coarse to fine), the iterations of a level, the
// votes, the weights, the Gauss-Seidel starts and the final score (see `solve`).
//
// With one slot (one or two logical cores) a fill is computed by one worker with `complete` itself, as before.
// Workers are made when first needed and terminated after a minute without work.

import { cpuBudget, type CpuBudget } from '../cpu-budget'
import { pick, type Completion, type CompletionInput, type Solved, type Start } from './completion'
import { canShare, newControl, type FillReply, type FillRequest } from './fill-split'

export interface FillTask {
  job: number
  start: Start
  /** Workers helping this completion's searches. */
  helpers: number
}

export interface FillPlan {
  /** One worker computes each fill whole (`complete`), one after another. */
  serial: boolean
  tasks: FillTask[]
  /** Tasks running at once. */
  concurrency: number
}

/**
 * How `slots` workers share the fills: one whole fill at a time with one slot; otherwise every completion is a task,
 * run `slots` at a time, and when there are more slots than tasks (and memory can be shared) the extra workers help
 * the tasks' searches, spread evenly (earlier tasks get the remainder).
 */
export function planFills(inputs: Pick<CompletionInput, 'initial'>[], slots: number, shared: boolean): FillPlan {
  if (slots <= 1 || !inputs.length) return { serial: true, tasks: [], concurrency: 1 }
  const tasks: FillTask[] = []
  inputs.forEach((input, job) => {
    if (input.initial) tasks.push({ job, start: 'source', helpers: 0 }, { job, start: 'smooth', helpers: 0 })
    else tasks.push({ job, start: 'smooth', helpers: 0 })
  })
  const extra = shared && slots > tasks.length ? slots - tasks.length : 0
  tasks.forEach((t, i) => (t.helpers = Math.floor(extra / tasks.length) + (i < extra % tasks.length ? 1 : 0)))
  return { serial: false, tasks, concurrency: Math.min(slots, tasks.length) }
}

/** What the pool needs of a worker (a Worker; the tests give in-process ones). */
export interface FillWorkerLike {
  postMessage(m: FillRequest): void
  terminate(): void
  onmessage: ((e: MessageEvent<FillReply>) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
}

interface Slot {
  worker: FillWorkerLike
  handler: ((m: FillReply) => void) | null
  fail: ((e: Error) => void) | null
  dead: boolean
  timer: ReturnType<typeof setTimeout> | null
}

let seq = 1

/** The fill workers: made on demand, kept for `idleMs` after their last task. */
export class FillWorkers {
  private readonly idle: Slot[] = []
  private readonly make: () => FillWorkerLike
  private readonly idleMs: number
  /** Workers alive. */
  live = 0

  constructor(make: () => FillWorkerLike, idleMs = 60000) {
    this.make = make
    this.idleMs = idleMs
  }

  take(): Slot {
    const s = this.idle.pop()
    if (s) {
      if (s.timer) clearTimeout(s.timer)
      s.timer = null
      return s
    }
    const slot: Slot = { worker: this.make(), handler: null, fail: null, dead: false, timer: null }
    slot.worker.onmessage = (e) => slot.handler?.(e.data)
    slot.worker.onerror = (e) => {
      slot.dead = true
      slot.fail?.(new Error(e.message || 'A Remove fill worker failed'))
    }
    this.live++
    return slot
  }

  give(s: Slot) {
    s.handler = null
    s.fail = null
    if (s.dead) {
      s.worker.terminate()
      this.live--
      return
    }
    s.timer = setTimeout(() => {
      const i = this.idle.indexOf(s)
      if (i >= 0) this.idle.splice(i, 1)
      s.worker.terminate()
      this.live--
    }, this.idleMs)
    this.idle.push(s)
  }

  /** One request on one worker; `on` hears progress and shares until the answer. */
  call(s: Slot, req: FillRequest, on: (m: FillReply) => void = () => {}): Promise<FillReply> {
    return new Promise((resolve, reject) => {
      s.handler = (m) => {
        if (m.id !== req.id) return
        if (m.kind === 'done' || m.kind === 'helped') resolve(m)
        else if (m.kind === 'error') reject(new Error(m.message))
        else on(m)
      }
      s.fail = reject
      if (s.dead) reject(new Error('A Remove fill worker failed'))
      else s.worker.postMessage(req)
    })
  }
}

let defaultWorkers: FillWorkers | null = null
const workers = () =>
  (defaultWorkers ??= new FillWorkers(() => new Worker(new URL('./fill.worker.ts', import.meta.url), { type: 'module' }) as unknown as FillWorkerLike))

export interface FillOptions {
  budget?: CpuBudget
  workers?: FillWorkers
  /** Whether helpers can share memory (default: where SharedArrayBuffer is available). */
  shared?: boolean
  /** Called with the plan chosen (measurements, tests). */
  onPlan?: (p: FillPlan, slots: number) => void
}

/**
 * Computes the fills (`complete` of each input, onProgress excepted) on the fill workers. The results are exactly
 * `complete`'s. `onProgress(job, fraction)` reports each fill's progress.
 */
export async function computeFills(inputs: CompletionInput[], onProgress?: (job: number, f: number) => void, o: FillOptions = {}): Promise<Completion[]> {
  if (!inputs.length) return []
  const budget = o.budget ?? cpuBudget
  const pool = o.workers ?? workers()
  const lease = budget.acquire('foreground', budget.total)
  const strip = (i: CompletionInput): CompletionInput => ({ width: i.width, height: i.height, image: i.image, hole: i.hole, blocked: i.blocked, initial: i.initial ?? null, radius: i.radius })
  try {
    const plan = planFills(inputs, lease.slots, o.shared ?? canShare())
    o.onPlan?.(plan, lease.slots)
    if (plan.serial) {
      const out: Completion[] = []
      const w = pool.take()
      try {
        for (const [job, input] of inputs.entries()) {
          const r = await pool.call(w, { kind: 'complete', id: seq++, input: strip(input) }, (m) => m.kind === 'progress' && onProgress?.(job, m.f))
          out.push((r as Extract<FillReply, { kind: 'done' }>).completion)
        }
      } finally {
        pool.give(w)
      }
      return out
    }
    const solved: Solved[][] = inputs.map(() => [])
    const fractions = plan.tasks.map(() => 0)
    const report = (job: number) => {
      const mine = plan.tasks.map((t, i) => (t.job === job ? fractions[i] : -1)).filter((f) => f >= 0)
      onProgress?.(job, mine.reduce((a, b) => a + b, 0) / mine.length)
    }
    let next = 0
    const runner = async () => {
      while (next < plan.tasks.length) {
        const ti = next++
        const t = plan.tasks[ti]
        const leader = pool.take()
        const helpers = Array.from({ length: t.helpers }, () => pool.take())
        const ctrl = helpers.length ? newControl() : null
        const helping: Promise<unknown>[] = []
        try {
          const r = await pool.call(leader, { kind: 'solve', id: seq++, input: strip(inputs[t.job]), start: t.start, ctrl }, (m) => {
            if (m.kind === 'progress') {
              fractions[ti] = m.f
              report(t.job)
            } else if (m.kind === 'share' && ctrl) {
              for (const h of helpers) helping.push(pool.call(h, { kind: 'help', id: seq++, ctrl, levels: m.levels, r: m.r }))
            }
          })
          const d = r as Extract<FillReply, { kind: 'done' }>
          solved[t.job][t.start === 'source' ? 0 : 1] = { completion: d.completion, energy: d.energy }
        } finally {
          await Promise.allSettled(helping)
          pool.give(leader)
          helpers.forEach((h) => pool.give(h))
        }
      }
    }
    const results = await Promise.allSettled(Array.from({ length: plan.concurrency }, runner))
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed) throw failed.reason
    // As `complete`: with a source, the better of the two (the source's on a tie); without, the smooth one.
    return inputs.map((input, job) => (input.initial ? pick(solved[job][0], solved[job][1]) : solved[job][1].completion))
  } finally {
    lease.release()
  }
}
