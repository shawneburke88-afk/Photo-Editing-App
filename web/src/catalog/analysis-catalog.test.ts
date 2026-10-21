// Catalog schema 14 (the culling helpers' photo_analysis table, docs/PHASE3.md Part 18) on SQLite's in-memory database:
// the upgrade adds one table and changes nothing else, can be taken back, rows go with their photo; storing, pending
// photos, sorting and filtering by sharpness, Auto-stack by look-alikes, and Apply / Undo of suggested rejects.
import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ANALYSIS_ALGO } from '../engine/analysis/analyze'
import { applyRejects, undoRejects } from '../library/reject-suggestions'
import type { PhotoAnalysis } from './analysis'
import { NEWER_CATALOG_MESSAGE } from './errors'
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

/** Everything in a catalog except photo_analysis (and schema 15's snapshots): schema and rows, to compare before and after. */
function dump(d: Database, skipAnalysis = true) {
  const tables = (d.selectValues("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name") as string[]).filter((t) => !skipAnalysis || (t !== 'photo_analysis' && t !== 'snapshots' && t !== 'import_pending'))
  return {
    schema: d.selectObjects(`SELECT type, name, tbl_name, sql FROM sqlite_schema ${skipAnalysis ? "WHERE tbl_name NOT IN ('photo_analysis', 'snapshots', 'import_pending')" : ''} ORDER BY name`),
    rows: Object.fromEntries(tables.map((t) => [t, d.selectObjects(`SELECT * FROM ${t} ORDER BY rowid`)])),
  }
}

/** A schema-13 catalog holding a few photos with ratings, an edit, keywords and a stack. */
function v13(): Database {
  const d = new sqlite3.oo1.DB(':memory:', 'c')
  migrate(d)
  d.exec('DROP TABLE photo_analysis; DROP TABLE snapshots; DROP TABLE import_pending')
  d.exec(`
    INSERT INTO roots (id, name) VALUES (1, 'Photos');
    INSERT INTO folders (id, root_id, path) VALUES (1, 1, 'day1');
    INSERT INTO stacks (id, uid, top_id) VALUES (1, 'u1', 7);
    INSERT INTO photos (id, folder_id, file_name, original_name, file_type, file_size, file_modified, captured_at, imported_at, rating, flag, stack_id, extras_read)
      VALUES (7, 1, 'A.NEF', 'A.NEF', 'NEF', 100, 1, 2, 3, 4, 1, 1, 1), (8, 1, 'B.NEF', 'B.NEF', 'NEF', 100, 1, 2, 3, 0, -1, 1, 0);
    INSERT INTO edits (photo_id, settings, history, updated_at) VALUES (7, '{"exposure":0.5}', '[]', 9);
    INSERT INTO keywords (id, path) VALUES (1, 'Places');
    INSERT INTO photo_keywords (photo_id, keyword_id) VALUES (7, 1);
    PRAGMA user_version = 13;
  `)
  return d
}

describe('schema 14', () => {
  it('upgrades a version-13 catalog by adding photo_analysis only, empty', () => {
    expect(SCHEMA_VERSION).toBe(17)
    const d = v13()
    const before = dump(d)
    migrate(d)
    expect(d.selectValue('PRAGMA user_version')).toBe(SCHEMA_VERSION)
    expect(dump(d)).toEqual(before)
    expect(d.selectValue('SELECT COUNT(*) FROM photo_analysis')).toBe(0)
    expect(d.selectValue('PRAGMA foreign_key_check')).toBeUndefined()
    expect(d.selectValue('PRAGMA integrity_check')).toBe('ok')
  })

  it('can be taken back: dropping the table gives the version-13 catalog exactly', () => {
    const d = v13()
    const before = dump(d, false)
    migrate(d)
    d.exec(`INSERT INTO photo_analysis (photo_id, algo, analyzed_at) VALUES (7, ${ANALYSIS_ALGO}, 1)`)
    d.exec('DROP TABLE photo_analysis; DROP TABLE snapshots; DROP TABLE import_pending; PRAGMA user_version = 13')
    expect(dump(d, false)).toEqual(before)
    // And up again.
    migrate(d)
    expect(d.selectValue('SELECT COUNT(*) FROM photo_analysis')).toBe(0)
  })

  it('an older LightBench refuses the version-14 catalog without changing it', () => {
    const d = new sqlite3.oo1.DB(':memory:', 'c')
    migrate(d)
    d.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    const before = dump(d, false)
    expect(() => migrate(d)).toThrow(NEWER_CATALOG_MESSAGE)
    expect(dump(d, false)).toEqual(before)
  })

  it('deletes a photo’s analysis with the photo (also when removed with its original)', () => {
    const d = v13()
    migrate(d)
    d.exec(`INSERT INTO photo_analysis (photo_id, algo, analyzed_at) VALUES (7, 1, 1), (8, 1, 1)`)
    d.exec('DELETE FROM photos WHERE id = 7')
    expect(d.selectValues('SELECT photo_id FROM photo_analysis')).toEqual([8])
  })
})

