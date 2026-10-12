import { describe, expect, it } from 'vitest'
import { ACTION_BY_ID, ACTIONS, VIEWS, type Context } from './actions'
import { chordText, eventChords, parseChord, recordChord, type KeyLike } from './chords'
import { allConflicts, assignKey, cleanKeyboard, conflictsFor, matchAction, removeKey, resetKeys, resolveKeymap, setKeys, type KeyboardSettings } from './keymap'

const LB: KeyboardSettings = { preset: 'lightbench', custom: {} }
const LR: KeyboardSettings = { preset: 'lightroom', custom: {} }

/** A key press as the browser reports it (US layout unless `code` says otherwise). */
function key(k: string, mods: Partial<KeyLike> & { altGraph?: boolean } = {}): KeyLike {
  const { altGraph, ...rest } = mods
  return { key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, getModifierState: (m) => m === 'AltGraph' && !!altGraph, ...rest }
}
const LIBRARY: Context[] = ['global', 'library']
const ONE: Context[] = ['global', 'cull', 'cull-one']
const COMPARE: Context[] = ['global', 'cull', 'compare']
const SURVEY: Context[] = ['global', 'cull', 'survey']
const DEVELOP: Context[] = ['global', 'develop']
const CROP: Context[] = ['global', 'crop']

describe('chords', () => {
  it('writes chords in one normal form', () => {
    expect(parseChord('shift+ctrl+g')).toBe('Ctrl+Shift+G')
    expect(parseChord('Cmd+K')).toBe('Ctrl+K')
    expect(parseChord('Ctrl++')).toBe('Ctrl++')
    expect(parseChord('Ctrl+Alt+=')).toBe('Ctrl+Alt+=')
    expect(parseChord('Esc')).toBe('Escape')
    expect(parseChord('Hyper+X')).toBeNull()
    expect(parseChord('')).toBeNull()
  })

  it('leaves Shift out of symbols, which already include it', () => {
    expect(parseChord('Shift+?')).toBe('?')
    expect(eventChords(key('?', { shiftKey: true }))[0]).toBe('?')
    // German layout: ' is Shift+#, \ is AltGr+ß (reported by Windows as Ctrl+Alt).
    expect(eventChords(key("'", { shiftKey: true, code: 'Backslash' }))[0]).toBe("'")
    expect(eventChords(key('\\', { ctrlKey: true, altKey: true, altGraph: true, code: 'Minus' }))[0]).toBe('\\')
    expect(eventChords(key("'", { ctrlKey: true, shiftKey: true }))[0]).toBe("Ctrl+'")
    // French layout: digits need Shift.
    expect(eventChords(key('3', { shiftKey: true, code: 'Digit3' }))[0]).toBe('3')
  })

  it('keeps Shift for letters and named keys, with a fallback without it', () => {
    expect(eventChords(key('S', { shiftKey: true }))).toEqual(['Shift+S', 'S'])
    expect(eventChords(key('Tab', { shiftKey: true }))).toEqual(['Shift+Tab', 'Tab'])
    expect(eventChords(key(' '))).toEqual(['Space'])
    // Caps Lock: an upper-case letter without Shift is the same key.
    expect(eventChords(key('P'))).toEqual(['P'])
  })

  it('follows the printed letter, not the key position', () => {
    // AZERTY: the key marked A is where QWERTY has Q.
    expect(eventChords(key('a', { code: 'KeyQ' }))).toEqual(['A'])
    expect(eventChords(key('p', { code: 'KeyR' }))).toEqual(['P'])
    // Layouts without Latin letters fall back to the US position.
    expect(eventChords(key('к', { ctrlKey: true, code: 'KeyR' }))).toEqual(['Ctrl+К', 'Ctrl+R'])
    // macOS Option changes the character; the position is tried too.
    expect(eventChords(key('≠', { metaKey: true, altKey: true, code: 'Equal' }))).toEqual(['Ctrl+Alt+≠', 'Ctrl+Alt+='])
  })

  it('records keys but not modifiers alone', () => {
    expect(recordChord(key('Shift', { shiftKey: true }))).toBeNull()
    expect(recordChord(key('Control', { ctrlKey: true }))).toBeNull()
    expect(recordChord(key('Dead'))).toBeNull()
    expect(recordChord(key('k', { ctrlKey: true }))).toBe('Ctrl+K')
  })

  it('shows chords plainly', () => {
    expect(chordText('ArrowLeft')).toBe('←')
    expect(chordText('Escape')).toBe('Esc')
    expect(chordText('Ctrl+Alt+-')).toBe('Ctrl+Alt+−')
    expect(chordText('Ctrl+Alt++')).toBe('Ctrl+Alt++')
    expect(chordText('+')).toBe('+')
  })
})

