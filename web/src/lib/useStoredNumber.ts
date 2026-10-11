import { useCallback, useState } from 'react'

/** A number remembered in this browser (e.g. panel sizes). Falls back to the default if storage is unavailable. */
export function useStoredNumber(key: string, initial: number): [number, (v: number) => void] {
  const [value, setValue] = useState(() => {
    try {
      const v = Number(localStorage.getItem(key))
      return Number.isFinite(v) && v > 0 ? v : initial
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (v: number) => {
      setValue(v)
      try {
        localStorage.setItem(key, String(Math.round(v)))
      } catch {
        // Storage blocked: the size still applies for this visit.
      }
    },
    [key],
  )
  return [value, set]
}
