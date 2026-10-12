// One keyboard listener for the whole app. Each view says which actions it runs (`useShortcuts`); a key
// press is matched against the keys in use (Settings → Keyboard) and handed to the view, and command search
// runs the same actions by name.

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { isSliderKey, isTextEntry } from '../lib/keys'
import { ACTION_BY_ID, ACTIONS, CONTEXT_NAMES, type ActionDef, type Context } from './actions'
import { chordText } from './chords'
import { matchAction } from './keymap'
import { settings } from './store'

/** Runs an action; returns false when it doesn't apply right now (the key then does what it normally does). */
export type Runner = (id: string, e?: KeyboardEvent) => boolean | void

interface Scope {
  contexts: Context[]
  run: Runner
}

const scopes: Scope[] = []
const listeners = new Set<() => void>()
let version = 0
const changed = () => {
  version++
  listeners.forEach((l) => l())
}

/**
 * Registers the actions a view runs while `enabled` (e.g. the Library grid while no dialog is open). The
 * runner is read at each key press, so it can use the view's current state.
 */
export function useShortcuts(contexts: Context[], enabled: boolean, run: Runner) {
  const ref = useRef(run)
  useEffect(() => {
    ref.current = run
  })
  const key = contexts.join(' ')
  useEffect(() => {
    if (!enabled) return
    const scope: Scope = { contexts: key.split(' ') as Context[], run: (id, e) => ref.current(id, e) }
    scopes.push(scope)
    changed()
    return () => {
      scopes.splice(scopes.indexOf(scope), 1)
      changed()
    }
  }, [enabled, key])
}

/** The contexts active now: everywhere, plus the views listening. */
export function activeContexts(): Context[] {
  return ['global', ...new Set(scopes.flatMap((s) => s.contexts))]
}

/** The actions that can run now, in registry order. */
export function availableActions(): ActionDef[] {
  const active = activeContexts()
  return ACTIONS.filter((a) => a.contexts.some((c) => active.includes(c)))
}

/** Runs an action in the newest view that knows it. Returns whether something handled it. */
export function runAction(id: string, e?: KeyboardEvent): boolean {
  const a = ACTION_BY_ID.get(id)
  if (!a) return false
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i]
    if (a.contexts.some((c) => s.contexts.includes(c)) && s.run(id, e) !== false) return true
  }
  return false
}

/** True while a dialog has the keyboard (its own keys, such as Esc and Enter, still work). */
export function dialogOpen(): boolean {
  return !!document.querySelector('.dialog-backdrop')
}

/** The app's keydown handler (installed once, in App). */
export function onShortcutKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing || isTextEntry(e.target) || isSliderKey(e) || dialogOpen()) return
  // Enter on a focused button presses the button, not a shortcut.
  if (e.key === 'Enter' && (e.target as HTMLElement | null)?.closest?.('button, a[href], summary, [role="button"]')) return
  const id = matchAction(settings.keymap(), e, activeContexts())
  if (id && runAction(id, e)) e.preventDefault()
}

/** Esc closes a window wherever the focus is (keys handled inside it, e.g. while recording a shortcut, stop first). */
export function useEscapeKey(onEscape: () => void, enabled = true) {
  const ref = useRef(onEscape)
  useEffect(() => {
    ref.current = onEscape
  })
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) ref.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

/** Re-renders when the keys or the listening views change. */
export function useKeymapVersion(): number {
  const keys = useSyncExternalStore(settings.subscribe, settings.keymap)
  const v = useSyncExternalStore(subscribeScopes, () => version)
  return keys.size + v
}

function subscribeScopes(l: () => void) {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** All keys of an action as shown ("Ctrl+C, Ctrl+Shift+C"), or '' when it has none. */
export function keysText(id: string): string {
  return (settings.keymap().get(id) ?? []).map(chordText).join(', ')
}

/** The first key of an action ("Ctrl+Z"), or ''. */
export function keyText(id: string): string {
  const k = settings.keymap().get(id)?.[0]
  return k ? chordText(k) : ''
}

/** "Undo (Ctrl+Z)" for tooltips; just "Undo" when the action has no key. */
export function withKey(text: string, id: string): string {
  const k = keyText(id)
  return k ? `${text} (${k})` : text
}

/**
 * The keys of several actions in a row, for hint lines: "0–5" when they are the default consecutive digits,
 * otherwise each one's first key joined by "/" (actions without a key are left out).
 */
export function rangeText(ids: string[]): string {
  const keys = ids.map(keyText)
  const digits = keys.every((k, i) => i === 0 || (/^\d$/.test(k) && /^\d$/.test(keys[i - 1]) && Number(k) === Number(keys[i - 1]) + 1))
  if (digits && keys.length > 2 && /^\d$/.test(keys[0])) return `${keys[0]}–${keys[keys.length - 1]}`
  return keys.filter(Boolean).join('/')
}

/** A hint line: "Keys: P pick · X reject …", leaving out actions that have no key. */
export function hintLine(lead: string, items: [key: string, what: string][]): string {
  const parts = items.filter(([k]) => k).map(([k, what]) => `${k} ${what}`)
  if (!lead) return parts.join(' · ')
  return lead.endsWith(':') ? `${lead} ${parts.join(' · ')}` : [lead, ...parts].join(' · ')
}

/** Text an action is found by: its name, where it works and its keys. */
export function searchText(a: ActionDef): string {
  return `${a.label} ${a.contexts.map((c) => CONTEXT_NAMES[c]).join(' ')} ${(settings.keymap().get(a.id) ?? []).map(chordText).join(' ')}`.toLowerCase()
}

/** True when every word of the query is in the action's text. */
export function matches(a: ActionDef, query: string): boolean {
  const text = searchText(a)
  return query.trim().toLowerCase().split(/\s+/).every((w) => text.includes(w))
}
