// Import presets: named sets of the Import window's options (Lightroom's Import Presets). The options are in the
// catalog as JSON; the destination and backup folders can't be (a folder is a browser handle), so they are kept in
// the browser's handle store under the preset's id, and permission is asked for again when the preset is used.

import { getCatalog } from '../catalog/client'
import { deleteHandle, loadHandle, saveHandle } from '../platform/handle-store'
import type { RenameTemplate } from './plan'

export interface ImportPresetData {
  rename: { kind: RenameTemplate['kind']; text: string; start: number }
  backup: boolean
  /** Also import JPEGs shot alongside RAW files. */
  includePaired: boolean
  /** Develop preset for new photos ('' = none). */
  developPreset: string
  /** Metadata preset for new photos ('' = none). */
  metadataPreset: string
  /** Folder names, for showing; the folders themselves are in the handle store. */
  destinationName: string | null
  backupName: string | null
}

export interface ImportPreset extends ImportPresetData {
  id: number
  name: string
}

const handleKey = (id: number, which: 'destination' | 'backup') => `import-preset:${id}:${which}`

export async function loadImportPresets(): Promise<ImportPreset[]> {
  return (await getCatalog().listImportPresets()).flatMap((r) => {
    try {
      return [{ ...(JSON.parse(r.preset) as ImportPresetData), id: r.id, name: r.name }]
    } catch {
      return []
    }
  })
}

/** Saves the options under a name (replacing a preset with the same name). Returns its id. */
export async function saveImportPreset(
  name: string,
  data: Omit<ImportPresetData, 'destinationName' | 'backupName'>,
  folders: { destination: FileSystemDirectoryHandle | null; backup: FileSystemDirectoryHandle | null },
): Promise<number> {
  const full: ImportPresetData = { ...data, destinationName: folders.destination?.name ?? null, backupName: folders.backup?.name ?? null }
  const id = await getCatalog().saveImportPreset(name, JSON.stringify(full))
  for (const which of ['destination', 'backup'] as const) {
    const h = folders[which]
    if (h) await saveHandle(handleKey(id, which), h)
    else await deleteHandle(handleKey(id, which)).catch(() => {})
  }
  return id
}

export async function deleteImportPreset(id: number) {
  await getCatalog().deleteImportPreset(id)
  for (const which of ['destination', 'backup'] as const) await deleteHandle(handleKey(id, which)).catch(() => {})
}

/** The preset's folders (null where it has none, or the browser no longer has it). */
export async function importPresetFolders(id: number): Promise<{ destination: FileSystemDirectoryHandle | null; backup: FileSystemDirectoryHandle | null }> {
  const get = (which: 'destination' | 'backup') => loadHandle(handleKey(id, which)).then((h) => h ?? null, () => null)
  return { destination: await get('destination'), backup: await get('backup') }
}
