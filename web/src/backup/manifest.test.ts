import { describe, expect, it } from 'vitest'
import {
  applySettings, catalogHeader, checkFile, checkListing, FORMAT, NEWER_BACKUP_MESSAGE, parseManifest, pickSettings, sha256, type Manifest,
} from './manifest'
import { ZipReader, ZipWriter } from './zip'

const bytes = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>

async function manifestFor(files: Record<string, Uint8Array<ArrayBuffer>>, patch: Partial<Manifest> = {}): Promise<Manifest> {
  return {
    format: FORMAT,
    formatVersion: 1,
    appVersion: '0.1.0+test',
    schemaVersion: 10,
    createdAt: '2026-10-12T12:00:00.000Z',
    counts: { photos: 3, thumbnails: Object.keys(files).filter((p) => p.startsWith('thumbnails/')).length, folders: 1, collections: 1, keywords: 2, edits: 1, presets: 1, settings: 2 },
    files: await Promise.all(Object.entries(files).map(async ([path, data]) => ({ path, size: data.length, sha256: await sha256(data) }))),
    ...patch,
  }
}

const sqliteHeader = (userVersion: number) => {
  const h = new Uint8Array(100)
  h.set(bytes('SQLite format 3\0'))
  new DataView(h.buffer).setUint32(60, userVersion)
  return h
}

const files = {
  'catalog.sqlite3': sqliteHeader(10) as Uint8Array<ArrayBuffer>,
  'settings.json': bytes('{"localStorage":{}}'),
  'README.txt': bytes('readme'),
  'thumbnails/1.jpg': bytes('jpeg one'),
  'thumbnails/2.jpg': bytes('jpeg two'),
}