// ---- through the worker's API

const photo = (fileName: string, rootId: number, capturedAt: number, folderPath = '') => ({
  rootId, folderPath, fileName, originalName: fileName, fileType: fileName.split('.').pop()!, fileSize: 1, fileModified: 1, capturedAt,
  cameraMake: 'Test', cameraModel: 'Cam', lens: '', iso: 200, shutter: 0, aperture: 0, focalLength: 0, width: 1, height: 1, orientation: 0,
})

function analysis(p: Partial<PhotoAnalysis> = {}): PhotoAnalysis {
  return {
    algo: ANALYSIS_ALGO, srcW: 3000, srcH: 2000, w: 1536, h: 1024, sharpPeak: 50, sharpSubject: 50, acuity: 0.9, noiseFloor: 5, motion: 0.1,
    motionSubject: 0.1, motionAngle: 0, textured: 0.8, subjectFrom: 'af', subjectBox: { x: 0.5, y: 0.2, w: 0.1, h: 0.1 }, focusU: 0.55, focusV: 0.25,
    clipHi: 0, clipLo: 0, median: 0.4, p005: 0.02, p995: 0.95, dhash: 'f8f9f9f8dcc4fcf8', phash: 'a1b2c3d4e5f60718',
    subSecMs: null, sequence: null, sequenceFrom: '', ...p,
  }
}

describe('storing and reading the analysis', () => {
  it('stores, lists pending originals, counts, and changes nothing else about the photos', () => {
    const root = api.addRoot('Store')
    const [a, b, c] = api.addPhotos([photo('A.NEF', root, 10), photo('B.NEF', root, 20), photo('C.NEF', root, 30)])
    const copy = api.createVirtualCopy(a!)
    const pending = () => api.analysisPending().filter((p) => p.rootId === root).map((p) => p.fileName)
    expect(pending()).toEqual(['A.NEF', 'B.NEF', 'C.NEF'])
    const before = [a, b, c, copy].map((id) => api.getPhoto(id!))
    const sidecarBefore = api.sidecarSource(a!)
    api.saveAnalyses([{ id: a!, a: analysis({ subSecMs: 450, sequence: 12, sequenceFrom: 'nikon-shutter-count' }) }, { id: b!, a: null }])
    expect(pending()).toEqual(['C.NEF'])
    expect([a, b, c, copy].map((id) => api.getPhoto(id!))).toEqual(before)
    expect(api.sidecarSource(a!)).toEqual(sidecarBefore)
    // Read back, also through the virtual copy; a failed one counts as done but has no measures.
    const [ra, rcopy, rb] = api.analysisOf([a!, copy, b!]).sort((x, y) => [a, copy, b].indexOf(x.id) - [a, copy, b].indexOf(y.id))
    expect(ra.a).toEqual(analysis({ subSecMs: 450, sequence: 12, sequenceFrom: 'nikon-shutter-count' }))
    expect(rcopy.a).toEqual(ra.a)
    expect(rb.a).toBeNull()
    const counts = api.analysisCounts()
    expect(counts.failed).toBeGreaterThanOrEqual(1)
    // An older algorithm's result is pending again.
    api.saveAnalyses([{ id: c!, a: analysis({ algo: ANALYSIS_ALGO - 1 }) }])
    expect(pending()).toEqual(['C.NEF'])
    // A photo removed meanwhile is skipped.
    api.removePhotos([c!])
    api.saveAnalyses([{ id: c!, a: analysis() }])
    expect(api.analysisOf([c!])).toEqual([])
  })

  it('"measure all again" clears every result', () => {
    const root = api.addRoot('Clear')
    const [a] = api.addPhotos([photo('A.NEF', root, 10)])
    api.saveAnalyses([{ id: a!, a: analysis() }])
    api.clearAnalysis()
    expect(api.analysisOf([a!])[0].a).toBeNull()
    expect(api.analysisPending().some((p) => p.id === a)).toBe(true)
  })
})

