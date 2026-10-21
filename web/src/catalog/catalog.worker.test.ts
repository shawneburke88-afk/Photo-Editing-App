// The catalog upgrades to schema 11 (sidecars changed by other apps), 12 (GPS) and 13 (the one-time refresh of older
// photos), on SQLite's in-memory database in Node.
import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { NEWER_CATALOG_MESSAGE } from './errors'
import { SCHEMA_VERSION } from './schema'

let migrate: (d: Database) => void
let api: typeof import('./catalog.worker').handlers
let pendingDb: () => Database
let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>

beforeAll(async () => {
  // The worker module answers messages on `self`; give it one so it can be imported here.
  vi.stubGlobal('self', { postMessage: () => {} })
  const worker = await import('./catalog.worker')
  migrate = worker.migrate
  api = worker.handlers
  pendingDb = worker.openDatabase
  sqlite3 = await sqlite3InitModule()
})

const NEW_COLUMNS = ['sidecar_modified', 'sidecar_size', 'sidecar_fields', 'sidecar_external']
const GPS_COLUMNS = ['gps_lat', 'gps_lon', 'gps_alt']
const REFRESH_COLUMNS = ['extras_read']
const columns = (d: Database) => (d.selectObjects('PRAGMA table_info(photos)') as { name: string; dflt_value: string | null; notnull: number }[])

