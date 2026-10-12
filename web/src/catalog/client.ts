import { createRpcClient, type RpcClient } from '../lib/rpc'
import type { CatalogApi } from './catalog.worker'
import { storageProblems } from './storage'

export type Catalog = RpcClient<CatalogApi>

let catalog: Catalog | null = null

/** The single catalog connection for this tab (SQLite allows one writer per database). */
export function getCatalog(): Catalog {
  catalog ??= createRpcClient<CatalogApi>(new Worker(new URL('./catalog.worker.ts', import.meta.url), { type: 'module' }), (method, err) => {
    // Opening has its own message; any other request failing in storage means changes may not be saved.
    if (err.name === 'StorageError' && method !== 'open') storageProblems.catalogFailed(err.message)
  })
  return catalog
}

/**
 * Asks the browser not to evict LightBench's storage (catalog, thumbnails) when space runs low. If it says no,
 * a notice explains the risk.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  let granted = false
  try {
    granted = (await navigator.storage.persisted()) || (await navigator.storage.persist())
  } catch {
    granted = false
  }
  storageProblems.setPersistent(granted)
  return granted
}
