import type { CatalogBenchResult } from './benchmark.worker'

export type { CatalogBenchResult }

export function runCatalogBenchmark(photos: number): Promise<CatalogBenchResult> {
  const worker = new Worker(new URL('./benchmark.worker.ts', import.meta.url), { type: 'module' })
  return new Promise<CatalogBenchResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ ok: true; result: CatalogBenchResult } | { ok: false; error: string }>) => {
      if (e.data.ok) resolve(e.data.result)
      else reject(new Error(e.data.error))
    }
    worker.onerror = (e) => reject(new Error(e.message || 'Catalog worker failed to start'))
    worker.postMessage({ photos })
  }).finally(() => worker.terminate())
}
