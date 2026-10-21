// Verified copies for Import. Each copy (and backup copy) is read back after writing and compared with what was
// read from the card by SHA-256, so a bad card reader, cable or disk is caught while the card still holds the
// originals. The source is never written to.
//
// crypto.subtle can only hash a whole buffer, so files are handled in 8 MiB pieces: each piece is hashed, and
// the file's digest is the SHA-256 of the pieces' digests. Two files have the same digest exactly when every
// piece matches, and memory stays at about one piece however large the RAW is.

import { numberedName } from './plan'
import { timed, type StepTimes } from './timing'

export const CHUNK_BYTES = 8 * 1024 * 1024

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * Hashes `file` piece by piece, handing each piece to `onPiece` (e.g. to write it) after hashing it. `t` collects the
 * time spent reading, hashing and in `onPiece` (as `write`).
 */
async function digestPieces(file: Blob, chunk: number, onPiece?: (piece: ArrayBuffer) => Promise<void>, t?: StepTimes): Promise<string> {
  const pieces: Uint8Array[] = []
  for (let at = 0; at === 0 || at < file.size; at += chunk) {
    const piece = await timed(t, 'read', () => file.slice(at, at + chunk).arrayBuffer())
    pieces.push(new Uint8Array(await timed(t, 'hash', () => crypto.subtle.digest('SHA-256', piece))))
    if (onPiece) await timed(t, 'write', () => onPiece(piece))
  }
  const all = new Uint8Array(pieces.length * 32)
  pieces.forEach((p, i) => all.set(p, i * 32))
  return hex(await timed(t, 'hash', () => crypto.subtle.digest('SHA-256', all)))
}

/** The file's content digest (see above). */
export const fileDigest = (file: Blob, chunk = CHUNK_BYTES) => digestPieces(file, chunk)

/** Thrown when a copy read back doesn't match the original; the copy has been deleted. */
export class CopyMismatchError extends Error {
  constructor(folder: string) {
    super(`The copy in “${folder}” didn’t match the original, so it was deleted. The original wasn’t changed. Import it again; if this keeps happening, check the card reader, cable and disk.`)
    this.name = 'CopyMismatchError'
  }
}

export interface CopyResult {
  /** The file's name in `dir` (numbered when another file had the name). */
  name: string
  /** False when an identical file was already there (copied on an earlier import). */
  copied: boolean
  /** The original's digest, to check further copies against. */
  digest: string
}

/**
 * Copies `file` into `dir` and checks the copy, avoiding clashes. A file of the same name counts as this photo
 * copied earlier only if its content matches; a different file keeps its name and the copy is numbered. An empty file
 * of the same name (left by a copy that was cut off, e.g. by closing the tab: the browser creates the file before
 * writing it) is written over, so importing again gives the name the copy would have had.
 * `known` is the original's digest when already known (e.g. from the main copy, for the backup). `t` collects the
 * time spent reading the card, hashing, writing and verifying (import/timing.ts).
 */
export async function copyVerified(dir: FileSystemDirectoryHandle, name: string, file: File, known?: string, chunk = CHUNK_BYTES, t?: StepTimes): Promise<CopyResult> {
  let source = known
  for (let n = 0; n < 1000; n++) {
    const candidate = n === 0 ? name : numberedName(name, n)
    let existing: File | null = null
    try {
      existing = await (await dir.getFileHandle(candidate)).getFile()
    } catch {
      existing = null
    }
    if (existing && !(existing.size === 0 && file.size > 0)) {
      if (existing.size !== file.size) continue
      const there = existing
      source ??= await digestPieces(file, chunk, undefined, t)
      if ((await timed(t, 'verify', () => fileDigest(there, chunk))) === source) return { name: candidate, copied: false, digest: source }
      continue
    }
    const fh = await dir.getFileHandle(candidate, { create: true })
    let read: string
    try {
      const w = await fh.createWritable()
      try {
        read = await digestPieces(file, chunk, (piece) => w.write(piece), t)
        await timed(t, 'write', () => w.close())
      } catch (err) {
        await w.abort().catch(() => {})
        throw err
      }
    } catch (err) {
      await dir.removeEntry(candidate).catch(() => {})
      throw err
    }
    // Read the copy back. `read` is what came from the card this time; `source` (if known) an earlier reading.
    const copy = await fh.getFile()
    const written = copy.size === file.size ? await timed(t, 'verify', () => fileDigest(copy, chunk)) : ''
    if (written !== read || (source !== undefined && written !== source)) {
      await dir.removeEntry(candidate).catch(() => {})
      throw new CopyMismatchError(dir.name)
    }
    return { name: candidate, copied: true, digest: read }
  }
  throw new Error(`Too many files named like ${name}`)
}
