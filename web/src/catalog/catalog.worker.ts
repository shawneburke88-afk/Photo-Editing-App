/// <reference lib="webworker" />
// The library catalog: one SQLite database stored in the browser's private storage (OPFS).
import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm'
import { exposeRpc } from '../lib/rpc'
import type { DuplicateKey, FolderNode, LibraryRoot, NewPhoto, PhotoDetail, PhotoQuery, PhotoRow } from './types'

const DB_FILE = '/lightbench-catalog.sqlite3'
const SCHEMA_VERSION = 4

let db: Database | null = null
let persistent = false
let opening: Promise<{ persistent: boolean }> | null = null

function conn(): Database {
  if (!db) throw new Error('Catalog is not open')
  return db
}

/** Opens the catalog once; concurrent callers share the same attempt. */
function open(options: { inMemory?: boolean } = {}): Promise<{ persistent: boolean }> {
  opening ??= openOnce(options).catch((err) => {
    opening = null
    throw err
  })
  return opening
}

async function openOnce(options: { inMemory?: boolean }): Promise<{ persistent: boolean }> {
  const sqlite3 = await sqlite3InitModule()
  if (options.inMemory) {
    db = new sqlite3.oo1.DB(':memory:', 'c')
  } else {
    try {
      const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'lightbench', directory: '.lightbench-catalog' })
      db = new pool.OpfsSAHPoolDb(DB_FILE)
      persistent = true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        /lock|access handle|NoModificationAllowed/i.test(msg)
          ? 'LightBench is already open in another tab. Close the other tab and reload this one.'
          : `Could not open the library catalog: ${msg}`,
      )
    }
  }
  migrate(db)
  return { persistent }
}