describe('shortcut sets', () => {
  it('has unique ids, contexts that belong to a view, and keys in normal form', () => {
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length)
    for (const a of ACTIONS) {
      expect(a.contexts.every((c) => VIEWS.some((v) => v.includes(c)))).toBe(true)
      for (const k of [...a.keys, ...(a.lightroom ?? [])]) expect(parseChord(k)).toBe(k)
    }
  })

  it('has no key used twice in one view, in either set', () => {
    expect(allConflicts(resolveKeymap(LB))).toEqual([])
    expect(allConflicts(resolveKeymap(LR))).toEqual([])
  })

  it('keeps the keys of version 0.1.0 in the LightBench set', () => {
    const map = resolveKeymap(LB)
    const at = (e: KeyLike, ctx: Context[]) => matchAction(map, e, ctx)
    expect(at(key('p'), LIBRARY)).toBe('photo.pick')
    expect(at(key('P', { shiftKey: true }), LIBRARY)).toBe('photo.pick')
    expect(at(key('S', { shiftKey: true }), LIBRARY)).toBe('library.stackTop')
    expect(at(key('s'), LIBRARY)).toBe('library.stackToggle')
    expect(at(key('c', { ctrlKey: true }), LIBRARY)).toBe('settings.copy')
    expect(at(key('C', { ctrlKey: true, shiftKey: true }), LIBRARY)).toBe('settings.copy')
    expect(at(key('E', { ctrlKey: true, shiftKey: true }), LIBRARY)).toBe('export')
    expect(at(key('e', { ctrlKey: true }), LIBRARY)).toBeNull()
    expect(at(key('5'), ONE)).toBe('photo.rate5')
    expect(at(key('9'), ONE)).toBe('photo.label4')
    expect(at(key('ArrowDown'), ONE)).toBe('one.next')
    expect(at(key('ArrowDown'), COMPARE)).toBe('compare.swap')
    expect(at(key('ArrowUp'), COMPARE)).toBe('compare.makeSelect')
    expect(at(key('Tab', { shiftKey: true }), COMPARE)).toBe('compare.switch')
    expect(at(key('Tab', { shiftKey: true }), SURVEY)).toBe('survey.prev')
    expect(at(key('Delete'), SURVEY)).toBe('survey.drop')
    expect(at(key('n'), SURVEY)).toBe('survey.close')
    expect(at(key('o'), DEVELOP)).toBe('develop.clipping')
    expect(at(key('O', { shiftKey: true }), DEVELOP)).toBe('develop.sensorClipping')
    expect(at(key('\\'), DEVELOP)).toBe('develop.before')
    expect(at(key('Z', { ctrlKey: true, shiftKey: true }), DEVELOP)).toBe('develop.redo')
    expect(at(key('g'), DEVELOP)).toBe('develop.grid')
    // Not while culling: the Library's keys belong to the grid.
    expect(at(key('a', { ctrlKey: true }), ONE)).toBeNull()
  })

  it('keeps cropping keys apart from Develop’s own (O, X, Esc, Enter)', () => {
    for (const set of [LB, LR]) {
      const map = resolveKeymap(set)
      expect(matchAction(map, key('o'), CROP)).toBe('crop.overlay')
      expect(matchAction(map, key('x'), CROP)).toBe('crop.swap')
      expect(matchAction(map, key('Escape'), CROP)).toBe('crop.cancel')
      expect(matchAction(map, key('Enter'), CROP)).toBe('crop.apply')
      expect(matchAction(map, key('r'), CROP)).toBe('develop.crop')
      expect(matchAction(map, key('r'), DEVELOP)).toBe('develop.crop')
      expect(matchAction(map, key('[', { ctrlKey: true }), DEVELOP)).toBe('develop.rotateLeft')
      expect(matchAction(map, key(']', { ctrlKey: true }), CROP)).toBe('develop.rotateRight')
      expect(matchAction(map, key('z', { ctrlKey: true }), CROP)).toBe('develop.undo')
      // Not while cropping: clipping, sensor clipping, the picker, next photo, the grid.
      expect(matchAction(map, key('j'), CROP)).toBeNull()
      expect(matchAction(map, key('O', { shiftKey: true }), CROP)).toBe('crop.overlay')
      expect(matchAction(map, key('ArrowRight'), CROP)).toBeNull()
      expect(matchAction(map, key('g'), CROP)).toBeNull()
      expect(matchAction(map, key('Escape'), DEVELOP)).toBe('develop.cancel')
    }
    expect(matchAction(resolveKeymap(LB), key('o'), DEVELOP)).toBe('develop.clipping')
  })

  it('uses Lightroom keys where LightBench differs', () => {
    const map = resolveKeymap(LR)
    expect(matchAction(map, key('o'), DEVELOP)).toBeNull()
    expect(matchAction(map, key('j'), DEVELOP)).toBe('develop.clipping')
    expect(matchAction(map, key('c', { ctrlKey: true }), LIBRARY)).toBeNull()
    expect(matchAction(map, key('C', { ctrlKey: true, shiftKey: true }), LIBRARY)).toBe('settings.copy')
    expect(matchAction(map, key('I', { ctrlKey: true, shiftKey: true }), LIBRARY)).toBe('library.import')
    expect(matchAction(map, key('p'), LIBRARY)).toBe('photo.pick')
  })

  it('opens the shortcut list and command search everywhere', () => {
    const map = resolveKeymap(LB)
    for (const ctx of [LIBRARY, ONE, SURVEY, DEVELOP]) {
      expect(matchAction(map, key('?', { shiftKey: true }), ctx)).toBe('app.shortcuts')
      expect(matchAction(map, key('P', { ctrlKey: true, shiftKey: true }), ctx)).toBe('app.commands')
      expect(matchAction(map, key(',', { ctrlKey: true }), ctx)).toBe('app.settings')
      expect(matchAction(map, key('=', { ctrlKey: true, altKey: true }), ctx)).toBe('app.scaleUp')
      expect(matchAction(map, key('-', { ctrlKey: true, altKey: true }), ctx)).toBe('app.scaleDown')
    }
  })
})

