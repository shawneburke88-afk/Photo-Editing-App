// The mask presets in the catalog (docs/PHASE3.md Part 31), and a signal for the lists showing them.

import { useEffect, useState } from 'react'
import { getCatalog } from '../catalog/client'
import { maskPresetFromRow, type MaskPreset } from './maskSettings'

const listeners = new Set<() => void>()
/** Lets every open list refresh after a mask preset is saved, renamed or deleted. */
export const maskPresetsChanged = {
  emit: () => listeners.forEach((fn) => fn()),
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => void listeners.delete(fn)
  },
}

export async function loadMaskPresets(): Promise<MaskPreset[]> {
  return (await getCatalog().listMaskPresets()).flatMap((r) => maskPresetFromRow(r) ?? [])
}

/** The mask presets, by name, kept up to date. */
export function useMaskPresets(): MaskPreset[] {
  const [list, setList] = useState<MaskPreset[]>([])
  useEffect(() => {
    let alive = true
    const load = () =>
      void loadMaskPresets().then(
        (l) => alive && setList(l),
        () => {},
      )
    load()
    const off = maskPresetsChanged.subscribe(load)
    return () => {
      alive = false
      off()
    }
  }, [])
  return list
}
