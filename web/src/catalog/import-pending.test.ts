// Schema 17: Import's background details (import/details.ts) are kept with the photo in `import_pending`, written in
// the same transaction as the photo, so a tab closed during an import resumes them on the next start. SQLite's
// in-memory database, in Node.
import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { SCHEMA_VERSION } from './schema'

let migrate: (d: Database) => void
let api: typeof import('./catalog.worker').handlers
let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>

beforeAll(async () => {
  vi.stubGlobal('self', { postMessage: () => {} })
  const worker = await import('./catalog.worker')
  migrate = worker.migrate
  api = worker.handlers
  sqlite3 = await sqlite3InitModule()
  await api.open({ inMemory: true })
})

const photo = (fileName: string, importDetails?: string) => ({
  rootId: 1, folderPath: '2026/2026-10-19', fileName, originalName: fileName, fileType: fileName.split('.').pop()!, fileSize: 1, fileModified: 1,
  capturedAt: 5, cameraMake: 'Nikon', cameraModel: 'D5200', lens: '', iso: 200, shutter: 0, aperture: 0, focalLength: 0, width: 1, height: 1, orientation: 0,
  ...(importDetails === undefined ? {} : { importDetails }),
})

describe('schema 17: import_pending', () => {
  it('upgrades a version-16 catalog by adding the empty table only', () => {
    expect(SCHEMA_VERSION).toBe(18)
    const d: Database = new sqlite3.oo1.DB(':memory:', 'c')
    migrate(d)
    d.exec(`DROP TABLE import_pending;
      INSERT INTO roots (id, name) VALUES (1, 'Photos');
      INSERT INTO folders (id, root_id, path) VALUES (1, 1, 'a');
      INSERT INTO photos (id, folder_id, file_name, original_name, file_type, file_size, file_modified, captured_at, imported_at) VALUES (1, 1, 'A.NEF', 'A.NEF', 'NEF', 1, 1, 1, 1);
      PRAGMA user_version = 16;`)
    const before = d.selectObjects('SELECT * FROM photos')
    migrate(d)
    expect(d.selectValue('PRAGMA user_version')).toBe(SCHEMA_VERSION)
    expect(d.selectValue('SELECT count(*) FROM import_pending')).toBe(0)
    expect(d.selectObjects('SELECT * FROM photos')).toEqual(before)
    expect(d.selectValue('PRAGMA integrity_check')).toBe('ok')
  })

  it('keeps details with photos added with them, lists them oldest first, and forgets them when done or removed', () => {
    const root = api.addRoot('Pictures')
    const ids = api.addPhotos([
      { ...photo('A.NEF', '{"a":1}'), rootId: root },
      { ...photo('B.NEF'), rootId: root },
      { ...photo('C.JPG', '{"c":3}'), rootId: root },
      { ...photo('D.JPG', '{"d":4}'), rootId: root },
    ]) as number[]
    expect(api.importPendingCount()).toBe(3)
    expect(api.importPending(2)).toEqual([{ id: ids[0], details: '{"a":1}' }, { id: ids[2], details: '{"c":3}' }])
    api.importDone([ids[0]])
    expect(api.importPending(10).map((r) => r.id)).toEqual([ids[2], ids[3]])
    // A photo removed from the library takes its pending details with it.
    api.removePhotos([ids[3]])
    expect(api.importPending(10).map((r) => r.id)).toEqual([ids[2]])
    // Added again (already in the library): nothing new is pending.
    expect(api.addPhotos([{ ...photo('A.NEF', '{"again":1}'), rootId: root }])).toEqual([null])
    expect(api.importPendingCount()).toBe(1)
  })
})
