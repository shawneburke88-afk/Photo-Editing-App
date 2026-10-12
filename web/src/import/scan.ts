import { isImportable, type SourceFile } from './plan'

export interface ScannedFile extends SourceFile {
  handle: FileSystemFileHandle
}

/**
 * Lists importable photos under `dir`, including subfolders (skips hidden folders like .Trashes). `sidecars`, if given,
 * collects the .xmp files found on the way, keyed by sidecarKey.
 */
export async function scanSource(dir: FileSystemDirectoryHandle, onProgress?: (n: number) => void, sidecars?: Map<string, FileSystemFileHandle>): Promise<ScannedFile[]> {
  const out: ScannedFile[] = []
  const walk = async (d: FileSystemDirectoryHandle, path: string) => {
    for await (const entry of d.values()) {
      if (entry.kind === 'directory') {
        if (!entry.name.startsWith('.')) await walk(entry, path ? `${path}/${entry.name}` : entry.name)
      } else if (sidecars && entry.name.toLowerCase().endsWith('.xmp')) {
        sidecars.set(sidecarKey(path, entry.name), entry)
      } else if (isImportable(entry.name)) {
        out.push({ handle: entry, dir: path, name: entry.name })
        if (out.length % 100 === 0) onProgress?.(out.length)
      }
    }
  }
  await walk(dir, '')
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir.localeCompare(b.dir)))
  return out
}

/** Key of a file found by scanSource: its folder (relative to the scanned folder) and name, ignoring case. */
export const sidecarKey = (dir: string, name: string) => `${dir}/${name}`.toLowerCase()
