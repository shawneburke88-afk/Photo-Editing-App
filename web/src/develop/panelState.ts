// Which Develop tool groups, and which secondary sections inside them (Advanced, Lens, Transform), are open (owner's
// feedback 2026-10-19: everything starts collapsed). What the user opens or closes is remembered in this browser, so
// the panel comes back as they left it. Storage can be unavailable (private windows, blocked site data): then the
// state still works for this visit.

import { useCallback, useSyncExternalStore } from 'react'

/** The part of Storage used here (a fake in tests). */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function browserStorage(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** A remembered set of open ids. */
export class OpenState {
  private open: Set<string> | null = null
  private listeners = new Set<() => void>()
  private version = 0
  private readonly key: string
  private readonly store: () => KeyValueStore | null

  constructor(key: string, store: () => KeyValueStore | null = browserStorage) {
    this.key = key
    this.store = store
  }

  private load(): Set<string> {
    if (this.open) return this.open
    let ids: string[] = []
    try {
      const raw = this.store()?.getItem(this.key)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      // Unreadable: everything closed.
    }
    return (this.open = new Set(ids))
  }

  isOpen(id: string): boolean {
    return this.load().has(id)
  }

  setOpen(id: string, open: boolean) {
    const set = this.load()
    if (set.has(id) === open) return
    if (open) set.add(id)
    else set.delete(id)
    try {
      this.store()?.setItem(this.key, JSON.stringify([...set]))
    } catch {
      // Not remembered this time.
    }
    this.version++
    for (const l of this.listeners) l()
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }

  snapshot = () => this.version
}

/** The tool groups (ToolStack). Before 2026-10, groups were remembered as closed ones; now as open ones, so all start closed. */
export const openGroups = new OpenState('lightbench.develop.openGroups')
/** Secondary sections inside the groups. */
export const openSections = new OpenState('lightbench.develop.openSections')

/** A remembered open state for React: [open, setOpen], where setOpen also takes a function of the current state. */
export function useOpen(state: OpenState, id: string): [boolean, (v: boolean | ((open: boolean) => boolean)) => void] {
  useSyncExternalStore(state.subscribe, state.snapshot, state.snapshot)
  const open = state.isOpen(id)
  const set = useCallback((v: boolean | ((open: boolean) => boolean)) => state.setOpen(id, typeof v === 'function' ? v(state.isOpen(id)) : v), [state, id])
  return [open, set]
}
