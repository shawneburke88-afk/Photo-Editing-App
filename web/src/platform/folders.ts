import { isRawFile } from '../engine/raw/decoder'

export const supportsFolderAccess = () => typeof window.showDirectoryPicker === 'function'

export interface ScanResult {
  files: number
  folders: number
  rawFiles: FileSystemFileHandle[]
  byExtension: Record<string, number>
  ms: number
}

/** Walks a folder tree and counts photos by type. */
export async function scanFolder(dir: FileSystemDirectoryHandle, onProgress?: (files: number) => void): Promise<ScanResult> {
  const t0 = performance.now()
  const result: ScanResult = { files: 0, folders: 0, rawFiles: [], byExtension: {}, ms: 0 }
  const walk = async (d: FileSystemDirectoryHandle) => {
    result.folders++
    for await (const entry of d.values()) {
      if (entry.kind === 'directory') {
        if (!entry.name.startsWith('.')) await walk(entry)
        continue
      }
      result.files++
      const dot = entry.name.lastIndexOf('.')
      const ext = dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : '(none)'
      result.byExtension[ext] = (result.byExtension[ext] ?? 0) + 1
      if (isRawFile(entry.name)) result.rawFiles.push(entry)
      if (result.files % 200 === 0) onProgress?.(result.files)
    }
  }
  await walk(dir)
  result.ms = performance.now() - t0
  return result
}

/** Creates, reads back and deletes a small file, to confirm LightBench could write sidecars here. */
export async function testWrite(dir: FileSystemDirectoryHandle): Promise<string> {
  if ((await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') {
    return 'Write permission was not granted'
  }
  const name = '.lightbench-write-test.tmp'
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write('LightBench write test — safe to delete.')
  await w.close()
  const text = await (await fh.getFile()).text()
  await dir.removeEntry(name)
  return text.startsWith('LightBench') ? 'ok' : 'Read-back did not match what was written'
}