function migrate(d: Database) {
  d.exec('PRAGMA foreign_keys = ON')
  const version = Number(d.selectValue('PRAGMA user_version'))
  if (version >= SCHEMA_VERSION) return
  d.exec('BEGIN')
  try {
    if (version < 1) {
      d.exec(`
        CREATE TABLE roots (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        );
        CREATE TABLE folders (
          id INTEGER PRIMARY KEY,
          root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
          path TEXT NOT NULL,
          UNIQUE (root_id, path)
        );
        CREATE TABLE photos (
          id INTEGER PRIMARY KEY,
          folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
          file_name TEXT NOT NULL,
          original_name TEXT NOT NULL,
          file_type TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          file_modified INTEGER NOT NULL,
          captured_at INTEGER NOT NULL,
          imported_at INTEGER NOT NULL,
          camera_make TEXT NOT NULL DEFAULT '',
          camera_model TEXT NOT NULL DEFAULT '',
          lens TEXT NOT NULL DEFAULT '',
          iso INTEGER NOT NULL DEFAULT 0,
          shutter REAL NOT NULL DEFAULT 0,
          aperture REAL NOT NULL DEFAULT 0,
          focal_length REAL NOT NULL DEFAULT 0,
          width INTEGER NOT NULL DEFAULT 0,
          height INTEGER NOT NULL DEFAULT 0,
          orientation INTEGER NOT NULL DEFAULT 0,
          rating INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
          flag INTEGER NOT NULL DEFAULT 0 CHECK (flag BETWEEN -1 AND 1),
          color_label INTEGER NOT NULL DEFAULT 0 CHECK (color_label BETWEEN 0 AND 5),
          UNIQUE (folder_id, file_name)
        );
        CREATE INDEX photos_captured ON photos(captured_at);
        CREATE INDEX photos_folder ON photos(folder_id, captured_at);
        CREATE INDEX photos_duplicate ON photos(original_name, file_size, captured_at);
      `)
    }
    if (version < 2) {
      // Develop edits: current settings plus the history list, as JSON.
      d.exec(`
        CREATE TABLE edits (
          photo_id INTEGER PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
          settings TEXT NOT NULL,
          history TEXT NOT NULL DEFAULT '[]',
          updated_at INTEGER NOT NULL
        );
      `)
    }
    if (version < 3) {
      // Auto targets saved by the user (JSON of AutoTarget).
      d.exec(`
        CREATE TABLE auto_targets (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          target TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `)
    }
    if (version < 4) {
      // When LightBench last wrote this photo's XMP sidecar (Unix seconds), to spot later outside changes.
      d.exec('ALTER TABLE photos ADD COLUMN sidecar_written_at INTEGER')
    }
    d.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
}

function addRoot(name: string): number {
  conn().exec({ sql: 'INSERT INTO roots(name) VALUES (?)', bind: [name] })
  return Number(conn().selectValue('SELECT last_insert_rowid()'))
}

function listRoots(): LibraryRoot[] {
  return conn().selectObjects('SELECT id, name FROM roots ORDER BY name') as unknown as LibraryRoot[]
}

function folderTree(): FolderNode[] {
  return conn().selectObjects(`
    SELECT f.id, f.root_id AS rootId, f.path, COUNT(p.id) AS count
    FROM folders f LEFT JOIN photos p ON p.folder_id = f.id
    GROUP BY f.id ORDER BY f.root_id, f.path`) as unknown as FolderNode[]
}

function folderId(rootId: number, path: string): number {
  const d = conn()
  d.exec({ sql: 'INSERT OR IGNORE INTO folders(root_id, path) VALUES (?, ?)', bind: [rootId, path] })
  return Number(d.selectValue('SELECT id FROM folders WHERE root_id = ? AND path = ?', [rootId, path]))
}

/** Returns, for each key, whether a matching photo is already in the catalog. */
function findDuplicates(keys: DuplicateKey[]): boolean[] {
  const stmt = conn().prepare(
    'SELECT 1 FROM photos WHERE original_name = ? COLLATE NOCASE AND file_size = ? AND captured_at = ? LIMIT 1',
  )
  try {
    return keys.map((k) => {
      stmt.bind([k.originalName, k.fileSize, k.capturedAt])
      const found = stmt.step()
      stmt.reset()
      return found
    })
  } finally {
    stmt.finalize()
  }
}

/** Adds photos in one transaction; returns their new ids (null where the file was already catalogued). */
function addPhotos(photos: NewPhoto[]): (number | null)[] {
  const d = conn()
  const now = Math.floor(Date.now() / 1000)
  const ids: (number | null)[] = []
  d.exec('BEGIN')
  try {
    const stmt = d.prepare(`
      INSERT OR IGNORE INTO photos (folder_id, file_name, original_name, file_type, file_size, file_modified,
        captured_at, imported_at, camera_make, camera_model, lens, iso, shutter, aperture, focal_length,
        width, height, orientation)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    for (const p of photos) {
      stmt.bind([
        folderId(p.rootId, p.folderPath), p.fileName, p.originalName, p.fileType, p.fileSize, p.fileModified,
        p.capturedAt, now, p.cameraMake, p.cameraModel, p.lens, p.iso, p.shutter, p.aperture, p.focalLength,
        p.width, p.height, p.orientation,
      ])
      stmt.step()
      stmt.reset()
      ids.push(d.changes() > 0 ? Number(d.selectValue('SELECT last_insert_rowid()')) : null)
    }
    stmt.finalize()
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
  return ids
}

function queryPhotos(q: PhotoQuery): PhotoRow[] {
  const where: string[] = []
  const bind: (string | number)[] = []
  if (q.folder) {
    // Prefix match without LIKE, so "_" and "%" in folder names aren't treated as wildcards.
    where.push(`p.folder_id IN (SELECT id FROM folders WHERE root_id = ?
      AND (?2 = '' OR path = ?2 OR substr(path, 1, length(?2) + 1) = ?2 || '/'))`)
    bind.push(q.folder.rootId, q.folder.path)
  }
  if (q.minRating) {
    where.push('p.rating >= ?')
    bind.push(q.minRating)
  }
  if (q.flag === 'picked') where.push('p.flag = 1')
  if (q.flag === 'rejected') where.push('p.flag = -1')
  if (q.flag === 'unflagged') where.push('p.flag = 0')
  if (q.flag === 'notRejected') where.push('p.flag >= 0')
  if (q.color) {
    where.push('p.color_label = ?')
    bind.push(q.color)
  }
  if (q.text?.trim()) {
    where.push('(p.file_name LIKE ? OR p.camera_model LIKE ? OR p.lens LIKE ?)')
    const like = `%${q.text.trim()}%`
    bind.push(like, like, like)
  }
  const order =
    q.sort === 'name' ? 'p.file_name COLLATE NOCASE' : q.sort === 'captureAsc' ? 'p.captured_at, p.file_name' : 'p.captured_at DESC, p.file_name DESC'
  const sql = `SELECT p.id, p.file_name AS fileName, p.captured_at AS capturedAt, p.rating, p.flag,
      p.color_label AS color, p.orientation, EXISTS (SELECT 1 FROM edits e WHERE e.photo_id = p.id) AS edited
    FROM photos p ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order}`
  type Row = Omit<PhotoRow, 'edited'> & { edited: number }
  return (conn().selectObjects(sql, bind) as unknown as Row[]).map((r) => ({ ...r, edited: !!r.edited }))
}

function getEdit(photoId: number): { settings: string; history: string } | null {
  return (conn().selectObject('SELECT settings, history FROM edits WHERE photo_id = ?', [photoId]) as { settings: string; history: string } | undefined) ?? null
}

/** Saves a photo's develop settings and history (JSON strings). */
function saveEdit(photoId: number, settings: string, history: string) {
  conn().exec({
    sql: `INSERT INTO edits (photo_id, settings, history, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT (photo_id) DO UPDATE SET settings = excluded.settings, history = excluded.history, updated_at = excluded.updated_at`,
    bind: [photoId, settings, history, Math.floor(Date.now() / 1000)],
  })
}

function deleteEdit(photoId: number) {
  conn().exec({ sql: 'DELETE FROM edits WHERE photo_id = ?', bind: [photoId] })
}

function getPhoto(id: number): PhotoDetail | null {
  const row = conn().selectObject(
    `SELECT p.id, f.root_id AS rootId, p.folder_id AS folderId, f.path AS folderPath,
       p.file_name AS fileName, p.original_name AS originalName, p.file_type AS fileType,
       p.file_size AS fileSize, p.file_modified AS fileModified, p.captured_at AS capturedAt,
       p.imported_at AS importedAt, p.camera_make AS cameraMake, p.camera_model AS cameraModel, p.lens,
       p.iso, p.shutter, p.aperture, p.focal_length AS focalLength, p.width, p.height, p.orientation,
       p.rating, p.flag, p.color_label AS color
     FROM photos p JOIN folders f ON f.id = p.folder_id WHERE p.id = ?`,
    [id],
  )
  return (row as unknown as PhotoDetail) ?? null
}

function update(column: 'rating' | 'flag' | 'color_label', ids: number[], value: number) {
  const d = conn()
  d.exec('BEGIN')
  try {
    const stmt = d.prepare(`UPDATE photos SET ${column} = ? WHERE id = ?`)
    for (const id of ids) stmt.bind([value, id]).stepReset()
    stmt.finalize()
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
}

/** Removes photos from the catalog only; files on disk are untouched. */
function removePhotos(ids: number[]) {
  const d = conn()
  d.exec('BEGIN')
  const stmt = d.prepare('DELETE FROM photos WHERE id = ?')
  for (const id of ids) stmt.bind([id]).stepReset()
  stmt.finalize()
  d.exec(`DELETE FROM folders WHERE id NOT IN (SELECT DISTINCT folder_id FROM photos)`)
  d.exec(`DELETE FROM roots WHERE id NOT IN (SELECT DISTINCT root_id FROM folders)`)
  d.exec('COMMIT')
}

function listTargets(): { id: number; name: string; target: string }[] {
  return conn().selectObjects('SELECT id, name, target FROM auto_targets ORDER BY name COLLATE NOCASE') as unknown as { id: number; name: string; target: string }[]
}

function saveTarget(name: string, target: string): number {
  conn().exec({ sql: 'INSERT INTO auto_targets (name, target, created_at) VALUES (?, ?, ?)', bind: [name, target, Math.floor(Date.now() / 1000)] })
  return Number(conn().selectValue('SELECT last_insert_rowid()'))
}

function deleteTarget(id: number) {
  conn().exec({ sql: 'DELETE FROM auto_targets WHERE id = ?', bind: [id] })
}

/** Everything needed to write a photo's sidecar. */
function sidecarSource(photoId: number) {
  const p = getPhoto(photoId)
  if (!p) return null
  const edit = getEdit(photoId)
  // Lightroom-style sidecars (name.xmp) are shared by files with the same base name. Like Lightroom with
  // RAW+JPEG pairs, the RAW owns it: a JPEG doesn't write one when a non-JPEG twin is in the library.
  const dot = p.fileName.lastIndexOf('.')
  const base = dot > 0 ? p.fileName.slice(0, dot) : p.fileName
  const isJpeg = /^jpe?g$/i.test(p.fileType)
  const twins = conn().selectObjects(
    `SELECT file_type AS fileType FROM photos
     WHERE folder_id = ?1 AND id <> ?2
       AND lower(substr(file_name, 1, length(?3) + 1)) = lower(?3) || '.'
       AND instr(substr(file_name, length(?3) + 2), '.') = 0`,
    [p.folderId, photoId, base],
  ) as unknown as { fileType: string }[]
  const owner = !(isJpeg && twins.some((t) => !/^jpe?g$/i.test(t.fileType)))
  return { photo: p, settings: edit?.settings ?? null, owner }
}

function markSidecarWritten(photoId: number, at: number) {
  conn().exec({ sql: 'UPDATE photos SET sidecar_written_at = ? WHERE id = ?', bind: [at, photoId] })
}

function stats() {
  return {
    photos: Number(conn().selectValue('SELECT COUNT(*) FROM photos')),
    roots: Number(conn().selectValue('SELECT COUNT(*) FROM roots')),
  }
}

const handlers = {
  open,
  addRoot,
  listRoots,
  folderTree,
  findDuplicates,
  addPhotos,
  queryPhotos,
  getPhoto,
  setRating: (ids: number[], v: number) => update('rating', ids, v),
  setFlag: (ids: number[], v: number) => update('flag', ids, v),
  setColor: (ids: number[], v: number) => update('color_label', ids, v),
  removePhotos,
  getEdit,
  saveEdit,
  deleteEdit,
  listTargets,
  saveTarget,
  deleteTarget,
  sidecarSource,
  markSidecarWritten,
  stats,
}

export type CatalogApi = typeof handlers

exposeRpc(handlers)
