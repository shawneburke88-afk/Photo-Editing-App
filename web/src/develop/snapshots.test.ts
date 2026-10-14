// Snapshots (docs/PHASE3.md Part 19): names, the stored and sidecar forms, reading damaged lists, the change-detection key,
// the Read changes merge; applying one as a single history step, its process version kept, and Set as Before's settings.
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, defaultsFor, displayUniforms, normalizeSettings, type DevelopSettings } from '../engine/develop/settings'
import { CURRENT_PROCESS } from '../engine/develop/process'
import { current, record, startHistory, undo } from './history'
import { PASTE_ITEMS } from './paste'
import {
  cleanName,
  defaultSnapshotName,
  fromSidecar,
  makeSnapshot,
  mergeSnapshots,
  parseSidecarSnapshots,
  parseSnapshotsKey,
  readSidecarSnapshots,
  snapshotsKey,
  sortSnapshots,
  toSidecar,
  uniqueName,
  type Snapshot,
} from './snapshots'

const at = (iso: string) => new Date(iso)
const snap = (id: string, name: string, created: number, exposure = 0): Snapshot => ({ id, name, created, settings: { ...DEFAULT_SETTINGS, exposure } })

describe('names', () => {
  it('names a new snapshot with the local date and time', () => {
    expect(defaultSnapshotName(new Date(2026, 9, 14, 9, 5, 7))).toBe('2026-10-14 09:05:07')
  })

  it('keeps names unique per photo, ignoring case, and trims them', () => {
    const list = [snap('a', 'Warm', 1), snap('b', 'warm (2)', 2)]
    expect(uniqueName('WARM', list)).toBe('WARM (3)')
    expect(uniqueName('Cool', list)).toBe('Cool')
    // Renaming a snapshot to its own name isn't a clash.
    expect(uniqueName('Warm', list, 'a')).toBe('Warm')
    expect(cleanName('  two   words \n')).toBe('two words')
    expect(cleanName('x'.repeat(300)).length).toBe(120)
  })

  it('makes a snapshot of a copy of the settings, with the default name when none is given', () => {
    const s = { ...DEFAULT_SETTINGS, exposure: 0.7, geometry: { ...DEFAULT_SETTINGS.geometry, angle: 2 } }
    const now = new Date(2026, 9, 14, 13, 0, 0)
    const a = makeSnapshot(s, [], undefined, now)
    expect(a.name).toBe('2026-10-14 13:00:00')
    expect(a.created).toBe(now.getTime())
    expect(a.settings).toEqual(s)
    // A copy: later changes to the photo's settings don't reach it.
    s.geometry.angle = 5
    expect(a.settings.geometry.angle).toBe(2)
    const b = makeSnapshot(s, [a], undefined, now)
    expect(b.name).toBe('2026-10-14 13:00:00 (2)')
    expect(b.id).not.toBe(a.id)
    expect(makeSnapshot(s, [a], '  Print  ').name).toBe('Print')
  })

  it('lists newest first', () => {
    expect(sortSnapshots([snap('a', 'A', 1), snap('b', 'B', 3), snap('c', 'C', 2)]).map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('the sidecar form', () => {
  it('round-trips: toSidecar → JSON → read → fromSidecar gives the same snapshots', () => {
    const list = [snap('a', 'Before crop', Date.UTC(2026, 9, 14, 10, 0, 0), 0.3), snap('b', 'Ünïcode “quotes” & <tags>', Date.UTC(2026, 9, 14, 11, 0, 0, 250), -1)]
    const text = JSON.stringify(toSidecar(list))
    const back = fromSidecar(parseSidecarSnapshots(text)!)
    expect(sortSnapshots(back)).toEqual(sortSnapshots(list))
    // Oldest first in the file, times as ISO 8601.
    expect(JSON.parse(text).map((x: { created: string }) => x.created)).toEqual(['2026-10-14T10:00:00Z', '2026-10-14T11:00:00.250Z'])
    // The key doesn't depend on the order.
    expect(snapshotsKey([...list].reverse())).toBe(snapshotsKey(list))
    expect(parseSnapshotsKey(snapshotsKey(list))!.map((x) => x.id).sort()).toEqual(['a', 'b'])
  })

  it('ignores damaged data safely', () => {
    expect(parseSidecarSnapshots('not json')).toBeNull()
    expect(parseSidecarSnapshots('{"a":1}')).toBeNull()
    expect(parseSidecarSnapshots('')).toBeNull()
    expect(parseSidecarSnapshots(null)).toBeNull()
    expect(readSidecarSnapshots('[]')).toBeNull()
    const list = readSidecarSnapshots([
      null,
      7,
      'x',
      { name: 'No settings' },
      { name: 42, settings: {} },
      { name: '   ', settings: {} },
      { name: 'Settings not an object', settings: [1, 2] },
      { id: 'ok', name: 'Good', created: '2026-10-14T10:00:00Z', settings: { exposure: 1 } },
      { id: 'ok', name: 'Same id again', created: '2026-10-14T10:00:00Z', settings: { exposure: 2 } },
      { name: 'No id, bad time', created: 'yesterday', settings: { exposure: 3 } },
    ])!
    expect(list.map((x) => x.name)).toEqual(['Good', 'No id, bad time'])
    // A missing id is made from the time and name, so the same file always gives the same id; a bad time reads as 1970.
    expect(list[1]).toEqual({ id: 'sidecar:1970-01-01T00:00:00Z:No id, bad time', name: 'No id, bad time', created: '1970-01-01T00:00:00Z', settings: { exposure: 3 } })
    expect(readSidecarSnapshots([{ name: 'No id, bad time', created: 'yesterday', settings: {} }])![0].id).toBe(list[1].id)
  })
})

describe('merging for Read changes (by snapshot)', () => {
  const A = snap('a', 'A', 1)
  const B = snap('b', 'B', 2)
  const C = snap('c', 'C', 3)
  const ids = (l: Snapshot[]) => l.map((x) => x.id).sort()

  it('takes what the other app added, changed and deleted', () => {
    const changedB = { ...B, name: 'B renamed', settings: { ...B.settings, exposure: 1 } }
    const m = mergeSnapshots([A, B], [A, B], [changedB, C])
    expect(ids(m)).toEqual(['b', 'c'])
    expect(m.find((x) => x.id === 'b')).toEqual(changedB)
  })

  it('keeps LightBench’s own new and changed snapshots the other app didn’t touch', () => {
    const mineA = { ...A, name: 'A mine' }
    const m = mergeSnapshots([A, B], [mineA, B, C], [A, B])
    expect(ids(m)).toEqual(['a', 'b', 'c'])
    expect(m.find((x) => x.id === 'a')!.name).toBe('A mine')
  })

  it('a snapshot LightBench deleted stays deleted unless the other app changed it; both changed: the other app’s wins', () => {
    expect(ids(mergeSnapshots([A, B], [B], [A, B]))).toEqual(['b'])
    const theirsA = { ...A, name: 'A theirs' }
    expect(mergeSnapshots([A], [], [theirsA]).map((x) => x.name)).toEqual(['A theirs'])
    expect(mergeSnapshots([A], [{ ...A, name: 'A mine' }], [theirsA]).map((x) => x.name)).toEqual(['A theirs'])
  })
})

describe('applying, Before, and what doesn’t carry snapshots', () => {
  it('applies a snapshot as one undoable history step, its process version kept', () => {
    const old: DevelopSettings = normalizeSettings({ ...DEFAULT_SETTINGS, process: 1, exposure: 0.4, shadows: 20 }, 'raw')
    const s = makeSnapshot(old, [], 'Old look')
    let h = startHistory(defaultsFor('raw'))
    h = record(h, 'Exposure', { ...current(h), process: CURRENT_PROCESS, exposure: 1 }, 1000)
    const before = h.steps.length
    // As Develop does: normalised for the photo's kind, a step of its own (never merged with a previous one).
    h = record(h, `Snapshot: ${s.name}`, normalizeSettings(s.settings, 'raw'), 1100, false)
    h = record(h, `Snapshot: ${s.name}`, normalizeSettings(s.settings, 'raw'), 1200, false)
    expect(h.steps.length).toBe(before + 2)
    expect(h.steps[before].label).toBe('Snapshot: Old look')
    expect(current(h).process).toBe(1)
    expect(current(h).exposure).toBe(0.4)
    // It renders with its own version's parameters, as when it was taken.
    expect(displayUniforms(current(h))).toEqual(displayUniforms(old))
    h = undo(undo(h))
    expect(current(h).exposure).toBe(1)
    expect(current(h).process).toBe(CURRENT_PROCESS)
  })

  it('Set as Before shows the snapshot’s settings exactly, not the defaults', () => {
    const s = makeSnapshot(normalizeSettings({ ...DEFAULT_SETTINGS, process: 1, contrast: 30, geometry: { ...DEFAULT_SETTINGS.geometry, angle: 1.5 } }, 'rgb'), [])
    // DevelopView's Before: the snapshot normalised for the photo's kind (its crop and process version included).
    const shown = normalizeSettings(s.settings, 'rgb')
    expect(shown.contrast).toBe(30)
    expect(shown.geometry.angle).toBe(1.5)
    expect(shown.process).toBe(1)
    expect(displayUniforms(shown)).not.toEqual(displayUniforms(defaultsFor('rgb')))
  })

  it('snapshots are not develop settings, so Copy/Paste, Sync and presets can’t carry them', () => {
    expect(PASTE_ITEMS.map((i) => i.key as string)).not.toContain('snapshots')
    expect(Object.keys(normalizeSettings({}, 'raw'))).not.toContain('snapshots')
  })
})

describe('time stamps', () => {
  it('reads the stored time back exactly', () => {
    const t = at('2026-10-14T21:30:15.123Z').getTime()
    expect(fromSidecar(readSidecarSnapshots(toSidecar([snap('x', 'X', t)]))!)[0].created).toBe(t)
  })
})