describe('changing keys', () => {
  it('saves a change as Custom and resolves it over the set', () => {
    const s = setKeys(LB, 'photo.pick', ['K'])
    expect(s.custom).toEqual({ 'photo.pick': ['K'] })
    const map = resolveKeymap(s)
    expect(matchAction(map, key('k'), LIBRARY)).toBe('photo.pick')
    expect(matchAction(map, key('p'), LIBRARY)).toBeNull()
    // Same in culling: Pick is one action.
    expect(matchAction(map, key('k'), ONE)).toBe('photo.pick')
  })

  it('keeps a change when it is based on the Lightroom set', () => {
    const s = setKeys(LR, 'develop.clipping', ['J', 'K'])
    expect(resolveKeymap(s).get('develop.clipping')).toEqual(['J', 'K'])
    expect(resolveKeymap(s).get('settings.copy')).toEqual(['Ctrl+Shift+C'])
  })

  it('counts keys set back to the set as unchanged', () => {
    const s = setKeys(setKeys(LB, 'photo.pick', ['K']), 'photo.pick', ['P'])
    expect(s.custom).toEqual({})
  })

  it('finds conflicts only where both actions work', () => {
    const map = resolveKeymap(LB)
    expect(conflictsFor(map, 'photo.pick', 'X').map((a) => a.id)).toEqual(['photo.reject'])
    // Z is zoom in culling and in Develop, but those never show together.
    expect(conflictsFor(map, 'develop.zoom', 'Z')).toEqual([])
    // Pick works in culling, where E closes the view.
    expect(conflictsFor(map, 'photo.pick', 'E').map((a) => a.id)).toEqual(['library.loupe', 'cull.close', 'survey.close'])
    // A key for everywhere conflicts with every view.
    expect(conflictsFor(map, 'app.settings', 'D').map((a) => a.id)).toEqual(['photo.develop'])
  })

  it('replaces a conflicting key by taking it from the other action', () => {
    const s = assignKey(LB, 'photo.pick', 'X', 'P')
    const map = resolveKeymap(s)
    expect(map.get('photo.pick')).toEqual(['X'])
    expect(map.get('photo.reject')).toEqual([])
    expect(allConflicts(map)).toEqual([])
  })

  it('adds, removes and resets keys', () => {
    let s = assignKey(LB, 'photo.pick', 'K')
    expect(resolveKeymap(s).get('photo.pick')).toEqual(['P', 'K'])
    s = removeKey(s, 'photo.pick', 'P')
    expect(resolveKeymap(s).get('photo.pick')).toEqual(['K'])
    s = resetKeys(s, 'photo.pick')
    expect(resolveKeymap(s).get('photo.pick')).toEqual(['P'])
    expect(s.custom).toEqual({})
  })

  it('reads stored settings defensively', () => {
    expect(cleanKeyboard(null)).toEqual(LB)
    expect(cleanKeyboard({ preset: 'nope', custom: { 'photo.pick': ['shift+?', 'Ctrl+k', 3, 'Hyper+X'], 'gone.action': ['Q'], 'photo.reject': 'X' } })).toEqual({
      preset: 'lightbench',
      custom: { 'photo.pick': ['?', 'Ctrl+K'] },
    })
    expect(cleanKeyboard({ preset: 'lightroom' }).preset).toBe('lightroom')
  })

  it('names every action plainly', () => {
    for (const a of ACTIONS) expect(a.label.length).toBeGreaterThan(2)
    expect(ACTION_BY_ID.get('photo.pick')?.label).toBe('Pick')
  })
})