/** A schema-10 catalog: today's schema without the version-11, 12 and 13 columns and the version-14 and 15 tables, holding one photo. */
function v10(): Database {
  const d = new sqlite3.oo1.DB(':memory:', 'c')
  migrate(d)
  d.exec('DROP TABLE photo_analysis; DROP TABLE snapshots')
  for (const c of [...NEW_COLUMNS, ...GPS_COLUMNS, ...REFRESH_COLUMNS]) d.exec(`ALTER TABLE photos DROP COLUMN ${c}`)
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
    expect(d.selectValue('PRAGMA user_version')).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(16)
    expect(columns(d).map((c) => c.name)).toEqual(expect.arrayContaining([...NEW_COLUMNS, ...GPS_COLUMNS, ...REFRESH_COLUMNS]))
  })

  it('upgrades a version-10 catalog, keeping its photos, with no record yet', () => {
    const d = v10()
    expect(columns(d).map((c) => c.name)).not.toContain('sidecar_modified')
    migrate(d)
    expect(d.selectValue('PRAGMA user_version')).toBe(SCHEMA_VERSION)
    const row = d.selectObject('SELECT id, rating, sidecar_written_at, sidecar_modified, sidecar_size, sidecar_fields, sidecar_external FROM photos')
    expect(row).toEqual({ id: 7, rating: 4, sidecar_written_at: 1700000000, sidecar_modified: null, sidecar_size: null, sidecar_fields: null, sidecar_external: 0 })
    expect(d.selectValue('PRAGMA foreign_key_check')).toBeUndefined()
  })

  it('refuses a newer catalog without changing it', () => {
    const d = new sqlite3.oo1.DB(':memory:', 'c')
    migrate(d)
    d.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    expect(() => migrate(d)).toThrow(NEWER_CATALOG_MESSAGE)
    expect(d.selectValue('PRAGMA user_version')).toBe(SCHEMA_VERSION + 1)
  })

  it('upgrades a version-11 catalog to 12: GPS columns, empty for photos already there', () => {
    const d = v10()
    migrate(d)
    d.exec('DROP TABLE photo_analysis; DROP TABLE snapshots')
    for (const c of [...GPS_COLUMNS, ...REFRESH_COLUMNS]) d.exec(`ALTER TABLE photos DROP COLUMN ${c}`)
    d.exec('PRAGMA user_version = 11')
    migrate(d)
    expect(d.selectValue('PRAGMA user_version')).toBe(SCHEMA_VERSION)
    expect(d.selectObject('SELECT id, rating, gps_lat, gps_lon, gps_alt FROM photos')).toEqual({ id: 7, rating: 4, gps_lat: null, gps_lon: null, gps_alt: null })
  })

  it('upgrades a version-12 catalog to 13: photos already there are marked for the refresh, nothing else changes', () => {
    const d = v10()
    migrate(d)
    d.exec('UPDATE photos SET gps_lat = 1.5, gps_lon = 2.5')
    const before = d.selectObject('SELECT * FROM photos')!
    d.exec('DROP TABLE photo_analysis; DROP TABLE snapshots')
    d.exec('ALTER TABLE photos DROP COLUMN extras_read')
    d.exec('PRAGMA user_version = 12')
    migrate(d)
    expect(d.selectValue('PRAGMA user_version')).toBe(SCHEMA_VERSION)
    expect(d.selectObject('SELECT * FROM photos')).toEqual({ ...before, extras_read: 0 })
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

  it('lists photos with their sidecar owner, records reads and writes, and marks changes by other apps', async () => {
    await api.open({ inMemory: true })
    const root = api.addRoot('Photos')
    const [a, b, bj, c] = api.addPhotos([photo('A.NEF'), photo('B.NEF'), photo('B.JPG'), photo('C.jpg', 'day2')].map((p) => ({ ...p, rootId: root })))
    const copy = api.createVirtualCopy(a!)
    const listed = api.sidecarStates(root, '').map((r) => `${r.fileName}:${r.owner}`).sort()
    // B.NEF owns B.xmp; B.JPG has its own B.JPG.xmp. The virtual copy lives in A's sidecar.
    expect(listed).toEqual(['A.NEF:true', 'B.JPG:false', 'B.NEF:true', 'C.jpg:true'])
    expect(api.sidecarSource(b!)!.owner).toBe(true)
    expect(api.sidecarSource(bj!)!.owner).toBe(false)
    expect(api.sidecarSource(c!)!.owner).toBe(true)
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

  it('stores and returns where a photo was taken', async () => {
    await api.open({ inMemory: true })
    const root = api.addRoot('GPS')
    const [a, b] = api.addPhotos([
      { ...photo('G.NEF'), rootId: root, gpsLat: 45.4215, gpsLon: -75.6972, gpsAlt: 70.5 },
      { ...photo('H.jpg'), rootId: root },
    ])
    expect(api.getPhoto(a!)).toMatchObject({ gpsLat: 45.4215, gpsLon: -75.6972, gpsAlt: 70.5 })
    expect(api.getPhoto(b!)).toMatchObject({ gpsLat: null, gpsLon: null, gpsAlt: null })
  })
})

describe('the one-time refresh of older photos (schema 13)', () => {
  const photo = (fileName: string, rootId: number, folderPath = '') => ({
    rootId, folderPath, fileName, originalName: fileName, fileType: fileName.split('.').pop()!, fileSize: 1, fileModified: 1, capturedAt: 1,
    cameraMake: '', cameraModel: '', lens: '', iso: 0, shutter: 0, aperture: 0, focalLength: 0, width: 1, height: 1, orientation: 0,
  })
  const row = (id: number) => api.getPhoto(id)

  it('lists only photos added before it, by file, and stores GPS without touching anything else', async () => {
    await api.open({ inMemory: true })
    const root = api.addRoot('Refresh')
    const [a, b, c] = api.addPhotos([photo('A.ARW', root, 'x'), photo('B.NEF', root, 'x'), photo('C.jpg', root, 'y')])
    // New photos are already done.
    expect(api.extrasPending().filter((p) => p.rootId === root)).toEqual([])
    // As if added before schema 13: rated, flagged, labelled, keyworded, edited, with a virtual copy.
    api.setRating([a!], 4)
    api.setFlag([a!], 1)
    api.setColor([a!], 2)
    api.addKeywords([a!], ['Places|Ottawa'])
    api.saveEdit(b!, '{"exposure":0.5}', '{"steps":[],"index":0}')
    api.setRating([b!], 3)
    const copy = api.createVirtualCopy(a!)
    // A position already stored (photo added after schema 12) is kept unless the file has another.
    const stored = { lat: 10, lon: 20, alt: null }
    api.saveExtras([c!], stored)
    for (const id of [a!, b!, c!, copy]) setPending(id)
    expect(api.extrasPending().filter((p) => p.rootId === root).map((p) => [p.folderPath, p.fileName, p.id])).toEqual([
      ['x', 'A.ARW', a], ['x', 'A.ARW', copy], ['x', 'B.NEF', b], ['y', 'C.jpg', c],
    ])
    const beforeA = row(a!)
    const beforeB = row(b!)
    const keywordsA = api.photoKeywords(a!)
    const editB = api.getEdit(b!)

    expect(api.isEdited(a!)).toBe(false)
    expect(api.isEdited(b!)).toBe(true)
    // A's file has a position: the original and its copy get it.
    expect(api.saveExtras([a!, copy], { lat: 45.42153, lon: -75.69723, alt: 70.5 })).toBe(2)
    // B's has none: nothing is cleared. C's has none either: its stored position stays.
    expect(api.saveExtras([b!], null)).toBe(0)
    expect(api.saveExtras([c!], null)).toBe(0)
    expect(api.extrasPending().filter((p) => p.rootId === root)).toEqual([])

    expect(row(a!)).toEqual({ ...beforeA, gpsLat: 45.42153, gpsLon: -75.69723, gpsAlt: 70.5 })
    expect(row(copy)).toMatchObject({ gpsLat: 45.42153, gpsLon: -75.69723, rating: 4, flag: 1, color: 2 })
    expect(row(b!)).toEqual(beforeB)
    expect(row(c!)).toMatchObject({ gpsLat: 10, gpsLon: 20, gpsAlt: null })
    expect(api.photoKeywords(a!)).toEqual(keywordsA)
    expect(api.getEdit(b!)).toEqual(editB)
    // The refresh records nothing about sidecars.
    expect(api.sidecarSource(a!)!.sidecar).toMatchObject({ modified: null, size: null, writtenAt: null, external: false })
  })

  it('gives a virtual copy its original’s position and refresh state', async () => {
    await api.open({ inMemory: true })
    const root = api.addRoot('Copies')
    const [a] = api.addPhotos([{ ...photo('G.NEF', root), gpsLat: -33.8599, gpsLon: 151.2112, gpsAlt: 58 }])
    expect(row(api.createVirtualCopy(a!))).toMatchObject({ gpsLat: -33.8599, gpsLon: 151.2112, gpsAlt: 58 })
    setPending(a!)
    const copy = api.createVirtualCopy(a!)
    expect(api.extrasPending().map((p) => p.id)).toEqual(expect.arrayContaining([a, copy]))
    api.saveExtras([a!, copy], null)
  })
})

/** Marks a photo as added before schema 13 (the worker exposes no setter: the migration is what sets 0). */
function setPending(id: number) {
  pendingDb().exec({ sql: 'UPDATE photos SET extras_read = 0 WHERE id = ?', bind: [id] })
}
