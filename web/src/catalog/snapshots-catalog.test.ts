// Catalog schema 15 (snapshots, docs/PHASE3.md Part 19) on SQLite's in-memory database: the upgrade adds one table and
// changes nothing else, can be taken back, an older version refuses it untouched, rows go with their photo; storing and
// listing; virtual copies' own snapshots, in their original's sidecar source and restored from it.
import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../engine/develop/settings'
import { toSidecar, type Snapshot } from '../develop/snapshots'
import { NEWER_CATALOG_MESSAGE } from './errors'
import { SCHEMA_VERSION } from './schema'

let migrate: (d: Database) => void
let api: typeof import('./catalog.worker').handlers
let raw: () => Database
let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>

beforeAll(async () => {
  vi.stubGlobal('self', { postMessage: () => {} })
  const worker = await import('./catalog.worker')
  migrate = worker.migrate
  api = worker.handlers
  raw = worker.openDatabase
  sqlite3 = await sqlite3InitModule()
  await api.open({ inMemory: true })
})

/** Everything in a catalog (optionally without the snapshots table): schema and rows. */
function dump(d: Database, withoutSnapshots = false) {
  const tables = (d.selectValues("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name") as string[]).filter((t) => !withoutSnapshots || (t !== 'snapshots' && t !== 'import_pending'))
  return {
    schema: d.selectObjects(`SELECT type, name, tbl_name, sql FROM sqlite_schema ${withoutSnapshots ? "WHERE tbl_name NOT IN ('snapshots', 'import_pending')" : ''} ORDER BY name`),
    rows: Object.fromEntries(tables.map((t) => [t, d.selectObjects(`SELECT * FROM ${t} ORDER BY rowid`)])),
  }
}

/** A schema-14 catalog (0.6.0) holding photos with ratings, an edit, keywords, an analysis row, a stack and a virtual copy. */
function v14(): Database {
  const d = new sqlite3.oo1.DB(':memory:', 'c')
  migrate(d)
  d.exec('DROP TABLE snapshots; DROP TABLE import_pending')
  d.exec(`
    INSERT INTO roots (id, name) VALUES (1, 'Photos');
    INSERT INTO folders (id, root_id, path) VALUES (1, 1, 'day1');
    INSERT INTO stacks (id, uid, top_id) VALUES (1, 'u1', 7);
    INSERT INTO photos (id, folder_id, file_name, original_name, file_type, file_size, file_modified, captured_at, imported_at, rating, flag, stack_id, extras_read, version, version_name)
      VALUES (7, 1, 'A.NEF', 'A.NEF', 'NEF', 100, 1, 2, 3, 4, 1, 1, 1, 0, NULL), (8, 1, 'B.NEF', 'B.NEF', 'NEF', 100, 1, 2, 3, 0, -1, 1, 0, 0, NULL),
             (9, 1, 'A.NEF', 'A.NEF', 'NEF', 100, 1, 2, 3, 0, 0, 1, 1, 1, 'Copy 1');
    INSERT INTO edits (photo_id, settings, history, updated_at) VALUES (7, '{"exposure":0.5}', '[]', 9);
    INSERT INTO keywords (id, path) VALUES (1, 'Places');
    INSERT INTO photo_keywords (photo_id, keyword_id) VALUES (7, 1);
    INSERT INTO photo_analysis (photo_id, algo, analyzed_at) VALUES (7, 1, 5);
    PRAGMA user_version = 14;
  `)
  return d
}

describe('schema 15', () => {
  it('upgrades a version-14 catalog by adding an empty snapshots table, nothing else', () => {
    expect(SCHEMA_VERSION).toBe(18)
    const d = v14()
    const before = dump(d)
    migrate(d)
    expect(d.selectValue('PRAGMA user_version')).toBe(SCHEMA_VERSION)
    expect(dump(d, true)).toEqual(before)
    expect(d.selectValue('SELECT COUNT(*) FROM snapshots')).toBe(0)
    expect(d.selectValue('PRAGMA foreign_key_check')).toBeUndefined()
    expect(d.selectValue('PRAGMA integrity_check')).toBe('ok')
    // Opening it again changes nothing.
    const after = dump(d)
    migrate(d)
    expect(dump(d)).toEqual(after)
  })

  it('can be taken back: dropping the table gives the version-14 catalog exactly, and up again', () => {
    const d = v14()
    const before = dump(d)
    migrate(d)
    d.exec(`INSERT INTO snapshots (photo_id, uid, name, settings, created_at) VALUES (7, 'x', 'Warm', '{}', 1)`)
    d.exec('DROP TABLE snapshots; DROP TABLE import_pending; PRAGMA user_version = 14')
    expect(dump(d)).toEqual(before)
    migrate(d)
    expect(d.selectValue('SELECT COUNT(*) FROM snapshots')).toBe(0)
  })

  it('a version that doesn’t know 15 refuses it without changing it (as 0.6.0 does with its newer-catalog check)', () => {
    const d = v14()
    migrate(d)
    d.exec(`INSERT INTO snapshots (photo_id, uid, name, settings, created_at) VALUES (7, 'x', 'Warm', '{}', 1)`)
    d.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    const before = dump(d)
    expect(() => migrate(d)).toThrow(NEWER_CATALOG_MESSAGE)
    expect(dump(d)).toEqual(before)
  })

  it('deletes a photo’s snapshots with the photo, and a copy’s with the copy', () => {
    const d = v14()
    migrate(d)
    d.exec(`INSERT INTO snapshots (photo_id, uid, name, settings, created_at) VALUES (7, 'a', 'A', '{}', 1), (8, 'b', 'B', '{}', 1), (9, 'c', 'C', '{}', 1)`)
    d.exec('DELETE FROM photos WHERE id = 9')
    expect(d.selectValues('SELECT uid FROM snapshots ORDER BY uid')).toEqual(['a', 'b'])
    d.exec('DELETE FROM photos WHERE id = 7')
    expect(d.selectValues('SELECT uid FROM snapshots ORDER BY uid')).toEqual(['b'])
  })
})

