// The keys in use: a shortcut set plus the user's own changes, and the checks that keep them unambiguous.

import { ACTION_BY_ID, ACTIONS, presetKeys, VIEWS, type ActionDef, type Context, type PresetId } from './actions'
import { eventChords, parseChord, type Chord, type KeyLike } from './chords'

/** What is saved: the set the user started from and the actions whose keys they changed (an empty list removes all keys). */
export interface KeyboardSettings {
  preset: PresetId
  custom: Record<string, Chord[]>
}

export type Keymap = Map<string, Chord[]>

export function resolveKeymap(s: KeyboardSettings): Keymap {
  return new Map(ACTIONS.map((a) => [a.id, s.custom[a.id] ?? presetKeys(a, s.preset)]))
}

/** True when two actions can be active in the same view (so they mustn't share a key). */
export function overlaps(a: ActionDef, b: ActionDef): boolean {
  return VIEWS.some((v) => a.contexts.some((c) => v.includes(c)) && b.contexts.some((c) => v.includes(c)))
}

/** The other actions that already use `chord` where `id` works. */
export function conflictsFor(map: Keymap, id: string, chord: Chord): ActionDef[] {
  const a = ACTION_BY_ID.get(id)
  if (!a) return []
  return ACTIONS.filter((b) => b.id !== id && overlaps(a, b) && (map.get(b.id) ?? []).includes(chord))
}

/** Every pair of actions sharing a key in some view (empty for both shortcut sets; checked by a test). */
export function allConflicts(map: Keymap): { chord: Chord; actions: [ActionDef, ActionDef] }[] {
  const out: { chord: Chord; actions: [ActionDef, ActionDef] }[] = []
  ACTIONS.forEach((a, i) => {
    for (const b of ACTIONS.slice(i + 1)) {
      if (!overlaps(a, b)) continue
      const keys = map.get(b.id) ?? []
      for (const c of map.get(a.id) ?? []) if (keys.includes(c)) out.push({ chord: c, actions: [a, b] })
    }
  })
  return out
}

/**
 * A change to one action's keys, saved as "Custom". Keys equal to the set's own are dropped from `custom`,
 * so resetting by hand also counts as unchanged.
 */
export function setKeys(s: KeyboardSettings, id: string, keys: Chord[]): KeyboardSettings {
  const a = ACTION_BY_ID.get(id)
  if (!a) return s
  const unique = [...new Set(keys)]
  const custom = { ...s.custom }
  const same = unique.length === presetKeys(a, s.preset).length && unique.every((k, i) => k === presetKeys(a, s.preset)[i])
  if (same) delete custom[id]
  else custom[id] = unique
  return { ...s, custom }
}

/** Gives `chord` to `id` (replacing `replace`, or added), taking it away from the actions it conflicts with. */
export function assignKey(s: KeyboardSettings, id: string, chord: Chord, replace?: Chord): KeyboardSettings {
  const map = resolveKeymap(s)
  let next = s
  for (const other of conflictsFor(map, id, chord)) {
    next = setKeys(next, other.id, (map.get(other.id) ?? []).filter((k) => k !== chord))
  }
  const own = map.get(id) ?? []
  const keys = replace && own.includes(replace) ? own.map((k) => (k === replace ? chord : k)) : [...own, chord]
  return setKeys(next, id, keys)
}

export function removeKey(s: KeyboardSettings, id: string, chord: Chord): KeyboardSettings {
  return setKeys(s, id, (resolveKeymap(s).get(id) ?? []).filter((k) => k !== chord))
}

export function resetKeys(s: KeyboardSettings, id: string): KeyboardSettings {
  const custom = { ...s.custom }
  delete custom[id]
  return { ...s, custom }
}

/** Stored settings as they are read back: unknown actions and malformed keys are dropped. */
export function cleanKeyboard(v: unknown): KeyboardSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<KeyboardSettings>
  const preset: PresetId = o.preset === 'lightroom' ? 'lightroom' : 'lightbench'
  const custom: Record<string, Chord[]> = {}
  if (o.custom && typeof o.custom === 'object') {
    for (const [id, keys] of Object.entries(o.custom)) {
      if (!ACTION_BY_ID.has(id) || !Array.isArray(keys)) continue
      custom[id] = [...new Set(keys.map((k) => (typeof k === 'string' ? parseChord(k) : null)).filter((k): k is Chord => !!k))]
    }
  }
  return { preset, custom }
}

/**
 * The action a key press runs in the given contexts, or null. The chords from `eventChords` are tried in
 * order, so an exact match (Shift+S) wins over the same key without Shift (S).
 */
export function matchAction(map: Keymap, e: KeyLike, contexts: Context[]): string | null {
  for (const chord of eventChords(e)) {
    for (const a of ACTIONS) {
      if (a.contexts.some((c) => contexts.includes(c)) && (map.get(a.id) ?? []).includes(chord)) return a.id
    }
  }
  return null
}
