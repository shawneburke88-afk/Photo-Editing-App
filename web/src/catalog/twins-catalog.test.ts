// RAW+JPEG twins in the catalog (owner's feedback 2026-10-19: a Nikon D5200's RAW+JPEG pairs imported from a card
// were not stacked). Schema 16 gives RAWs the camera's clock as capture time (they were this computer's UTC offset
// away from their JPEGs), and stackRawJpegPairs pairs twins that arrived separately (another import, renamed, another
// folder) by their names on the card and capture times. SQLite's in-memory database, in Node.
import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SCHEMA_VERSION } from './schema'

let migrate: (d: Database) => void
let api: typeof import('./catalog.worker').handlers
let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
const tz = env.TZ

beforeAll(async () => {
  vi.stubGlobal('self', { postMessage: () => {} })
  const worker = await import('./catalog.worker')
  migrate = worker.migrate
  api = worker.handlers
  sqlite3 = await sqlite3InitModule()
  await api.open({ inMemory: true })
})
afterAll(() => {
  if (tz === undefined) delete env.TZ
  else env.TZ = tz
})

const T = Date.UTC(2026, 9, 18, 21, 30, 5) / 1000
const photo = (fileName: string, rootId: number, folderPath: string, capturedAt: number, originalName = fileName) => ({
  rootId, folderPath, fileName, originalName, fileType: fileName.split('.').pop()!, fileSize: 1, fileModified: 1, capturedAt,
  cameraMake: 'Nikon', cameraModel: 'D5200', lens: '', iso: 200, shutter: 0, aperture: 0, focalLength: 0, width: 1, height: 1, orientation: 0,
})
const stackOf = (id: number) => api.queryPhotos({ ids: [id], ungrouped: true })[0]?.stackId ?? null

describe('schema 16: RAW capture times', () => {
  it('turns RAW times read as local time back into the camera’s clock, leaving JPEGs as they were', () => {
    expect(SCHEMA_VERSION).toBe(16)
    env.TZ = 'America/Halifax'
    try {
      const d: Database = new sqlite3.oo1.DB(':memory:', 'c')
      migrate(d)
      const shiftedRaw = T + 3 * 3600 // what LibRaw gave on a computer on Atlantic (daylight) time
      d.exec(`
        INSERT INTO roots (id, name) VALUES (1, 'Photos');
        INSERT INTO folders (id, root_id, path) VALUES (1, 1, '2026/2026-10-19');
        INSERT INTO photos (id, folder_id, file_name, original_name, file_type, file_size, file_modified, captured_at, imported_at)
          VALUES (1, 1, 'DSC_0001.NEF', 'DSC_0001.NEF', 'NEF', 1, 1, ${shiftedRaw}, 1), (2, 1, 'DSC_0001.JPG', 'DSC_0001.JPG', 'JPG', 1, 1, ${T}, 1),
                 (3, 1, 'DSC_0002.NEF', 'DSC_0002.NEF', 'NEF', 1, 1, 0, 1);
        PRAGMA user_version = 15;
      `)
      migrate(d)
      expect(d.selectValue('PRAGMA user_version')).toBe(16)
      expect(d.selectObjects('SELECT id, captured_at AS t FROM photos ORDER BY id')).toEqual([{ id: 1, t: T }, { id: 2, t: T }, { id: 3, t: 0 }])
      expect(d.selectValue('PRAGMA integrity_check')).toBe('ok')
    } finally {
      if (tz === undefined) delete env.TZ
      else env.TZ = tz
    }
  })
})

describe('stackRawJpegPairs', () => {
  it('stacks twins in one folder, the RAW on top, whatever the case of the names', () => {
    const root = api.addRoot('Same folder')
    const [raw, jpeg, solo] = api.addPhotos([photo('DSC_0001.NEF', root, 'a', T), photo('dsc_0001.jpg', root, 'a', T), photo('DSC_0003.JPG', root, 'a', T + 9)]) as number[]
    const touched = api.stackRawJpegPairs([raw, jpeg, solo])
    expect(new Set(touched)).toEqual(new Set([raw, jpeg]))
    expect(stackOf(raw)).not.toBeNull()
    expect(stackOf(jpeg)).toBe(stackOf(raw))
    expect(stackOf(solo)).toBeNull()
    const rows = api.queryPhotos({ folder: { rootId: root, path: 'a', recursive: false } })
    expect(rows.map((r) => r.id)).toEqual([solo, raw])
  })

  it('pairs a JPEG with the RAW imported earlier, renamed and in another dated folder (the import was split)', () => {
    const root = api.addRoot('Split imports')
    // First import (stopped, or only some dates ticked): the RAW, renamed.
    const [raw] = api.addPhotos([photo('2026-10-18_0001.NEF', root, '2026/2026-10-18', T, 'DSC_0042.NEF')]) as number[]
    expect(api.stackRawJpegPairs([raw])).toEqual([])
    // Second import: its JPEG, numbered again from 1, and a JPEG of another shot that got the RAW's new name.
    const [jpeg, other] = api.addPhotos([
      photo('2026-10-18_0003.JPG', root, '2026/2026-10-18', T, 'DSC_0042.JPG'),
      photo('2026-10-18_0001.JPG', root, '2026/2026-10-18', T + 600, 'DSC_0050.JPG'),
    ]) as number[]
    api.stackRawJpegPairs([jpeg, other])
    expect(stackOf(jpeg)).toBe(stackOf(raw))
    expect(stackOf(raw)).not.toBeNull()
    expect(stackOf(other)).toBeNull()
  })

  it('leaves a JPEG already in a stack, and joins a RAW’s existing stack', () => {
    const root = api.addRoot('Existing stacks')
    const [raw, burst, jpeg] = api.addPhotos([photo('B.NEF', root, 'b', T), photo('C.NEF', root, 'b', T + 1), photo('B.JPG', root, 'b', T)]) as number[]
    api.createStack([raw, burst], raw)
    api.stackRawJpegPairs([jpeg])
    expect(stackOf(jpeg)).toBe(stackOf(raw))
    const [jpeg2] = api.addPhotos([photo('B.JPG', root, 'c', T)]) as number[]
    api.stackRawJpegPairs([jpeg2])
    expect(stackOf(jpeg2)).toBeNull()
  })
})