// ---- through the worker's API

const photo = (fileName: string, rootId: number) => ({
  rootId, folderPath: '', fileName, originalName: fileName, fileType: fileName.split('.').pop()!, fileSize: 1, fileModified: 1, capturedAt: 1,
  cameraMake: '', cameraModel: '', lens: '', iso: 0, shutter: 0, aperture: 0, focalLength: 0, width: 1, height: 1, orientation: 0,
})
const snap = (id: string, name: string, created: number, exposure = 0): Snapshot => ({ id, name, created, settings: { ...DEFAULT_SETTINGS, exposure } })

describe('storing snapshots', () => {
  it('saves and lists them newest first; rows that can’t be read are left out', () => {
    const root = api.addRoot('Snaps')
    const [a] = api.addPhotos([photo('A.NEF', root)])
    api.saveSnapshots(a!, [snap('1', 'First', 1000, 0.1), snap('2', 'Second', 2000, 0.2)])
    expect(api.listSnapshots(a!).map((s) => s.name)).toEqual(['Second', 'First'])
    expect(api.listSnapshots(a!)[1]).toEqual(snap('1', 'First', 1000, 0.1))
    // Replacing the list: rename, update, delete.
    api.saveSnapshots(a!, [{ ...snap('2', 'Renamed', 2000), settings: { ...DEFAULT_SETTINGS, exposure: 1 } }])
    expect(api.listSnapshots(a!)).toEqual([{ ...snap('2', 'Renamed', 2000), settings: { ...DEFAULT_SETTINGS, exposure: 1 } }])
    raw().exec({ sql: `INSERT INTO snapshots (photo_id, uid, name, settings, created_at) VALUES (?, 'bad', 'Bad', 'not json', 5)`, bind: [a!] })
    expect(api.listSnapshots(a!).map((s) => s.id)).toEqual(['2'])
    // Nothing else about the photo changes.
    expect(api.getEdit(a!)).toBeNull()
  })

  it('virtual copies have their own: a new copy starts with none, the sidecar source lists each copy’s, and they come back from it', () => {
    const root = api.addRoot('Copies')
    const [o] = api.addPhotos([photo('O.NEF', root)])
    api.saveSnapshots(o!, [snap('o1', 'Original’s', 1000)])
    const copy = api.createVirtualCopy(o!)
    expect(api.listSnapshots(copy)).toEqual([])
    api.saveSnapshots(copy, [snap('c1', 'Copy’s', 2000, 0.5)])
    expect(api.listSnapshots(o!).map((s) => s.id)).toEqual(['o1'])
    const src = api.sidecarSource(copy)!
    // Writing for a copy writes the original's sidecar: the original's list, and the copy's inside its version entry.
    expect(src.photo.id).toBe(o)
    expect(src.snapshots).toEqual(toSidecar([snap('o1', 'Original’s', 1000)]))
    expect(src.versions).toHaveLength(1)
    expect(src.versions[0].snapshots).toEqual(toSidecar([snap('c1', 'Copy’s', 2000, 0.5)]))
    // A copy without snapshots has no key (its entry is as before snapshots existed).
    const copy2 = api.createVirtualCopy(o!)
    expect(api.sidecarSource(o!)!.versions.find((v) => v.name !== src.versions[0].name)).not.toHaveProperty('snapshots')
    void copy2
    // A fresh library: the copy is made again from the sidecar with its own snapshots; a damaged list is ignored.
    const [n] = api.addPhotos([photo('N.NEF', root)])
    const made = api.restoreVersions(n!, [
      { ...src.versions[0] },
      { name: 'Broken', rating: 0, flag: 0, color: 0, develop: null, keywords: [], collections: [], snapshots: 'oops' as never },
    ])
    expect(made).toHaveLength(2)
    expect(api.listSnapshots(made[0])).toEqual([snap('c1', 'Copy’s', 2000, 0.5)])
    expect(api.listSnapshots(made[1])).toEqual([])
    expect(api.listSnapshots(n!)).toEqual([])
  })

  it('removing a photo from the library removes its snapshots and its copies’', () => {
    const root = api.addRoot('Remove')
    const [o] = api.addPhotos([photo('R.NEF', root)])
    const copy = api.createVirtualCopy(o!)
    api.saveSnapshots(o!, [snap('r1', 'R', 1)])
    api.saveSnapshots(copy, [snap('r2', 'R copy', 1)])
    api.removePhotos([o!])
    expect(raw().selectValue('SELECT COUNT(*) FROM snapshots WHERE uid IN (\'r1\', \'r2\')')).toBe(0)
  })
})
