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

  it('reads Shift with a digit key as Shift+digit where the digit is typed without Shift', () => {
    expect(parseChord('Shift+3')).toBe('Shift+3')
    expect(parseChord('shift+ctrl+0')).toBe('Ctrl+Shift+0')
    // US: Shift+3 types "#"; German: "§"; Russian: "№". The typed symbol first, then Shift+3 by position.
    expect(eventChords(key('#', { shiftKey: true, code: 'Digit3' }))).toEqual(['#', 'Shift+3'])
    // (A symbol outside ASCII also tries the US position, as before; Shift+3 comes first.)
    expect(eventChords(key('§', { shiftKey: true, code: 'Digit3' }))).toEqual(['§', 'Shift+3', '3'])
    expect(eventChords(key('№', { shiftKey: true, code: 'Digit3' }))).toEqual(['№', 'Shift+3', '3'])
    expect(eventChords(key(')', { shiftKey: true, code: 'Digit0' }))).toEqual([')', 'Shift+0'])
    // French: Shift is what types the digit, so it stays the plain digit.
    expect(eventChords(key('3', { shiftKey: true, code: 'Digit3' }))).toEqual(['3'])
    // Without Shift, or on the numeric keypad, nothing changes.
    expect(eventChords(key('3', { code: 'Digit3' }))).toEqual(['3'])
    expect(eventChords(key('3', { code: 'Numpad3' }))).toEqual(['3'])
    // Recording: "Shift+3", as Lightroom names it, not "#".
    expect(recordChord(key('#', { shiftKey: true, code: 'Digit3' }))).toBe('Shift+3')
    expect(recordChord(key('3', { shiftKey: true, code: 'Digit3' }))).toBe('3')
    expect(recordChord(key('?', { shiftKey: true, code: 'Slash' }))).toBe('?')
    expect(chordText('Shift+3')).toBe('Shift+3')
  })

  it('follows the printed [ and ]', () => {
    expect(eventChords(key('[', { code: 'BracketLeft' }))).toEqual(['['])
    // German: [ is AltGr+8 (Windows reports Ctrl+Alt); the key at the US [ position types Ü.
    expect(eventChords(key('[', { ctrlKey: true, altKey: true, altGraph: true, code: 'Digit8' }))).toEqual(['['])
    expect(eventChords(key('ü', { code: 'BracketLeft' }))).toEqual(['Ü'])
    // Accented letters are printed letters: French é (the 2 key without Shift) is not 2, German Ä is not '.
    expect(eventChords(key('é', { code: 'Digit2' }))).toEqual(['É'])
    expect(eventChords(key('ä', { ctrlKey: true, code: 'Quote' }))).toEqual(['Ctrl+Ä'])
    // Russian: х at the US [ position falls back to it.
    expect(eventChords(key('х', { code: 'BracketLeft' }))).toEqual(['Х', '['])
    expect(eventChords(key('[', { ctrlKey: true, code: 'BracketLeft' }))).toEqual(['Ctrl+['])
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

  it('gives the Tone Curve’s targeted adjustment tool its own keys (↑ ↓ nudge, Esc ends), apart from Develop’s', () => {
    const CURVE: Context[] = ['global', 'curve']
    for (const set of [LB, LR]) {
      const map = resolveKeymap(set)
      expect(matchAction(map, key('T', { ctrlKey: true, altKey: true, shiftKey: true }), DEVELOP)).toBe('develop.curveTarget')
      expect(matchAction(map, key('T', { ctrlKey: true, altKey: true, shiftKey: true }), CURVE)).toBe('develop.curveTarget')
      expect(matchAction(map, key('ArrowUp'), CURVE)).toBe('curve.up')
      expect(matchAction(map, key('ArrowDown'), CURVE)).toBe('curve.down')
      expect(matchAction(map, key('ArrowUp', { shiftKey: true }), CURVE)).toBe('curve.upBig')
      expect(matchAction(map, key('ArrowDown', { shiftKey: true }), CURVE)).toBe('curve.downBig')
      expect(matchAction(map, key('Escape'), CURVE)).toBe('curve.done')
      expect(matchAction(map, key('z', { ctrlKey: true }), CURVE)).toBe('develop.undo')
      expect(matchAction(map, key('j'), CURVE)).toBe('develop.clipping')
      expect(matchAction(map, key('\\'), CURVE)).toBe('develop.before')
      // Not while the tool is on: the next photo, the grid, the white balance picker.
      expect(matchAction(map, key('ArrowRight'), CURVE)).toBeNull()
      expect(matchAction(map, key('g'), CURVE)).toBeNull()
      expect(matchAction(map, key('w'), CURVE)).toBeNull()
      // Develop's own arrows are untouched.
      expect(matchAction(map, key('ArrowUp'), DEVELOP)).toBeNull()
      expect(matchAction(map, key('Escape'), DEVELOP)).toBe('develop.cancel')
    }
  })

  it('gives the Colour Mixer’s tools their own keys (H, S, L targets, ↑ ↓ nudge, Esc and Ctrl+Alt+Shift+N end), apart from Develop’s', () => {
    const MIXER: Context[] = ['global', 'mixer']
    for (const set of [LB, LR]) {
      const map = resolveKeymap(set)
      const cas = (k: string) => key(k, { ctrlKey: true, altKey: true, shiftKey: true })
      for (const ctx of [DEVELOP, MIXER]) {
        expect(matchAction(map, cas('H'), ctx)).toBe('develop.mixerTargetHue')
        expect(matchAction(map, cas('S'), ctx)).toBe('develop.mixerTargetSat')
        expect(matchAction(map, cas('L'), ctx)).toBe('develop.mixerTargetLum')
      }
      expect(matchAction(map, cas('N'), MIXER)).toBe('develop.mixerTargetOff')
      expect(matchAction(map, cas('T'), DEVELOP)).toBe('develop.curveTarget')
      expect(matchAction(map, key('ArrowUp'), MIXER)).toBe('mixer.up')
      expect(matchAction(map, key('ArrowDown', { shiftKey: true }), MIXER)).toBe('mixer.downBig')
      expect(matchAction(map, key('Escape'), MIXER)).toBe('mixer.done')
      expect(matchAction(map, key('Enter'), MIXER)).toBe('mixer.done')
      expect(matchAction(map, key('z', { ctrlKey: true }), MIXER)).toBe('develop.undo')
      expect(matchAction(map, key('\\'), MIXER)).toBe('develop.before')
      // Not while the tool is on: the next photo, the grid.
      expect(matchAction(map, key('ArrowRight'), MIXER)).toBeNull()
      expect(matchAction(map, key('g'), MIXER)).toBeNull()
      expect(matchAction(map, key('ArrowUp'), DEVELOP)).toBeNull()
    }
  })

  it('raises and lowers the rating with ] and [, and rates then moves on with Shift+0–5, in both sets', () => {
    for (const set of [LB, LR]) {
      const map = resolveKeymap(set)
      for (const ctx of [LIBRARY, ONE, COMPARE, SURVEY]) {
        expect(matchAction(map, key(']', { code: 'BracketRight' }), ctx)).toBe('photo.rateUp')
        expect(matchAction(map, key('[', { code: 'BracketLeft' }), ctx)).toBe('photo.rateDown')
        expect(matchAction(map, key('#', { shiftKey: true, code: 'Digit3' }), ctx)).toBe('photo.rateNext3')
        expect(matchAction(map, key(')', { shiftKey: true, code: 'Digit0' }), ctx)).toBe('photo.rateNext0')
        expect(matchAction(map, key('%', { shiftKey: true, code: 'Digit5' }), ctx)).toBe('photo.rateNext5')
        // Plain digits still only rate; French Shift+3 is the plain 3.
        expect(matchAction(map, key('3', { code: 'Digit3' }), ctx)).toBe('photo.rate3')
        expect(matchAction(map, key('3', { shiftKey: true, code: 'Digit3' }), ctx)).toBe('photo.rate3')
        // Labels don't get a Shift variant.
        expect(matchAction(map, key('^', { shiftKey: true, code: 'Digit6' }), ctx)).toBeNull()
      }
      // Ctrl+[ and Ctrl+] still rotate in Develop; plain [ and ] do nothing in Develop, cropping or Guided Upright,
      // which leaves them free for a brush context (Lightroom's brush size).
      expect(matchAction(map, key('[', { ctrlKey: true }), DEVELOP)).toBe('develop.rotateLeft')
      expect(matchAction(map, key(']', { ctrlKey: true }), CROP)).toBe('develop.rotateRight')
      for (const ctx of [DEVELOP, CROP, ['global', 'guided'] as Context[]]) {
        expect(matchAction(map, key('['), ctx)).toBeNull()
        expect(matchAction(map, key(']'), ctx)).toBeNull()
      }
      expect(matchAction(map, key('[', { ctrlKey: true }), LIBRARY)).toBeNull()
    }
  })

  it('gives the Remove brush its own keys: Q, [ and ] for the size, Shift+[ and Shift+] for the feather, H, Delete, Esc', () => {
    const REMOVE: Context[] = ['global', 'remove']
    for (const set of [LB, LR]) {
      const map = resolveKeymap(set)
      expect(matchAction(map, key('q'), DEVELOP)).toBe('develop.remove')
      expect(matchAction(map, key('q'), REMOVE)).toBe('develop.remove')
      expect(matchAction(map, key(']', { code: 'BracketRight' }), REMOVE)).toBe('remove.sizeUp')
      expect(matchAction(map, key('[', { code: 'BracketLeft' }), REMOVE)).toBe('remove.sizeDown')
      expect(matchAction(map, key('}', { shiftKey: true, code: 'BracketRight' }), REMOVE)).toBe('remove.featherUp')
      expect(matchAction(map, key('{', { shiftKey: true, code: 'BracketLeft' }), REMOVE)).toBe('remove.featherDown')
      expect(matchAction(map, key('h'), REMOVE)).toBe('remove.showAll')
      expect(matchAction(map, key('Delete'), REMOVE)).toBe('remove.delete')
      expect(matchAction(map, key('Escape'), REMOVE)).toBe('remove.cancel')
      expect(matchAction(map, key('z', { ctrlKey: true }), REMOVE)).toBe('develop.undo')
      // Ctrl+[ still rotates in Develop; the brush keys don't reach Develop or the Library.
      expect(matchAction(map, key('[', { ctrlKey: true }), DEVELOP)).toBe('develop.rotateLeft')
      expect(matchAction(map, key(']'), DEVELOP)).toBeNull()
      expect(matchAction(map, key(']', { code: 'BracketRight' }), LIBRARY)).toBe('photo.rateUp')
    }
  })

  it('gives soft proofing S and Shift+S in Develop only, leaving the Library’s stack keys and Ctrl+Shift+S alone', () => {
    for (const set of [LB, LR]) {
      const map = resolveKeymap(set)
      expect(matchAction(map, key('s'), DEVELOP)).toBe('develop.softProof')
      expect(matchAction(map, key('S', { shiftKey: true }), DEVELOP)).toBe('develop.proofGamut')
      expect(matchAction(map, key('S', { ctrlKey: true, shiftKey: true }), DEVELOP)).toBe('settings.sync')
      expect(matchAction(map, key('S', { ctrlKey: true, altKey: true, shiftKey: true }), DEVELOP)).toBe('develop.mixerTargetSat')
      expect(matchAction(map, key('s'), LIBRARY)).toBe('library.stackToggle')
      expect(matchAction(map, key('S', { shiftKey: true }), LIBRARY)).toBe('library.stackTop')
      // Not while cropping or with an on-photo tool: those views listen to their own contexts.
      for (const ctx of [CROP, ['global', 'curve'], ['global', 'mixer'], ['global', 'remove'], ['global', 'guided']] as Context[][]) {
        expect(matchAction(map, key('s'), ctx)).toBeNull()
      }
    }
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
