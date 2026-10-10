/// <reference lib="webworker" />
// Catalog spike: can SQLite running in the browser (stored in OPFS) handle a large photo library?
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

export interface CatalogBenchRequest {
  photos: number
}

export interface CatalogBenchResult {
  sqliteVersion: string
  storage: 'opfs-sahpool' | 'memory'
  storageNote?: string
  timings: { label: string; ms: number; rows?: number }[]
  dbSizeBytes: number
}

const DB_NAME = '/lightbench-benchmark.sqlite3'

self.onmessage = async (e: MessageEvent<CatalogBenchRequest>) => {
  try {
    self.postMessage({ ok: true, result: await run(e.data.photos) })
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

async function run(photos: number): Promise<CatalogBenchResult> {
  const timings: CatalogBenchResult['timings'] = []
  const time = <T>(label: string, fn: () => T, rows?: (r: T) => number): T => {
    const t = performance.now()
    const r = fn()
    timings.push({ label, ms: performance.now() - t, rows: rows?.(r) })
    return r
  }

  const sqlite3 = await sqlite3InitModule()
  let storage: CatalogBenchResult['storage'] = 'memory'
  let storageNote: string | undefined
  let db
  let pool: Awaited<ReturnType<typeof sqlite3.installOpfsSAHPoolVfs>> | null = null
  try {
    pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'lightbench-bench', directory: '.lightbench-bench' })
    pool.unlink(DB_NAME)
    db = new pool.OpfsSAHPoolDb(DB_NAME)
    storage = 'opfs-sahpool'
  } catch (err) {
    storageNote = `Persistent storage unavailable, used memory instead: ${err instanceof Error ? err.message : err}`
    db = new sqlite3.oo1.DB(':memory:', 'c')
  }

  try {
    db.exec(`
      CREATE TABLE folders (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE);
      CREATE TABLE photos (
        id INTEGER PRIMARY KEY,
        folder_id INTEGER NOT NULL REFERENCES folders(id),
        file_name TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        camera TEXT, lens TEXT, iso INTEGER,
        rating INTEGER NOT NULL DEFAULT 0,
        flag INTEGER NOT NULL DEFAULT 0,
        color_label INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE keywords (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
      CREATE TABLE photo_keywords (photo_id INTEGER, keyword_id INTEGER, PRIMARY KEY (photo_id, keyword_id)) WITHOUT ROWID;
    `)

    const cameras = ['Nikon Z 6II', 'Nikon D750', 'Sony ILCE-7M4', 'Sony ILCE-6400']
    const lenses = ['24-70mm f/2.8', '50mm f/1.8', '70-200mm f/4', '16-35mm f/4']
    const folderCount = Math.max(1, Math.round(photos / 400))
    const keywordCount = 300

    time(`Insert ${photos.toLocaleString()} photos`, () => {
      db.exec('BEGIN')
      for (let f = 0; f < folderCount; f++) {
        db.exec({ sql: 'INSERT INTO folders(id, path) VALUES (?, ?)', bind: [f + 1, `Photos/${2015 + (f % 10)}/${f}`] })
      }
      for (let k = 0; k < keywordCount; k++) {
        db.exec({ sql: 'INSERT INTO keywords(id, name) VALUES (?, ?)', bind: [k + 1, `keyword-${k}`] })
      }
      const ins = db.prepare(
        'INSERT INTO photos(id, folder_id, file_name, captured_at, camera, lens, iso, rating, flag, color_label) VALUES (?,?,?,?,?,?,?,?,?,?)',
      )
      const kw = db.prepare('INSERT OR IGNORE INTO photo_keywords(photo_id, keyword_id) VALUES (?, ?)')
      const start = 1_420_070_400 // 2015-01-01
      for (let i = 1; i <= photos; i++) {
        ins.bind([
          i, ((i - 1) % folderCount) + 1, `DSC_${String(i).padStart(6, '0')}.NEF`,
          start + i * 3000, cameras[i % 4], lenses[(i >> 2) % 4], 100 << (i % 6),
          i % 6, (i % 11 === 0 ? 1 : 0), i % 7 === 0 ? (i % 5) + 1 : 0,
        ]).stepReset()
        for (let k = 0; k < 3; k++) kw.bind([i, ((i * 7 + k * 31) % keywordCount) + 1]).stepReset()
      }
      ins.finalize()
      kw.finalize()
      db.exec('COMMIT')
    })

    time('Build indexes', () =>
      db.exec(`
        CREATE INDEX photos_captured ON photos(captured_at);
        CREATE INDEX photos_folder ON photos(folder_id, captured_at);
        CREATE INDEX photos_rating ON photos(rating, captured_at);
        CREATE INDEX photo_keywords_kw ON photo_keywords(keyword_id);
      `),
    )

    const rows = (sql: string, bind?: (string | number)[]) => db.selectArrays(sql, bind).length
    time('Grid page: newest 200 photos', () => rows('SELECT id, file_name FROM photos ORDER BY captured_at DESC LIMIT 200'), (r) => r)
    time('Filter: 4★+ and picked, by date', () =>
      rows('SELECT id FROM photos WHERE rating >= 4 AND flag = 1 ORDER BY captured_at DESC'), (r) => r)
    time('Folder view (one folder)', () =>
      rows('SELECT id FROM photos WHERE folder_id = ? ORDER BY captured_at', [3]), (r) => r)
    time('Keyword search', () =>
      rows(`SELECT p.id FROM photos p JOIN photo_keywords pk ON pk.photo_id = p.id
            JOIN keywords k ON k.id = pk.keyword_id WHERE k.name = ?`, ['keyword-42']), (r) => r)
    time('Text search on file name', () =>
      rows("SELECT id FROM photos WHERE file_name LIKE '%0420%'"), (r) => r)
    time('Folder tree with counts', () =>
      rows('SELECT f.path, COUNT(*) FROM photos p JOIN folders f ON f.id = p.folder_id GROUP BY f.id'), (r) => r)
    time('Set rating on 500 photos', () => {
      db.exec('BEGIN')
      db.exec('UPDATE photos SET rating = 5 WHERE id BETWEEN 1000 AND 1499')
      db.exec('COMMIT')
    })

    const pageCount = Number(db.selectValue('PRAGMA page_count'))
    const pageSize = Number(db.selectValue('PRAGMA page_size'))
    return {
      sqliteVersion: sqlite3.version.libVersion,
      storage,
      storageNote,
      timings,
      dbSizeBytes: pageCount * pageSize,
    }
  } finally {
    db.close()
    // Leave no benchmark data behind in the user's browser storage.
    pool?.unlink(DB_NAME)
  }
}
