// The catalog side of library backups, run inside the catalog worker (which owns the SQLite connection).
import type { Database, SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { DOWNLOAD_COPY, NEWER_BACKUP_MESSAGE } from '../backup/manifest'
import { SCHEMA_VERSION } from './schema'
import { otherSlot, removeThumbsDir, type Slot } from './slot'

export interface CatalogSummary {
  schemaVersion: number
  photos: number
  folders: number
  collections: number
  keywords: number
  edits: number
  /** Develop, metadata and import presets. */
  presets: number
  roots: { id: number; name: string }[]
}

function count(d: Database, table: string, where = ''): number {
  const exists = d.selectValue("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?", [table])
  return exists === undefined ? 0 : Number(d.selectValue(`SELECT COUNT(*) FROM ${table} ${where}`))
}

export function summarize(d: Database): CatalogSummary {
  return {
    schemaVersion: Number(d.selectValue('PRAGMA user_version')),
    photos: count(d, 'photos'),
    folders: count(d, 'folders'),
    collections: count(d, 'collections', "WHERE kind <> 'quick'"),
    keywords: count(d, 'keywords'),
    edits: count(d, 'edits'),
    presets: count(d, 'presets') + count(d, 'metadata_presets') + count(d, 'import_presets'),
    roots: count(d, 'roots') ? (d.selectObjects('SELECT id, name FROM roots ORDER BY id') as unknown as { id: number; name: string }[]) : [],
  }
}

/**
 * A copy of the whole catalog file, made with sqlite3_js_db_export (sqlite3_serialize;
 * https://sqlite.org/wasm/doc/trunk/api-c-style.md#sqlite3_js_db_export). The worker runs one request at a time and
 * every change finishes (commits) within its request, so nothing can change the catalog while it is copied.
 */
export function exportCatalog(sqlite3: Sqlite3Static, d: Database) {
  const bytes = sqlite3.capi.sqlite3_js_db_export(d)
  const photoIds = (d.selectValues('SELECT id FROM photos ORDER BY id') as number[]).map(Number)
  return { bytes, summary: summarize(d), photoIds }
}

/** Runs SQLite's integrity check; returns its first problem, or null. */
function integrity(d: Database): string | null {
  const rows = d.selectValues('PRAGMA integrity_check') as string[]
  return rows.length === 1 && rows[0] === 'ok' ? null : String(rows[0] ?? 'no result')
}

function checked(d: Database): CatalogSummary {
  const problem = integrity(d)
  if (problem) throw new Error(`The catalog in this backup is damaged (SQLite: ${problem}).`)
  const summary = summarize(d)
  if (summary.schemaVersion > SCHEMA_VERSION) throw new Error(NEWER_BACKUP_MESSAGE)
  if (d.selectValue("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'photos'") === undefined) throw new Error('The catalog in this backup has no photos.')
  return summary
}

/**
 * Opens a catalog image in memory (sqlite3_deserialize, read-only) and checks it, without touching the library.
 * Used to check a backup after writing it.
 */
export function checkCatalogImage(sqlite3: Sqlite3Static, bytes: Uint8Array): CatalogSummary {
  const d = new sqlite3.oo1.DB(':memory:', 'c')
  try {
    const p = sqlite3.wasm.allocFromTypedArray(bytes)
    // FREEONCLOSE: SQLite frees the copy when the database closes (or if this call fails).
    const rc = sqlite3.capi.sqlite3_deserialize(d.pointer!, 'main', p, bytes.byteLength, bytes.byteLength,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_READONLY)
    if (rc) throw new Error(`The catalog in this backup could not be opened (${sqlite3.capi.sqlite3_js_rc_str(rc)}).`)
    return checked(d)
  } finally {
    d.close()
  }
}

/** Removes the unused slot's catalog file. Must not be called for the slot in use. */
function unlinkCatalog(pool: SAHPoolUtil, slot: Slot) {
  for (const suffix of ['', '-journal', '-wal']) pool.unlink(slot.dbFile + suffix)
}

/**
 * Writes a backup's catalog into the slot not in use and checks it there (SQLite integrity check, schema version).
 * The library in use is not touched. Throws (after removing what was written) if anything is wrong.
 */
export async function stageCatalog(pool: SAHPoolUtil, active: Slot, bytes: Uint8Array<ArrayBuffer>): Promise<CatalogSummary> {
  const target = otherSlot(active)
  unlinkCatalog(pool, target)
  // Room for both catalogs and their journals (the pool starts with 6 files; this never shrinks it).
  await pool.reserveMinimumCapacity(6)
  try {
    await pool.importDb(target.dbFile, bytes)
    const d = new pool.OpfsSAHPoolDb(target.dbFile)
    try {
      return checked(d)
    } finally {
      d.close()
    }
  } catch (err) {
    unlinkCatalog(pool, target)
    throw err
  }
}

export function discardStaged(pool: SAHPoolUtil, active: Slot) {
  unlinkCatalog(pool, otherSlot(active))
}

/**
 * Run when the catalog opens: removes the slot a restore switched away from (catalog and thumbnails, in the
 * background), and the copy of a downloaded backup if it is still there (backup.ts).
 */
export function removeLeftovers(pool: SAHPoolUtil, active: Slot) {
  const old = otherSlot(active)
  try {
    unlinkCatalog(pool, old)
  } catch {
    // Tried again at the next start.
  }
  void removeThumbsDir(old).catch(() => {})
  void navigator.storage.getDirectory().then((root) => root.removeEntry(DOWNLOAD_COPY)).catch(() => {})
}