describe('queries with the culling helpers', () => {
  it('orders a burst by sub-second time, sorts and filters by sharpness', () => {
    const root = api.addRoot('Query')
    const names = ['F_0001.JPG', 'F_0002.JPG', 'F_0003.JPG', 'F_0004.JPG']
    const ids = api.addPhotos(names.map((n) => photo(n, root, 1000))) as number[]
    // Frames' sub-second order 3, 1, 4, 2; sharpness 4 > 1 > 2 > 3; frame 2 shaken.
    const sub = [250, 700, 100, 500]
    const sharp = [50, 30, 12, 60]
    api.saveAnalyses(ids.map((id, i) => ({ id, a: analysis({ subSecMs: sub[i], sharpSubject: sharp[i], acuity: sharp[i] / 60, motion: i === 1 ? 0.6 : 0.1 }) })))
    const q = (extra: object) => api.queryPhotos({ folder: { rootId: root, path: '' }, ...extra }).map((r) => r.fileName)
    expect(q({ sort: 'captureAsc' })).toEqual(['F_0003.JPG', 'F_0001.JPG', 'F_0004.JPG', 'F_0002.JPG'])
    expect(q({ sort: 'captureDesc' })).toEqual(['F_0002.JPG', 'F_0004.JPG', 'F_0001.JPG', 'F_0003.JPG'])
    expect(q({ sort: 'sharpDesc' })).toEqual(['F_0004.JPG', 'F_0001.JPG', 'F_0002.JPG', 'F_0003.JPG'])
    expect(q({ sort: 'sharpAsc' })).toEqual(['F_0003.JPG', 'F_0002.JPG', 'F_0001.JPG', 'F_0004.JPG'])
    // They look alike: F_0004 is the best; F_0002 (shake, 50 % as sharp) and F_0003 are suggested.
    const rows = api.queryPhotos({ folder: { rootId: root, path: '' }, sort: 'name' })
    expect(rows[3].cull!.group).toMatchObject({ kind: 'similar', best: true })
    expect(rows[0].cull!.dupOf!.name).toBe('F_0004.JPG')
    expect(rows[3].cull!.focus).toEqual({ u: 0.55, v: 0.25, from: 'af' })
    expect(q({ cull: 'suggested', sort: 'name' })).toEqual(['F_0002.JPG', 'F_0003.JPG'])
    expect(q({ cull: 'soft', sort: 'name' })).toEqual(['F_0002.JPG', 'F_0003.JPG'])
    expect(q({ cull: 'notSoft', sort: 'name' })).toEqual(['F_0001.JPG', 'F_0004.JPG'])
    expect(q({ cull: 'duplicates', sort: 'name' })).toEqual(['F_0001.JPG', 'F_0002.JPG', 'F_0003.JPG'])
    const [late, bad] = api.addPhotos([photo('LATE.JPG', root, 5000), photo('BAD.JPG', root, 6000)])
    api.saveAnalyses([{ id: bad!, a: null }])
    expect(q({ cull: 'unanalysed' })).toEqual(['BAD.JPG', 'LATE.JPG'])
    // Not analysed yet: no verdicts, marked pending, never suggested; one that couldn't be measured is marked failed.
    expect(api.queryPhotos({ ids: [late!] })[0]).toMatchObject({ cull: null, analysisState: 'pending' })
    expect(api.queryPhotos({ ids: [bad!] })[0]).toMatchObject({ cull: null, analysisState: 'failed' })
    expect(api.queryPhotos({ ids: [ids[3]] })[0].analysisState).toBeUndefined()
    expect(q({ cull: 'suggested' })).not.toContain('LATE.JPG')
    api.removePhotos([bad!])
    // Unanalysed photos sort last both ways.
    expect(q({ sort: 'sharpAsc' }).at(-1)).toBe('LATE.JPG')
  })

  it('a stack’s best counts its hidden members, and Auto-stack can require look-alikes and put the sharpest on top', () => {
    const root = api.addRoot('Stacks')
    const ids = api.addPhotos(['S1.JPG', 'S2.JPG', 'S3.JPG', 'OTHER.JPG'].map((n, i) => photo(n, root, 2000 + (i < 3 ? 0 : 1)))) as number[]
    api.saveAnalyses([
      { id: ids[0], a: analysis({ sharpSubject: 30, subSecMs: 100 }) },
      { id: ids[1], a: analysis({ sharpSubject: 55, subSecMs: 200 }) },
      { id: ids[2], a: analysis({ sharpSubject: 40, subSecMs: 300 }) },
      // Taken a second later, but a different scene.
      { id: ids[3], a: analysis({ dhash: '0123456789abcdef', phash: 'fedcba9876543210' }) },
    ])
    // By time only (as before): all four in one stack, the first on top.
    const plain = api.autoStack(ids, 2)
    expect(plain.stacks).toBe(1)
    expect(api.queryPhotos({ folder: { rootId: root, path: '' } }).map((r) => r.fileName)).toEqual(['S1.JPG'])
    api.unstack(ids)
    const r = api.autoStack(ids, 2, { similar: 3, sharpestTop: true })
    expect(r).toMatchObject({ stacks: 1, skipped: 0 })
    const shown = api.queryPhotos({ folder: { rootId: root, path: '' }, sort: 'captureAsc' })
    expect(shown.map((x) => x.fileName)).toEqual(['S2.JPG', 'OTHER.JPG'])
    expect(shown[0].cull!.group).toMatchObject({ kind: 'stack', best: true, size: 3 })
    // Filtered to the soft one, the stack still ranks with its hidden members.
    const soft = api.queryPhotos({ folder: { rootId: root, path: '' }, cull: 'suggested', ungrouped: true })
    expect(soft.map((x) => x.fileName)).toEqual(['S1.JPG'])
    expect(soft[0].cull!.group).toMatchObject({ rank: 3, bestId: ids[1] })
  })
})

