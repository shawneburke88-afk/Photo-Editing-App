// Catalog errors the UI treats specially. Shared by the catalog worker and the page.

/** Shown when the catalog was saved by a newer LightBench, whose changes this version doesn't know. */
export const NEWER_CATALOG_MESSAGE = 'This library was saved by a newer version of LightBench. Reload to get the latest version. Nothing in the library was changed.'

/**
 * True when the browser's storage failed rather than the request: SQLite's read-only, I/O error, corrupt, disk
 * full, can't open and not-a-database codes (https://sqlite.org/rescode.html; sqlite-wasm puts the code in
 * `resultCode`), or the browser's storage quota.
 */
export function isStorageFailure(err: unknown): boolean {
  const rc = (err as { resultCode?: unknown } | null)?.resultCode
  if (typeof rc === 'number' && [8, 10, 11, 13, 14, 26].includes(rc & 0xff)) return true
  return (err as { name?: unknown } | null)?.name === 'QuotaExceededError'
}
