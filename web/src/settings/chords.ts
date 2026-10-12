// Key chords ("Ctrl+Shift+P", "?", "ArrowUp"): how a key press is written, compared and shown.
//
// Keys follow the character printed on the key (`KeyboardEvent.key`), not its position (`code`), so P is
// the key marked P on a French or German keyboard too. Shift is part of a chord only for letters and named
// keys: a symbol such as `?` or `'` already says whether Shift was needed on that layout (it is Shift+ß on
// a German keyboard, Shift+/ on a US one), and digits need Shift on French keyboards.

/** A chord in its normal form: modifiers in the order Ctrl, Alt, Shift, then the key ("Ctrl+Shift+G", "?", "Space"). */
export type Chord = string

/** The minimal event fields used here (a real KeyboardEvent, or a test object). */
export interface KeyLike {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  getModifierState?: (key: string) => boolean
}

const NAMED = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Tab', 'Space', 'Delete', 'Backspace',
  'Home', 'End', 'PageUp', 'PageDown', 'Insert',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
])
const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'Hyper', 'Super', 'Symbol', 'SymbolLock'])
/** Older names some browsers still send. */
const ALIASES: Record<string, string> = { Esc: 'Escape', Del: 'Delete', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', Spacebar: 'Space', ' ': 'Space' }

/** The character a key produces in the US position (`code`), for layouts that don't type Latin letters. */
const US_CODES: Record<string, string> = {
  Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Quote: "'", Semicolon: ';',
  BracketLeft: '[', BracketRight: ']', Backquote: '`', NumpadAdd: '+', NumpadSubtract: '-',
}

const isLetter = (k: string) => k.length === 1 && /\p{L}/u.test(k)
/** One character that isn't a letter: a digit or a symbol (Shift is already in it). */
const isSymbol = (k: string) => [...k].length === 1 && !isLetter(k) && k !== ' '

/** The key part of a chord: letters in capitals, names as in `KeyboardEvent.key`. Null for keys that can't be bound. */
function normalKey(key: string): string | null {
  const k = ALIASES[key] ?? key
  if (NAMED.has(k)) return k
  if (isLetter(k)) {
    const up = k.toUpperCase()
    return [...up].length === 1 ? up : k
  }
  if (isSymbol(k)) return k
  return null
}

/** Modifiers and key of a chord; "Ctrl++" has the key "+". */
function split(c: string): [string[], string] {
  if (c.endsWith('+')) return [c.slice(0, -1).split('+').filter(Boolean), '+']
  const parts = c.split('+')
  const key = parts.pop() ?? ''
  return [parts, key]
}

function build(ctrl: boolean, alt: boolean, shift: boolean, key: string): Chord {
  return `${ctrl ? 'Ctrl+' : ''}${alt ? 'Alt+' : ''}${shift && !isSymbol(key) ? 'Shift+' : ''}${key}`
}

/** Normal form of a written chord ("shift+ctrl+g" → "Ctrl+Shift+G", "Ctrl++" → "Ctrl++"); null if it isn't one. */
export function parseChord(text: string): Chord | null {
  const t = text.trim()
  if (!t) return null
  const [parts, last] = split(t)
  const key = normalKey(last)
  if (!key) return null
  let ctrl = false
  let alt = false
  let shift = false
  for (const m of parts) {
    const p = m.toLowerCase()
    if (p === 'ctrl' || p === 'control' || p === 'cmd' || p === 'meta') ctrl = true
    else if (p === 'alt' || p === 'option') alt = true
    else if (p === 'shift') shift = true
    else return null
  }
  return build(ctrl, alt, shift, key)
}

/**
 * The chords a key press can mean, best first:
 * 1. as typed (`key`, with Ctrl meaning Ctrl or ⌘; AltGr, which Windows reports as Ctrl+Alt, is ignored);
 * 2. without Shift, so Shift+P still picks and Shift+→ still moves, as before, unless something uses the Shift chord;
 * 3. the key's US position (`code`), only when it typed no Latin character (a Russian or Greek layout) or Alt
 *    changed it (macOS Option+P types "π").
 */
export function eventChords(e: KeyLike): Chord[] {
  const key = normalKey(e.key)
  const altGr = !!e.getModifierState?.('AltGraph')
  const ctrl = (e.ctrlKey || e.metaKey) && !altGr
  const alt = e.altKey && !altGr
  const out: Chord[] = []
  const add = (c: Chord) => !out.includes(c) && out.push(c)
  if (key) {
    add(build(ctrl, alt, e.shiftKey, key))
    if (e.shiftKey) add(build(ctrl, alt, false, key))
  }
  const latin = key !== null && (key.length > 1 || /^[\x20-\x7e]$/.test(key))
  if (e.code && ((key !== null && !latin) || alt) && !MODIFIERS.has(e.key)) {
    const m = /^Key([A-Z])$/.exec(e.code) ?? /^(?:Digit|Numpad)([0-9])$/.exec(e.code)
    const us = m ? m[1] : US_CODES[e.code]
    if (us) {
      add(build(ctrl, alt, e.shiftKey, us))
      if (e.shiftKey) add(build(ctrl, alt, false, us))
    }
  }
  return out
}

/** The chord to record when the user presses keys to set a shortcut; null for a modifier alone or a dead key. */
export function recordChord(e: KeyLike): Chord | null {
  if (MODIFIERS.has(e.key)) return null
  return eventChords(e)[0] ?? null
}

const SHOW: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Delete: 'Delete', Backspace: 'Backspace',
  PageUp: 'Page Up', PageDown: 'Page Down', '-': '−',
}

/** How a chord is shown: "Ctrl+Shift+P", "←", "Esc", "Ctrl+Alt+−". */
export function chordText(c: Chord): string {
  const [parts, key] = split(c)
  return [...parts, SHOW[key] ?? key].join('+')
}
