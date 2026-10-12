// The catalog upgrade to schema 11 (sidecars changed by other apps), on SQLite's in-memory database in Node.
import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { NEWER_CATALOG_MESSAGE } from './errors'

let migrate: (d: Database) => void
let api: typeof import('./catalog.worker').handlers
let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>

beforeAll(async () => {
  // The worker module answers messages on `self`; give it one so it can be imported here.
  vi.stubGlobal('self', { postMessage: () => {} })
  const worker = await import('./catalog.worker')
  migrate = worker.migrate
  api = worker.handlers
  sqlite3 = await sqlite3InitModule()
})

const NEW_COLUMNS = ['sidecar_modified', 'sidecar_size', 'sidecar_fields', 'sidecar_external']
const columns = (d: Database) => (d.selectObjects('PRAGMA table_info(photos)') as { name: string; dflt_value: string | null; notnull: number }[])

/** A schema-10 catalog: today's schema without the version-11 columns, holding one photo. */
function v10(): Database {
  const d = new sqlite3.oo1.DB(':memory:', 'c')
  migrate(d)
  for (const c of NEW_COLUMNS) d.exec(`ALTER TABLE photos DROP COLUMN ${c}`)
  d.exec(`
    INSERT INTO roots (id, name) VALUES (1, 'Photos');
    INSERT INTO folders (id, root_id, path) VALUES (1, 1, 'day1');
    INSERT INTO photos (id, folder_id, file_name, original_name, file_type, file_size, file_modified, captured_at, imported_at, rating, sidecar_written_at)
      VALUES (7, 1, 'A.NEF', 'A.NEF', 'NEF', 100, 1, 2, 3, 4, 1700000000);
    PRAGMA user_version = 10;
  `)
  return d
}

describe('catalog schema 11', () => {
  it('a new catalog gets the sidecar columns', () => {
    const d = new sqlite3.oo1.DB(':memory:', 'c')
    migrate(d)
    expect(d.selectValue('PRAGMA user_version')).toBe(11)
    expect(columns(d).map((c) => c.name)).toEqual(expect.arrayContaining(NEW_COLUMNS))
  })

  it('upgrades a version-10 catalog, keeping its photos, with no record yet', () => {
    const d = v10()
    expect(columns(d).map((c) => c.name)).not.toContain('sidecar_modified')
    migrate(d)
    expect(d.selectValue('PRAGMA user_version')).toBe(11)
    const row = d.selectObject('SELECT id, rating, sidecar_written_at, sidecar_modified, sidecar_size, sidecar_fields, sidecar_external FROM photos')
    expect(row).toEqual({ id: 7, rating: 4, sidecar_written_at: 1700000000, sidecar_modified: null, sidecar_size: null, sidecar_fields: null, sidecar_external: 0 })
    expect(d.selectValue('PRAGMA foreign_key_check')).toBeUndefined()
  })

  it('refuses a newer catalog without changing it', () => {
    const d = new sqlite3.oo1.DB(':memory:', 'c')
    migrate(d)
    d.exec('PRAGMA user_version = 12')
    expect(() => migrate(d)).toThrow(NEWER_CATALOG_MESSAGE)
    expect(d.selectValue('PRAGMA user_version')).toBe(12)
  })

  it('opening an up-to-date catalog again changes nothing', () => {
    const d = new sqlite3.oo1.DB(':memory:', 'c')
    migrate(d)
    const before = columns(d)
    migrate(d)
    expect(columns(d)).toEqual(before)
  })
})

describe('sidecar records', () => {
  const photo = (fileName: string, folderPath = 'day1') => ({
    rootId: 1, folderPath, fileName, originalName: fileName, fileType: fileName.split('.').pop()!, fileSize: 1, fileModified: 1, capturedAt: 1,
    cameraMake: '', cameraModel: '', lens: '', iso: 0, shutter: 0, aperture: 0, focalLength: 0, width: 1, height: 1, orientation: 0,
  })

  it('lists photos that own their sidecar, records reads and writes, and marks changes by other apps', async () => {
    await api.open({ inMemory: true })
    const root = api.addRoot('Photos')
    const [a, b, bj, c] = api.addPhotos([photo('A.NEF'), photo('B.NEF'), photo('B.JPG'), photo('C.jpg', 'day2')].map((p) => ({ ...p, rootId: root })))
    const copy = api.createVirtualCopy(a!)
    const listed = api.sidecarStates(root, '').map((r) => r.fileName).sort()
    // B.JPG's sidecar belongs to B.NEF; the virtual copy lives in A's sidecar.
    expect(listed).toEqual(['A.NEF', 'B.NEF', 'C.jpg'])
    expect(api.sidecarStates(root, 'day2').map((r) => r.id)).toEqual([c])
    expect(api.sidecarStates(root, '').find((r) => r.id === a)).toMatchObject({ modified: null, size: null, external: false, writtenAt: null })

    api.recordSidecar(a!, 123456, 789, '{"rating":1}', 1700000000)
    expect(api.sidecarSource(a!)!.sidecar).toMatchObject({ modified: 123456, size: 789, fields: '{"rating":1}', external: false, writtenAt: 1700000000 })
    // A copy's record is its original's.
    expect(api.sidecarSource(copy)!.sidecar.modified).toBe(123456)

    api.setSidecarExternal([a!, b!], true)
    expect(api.externalSidecars()).toEqual([a, b])
    expect(api.queryPhotos({ ids: api.externalSidecars(), ungrouped: true }).map((r) => r.fileName).sort()).toEqual(['A.NEF', 'B.NEF'])
    // Reading or ignoring records the file again and clears the mark; a read keeps the last write time.
    api.recordSidecar(a!, 999, 800, '{"rating":5}')
    expect(api.externalSidecars()).toEqual([b])
    expect(api.sidecarSource(a!)!.sidecar).toMatchObject({ modified: 999, writtenAt: 1700000000 })
    expect(bj).not.toBeNull()
  })
})
