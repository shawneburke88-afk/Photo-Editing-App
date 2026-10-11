import { useCallback, useState } from 'react'

/**
 * A small settings object remembered in this browser (e.g. viewing preferences). Missing fields fall
 * back to `initial`, and the default is used if storage is unavailable.
 */
export function useStoredJson<T extends object>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? { ...initial, ...(JSON.parse(raw) as Partial<T>) } : initial
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (v: T) => {
      setValue(v)
      try {
        localStorage.setItem(key, JSON.stringify(v))
      } catch {
        // Storage blocked: the setting still applies for this visit.
      }
    },
    [key],
  )
  return [value, set]
}
