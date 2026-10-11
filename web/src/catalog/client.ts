import { createRpcClient, type RpcClient } from '../lib/rpc'
import type { CatalogApi } from './catalog.worker'

export type Catalog = RpcClient<CatalogApi>

let catalog: Catalog | null = null

/** The single catalog connection for this tab (SQLite allows one writer per database). */
export function getCatalog(): Catalog {
  catalog ??= createRpcClient<CatalogApi>(new Worker(new URL('./catalog.worker.ts', import.meta.url), { type: 'module' }))
  return catalog
}

/** Asks the browser not to evict LightBench's storage (catalog, thumbnails) when space runs low. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
