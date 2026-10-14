// A pool of workers that runs queued tasks on as many workers as its CPU lease allows (engine/cpu-budget.ts;
// PHASE3.md, Part 22). Used by the probe, analysis and export-encoder pools.
//
// - Lazy: no worker exists until a task is queued; a worker is made only when a slot is free and no idle one is left.
// - The lease is taken when the first task is queued and given back `lingerMs` after the queue empties (so a run of
//   tasks doesn't take and give it back between items); with `hold`, it is taken at once and kept until `dispose`
//   (Export: the whole run is foreground work, also while its encoders wait for the next photo).
// - A task starts only while fewer than `lease.slots` run: when the budget shrinks the lease (foreground work came),
//   running tasks finish and the next one waits, so the pool yields between items, never in the middle of one.
// - Workers idle for `idleMs` are terminated (their memory, e.g. jpegli's WebAssembly heap, goes with them).

import { cpuBudget, type CpuBudget, type CpuLease, type CpuPriority } from './cpu-budget'

export interface WorkerPoolOptions<W> {
  create: () => W
  terminate: (w: W) => void
  priority: CpuPriority
  /** How many workers the pool would like (it gets what the budget gives). */
  want: number
  /** Foreground only: at least this many even over the budget (default 1). */
  min?: number
  /** Idle workers are terminated after this long (default 30 s). */
  idleMs?: number
  /** The lease is kept this long after the last task (default 500 ms). */
  lingerMs?: number
  /** Take the lease now and keep it until `dispose`. */
  hold?: boolean
  /** A worker that can't be used again (it failed to start): ended after its task instead of kept. */
  broken?: (w: W) => boolean
  budget?: CpuBudget
}

interface Job<W> {
  task: (w: W) => Promise<unknown>
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export class WorkerPool<W> {
  private readonly o: WorkerPoolOptions<W>
  private readonly queue: Job<W>[] = []
  private readonly idle: { w: W; timer: ReturnType<typeof setTimeout> }[] = []
  private readonly busy = new Set<W>()
  private live = 0
  private running = 0
  private lease: CpuLease | null = null
  private linger: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(o: WorkerPoolOptions<W>) {
    this.o = o
    if (o.hold) this.takeLease()
  }

  private takeLease() {
    const budget = this.o.budget ?? cpuBudget
    this.lease = budget.acquire(this.o.priority, this.o.want, this.o.min)
    this.lease.onChange(() => this.pump())
  }

  /** Workers alive now. */
  get size() {
    return this.live
  }

  /** Tasks running now. */
  get active() {
    return this.running
  }

  /** Slots the pool's lease allows now (0 without a lease). */
  get slots() {
    return this.lease?.slots ?? 0
  }

  /** Queues a task; it runs on a worker of the pool when a slot is free. */
  run<R>(task: (w: W) => Promise<R>): Promise<R> {
    if (this.disposed) return Promise.reject(new Error('cancelled'))
    return new Promise<R>((resolve, reject) => {
      this.queue.push({ task, resolve: resolve as (v: unknown) => void, reject })
      this.pump()
    })
  }

  /**
   * Makes up to `n` workers now (as many as the lease allows), so their start-up overlaps with whatever the caller
   * does before its first task (Open folder: reading the folder). They wait idle like any other.
   */
  prestart(n = this.o.want) {
    if (this.disposed) return
    if (!this.lease) this.takeLease()
    for (let k = Math.min(n, this.slots) - this.live; k > 0; k--) {
      this.live++
      this.put(this.o.create())
    }
    this.pump()
  }

  /** Drops queued (not yet started) tasks; they reject with "cancelled". */
  clear() {
    for (const job of this.queue.splice(0)) job.reject(new Error('cancelled'))
    this.pump()
  }

  /** Drops queued tasks and terminates every worker (running tasks may reject). */
  dispose() {
    this.disposed = true
    this.clear()
    for (const { w, timer } of this.idle.splice(0)) {
      clearTimeout(timer)
      this.o.terminate(w)
      this.live--
    }
    this.busy.forEach((w) => {
      this.o.terminate(w)
      this.live--
    })
    this.busy.clear()
    if (this.linger) clearTimeout(this.linger)
    this.linger = null
    this.lease?.release()
    this.lease = null
  }

  private pump() {
    if (this.disposed) return
    if (this.queue.length) {
      if (this.linger) {
        clearTimeout(this.linger)
        this.linger = null
      }
      if (!this.lease) this.takeLease()
    }
    while (this.queue.length && this.running < this.slots) {
      const job = this.queue.shift()!
      const w = this.take()
      this.running++
      this.busy.add(w)
      let p: Promise<unknown>
      try {
        p = job.task(w)
      } catch (e) {
        p = Promise.reject(e)
      }
      p.then(job.resolve, job.reject).finally(() => {
        this.running--
        this.busy.delete(w)
        if (this.disposed) return
        this.put(w)
        this.pump()
      })
    }
    if (!this.queue.length && !this.running && this.lease && !this.linger && !this.o.hold) {
      this.linger = setTimeout(() => {
        this.linger = null
        const l = this.lease
        this.lease = null
        l?.release()
      }, this.o.lingerMs ?? 500)
    }
  }

  /** An idle worker (the most recently used, so the others age out), or a new one. */
  private take(): W {
    const i = this.idle.pop()
    if (i) {
      clearTimeout(i.timer)
      return i.w
    }
    this.live++
    return this.o.create()
  }

  private put(w: W) {
    if (this.o.broken?.(w)) {
      this.o.terminate(w)
      this.live--
      return
    }
    const entry = {
      w,
      timer: setTimeout(() => {
        const k = this.idle.indexOf(entry)
        if (k >= 0) this.idle.splice(k, 1)
        this.o.terminate(w)
        this.live--
      }, this.o.idleMs ?? 30000),
    }
    this.idle.push(entry)
  }
}
