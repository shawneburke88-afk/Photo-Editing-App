// Key chords ("Ctrl+Shift+P", "?", "ArrowUp"): how a key press is written, compared and shown.
//
// Keys follow the character printed on the key (`KeyboardEvent.key`), not its position (`code`), so P is
// the key marked P on a French or German keyboard too. Shift is part of a chord only for letters and named
// keys: a symbol such as `?` or `'` already says whether Shift was needed on that layout (it is Shift+ß on
// a German keyboard, Shift+/ on a US one), and digits need Shift on French keyboards.
//
// One exception: Shift with a digit key (Lightroom's Shift+1–5, rate and go to the next photo). Where the digit is
// typed without Shift (US, German, UK, Russian…), Shift on that key types a symbol instead (`#` on a US keyboard,
// `§` on a German one); that press is also read as "Shift+3" by the key's position (`code` Digit3). Where the digit
// itself needs Shift (French AZERTY), Shift+3 is just "3", as before.

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
const isDigit = (k: string) => /^[0-9]$/.test(k)
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

/** A chord from its parts. Shift is dropped for symbols and digits, unless `shiftDigit` keeps it for a digit (Shift+3). */
function build(ctrl: boolean, alt: boolean, shift: boolean, key: string, shiftDigit = false): Chord {
  const keepShift = shift && (!isSymbol(key) || (shiftDigit && isDigit(key)))
  return `${ctrl ? 'Ctrl+' : ''}${alt ? 'Alt+' : ''}${keepShift ? 'Shift+' : ''}${key}`
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
  return build(ctrl, alt, shift, key, true)
}

/**
 * "Shift+3" for Shift on the 3 key when that doesn't type the digit (US `#`, German `§`), else null. On a layout
 * where Shift is what types the digit (French), the press is the plain digit.
 */
function shiftDigitChord(e: KeyLike, ctrl: boolean, alt: boolean, key: string | null): Chord | null {
  const d = e.shiftKey && e.code ? /^Digit([0-9])$/.exec(e.code)?.[1] : undefined
  if (!d || key === d) return null
  return build(ctrl, alt, true, d, true)
}

/**
 * The chords a key press can mean, best first:
 * 1. as typed (`key`, with Ctrl meaning Ctrl or ⌘; AltGr, which Windows reports as Ctrl+Alt, is ignored);
 * 2. without Shift, so Shift+P still picks and Shift+→ still moves, as before, unless something uses the Shift chord;
 * 3. Shift with a digit key that typed a symbol (`#` on a US keyboard): "Shift+3" (see the top of this file);
 * 4. the key's US position (`code`), only when it typed no Latin character, accented ones included (a Russian or
 *    Greek layout), or Alt
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
  const digit = shiftDigitChord(e, ctrl, alt, key)
  if (digit) add(digit)
  // Accented Latin letters (German Ü, French é) are printed letters too, so they don't fall back to the US key in
  // that place ([ for Ü, 2 for é): only scripts without Latin letters do.
  const latin = key !== null && (key.length > 1 || /^[\x20-\x7e]$/.test(key) || /^\p{Script=Latin}$/u.test(key))
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
  // Shift+3 on a US keyboard is recorded as "Shift+3" (as Lightroom names it), not as the "#" it types.
  const chords = eventChords(e)
  return chords.find((c) => /(^|\+)Shift\+[0-9]$/.test(c)) ?? chords[0] ?? null
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
