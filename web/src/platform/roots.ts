// Library roots: top-level folders LightBench has been given access to. The catalog stores photo
// locations relative to a root; the browser keeps the folder handles (and their permissions).

import type { Catalog } from '../catalog/client'
import { deleteHandle, loadHandle, saveHandle } from './handle-store'

const key = (rootId: number) => `root:${rootId}`

export const getRootHandle = (rootId: number) => loadHandle(key(rootId))
export const forgetRootHandle = (rootId: number) => deleteHandle(key(rootId))

/**
 * Finds the root that contains `dir` (reusing it so one folder isn't catalogued twice), or registers
 * `dir` as a new root. Returns the root id and `dir`'s path inside that root.
 */
export async function resolveRoot(catalog: Catalog, dir: FileSystemDirectoryHandle): Promise<{ rootId: number; subPath: string }> {
  for (const root of await catalog.listRoots()) {
    const handle = await getRootHandle(root.id)
    if (!handle) continue
    if (await handle.isSameEntry(dir)) return { rootId: root.id, subPath: '' }
    const rel = await handle.resolve(dir)
    if (rel) return { rootId: root.id, subPath: rel.join('/') }
  }
  const rootId = await catalog.addRoot(dir.name)
  await saveHandle(key(rootId), dir)
  return { rootId, subPath: '' }
}

/** Checks permission; asks for it if needed (asking only works right after a click). */
export async function ensurePermission(handle: FileSystemHandle, mode: FileSystemPermissionMode = 'read'): Promise<boolean> {
  if ((await handle.queryPermission({ mode })) === 'granted') return true
  try {
    return (await handle.requestPermission({ mode })) === 'granted'
  } catch {
    return false
  }
}

export async function getDirAt(base: FileSystemDirectoryHandle, path: string, create = false): Promise<FileSystemDirectoryHandle> {
  let dir = base
  for (const part of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create })
  return dir
}

export async function getFileAt(base: FileSystemDirectoryHandle, folderPath: string, name: string): Promise<File> {
  return (await (await getDirAt(base, folderPath)).getFileHandle(name)).getFile()
}

/** Opens a catalogued photo's original file, or returns null if its folder is not connected. */
export async function openPhotoFile(rootId: number, folderPath: string, fileName: string): Promise<File | null> {
  const root = await getRootHandle(rootId)
  if (!root || (await root.queryPermission({ mode: 'read' })) !== 'granted') return null
  try {
    return await getFileAt(root, folderPath, fileName)
  } catch {
    return null
  }
}
