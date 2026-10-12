// Metadata presets (the user's, from the catalog) and the preset chosen to fill in new photos: when a folder is
// opened or imported, the preset's fields are set on new photos where they have no value yet (e.g. none in their
// sidecars), mirroring "Develop new photos with" (develop/presetStore.ts).

import { getCatalog } from '../catalog/client'
import { sidecars } from '../sidecar/sync'
import { photosAdded } from './added'
import { groupByValues, metadataPresetFromRow, type MetadataPreset } from './metadata'

const NEW_PHOTOS_KEY = 'lightbench.metadataPresets.newPhotos'

function emitter() {
  const listeners = new Set<() => void>()
  return {
    emit: () => listeners.forEach((fn) => fn()),
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
  }
}

/** Lets preset lists (Library, Import) refresh after one is saved or deleted, or the new-photos choice changes. */
export const metadataPresetsChanged = emitter()
/** Photos' metadata changed in the background (new photos filled in), so an open panel reloads. */
export const metadataChanged = emitter()

export async function loadMetadataPresets(): Promise<MetadataPreset[]> {
  return (await getCatalog().listMetadataPresets()).flatMap((r) => metadataPresetFromRow(r) ?? [])
}

/**
 * Sets a preset's fields on photos, with {year} expanded per photo. `onlyEmpty` keeps values the photos already have
 * (presets for new photos). Returns the photos changed; their sidecars are updated.
 */
export async function applyMetadataPreset(ids: number[], preset: MetadataPreset, onlyEmpty = false): Promise<number[]> {
  const catalog = getCatalog()
  const changed: number[] = []
  for (const g of groupByValues(await catalog.photoDates(ids), preset.fields)) {
    if (onlyEmpty) changed.push(...(await catalog.fillMetadata(g.ids, g.values)))
    else {
      await catalog.setMetadata(g.ids, g.values)
      changed.push(...g.ids)
    }
  }
  sidecars.schedule(changed)
  return changed
}

/** The preset for new photos ('' for none), remembered in this browser. */
export function newPhotosMetadataPreset(): string {
  try {
    return localStorage.getItem(NEW_PHOTOS_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setNewPhotosMetadataPreset(id: string) {
  try {
    if (id) localStorage.setItem(NEW_PHOTOS_KEY, id)
    else localStorage.removeItem(NEW_PHOTOS_KEY)
  } catch {
    // Not remembered this time.
  }
  metadataPresetsChanged.emit()
}

/** Starts filling in new photos with the chosen preset; returns a function that stops it. */
export function startNewPhotosMetadata(): () => void {
  return photosAdded.subscribe((ids) => {
    const id = newPhotosMetadataPreset()
    if (!id) return
    void loadMetadataPresets().then(async (all) => {
      const p = all.find((x) => x.id === id)
      if (p && (await applyMetadataPreset(ids, p, true)).length) metadataChanged.emit()
    })
  })
}
