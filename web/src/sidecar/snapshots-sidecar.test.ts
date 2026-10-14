// @vitest-environment jsdom
// Snapshots in sidecars (docs/PHASE3.md Part 19): `lightbench:Snapshots` written and read back, virtual copies' own lists
// inside `lightbench:Versions`, damaged lists ignored safely, no crs: snapshot field, and change detection: another
// LightBench's snapshot changes are noticed and merged by Read changes.
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../engine/develop/settings'
import { EMPTY_METADATA } from '../library/metadata'
import { fromSidecar, toSidecar, type SidecarSnapshot, type Snapshot } from '../develop/snapshots'
import { diffFields, fieldsFromCatalog, fieldsFromRead, judge, mergeForRead, parseFields, type SidecarState } from './changes'
import { readXmp, writeXmp, type SidecarData } from './xmp'

const snap = (id: string, name: string, created: number, exposure = 0): Snapshot => ({ id, name, created, settings: { ...DEFAULT_SETTINGS, exposure } })
const A = snap('a', 'Warm', Date.UTC(2026, 9, 14, 10), 0.3)
const B = snap('b', 'Cool “blue”', Date.UTC(2026, 9, 14, 11), -0.5)
const C = snap('c', 'From the other LightBench', Date.UTC(2026, 9, 14, 12), 1)

const develop = JSON.stringify({ ...DEFAULT_SETTINGS, exposure: 0.2 })
const data = (d: Partial<SidecarData> = {}): SidecarData => ({ rating: 3, flag: 0, color: 0, develop, keywords: [], metadata: { ...EMPTY_METADATA }, ...d })
const write = (d: Partial<SidecarData> = {}, existing: string | null = null) => writeXmp(existing, data(d))!

const LIGHTROOM = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"
   crs:ProcessVersion="15.4" crs:Exposure2012="+0.35" xmp:Rating="2"/>
 </rdf:RDF>
</x:xmpmeta>`

const ours = (snapshots: SidecarSnapshot[], d = develop) => fieldsFromCatalog({ rating: 3, flag: 0, color: 0, keywords: [], metadata: { ...EMPTY_METADATA }, develop: d, snapshots })
const state = (s: Partial<SidecarState> = {}): SidecarState => ({ modified: 1000, size: 500, fields: null, external: false, writtenAt: null, importedAt: 100, ...s })

describe('lightbench:Snapshots in the sidecar', () => {
  it('writes the list as JSON in LightBench’s namespace and reads it back exactly', () => {
    const text = write({ snapshots: toSidecar([A, B]) })
    expect(text).toContain('lightbench:Snapshots=')
    // No Lightroom snapshot field is invented.
    expect(text).not.toMatch(/crs:[A-Za-z]*Snapshot/)
    const r = readXmp(text)
    expect(fromSidecar(r.snapshots!)).toEqual([A, B])
    expect(r.develop).toBe(develop)
  })

  it('an empty list removes the field, undefined leaves it alone, and an unchanged list doesn’t rewrite the file', () => {
    const text = write({ snapshots: toSidecar([A]) })
    expect(writeXmp(text, data({ snapshots: toSidecar([A]) }))).toBeNull()
    expect(readXmp(writeXmp(text, data({ rating: 4 }))!).snapshots).toEqual(toSidecar([A]))
    const removed = writeXmp(text, data({ snapshots: [] }))!
    expect(removed).not.toContain('Snapshots')
    expect(readXmp(removed).snapshots).toBeUndefined()
  })

  it('keeps Lightroom’s fields when adding snapshots to its sidecar', () => {
    const text = write({ snapshots: toSidecar([A]) }, LIGHTROOM)
    expect(text).toContain('crs:ProcessVersion="15.4"')
    expect(text).toContain('crs:Exposure2012="+0.35"')
    expect(fromSidecar(readXmp(text).snapshots!)).toEqual([A])
  })

  it('ignores a damaged list safely: nothing read, flagged, and left in the file until the photo has snapshots', () => {
    const good = write({ snapshots: toSidecar([A]) })
    const damaged = good.replace(/lightbench:Snapshots="[^"]*"/, 'lightbench:Snapshots="[{&quot;name&quot;: oops"')
    const r = readXmp(damaged)
    expect(r.snapshots).toBeUndefined()
    expect(r.snapshotsDamaged).toBe(true)
    // The rest of the file still reads.
    expect(r.rating).toBe(3)
    expect(r.develop).toBe(develop)
    // Not a list: likewise.
    expect(readXmp(good.replace(/lightbench:Snapshots="[^"]*"/, 'lightbench:Snapshots="{&quot;a&quot;:1}"')).snapshots).toBeUndefined()
    // Entries that make no sense are left out, the rest kept.
    const mixed = good.replace(/lightbench:Snapshots="[^"]*"/, `lightbench:Snapshots="${JSON.stringify([{ name: 'x' }, ...toSidecar([B])]).replace(/"/g, '&quot;')}"`)
    expect(fromSidecar(readXmp(mixed).snapshots!)).toEqual([B])
  })

  it('virtual copies keep their own snapshots inside lightbench:Versions; a copy’s damaged list is dropped', () => {
    const version = { name: 'Copy 1', rating: 0, flag: 0, color: 0, develop: null, keywords: [], collections: [] }
    const text = write({ snapshots: toSidecar([A]), versions: [{ ...version, snapshots: toSidecar([B]) }, { ...version, name: 'Copy 2' }] })
    const r = readXmp(text)
    expect(fromSidecar(r.snapshots!)).toEqual([A])
    expect(fromSidecar(r.versions![0].snapshots!)).toEqual([B])
    expect(r.versions![1].snapshots).toBeUndefined()
    const bad = write({ versions: [{ ...version, snapshots: 'nonsense' as unknown as SidecarSnapshot[] }] })
    expect(readXmp(bad).versions![0]).toEqual(version)
  })
})

