// The preset list (the user's, from the catalog, then the starters), and the preset chosen for new photos: when a
// folder is opened or imported, photos without edits (none in their sidecars) are developed with it in the
// background.

import { getCatalog } from '../catalog/client'
import { photosAdded } from '../library/added'
import { batch } from './batch'
import { presetClip, presetFromRow, STARTER_PRESETS, type Preset } from './presets'

const NEW_PHOTOS_KEY = 'lightbench.presets.newPhotos'
const listeners = new Set<() => void>()

export async function loadPresets(): Promise<Preset[]> {
  const rows = await getCatalog().listPresets()
  return [...rows.flatMap((r) => presetFromRow(r) ?? []), ...STARTER_PRESETS]
}

/** Lets preset lists elsewhere (Library, Import) refresh after one is saved or deleted. */
export const presetsChanged = {
  emit: () => listeners.forEach((fn) => fn()),
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => void listeners.delete(fn)
  },
}

/** The preset for new photos ('' for none), remembered in this browser. */
export function newPhotosPreset(): string {
  try {
    return localStorage.getItem(NEW_PHOTOS_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setNewPhotosPreset(id: string) {
  try {
    if (id) localStorage.setItem(NEW_PHOTOS_KEY, id)
    else localStorage.removeItem(NEW_PHOTOS_KEY)
  } catch {
    // Not remembered this time.
  }
  presetsChanged.emit()
}

/** Starts developing new photos with the chosen preset; returns a function that stops it. */
export function startNewPhotosPreset(): () => void {
  return photosAdded.subscribe((ids) => {
    const id = newPhotosPreset()
    if (!id) return
    void loadPresets().then((all) => {
      const p = all.find((x) => x.id === id)
      if (p) batch.run({ label: `Preset: ${p.name}`, ids, clip: presetClip(p), onlyUnedited: true })
    })
  })
}
