import { cpuBudget, type CpuPriority } from '../engine/cpu-budget'
import { WorkerPool } from '../engine/worker-pool'
import { createRpcClient, type RpcClient } from '../lib/rpc'
import type { ProbeApi, ProbeResult } from './probe.worker'

export type { ProbeResult }

interface ProbeWorker {
  worker: Worker
  api: RpcClient<ProbeApi>
}

/**
 * A small pool of probe workers so several photos are read in parallel, on the page's CPU budget
 * (engine/cpu-budget.ts; PHASE3.md, Part 22). Open folder and Import are foreground work: they get half the cores, at
 * most 6 and at least 2 (as before the budget, so Open folder is never slower), less only while other foreground work
 * (Remove, Export) shares the budget. The one-time refresh asks as background work. A foreground pool starts its
 * workers when it is made (Open folder and Import make it when they start reading a folder, so the workers load while
 * the folder is listed, as before the budget); a background pool makes them on first use.
 */
export class ProbePool {
  private readonly pool: WorkerPool<ProbeWorker>

  constructor(o: { priority?: CpuPriority; want?: number } = {}) {
    const priority = o.priority ?? 'foreground'
    this.pool = new WorkerPool<ProbeWorker>({
      create: () => {
        const worker = new Worker(new URL('./probe.worker.ts', import.meta.url), { type: 'module' })
        return { worker, api: createRpcClient<ProbeApi>(worker) }
      },
      terminate: (w) => w.worker.terminate(),
      priority,
      want: o.want ?? Math.min(6, Math.max(2, cpuBudget.total)),
      min: priority === 'foreground' ? 2 : 0,
    })
    if (priority === 'foreground') this.pool.prestart()
  }

  /** Reads a photo; `t.ms`, if given, gets the time a worker spent on it (not the wait for a free worker). */
  probe(file: File, t?: { ms: number }): Promise<ProbeResult> {
    return this.pool.run(async (w) => {
      const start = performance.now()
      try {
        return await w.api.probe(file)
      } finally {
        if (t) t.ms = performance.now() - start
      }
    })
  }

  /** Drops queued (not yet started) work, e.g. when the import window closes. */
  clear() {
    this.pool.clear()
  }

  dispose() {
    this.pool.dispose()
  }
}