describe('change detection', () => {
  it('a file LightBench wrote matches the catalog it was written from', () => {
    const text = write({ snapshots: toSidecar([A, B]) })
    expect(diffFields(fieldsFromRead(readXmp(text)), ours(toSidecar([B, A])))).toEqual([])
    // No snapshots: the file with LightBench's settings says "none".
    const none = write({ snapshots: [] })
    expect(fieldsFromRead(readXmp(none)).snapshots).toBe('[]')
    expect(diffFields(fieldsFromRead(readXmp(none)), ours([]))).toEqual([])
  })

  it('another LightBench adding, renaming or deleting a snapshot is a change, and Read changes merges it by snapshot', () => {
    const mine = write({ snapshots: toSidecar([A, B]) })
    const record = JSON.stringify(fieldsFromRead(readXmp(mine)))
    const theirs = write({ snapshots: toSidecar([{ ...A, name: 'Warm (theirs)' }, C]) }, mine)
    const v = judge(state({ fields: record }), { lastModified: 9000 }, fieldsFromRead(readXmp(theirs)), ours(toSidecar([A, B])))
    expect(v).toEqual({ external: true, changed: ['snapshots'], conflicts: [] })
    // Meanwhile LightBench made a snapshot of its own: it stays.
    const D = snap('d', 'Mine, new', Date.UTC(2026, 9, 14, 13))
    const p = mergeForRead(parseFields(record), ours(toSidecar([A, B, D])), fieldsFromRead(readXmp(theirs)))
    expect(fromSidecar(p.snapshots!).map((x) => x.name).sort()).toEqual(['From the other LightBench', 'Mine, new', 'Warm (theirs)'])
    expect(p.develop).toBeUndefined()
  })

  it('an app that drops LightBench’s namespace doesn’t delete snapshots', () => {
    const mine = write({ snapshots: toSidecar([A]) })
    const record = JSON.stringify(fieldsFromRead(readXmp(mine)))
    const stripped = LIGHTROOM
    const theirs = fieldsFromRead(readXmp(stripped))
    expect(theirs.snapshots).toBeUndefined()
    const v = judge(state({ fields: record }), { lastModified: 9000 }, theirs, ours(toSidecar([A])))
    expect(v.external && v.changed.includes('snapshots')).toBe(false)
    expect(mergeForRead(parseFields(record), ours(toSidecar([A])), theirs).snapshots).toBeUndefined()
  })

  it('a record made before snapshots existed: unknown snapshots in the file are a change to read; none is no change', () => {
    const old = { rating: 3, flag: 0, color: 0, keywords: [], metadata: { ...EMPTY_METADATA }, develop }
    const withC = write({ snapshots: toSidecar([C]) })
    const v = judge(state({ fields: JSON.stringify(old) }), { lastModified: 9000 }, fieldsFromRead(readXmp(withC)), ours([]))
    expect(v).toEqual({ external: true, changed: ['snapshots'], conflicts: [] })
    expect(fromSidecar(mergeForRead(parseFields(JSON.stringify(old)), ours([]), fieldsFromRead(readXmp(withC))).snapshots!)).toEqual([C])
    const plain = write({ rating: 4 })
    const v2 = judge(state({ fields: JSON.stringify(old) }), { lastModified: 9000 }, fieldsFromRead(readXmp(plain)), ours([]))
    expect(v2.external).toBe(true)
    expect(v2.external && v2.changed).toEqual(['rating'])
  })

  it('no record and an older file: taken silently, but its snapshots aren’t claimed as known (the next write keeps them)', () => {
    const withC = write({ snapshots: toSidecar([C]) })
    const v = judge(state({ modified: null, fields: null, importedAt: 100 }), { lastModified: 50_000 }, fieldsFromRead(readXmp(withC)), ours([]))
    expect(v.external).toBe(false)
    expect(!v.external && v.record.snapshots).toBeUndefined()
  })

  it('a damaged list in the file is not a change', () => {
    const mine = write({ snapshots: toSidecar([A]) })
    const record = JSON.stringify(fieldsFromRead(readXmp(mine)))
    const damaged = mine.replace(/lightbench:Snapshots="[^"]*"/, 'lightbench:Snapshots="[oops"')
    const v = judge(state({ fields: record }), { lastModified: 9000 }, fieldsFromRead(readXmp(damaged)), ours(toSidecar([A])))
    expect(v.external).toBe(false)
  })
})
