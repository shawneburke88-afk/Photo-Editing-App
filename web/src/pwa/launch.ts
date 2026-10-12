// "Open with LightBench": in the installed app (Chrome/Edge), RAW and JPEG files can be opened from the
// computer's file manager. The manifest's `file_handlers` registers the file types; the browser hands the
// files to the page through `launchQueue` (https://developer.chrome.com/docs/capabilities/web-apis/file-handling).
// The library needs the folder, not just the file, so the Library asks for it (OpenWithDialog).

import { isRawFile } from '../engine/raw/decoder'

interface LaunchParams {
  files: readonly FileSystemHandle[]
}

interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void
}

declare global {
  interface Window {
    launchQueue?: LaunchQueue
  }
}

/** The photo types the manifest's file_handlers lists: every RAW the decoder reads, plus JPEG. */
export function isLaunchablePhoto(name: string): boolean {
  return isRawFile(name) || /\.jpe?g$/i.test(name)
}

let pending: FileSystemFileHandle[] = []
const listeners = new Set<() => void>()

export const launched = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  /** Files opened from the OS and not yet dealt with (empty most of the time). */
  get: (): FileSystemFileHandle[] => pending,
  clear() {
    pending = []
    for (const fn of listeners) fn()
  },
}

/** The launchQueue consumer: keeps the photos among the launched files for the Library to open. */
export function receiveLaunch(params: LaunchParams) {
  const files = params.files.filter((h): h is FileSystemFileHandle => h.kind === 'file' && isLaunchablePhoto(h.name))
  if (!files.length) return
  pending = files
  for (const fn of listeners) fn()
}

/** Starts listening for launched files; the browser queues them until a consumer is set. */
export function startLaunchQueue() {
  window.launchQueue?.setConsumer(receiveLaunch)
}
