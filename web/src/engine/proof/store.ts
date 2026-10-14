// Profiles people load for soft proofing (printer and paper ICC files): read from disk, kept in this browser's private
// storage (OPFS, folder `proof-profiles`) for next time, never uploaded anywhere, and removable. One file per profile,
// named by its hash, plus `index.json` with what the list shows.

import { builtinIcc, builtinProfile, profileHash } from './profiles'
import type { ProfileInfo } from './lut'
import { inspectProfile } from './client'

export interface UserProfile {
  /** `user:<id>` in the settings: the first 16 hex digits of the file's SHA-256. */
  id: string
  name: string
  /** RGB, CMYK, GRAY or CMY. */
  space: string
  /** ICC class signature (prtr, mntr…). */
  cls: string
  /** The file's name when it was loaded. */
  fileName: string
  bytes: number
  added: number
}

/** Where profiles are kept and how a file is read; replaced in tests. */
export interface ProfileStoreDeps {
  root: () => Promise<FileSystemDirectoryHandle>
  inspect: (bytes: Uint8Array<ArrayBuffer>) => Promise<ProfileInfo>
}

const DIR = 'proof-profiles'
const INDEX = 'index.json'
/** Larger than any printer profile seen in practice (they are a few MB); a guard against loading the wrong file. */
export const MAX_PROFILE_BYTES = 32 << 20

let deps: ProfileStoreDeps = {
  root: async () => (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create: true }),
  inspect: inspectProfile,
}

/** Tests: where profiles are kept and how they are read. */
export function setProfileStoreDeps(d: ProfileStoreDeps) {
  deps = d
}

const listeners = new Set<() => void>()
/** Calls `fn` when the list changes; returns the function that stops it. */
export function subscribeProfiles(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
const changed = () => listeners.forEach((fn) => fn())

async function readIndex(dir: FileSystemDirectoryHandle): Promise<UserProfile[]> {
  try {
    const text = await (await (await dir.getFileHandle(INDEX)).getFile()).text()
    const v = JSON.parse(text) as unknown
    return Array.isArray(v) ? (v.filter((p) => p && typeof p.id === 'string' && /^[0-9a-f]{16}$/.test(p.id) && typeof p.name === 'string') as UserProfile[]) : []
  } catch {
    return []
  }
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: BufferSource | string) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
  await w.write(data)
  await w.close()
}

/** The profiles loaded in this browser, in the order they were added. */
export async function listUserProfiles(): Promise<UserProfile[]> {
  try {
    return await readIndex(await deps.root())
  } catch {
    // No private storage (e.g. a private window that refuses it): nothing loaded.
    return []
  }
}

/**
 * Reads an ICC file, checks Little CMS can proof to it and keeps it. Loading the same file again keeps one copy.
 * Rejects with a message for people.
 */
export async function addUserProfile(fileName: string, bytes: Uint8Array<ArrayBuffer>): Promise<UserProfile> {
  if (bytes.length > MAX_PROFILE_BYTES) throw new Error(`${fileName} is ${Math.round(bytes.length / 1048576)} MB, too large for an ICC profile.`)
  const info = await deps.inspect(bytes)
  const id = await profileHash(bytes)
  const dir = await deps.root()
  await writeFile(dir, `${id}.icc`, bytes)
  const list = (await readIndex(dir)).filter((p) => p.id !== id)
  const entry: UserProfile = { id, name: info.name, space: info.space, cls: info.cls, fileName, bytes: bytes.length, added: Date.now() }
  await writeFile(dir, INDEX, JSON.stringify([...list, entry]))
  changed()
  return entry
}

/** Removes a loaded profile (its file and its entry). */
export async function removeUserProfile(id: string): Promise<void> {
  const dir = await deps.root()
  const list = await readIndex(dir)
  await writeFile(dir, INDEX, JSON.stringify(list.filter((p) => p.id !== id)))
  try {
    await dir.removeEntry(`${id}.icc`)
  } catch {
    // Already gone.
  }
  changed()
}

async function readUserProfile(id: string): Promise<Uint8Array<ArrayBuffer>> {
  const dir = await deps.root()
  const file = await (await dir.getFileHandle(`${id}.icc`)).getFile()
  return new Uint8Array(await file.arrayBuffer())
}

/** A destination ready to proof to: its bytes, their hash (the table cache's key) and its name. */
export interface ProofSource {
  id: string
  hash: string
  bytes: Uint8Array<ArrayBuffer>
  label: string
  space: string
}

/** The profile a setting names (`builtin:…` or `user:…`), or null if it doesn't exist (any more). */
export async function proofSource(id: string): Promise<ProofSource | null> {
  const [kind, rest] = id.split(':')
  if (kind === 'builtin') {
    const b = builtinProfile(rest)
    if (!b) return null
    const bytes = builtinIcc(rest)
    return { id, hash: `builtin-${rest}`, bytes, label: b.label, space: 'RGB' }
  }
  if (kind !== 'user') return null
  const entry = (await listUserProfiles()).find((p) => p.id === rest)
  if (!entry) return null
  try {
    return { id, hash: entry.id, bytes: await readUserProfile(entry.id), label: entry.name, space: entry.space }
  } catch {
    return null
  }
}
