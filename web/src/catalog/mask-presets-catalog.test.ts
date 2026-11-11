// Schema 18: mask presets (docs/PHASE3.md Part 31) in `mask_presets`, a mask's slider values under a unique name, kept
// in library backups (the whole catalog file) and counted in their summary. SQLite's in-memory database, in Node.
import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { SCHEMA_VERSION } from './schema'
import { checkCatalogImage, summarize } from './backup-db'
import { maskPresetData, maskPresetFromRow } from '../develop/maskSettings'

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

const tables = (d: Database) => d.selectValues("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name") as string[]

describe('schema 18: mask_presets', () => {
  it('upgrades a version-17 catalog by adding the empty table only', () => {
    expect(SCHEMA_VERSION).toBe(18)
    const d: Database = new sqlite3.oo1.DB(':memory:', 'c')
    migrate(d)
    d.exec(`DROP TABLE mask_presets;
      INSERT INTO roots (id, name) VALUES (1, 'Photos');
      INSERT INTO folders (id, root_id, path) VALUES (1, 1, 'a');
      INSERT INTO photos (id, folder_id, file_name, original_name, file_type, file_size, file_modified, captured_at, imported_at) VALUES (1, 1, 'A.NEF', 'A.NEF', 'NEF', 1, 1, 1, 1);
      INSERT INTO presets (name, preset, created_at) VALUES ('Warm', '{"keys":[]}', 1);
      PRAGMA user_version = 17;`)
    const before = { photos: d.selectObjects('SELECT * FROM photos'), presets: d.selectObjects('SELECT * FROM presets'), tables: tables(d) }
    expect(before.tables).not.toContain('mask_presets')
    migrate(d)
    expect(d.selectValue('PRAGMA user_version')).toBe(SCHEMA_VERSION)
    expect(d.selectValue('SELECT count(*) FROM mask_presets')).toBe(0)
    expect(tables(d)).toEqual([...before.tables, 'mask_presets'].sort())
    expect(d.selectObjects('SELECT * FROM photos')).toEqual(before.photos)
    expect(d.selectObjects('SELECT * FROM presets')).toEqual(before.presets)
    expect(d.selectValue('PRAGMA integrity_check')).toBe('ok')
    // Opening it again changes nothing.
    migrate(d)
    expect(d.selectValue('PRAGMA user_version')).toBe(SCHEMA_VERSION)
  })

  it('saves, lists by name, replaces by name, renames and deletes mask presets', () => {
    const face = api.saveMaskPreset('Brighten face', maskPresetData({ adjust: { exposure: 0.4, shadows: 20 }, amount: 100 }))
    const sky = api.saveMaskPreset('  Darken sky ', maskPresetData({ adjust: { exposure: -0.7, dehaze: 15 }, amount: 80 }))
    let rows = api.listMaskPresets()
    expect(rows.map((r) => r.name)).toEqual(['Brighten face', 'Darken sky'])
    expect(rows.map((r) => maskPresetFromRow(r)!.values)).toEqual([
      { adjust: { exposure: 0.4, shadows: 20 }, amount: 100 },
      { adjust: { exposure: -0.7, dehaze: 15 }, amount: 80 },
    ])
    // The same name (any case) replaces that preset's values.
    expect(api.saveMaskPreset('darken SKY', maskPresetData({ adjust: { exposure: -1 }, amount: 100 }))).toBe(sky)
    rows = api.listMaskPresets()
    expect(rows).toHaveLength(2)
    expect(maskPresetFromRow(rows[1])!.values).toEqual({ adjust: { exposure: -1 }, amount: 100 })
    expect(() => api.saveMaskPreset('   ', '{}')).toThrow('Give the preset a name.')
    // Rename: refused onto another preset's name, allowed onto its own in another case.
    expect(() => api.renameMaskPreset(face, 'Darken Sky')).toThrow('Another preset is already called “Darken Sky”.')
    expect(() => api.renameMaskPreset(face, ' ')).toThrow('Give the preset a name.')
    api.renameMaskPreset(face, 'brighten FACE')
    api.renameMaskPreset(sky, 'A darker sky')
    expect(api.listMaskPresets().map((r) => [r.id, r.name])).toEqual([[sky, 'A darker sky'], [face, 'brighten FACE']])
    api.deleteMaskPreset(sky)
    expect(api.listMaskPresets().map((r) => r.name)).toEqual(['brighten FACE'])
    // Develop presets are a separate list.
    expect(api.listPresets().some((r) => r.name === 'brighten FACE')).toBe(false)
  })

  it('travels in a library backup (the catalog file) and is counted in its summary', () => {
    const d: Database = new sqlite3.oo1.DB(':memory:', 'c')
    migrate(d)
    d.exec(`INSERT INTO presets (name, preset, created_at) VALUES ('Warm', '{}', 1);
      INSERT INTO mask_presets (name, preset, created_at) VALUES ('Brighten face', '${maskPresetData({ adjust: { exposure: 0.5 }, amount: 100 })}', 1);`)
    expect(summarize(d).presets).toBe(2)
    const copy: Database = new sqlite3.oo1.DB(':memory:', 'c')
    const bytes = sqlite3.capi.sqlite3_js_db_export(d)
    // The backup's own check of what it wrote.
    expect(checkCatalogImage(sqlite3, bytes)).toMatchObject({ schemaVersion: SCHEMA_VERSION, presets: 2 })
    const p = sqlite3.wasm.allocFromTypedArray(bytes)
    const rc = sqlite3.capi.sqlite3_deserialize(copy.pointer!, 'main', p, bytes.byteLength, bytes.byteLength, sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE)
    expect(rc).toBe(0)
    expect(copy.selectObjects('SELECT name, preset FROM mask_presets').map((r) => maskPresetFromRow({ id: 1, name: String(r.name), preset: String(r.preset) }))).toEqual([
      { id: 1, name: 'Brighten face', values: { adjust: { exposure: 0.5 }, amount: 100 } },
    ])
    // A backup from before mask presets (schema 17) gets the empty table when it is opened.
    copy.exec('DROP TABLE mask_presets; PRAGMA user_version = 17')
    expect(summarize(copy).presets).toBe(1)
    migrate(copy)
    expect(copy.selectValue('SELECT count(*) FROM mask_presets')).toBe(0)
  })
})
