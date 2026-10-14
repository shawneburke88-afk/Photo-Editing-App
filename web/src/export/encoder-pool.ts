// Export's encoder workers (PHASE3.md, Part 22): JPEG (jpegli), PNG and TIFF encoding off the page, several photos at
// once, as foreground work on the page's CPU budget (engine/cpu-budget.ts). Workers are made on first use; Export
// disposes of its pool at the end of the run, which frees each worker's memory (jpegli's WebAssembly heap grows to
// about 13 bytes a pixel, 314 MB after a 24 MP photo and 587 MB after a 45 MP one, measured in Node, and never shrinks).

import { cpuBudget, type CpuBudget } from '../engine/cpu-budget'
import { WorkerPool } from '../engine/worker-pool'
import type { EncodeJob, EncodeResult } from './encode'
import type { EncoderReply, EncoderRequest } from './encoder.worker'

interface EncoderWorker {
  worker: Worker
  pending: Map<number, { resolve: (r: EncodeResult) => void; reject: (e: Error) => void }>
  /** The worker failed to start: every task on it fails at once. */
  dead: boolean
}

let seq = 1

function makeWorker(): EncoderWorker {
  const worker = new Worker(new URL('./encoder.worker.ts', import.meta.url), { type: 'module' })
  const w: EncoderWorker = { worker, pending: new Map(), dead: false }
  worker.onmessage = (e: MessageEvent<EncoderReply>) => {
    const p = w.pending.get(e.data.id)
    if (!p) return
    w.pending.delete(e.data.id)
    if (e.data.ok) p.resolve(e.data.value)
    else p.reject(new Error(e.data.error))
  }
  worker.onerror = (e) => {
    w.dead = true
    const err = new Error(e.message || 'The encoder failed to start')
    for (const p of w.pending.values()) p.reject(err)
    w.pending.clear()
  }
  return w
}

export class EncoderPool {
  private readonly pool: WorkerPool<EncoderWorker>

  /** `hold`: take the CPU lease now and keep it until `dispose` (Export's whole run is foreground work). */
  constructor(o: { budget?: CpuBudget; idleMs?: number; hold?: boolean } = {}) {
    const budget = o.budget ?? cpuBudget
    this.pool = new WorkerPool<EncoderWorker>({
      create: makeWorker,
      terminate: (w) => w.worker.terminate(),
      broken: (w) => w.dead,
      priority: 'foreground',
      want: budget.total,
      idleMs: o.idleMs,
      hold: o.hold,
      budget,
    })
  }

  /**
   * Encodes a photo on the next free encoder. With `transfer` (the default) the pixels are moved to the worker and
   * `job.rgba` can't be used afterwards; without, they are copied.
   */
  encode(job: EncodeJob, transfer = true): Promise<EncodeResult> {
    return this.pool.run(
      (w) =>
        new Promise<EncodeResult>((resolve, reject) => {
          if (w.dead) return reject(new Error('The encoder failed to start'))
          const id = seq++
          w.pending.set(id, { resolve, reject })
          w.worker.postMessage({ id, job } satisfies EncoderRequest, transfer ? [job.rgba.buffer as ArrayBuffer] : [])
        }),
    )
  }

  /** Encoders running now. */
  get active() {
    return this.pool.active
  }

  dispose() {
    this.pool.dispose()
  }
}
