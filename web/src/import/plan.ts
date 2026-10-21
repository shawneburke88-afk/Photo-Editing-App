// Pure import planning: which files to offer, where they go and what they're called.

import { RAW_EXTENSIONS } from '../engine/raw/decoder'
import { pairTwins } from '../catalog/stacks'

export const JPEG_EXTENSIONS = ['jpg', 'jpeg']

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function baseNameOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export function isImportable(name: string): boolean {
  if (name.startsWith('.')) return false
  const ext = extensionOf(name)
  return RAW_EXTENSIONS.includes(ext) || JPEG_EXTENSIONS.includes(ext)
}

export interface SourceFile {
  /** Folder path relative to the chosen source, "" for the top level. */
  dir: string
  name: string
}

/**
 * Finds JPEGs shot alongside a RAW (RAW+JPEG mode): the same name in the same folder, or in another folder with the
 * same capture time when it is known (catalog/stacks.ts pairTwins). They are imported too unless the user says
 * otherwise, and stacked under their RAW. Returns the indices of such JPEGs.
 */
export function findRawJpegPairs(files: (SourceFile & { capturedAt?: number })[]): Set<number> {
  return new Set(pairTwins(files.map((f) => ({ group: f.dir, name: f.name, capturedAt: f.capturedAt ?? 0 }))).map(([, j]) => j))
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** Capture time (camera-local, stored as UTC seconds) → "YYYY-MM-DD". */
export function dateString(seconds: number): string {
  const d = new Date(seconds * 1000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Destination subfolder for a photo: "YYYY/YYYY-MM-DD". */
export function dateFolder(seconds: number): string {
  const day = dateString(seconds)
  return `${day.slice(0, 4)}/${day}`
}

export type RenameTemplate =
  | { kind: 'original' }
  | { kind: 'date-sequence'; start: number }
  | { kind: 'custom-sequence'; text: string; start: number }

/** Strips characters Windows doesn't allow in file names. */
export function safeFileText(s: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what must be removed
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim()
}

/** New file name for the photo at position `index` (0-based) in capture order. */
export function renamedFile(t: RenameTemplate, originalName: string, capturedAt: number, index: number): string {
  if (t.kind === 'original') return originalName
  const ext = originalName.slice(originalName.lastIndexOf('.'))
  const seq = pad(t.start + index, 4)
  if (t.kind === 'date-sequence') return `${dateString(capturedAt)}_${seq}${ext}`
  const text = safeFileText(t.text) || 'Photo'
  return `${text}_${seq}${ext}`
}

/** "name.ext" → "name-1.ext", "name-2.ext", … for resolving clashes with different files. */
export function numberedName(name: string, n: number): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`
}

/** Joins folder path segments with "/", ignoring empty parts. */
export function joinPath(...parts: string[]): string {
  return parts.flatMap((p) => p.split('/')).filter(Boolean).join('/')
}
