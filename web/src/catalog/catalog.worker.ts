/// <reference lib="webworker" />
// The library catalog: one SQLite database stored in the browser's private storage (OPFS).
import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm'
import { exposeRpc } from '../lib/rpc'
import { compileSmart, type SmartRules } from './smart'
import type { CollectionInfo, DuplicateKey, FolderNode, LibraryRoot, NewPhoto, PhotoDetail, PhotoQuery, PhotoRow } from './types'

const DB_FILE = '/lightbench-catalog.sqlite3'
const SCHEMA_VERSION = 6

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
    if (version < 5) {
      // Hierarchical keywords, stored as darktable stores tags: "Places|Canada|Ottawa". keywords_read marks photos
      // whose sidecar keywords are already in the catalog; photos added before keywords existed get 0, so their
      // sidecar's keywords are read before LightBench first rewrites it (otherwise they would be lost).
      d.exec(`
        CREATE TABLE keywords (
          id INTEGER PRIMARY KEY,
          path TEXT NOT NULL UNIQUE COLLATE NOCASE
        );
        CREATE TABLE photo_keywords (
          photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
          keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
          PRIMARY KEY (photo_id, keyword_id)
        );
        CREATE INDEX photo_keywords_keyword ON photo_keywords(keyword_id);
        ALTER TABLE photos ADD COLUMN keywords_read INTEGER NOT NULL DEFAULT 0;
      `)
    }
    if (version < 6) {
      // Collections: manual ones (also written to each photo's sidecar so they can be rebuilt), smart ones
      // (saved rules), and Lightroom's Quick Collection. Names are unique, ignoring case.
      d.exec(`
        CREATE TABLE collections (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          kind TEXT NOT NULL CHECK (kind IN ('manual', 'smart', 'quick')),
          rules TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE collection_photos (
          collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
          photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
          added_at INTEGER NOT NULL,
          PRIMARY KEY (collection_id, photo_id)
        );
        CREATE INDEX collection_photos_photo ON collection_photos(photo_id);
        INSERT INTO collections (name, kind, created_at) VALUES ('Quick Collection', 'quick', strftime('%s', 'now'));
      `)
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

/**
 * Moves every folder of root `childId` under root `parentId` at `prefix`, then deletes the child root. Used
 * when the user opens a folder that contains a folder already in the library, so no photo is listed twice.
 */
function adoptRoot(childId: number, parentId: number, prefix: string) {
  const d = conn()
  d.exec('BEGIN')
  try {
    d.exec({
      sql: `UPDATE folders SET root_id = ?1, path = CASE WHEN path = '' THEN ?3 ELSE ?3 || '/' || path END WHERE root_id = ?2`,
      bind: [parentId, childId, prefix],
    })
    d.exec({ sql: 'DELETE FROM roots WHERE id = ?', bind: [childId] })
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
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

/** Files already catalogued under a folder of a root (and its subfolders), as "folder/name" paths. */
function listFiles(rootId: number, path: string): string[] {
  const rows = conn().selectObjects(
    `SELECT f.path, p.file_name AS name FROM photos p JOIN folders f ON f.id = p.folder_id
     WHERE f.root_id = ?1 AND (?2 = '' OR f.path = ?2 OR substr(f.path, 1, length(?2) + 1) = ?2 || '/')`,
    [rootId, path],
  ) as unknown as { path: string; name: string }[]
  return rows.map((r) => (r.path ? `${r.path}/${r.name}` : r.name))
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
        width, height, orientation, keywords_read)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
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
  if (q.folder?.recursive === false) {
    where.push('p.folder_id IN (SELECT id FROM folders WHERE root_id = ?1 AND path = ?2)')
    bind.push(q.folder.rootId, q.folder.path)
  } else if (q.folder) {
    // Prefix match without LIKE, so "_" and "%" in folder names aren't treated as wildcards.
    where.push(`p.folder_id IN (SELECT id FROM folders WHERE root_id = ?1
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
  if (q.collection !== undefined) {
    const c = conn().selectObject('SELECT kind, rules FROM collections WHERE id = ?', [q.collection]) as { kind: string; rules: string | null } | undefined
    if (!c) {
      where.push('0')
    } else if (c.kind === 'smart') {
      const smart = compileSmart(parseRules(c.rules))
      where.push(smart.sql)
      bind.push(...smart.bind)
    } else {
      where.push('p.id IN (SELECT photo_id FROM collection_photos WHERE collection_id = ?)')
      bind.push(q.collection)
    }
  }
  if (q.keyword) {
    where.push(`EXISTS (SELECT 1 FROM photo_keywords pk JOIN keywords k ON k.id = pk.keyword_id WHERE pk.photo_id = p.id AND ${KEYWORD_UNDER})`)
    bind.push(q.keyword, q.keyword, q.keyword)
  }
  if (q.text?.trim()) {
    where.push(`(p.file_name LIKE ? OR p.camera_model LIKE ? OR p.lens LIKE ?
      OR EXISTS (SELECT 1 FROM photo_keywords pk JOIN keywords k ON k.id = pk.keyword_id WHERE pk.photo_id = p.id AND k.path LIKE ?))`)
    const like = `%${q.text.trim()}%`
    bind.push(like, like, like, like)
  }
  const order =
    q.sort === 'name' ? 'p.file_name COLLATE NOCASE' : q.sort === 'captureAsc' ? 'p.captured_at, p.file_name' : 'p.captured_at DESC, p.file_name DESC'
  const sql = `SELECT p.id, p.file_name AS fileName, p.captured_at AS capturedAt, p.rating, p.flag,
      p.color_label AS color, p.orientation, EXISTS (SELECT 1 FROM edits e WHERE e.photo_id = p.id) AS edited,
      EXISTS (SELECT 1 FROM collection_photos cp JOIN collections c ON c.id = cp.collection_id
              WHERE cp.photo_id = p.id AND c.kind = 'quick') AS quick
    FROM photos p ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order}`
  type Row = Omit<PhotoRow, 'edited' | 'quick'> & { edited: number; quick: number }
  return (conn().selectObjects(sql, bind) as unknown as Row[]).map((r) => ({ ...r, edited: !!r.edited, quick: !!r.quick }))
}

// ---- keywords

/** Matches a keyword path and everything below it ("Places" matches "Places|Canada|Ottawa"). */
const KEYWORD_UNDER = `(lower(k.path) = lower(?) OR substr(lower(k.path), 1, length(?) + 1) = lower(?) || '|')`

/** Every keyword with the number of photos it is attached to directly. */
function listKeywords(): { path: string; count: number }[] {
  return conn().selectObjects(
    `SELECT k.path, COUNT(pk.photo_id) AS count FROM keywords k LEFT JOIN photo_keywords pk ON pk.keyword_id = k.id
     GROUP BY k.id ORDER BY k.path COLLATE NOCASE`,
  ) as unknown as { path: string; count: number }[]
}

/** Keywords on any of `ids`, each with how many of them carry it. */
function keywordsOf(ids: number[]): { path: string; count: number }[] {
  if (!ids.length) return []
  return conn().selectObjects(
    `SELECT k.path, COUNT(*) AS count FROM photo_keywords pk JOIN keywords k ON k.id = pk.keyword_id
     WHERE pk.photo_id IN (${ids.map(() => '?').join(',')}) GROUP BY k.id ORDER BY k.path COLLATE NOCASE`,
    ids,
  ) as unknown as { path: string; count: number }[]
}

function keywordId(path: string): number {
  const d = conn()
  d.exec({ sql: 'INSERT OR IGNORE INTO keywords(path) VALUES (?)', bind: [path] })
  return Number(d.selectValue('SELECT id FROM keywords WHERE path = ?', [path]))
}

function inTransaction<T>(fn: () => T): T {
  const d = conn()
  d.exec('BEGIN')
  try {
    const r = fn()
    d.exec('COMMIT')
    return r
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
}

/** Attaches keywords (already normalised paths) to photos. */
function addKeywords(ids: number[], paths: string[]) {
  inTransaction(() => {
    const stmt = conn().prepare('INSERT OR IGNORE INTO photo_keywords(photo_id, keyword_id) VALUES (?, ?)')
    for (const path of paths) {
      const kid = keywordId(path)
      for (const id of ids) stmt.bind([id, kid]).stepReset()
    }
    stmt.finalize()
  })
}

/** Detaches keywords from photos (the keywords stay in the keyword list). */
function removeKeywords(ids: number[], paths: string[]) {
  inTransaction(() => {
    const stmt = conn().prepare('DELETE FROM photo_keywords WHERE photo_id = ? AND keyword_id = (SELECT id FROM keywords WHERE path = ?)')
    for (const path of paths) for (const id of ids) stmt.bind([id, path]).stepReset()
    stmt.finalize()
  })
}

/** Deletes a keyword and everything below it from the library; returns the photos that carried them. */
function deleteKeyword(path: string): number[] {
  return inTransaction(() => {
    const ids = (conn().selectObjects(
      `SELECT DISTINCT pk.photo_id AS id FROM photo_keywords pk JOIN keywords k ON k.id = pk.keyword_id WHERE ${KEYWORD_UNDER}`,
      [path, path, path],
    ) as unknown as { id: number }[]).map((r) => r.id)
    conn().exec({ sql: `DELETE FROM keywords AS k WHERE ${KEYWORD_UNDER}`, bind: [path, path, path] })
    return ids
  })
}

function photoKeywords(photoId: number): string[] {
  return (conn().selectObjects(
    'SELECT k.path FROM photo_keywords pk JOIN keywords k ON k.id = pk.keyword_id WHERE pk.photo_id = ? ORDER BY k.path COLLATE NOCASE',
    [photoId],
  ) as unknown as { path: string }[]).map((r) => r.path)
}

/** Photos under a folder whose sidecar keywords haven't been read yet (added before keywords existed). */
function photosWithUnreadKeywords(rootId: number, path: string): { id: number; folderPath: string; fileName: string }[] {
  return conn().selectObjects(
    `SELECT p.id, f.path AS folderPath, p.file_name AS fileName FROM photos p JOIN folders f ON f.id = p.folder_id
     WHERE p.keywords_read = 0 AND f.root_id = ?1 AND (?2 = '' OR f.path = ?2 OR substr(f.path, 1, length(?2) + 1) = ?2 || '/')`,
    [rootId, path],
  ) as unknown as { id: number; folderPath: string; fileName: string }[]
}

function markKeywordsRead(photoId: number) {
  conn().exec({ sql: 'UPDATE photos SET keywords_read = 1 WHERE id = ?', bind: [photoId] })
}

// ---- collections

function parseRules(text: string | null): SmartRules {
  try {
    const r = JSON.parse(text ?? '') as SmartRules
    return r && Array.isArray(r.rules) ? r : { match: 'all', rules: [] }
  } catch {
    return { match: 'all', rules: [] }
  }
}

function countSmart(rules: SmartRules): number {
  const c = compileSmart(rules)
  return Number(conn().selectValue(`SELECT COUNT(*) FROM photos p WHERE ${c.sql}`, c.bind))
}

/** All collections with their photo counts (smart ones counted by running their rules). */
function listCollections(): CollectionInfo[] {
  const rows = conn().selectObjects(
    `SELECT c.id, c.name, c.kind, c.rules, (SELECT COUNT(*) FROM collection_photos cp WHERE cp.collection_id = c.id) AS count
     FROM collections c ORDER BY c.kind = 'quick' DESC, c.name COLLATE NOCASE`,
  ) as unknown as (CollectionInfo & { rules: string | null })[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    count: r.kind === 'smart' ? countSmart(parseRules(r.rules)) : r.count,
    rules: r.kind === 'smart' ? parseRules(r.rules) : undefined,
  }))
}

function nameTaken(name: string, exceptId = -1): boolean {
  return conn().selectValue('SELECT 1 FROM collections WHERE name = ? AND id <> ?', [name, exceptId]) !== undefined
}

/** Creates a manual or smart collection; throws a user-facing message if the name is taken. */
function createCollection(name: string, kind: 'manual' | 'smart', rules?: SmartRules): number {
  const n = name.trim()
  if (!n) throw new Error('Give the collection a name.')
  if (nameTaken(n)) throw new Error(`There is already a collection called “${n}”.`)
  conn().exec({
    sql: 'INSERT INTO collections (name, kind, rules, created_at) VALUES (?, ?, ?, ?)',
    bind: [n, kind, kind === 'smart' ? JSON.stringify(rules ?? { match: 'all', rules: [] }) : null, Math.floor(Date.now() / 1000)],
  })
  return Number(conn().selectValue('SELECT last_insert_rowid()'))
}

function memberIds(id: number): number[] {
  return (conn().selectObjects('SELECT photo_id AS id FROM collection_photos WHERE collection_id = ?', [id]) as unknown as { id: number }[]).map((r) => r.id)
}

/** Renames a collection (and replaces a smart collection's rules); returns members whose sidecars name it. */
function updateCollection(id: number, name: string, rules?: SmartRules): number[] {
  const n = name.trim()
  if (!n) throw new Error('Give the collection a name.')
  if (nameTaken(n, id)) throw new Error(`There is already a collection called “${n}”.`)
  const kind = conn().selectValue('SELECT kind FROM collections WHERE id = ?', [id])
  if (kind === 'quick') throw new Error('The Quick Collection can’t be renamed.')
  conn().exec({ sql: 'UPDATE collections SET name = ?, rules = COALESCE(?, rules) WHERE id = ?', bind: [n, rules ? JSON.stringify(rules) : null, id] })
  return kind === 'manual' ? memberIds(id) : []
}

/** Deletes a collection (never the photos); returns members whose sidecars named it. */
function deleteCollection(id: number): number[] {
  const kind = conn().selectValue('SELECT kind FROM collections WHERE id = ?', [id])
  if (kind === 'quick') throw new Error('The Quick Collection can’t be deleted; clear it instead.')
  const ids = kind === 'manual' ? memberIds(id) : []
  conn().exec({ sql: 'DELETE FROM collections WHERE id = ?', bind: [id] })
  return ids
}

function addToCollection(id: number, ids: number[]) {
  inTransaction(() => {
    const now = Math.floor(Date.now() / 1000)
    const stmt = conn().prepare('INSERT OR IGNORE INTO collection_photos (collection_id, photo_id, added_at) VALUES (?, ?, ?)')
    for (const pid of ids) stmt.bind([id, pid, now]).stepReset()
    stmt.finalize()
  })
}

function removeFromCollection(id: number, ids: number[]) {
  inTransaction(() => {
    const stmt = conn().prepare('DELETE FROM collection_photos WHERE collection_id = ? AND photo_id = ?')
    for (const pid of ids) stmt.bind([id, pid]).stepReset()
    stmt.finalize()
  })
}

const quickId = () => Number(conn().selectValue("SELECT id FROM collections WHERE kind = 'quick'"))

/** Lightroom's B: adds the photos to the Quick Collection, or removes them if they are all in it already. */
function toggleQuick(ids: number[]): boolean {
  const q = quickId()
  const inside = Number(conn().selectValue(
    `SELECT COUNT(*) FROM collection_photos WHERE collection_id = ? AND photo_id IN (${ids.map(() => '?').join(',') || 'NULL'})`,
    [q, ...ids],
  ))
  if (inside === ids.length) {
    removeFromCollection(q, ids)
    return false
  }
  addToCollection(q, ids)
  return true
}

function clearQuick() {
  conn().exec({ sql: 'DELETE FROM collection_photos WHERE collection_id = ?', bind: [quickId()] })
}

/** Manual collections holding any of `ids`, with how many of them each holds. */
function collectionsOf(ids: number[]): { id: number; name: string; count: number }[] {
  if (!ids.length) return []
  return conn().selectObjects(
    `SELECT c.id, c.name, COUNT(*) AS count FROM collection_photos cp JOIN collections c ON c.id = cp.collection_id
     WHERE c.kind = 'manual' AND cp.photo_id IN (${ids.map(() => '?').join(',')}) GROUP BY c.id ORDER BY c.name COLLATE NOCASE`,
    ids,
  ) as unknown as { id: number; name: string; count: number }[]
}

/** From a sidecar: puts the photo into manual collections by name, creating any that don't exist. */
function addToCollectionsByName(photoId: number, names: string[]) {
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    const row = conn().selectObject('SELECT id, kind FROM collections WHERE name = ?', [name]) as { id: number; kind: string } | undefined
    // A smart collection or the Quick Collection with the same name: leave it alone rather than mixing kinds.
    if (row && row.kind !== 'manual') continue
    addToCollection(row ? row.id : createCollection(name, 'manual'), [photoId])
  }
}

function photoCollections(photoId: number): string[] {
  return (conn().selectObjects(
    `SELECT c.name FROM collection_photos cp JOIN collections c ON c.id = cp.collection_id
     WHERE cp.photo_id = ? AND c.kind = 'manual' ORDER BY c.name COLLATE NOCASE`,
    [photoId],
  ) as unknown as { name: string }[]).map((r) => r.name)
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
  const keywordsRead = Number(conn().selectValue('SELECT keywords_read FROM photos WHERE id = ?', [photoId])) === 1
  return { photo: p, settings: edit?.settings ?? null, owner, keywords: photoKeywords(photoId), keywordsRead, collections: photoCollections(photoId) }
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
  adoptRoot,
  listRoots,
  folderTree,
  findDuplicates,
  listFiles,
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
  listKeywords,
  keywordsOf,
  addKeywords,
  removeKeywords,
  deleteKeyword,
  photoKeywords,
  markKeywordsRead,
  photosWithUnreadKeywords,
  listCollections,
  countSmart,
  createCollection,
  updateCollection,
  deleteCollection,
  addToCollection,
  removeFromCollection,
  toggleQuick,
  clearQuick,
  collectionsOf,
  addToCollectionsByName,
  markSidecarWritten,
  stats,
}

export type CatalogApi = typeof handlers

exposeRpc(handlers)