describe('sha256', () => {
  it('matches the FIPS 180-2 example', async () => {
    expect(await sha256(bytes('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('parseManifest', () => {
  it('accepts a good manifest', async () => {
    const m = await manifestFor(files)
    expect(parseManifest(JSON.stringify(m), 10)).toEqual(m)
  })
  it('accepts an older library version', async () => {
    expect(parseManifest(JSON.stringify(await manifestFor(files, { schemaVersion: 9 })), 10).schemaVersion).toBe(9)
  })
  it('refuses a newer library version or format', async () => {
    expect(() => parseManifest(JSON.stringify({ ...files, x: 1 }), 10)).toThrow(/not a LightBench library backup/)
    const newer = await manifestFor(files, { schemaVersion: 11 })
    expect(() => parseManifest(JSON.stringify(newer), 10)).toThrow(NEWER_BACKUP_MESSAGE)
    const newerFormat = await manifestFor(files, { formatVersion: 2 })
    expect(() => parseManifest(JSON.stringify(newerFormat), 10)).toThrow(NEWER_BACKUP_MESSAGE)
  })
  it('refuses something that is not a backup', () => {
    expect(() => parseManifest('not json', 10)).toThrow(/not a LightBench library backup/)
    expect(() => parseManifest('{"format":"other"}', 10)).toThrow(/not a LightBench library backup/)
  })
  it('refuses a damaged file list', async () => {
    const m = await manifestFor(files)
    const bad = (patch: Partial<Manifest>) => () => parseManifest(JSON.stringify({ ...m, ...patch }), 10)
    expect(bad({ files: [...m.files, m.files[3]] })).toThrow(/listed twice/)
    expect(bad({ files: [...m.files, { path: '../evil.js', size: 1, sha256: m.files[0].sha256 }] })).toThrow(/unexpected file/)
    expect(bad({ files: m.files.filter((f) => f.path !== 'catalog.sqlite3') })).toThrow(/no catalog/)
    expect(bad({ files: m.files.map((f, i) => (i === 0 ? { ...f, sha256: 'xyz' } : f)) })).toThrow(/bad file list/)
    expect(bad({ counts: { ...m.counts, thumbnails: 5 } })).toThrow(/thumbnail count/)
    expect(bad({ createdAt: 'yesterday' })).toThrow(/bad header/)
  })
})

describe('checking files', () => {
  it('checkListing wants exactly the listed files at the listed sizes', async () => {
    const m = await manifestFor(files)
    const archive = [...Object.entries(files).map(([name, d]) => ({ name, size: d.length })), { name: 'manifest.json', size: 99 }]
    expect(() => checkListing(m, archive)).not.toThrow()
    expect(() => checkListing(m, archive.slice(1))).toThrow(/catalog.sqlite3 is missing/)
    expect(() => checkListing(m, [...archive, { name: 'extra.bin', size: 1 }])).toThrow(/unexpected file extra.bin/)
    expect(() => checkListing(m, archive.map((e) => (e.name === 'README.txt' ? { ...e, size: 7 } : e)))).toThrow(/wrong size/)
  })
  it('checkFile catches one flipped bit', async () => {
    const m = await manifestFor(files)
    const f = m.files.find((x) => x.path === 'thumbnails/1.jpg')!
    await expect(checkFile(f, bytes('jpeg one'))).resolves.toBeUndefined()
    await expect(checkFile(f, bytes('jpeg onf'))).rejects.toThrow(/damaged.*thumbnails\/1.jpg doesn't match its checksum.*Nothing in the library was changed/)
  })
  it('catalogHeader reads the SQLite magic and user version', () => {
    expect(catalogHeader(sqliteHeader(10))).toEqual({ ok: true, userVersion: 10 })
    expect(catalogHeader(bytes('x'.repeat(100))).ok).toBe(false)
  })
})

describe('a backup archive end to end (format only)', () => {
  it('survives the zip round trip, and a flipped byte is caught', async () => {
    const parts: Uint8Array<ArrayBuffer>[] = []
    const zip = new ZipWriter({ write: async (c) => void parts.push(c.slice()) })
    for (const [path, data] of Object.entries(files)) await zip.add(path, data, { compress: path.endsWith('.sqlite3') })
    const m = await manifestFor(files)
    await zip.add('manifest.json', bytes(JSON.stringify(m)))
    await zip.finish()
    const blob = new Blob(parts)

    const check = async (b: Blob) => {
      const r = await ZipReader.open(b)
      const manifest = parseManifest(new TextDecoder().decode(await r.read(r.get('manifest.json')!)), 10)
      checkListing(manifest, r.entries)
      const byPath = new Map(manifest.files.map((f) => [f.path, f]))
      await r.readEach(r.entries.filter((e) => e.name !== 'manifest.json'), (e, data) => checkFile(byPath.get(e.name)!, data))
      return manifest
    }
    expect(await check(blob)).toEqual(m)

    // Flip one byte inside thumbnails/2.jpg's data.
    const raw = new Uint8Array(await blob.arrayBuffer())
    const at = indexOf(raw, bytes('jpeg two'))
    raw[at + 3] ^= 1
    await expect(check(new Blob([raw]))).rejects.toThrow(/thumbnails\/2.jpg doesn't match its checksum/)
  })
})

function indexOf(hay: Uint8Array, needle: Uint8Array) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  throw new Error('not found')
}

describe('settings', () => {
  const fake = (init: Record<string, string>) => {
    const map = new Map(Object.entries(init))
    return {
      map,
      get length() {
        return map.size
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    }
  }
  it('picks LightBench keys only', () => {
    const s = fake({ 'lightbench.export': '{}', 'library:subfolders': 'off', 'cull:advance': 'on', 'storage:persist-notice-hidden': '1', other: 'x' })
    expect(pickSettings(s)).toEqual({ localStorage: { 'cull:advance': 'on', 'library:subfolders': 'off', 'lightbench.export': '{}' } })
  })
  it('replaces LightBench keys and leaves others', () => {
    const s = fake({ 'lightbench.a': '1', 'lightbench.b': '2', other: 'x' })
    applySettings(s, { localStorage: { 'lightbench.a': '9', 'library:subfolders': 'on', other: 'not applied' } })
    expect(Object.fromEntries(s.map)).toEqual({ 'lightbench.a': '9', 'library:subfolders': 'on', other: 'x' })
  })
})