describe('applying suggested rejects', () => {
  it('rejects in one step, schedules their sidecars, and Undo puts the flags back', async () => {
    const root = api.addRoot('Apply')
    const ids = api.addPhotos(['A.JPG', 'B.JPG', 'C.JPG'].map((n, i) => photo(n, root, 3000 + i * 100))) as number[]
    api.setRating([ids[0]], 3)
    const scheduled: number[][] = []
    const applied = await applyRejects(api, [ids[0], ids[1]], (x) => scheduled.push(x))
    expect(api.getPhoto(ids[0])!.flag).toBe(-1)
    expect(api.getPhoto(ids[1])!.flag).toBe(-1)
    expect(api.getPhoto(ids[2])!.flag).toBe(0)
    expect(api.getPhoto(ids[0])!.rating).toBe(3)
    expect(scheduled).toEqual([[ids[0], ids[1]]])
    // Meanwhile the owner picks B by hand: Undo leaves that alone.
    api.setFlag([ids[1]], 1)
    expect(await undoRejects(api, applied, (x) => scheduled.push(x))).toBe(1)
    expect(api.getPhoto(ids[0])!.flag).toBe(0)
    expect(api.getPhoto(ids[1])!.flag).toBe(1)
    expect(scheduled[1]).toEqual([ids[0]])
    // A photo removed before Apply is skipped.
    api.removePhotos([ids[2]])
    expect((await applyRejects(api, [ids[2]], () => {})).ids).toEqual([])
  })
})
