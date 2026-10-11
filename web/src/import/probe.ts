import { createRpcClient, type RpcClient } from '../lib/rpc'
import type { ProbeApi, ProbeResult } from './probe.worker'

export type { ProbeResult }

/** A small pool of probe workers so several photos are read in parallel. */
export class ProbePool {
  private workers: { worker: Worker; api: RpcClient<ProbeApi>; busy: boolean }[] = []
  private queue: { file: File; resolve: (r: ProbeResult) => void; reject: (e: Error) => void }[] = []

  constructor(size = Math.min(6, Math.max(2, Math.floor((navigator.hardwareConcurrency || 4) / 2)))) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./probe.worker.ts', import.meta.url), { type: 'module' })
      this.workers.push({ worker, api: createRpcClient<ProbeApi>(worker), busy: false })
    }
  }

  probe(file: File): Promise<ProbeResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ file, resolve, reject })
      this.pump()
    })
  }

  /** Drops queued (not yet started) work, e.g. when the import window closes. */
  clear() {
    for (const job of this.queue.splice(0)) job.reject(new Error('cancelled'))
  }

  private pump() {
    for (const w of this.workers) {
      if (w.busy) continue
      const job = this.queue.shift()
      if (!job) return
      w.busy = true
      w.api
        .probe(job.file)
        .then(job.resolve, job.reject)
        .finally(() => {
          w.busy = false
          this.pump()
        })
    }
  }

  dispose() {
    this.clear()
    for (const w of this.workers) w.worker.terminate()
  }
}
