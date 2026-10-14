// Culling badges: the defaults, stored choices read back safely, which badges a photo gets, and where Z zooms.
import { describe, expect, it } from 'vitest'
import type { CullInfo } from '../catalog/analysis'
import { DEFAULT_SUGGEST } from '../catalog/analysis'
import { readable } from './analysis-pass'
import { badgesFor, cleanPrefs, DEFAULT_BADGES, focusPoint } from './cull-badges'
import { allConflicts, matchAction, resolveKeymap } from '../settings/keymap'
import type { KeyLike } from '../settings/chords'

const info = (p: Partial<CullInfo> = {}): CullInfo => ({
  rel: 1, soft: null, shake: null, clipped: null, exposure: null, exposureBad: null, dupOf: null, group: null, softInGroup: null, focus: null, ...p,
})

describe('badge preferences', () => {
  it('default to soft, shake, clipped, look-alike, best, suggested and not-yet-analysed on; dark or bright off', () => {
    expect(cleanPrefs(null)).toEqual({ badges: DEFAULT_BADGES, suggest: DEFAULT_SUGGEST })
    expect(DEFAULT_BADGES).toEqual({ soft: true, shake: true, clipped: true, exposure: false, dup: true, best: true, suggested: true, pending: true })
  })
  it('keep stored booleans and ignore anything else', () => {
    const p = cleanPrefs({ badges: { soft: false, shake: 'yes', bogus: true }, suggest: { soft: true } })
    expect(p.badges).toEqual({ ...DEFAULT_BADGES, soft: false })
    expect(p.suggest).toEqual({ ...DEFAULT_SUGGEST, soft: true })
  })
})

describe('badges for a photo', () => {
  const prefs = cleanPrefs(null)
  it('shows nothing before analysis, and only the kinds switched on', () => {
    expect(badgesFor({ flag: 0, cull: null }, prefs)).toEqual([])
    const row = { flag: 0, cull: info({ shake: 'Shaken.', clipped: 'Clipped.', exposure: 'Very dark: …' }) }
    expect(badgesFor(row, prefs).map((b) => b.kind)).toEqual(['suggested', 'shake', 'clipped'])
    expect(badgesFor(row, { ...prefs, badges: { ...prefs.badges, suggested: false, exposure: true } }).map((b) => b.text)).toEqual(['Shake', 'Clipped', 'Dark'])
  })
  it('marks photos not analysed yet with “…” and says so; nothing for one that couldn’t be measured', () => {
    expect(badgesFor({ flag: 0, cull: null, analysisState: 'pending' }, prefs)).toEqual([{ kind: 'pending', text: '…', reason: expect.stringMatching(/^Not analysed yet: .*left out of suggestions/) }])
    expect(badgesFor({ flag: 0, cull: null, analysisState: 'pending' }, { ...prefs, badges: { ...prefs.badges, pending: false } })).toEqual([])
    expect(badgesFor({ flag: 0, cull: null, analysisState: 'failed' }, prefs)).toEqual([])
  })
  it('carries the reasons, and never suggests a picked photo', () => {
    const row = { flag: 1, cull: info({ softInGroup: '40 % less sharp than A.NEF.', dupOf: { id: 1, name: 'A.NEF', reason: 'Looks like A.NEF.' } }) }
    const b = badgesFor(row, prefs)
    expect(b.map((x) => x.kind)).toEqual(['soft', 'dup'])
    expect(b[0].reason).toBe('40 % less sharp than A.NEF.')
    expect(badgesFor({ ...row, flag: 0 }, prefs)[0]).toMatchObject({ kind: 'suggested', text: 'Reject?' })
    expect(badgesFor({ flag: 0, cull: info({ group: { kind: 'stack', size: 3, rank: 1, bestId: 5, best: true, reason: 'Sharpest of the 3.' } }) }, prefs)).toEqual([
      { kind: 'best', text: '☆ Best', reason: 'Sharpest of the 3.' },
    ])
  })
})

describe('Z in culling', () => {
  it('zooms to the measured focus point, else the centre', () => {
    expect(focusPoint({ cull: info({ focus: { u: 0.59, v: 0.31, from: 'af' } }) })).toEqual({ u: 0.59, v: 0.31 })
    expect(focusPoint({ cull: info({ focus: { u: 1.2, v: -0.1, from: 'peak' } }) })).toEqual({ u: 1, v: 0 })
    expect(focusPoint({ cull: null })).toEqual({ u: 0.5, v: 0.5 })
    expect(focusPoint(undefined)).toEqual({ u: 0.5, v: 0.5 })
  })
})

describe('the background pass', () => {
  it('skips folders without permission, counting what waits', () => {
    const files = [{ rootId: 1 }, { rootId: 2 }, { rootId: 1 }, { rootId: 3 }]
    const r = readable(files, new Map<number, unknown>([[1, {}], [2, null]]))
    expect(r.todo).toEqual([{ rootId: 1 }, { rootId: 1 }])
    expect(r.waiting).toBe(2)
  })
})

describe('keys', () => {
  const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, getModifierState: () => false, ...mods })
  it('Ctrl+Z in the Library undoes an Apply; Z in culling zooms to the focus point; no clashes in either set', () => {
    for (const preset of ['lightbench', 'lightroom'] as const) {
      const map = resolveKeymap({ preset, custom: {} })
      expect(allConflicts(map)).toEqual([])
      expect(matchAction(map, key('z', { ctrlKey: true }), ['global', 'library'])).toBe('library.undoSuggested')
      expect(matchAction(map, key('z'), ['global', 'cull', 'cull-one'])).toBe('cull.zoom')
      expect(matchAction(map, key('z', { ctrlKey: true }), ['global', 'develop'])).toBe('develop.undo')
    }
  })
})
