// The page's side of soft proofing's worker (proof.worker.ts): builds proof tables and reads profiles there, and keeps
// the last few tables, so switching back to a profile or an intent shows at once. The worker (and Little CMS) is made
// on first use only.

import type { ProfileInfo, ProofLut } from './lut'
import type { LutOptions } from './settings'
import { LUT_SIZE, proofKey } from './settings'

type RequestBody =
  | { type: 'inspect'; bytes: Uint8Array<ArrayBuffer> }
  | { type: 'build'; bytes: Uint8Array<ArrayBuffer>; options: LutOptions; size: number }

export type ProofRequest = RequestBody & { id: number }

export type ProofResponse =
  | { id: number; ok: true; info: ProfileInfo }
  | { id: number; ok: true; lut: ProofLut }
  | { id: number; ok: false; error: string }

let worker: Worker | null = null
let seq = 0
const waiting = new Map<number, { resolve: (r: ProofResponse) => void; reject: (e: Error) => void }>()

function failAll(e: Error) {
  for (const w of waiting.values()) w.reject(e)
  waiting.clear()
  worker?.terminate()
  worker = null
}

function call(req: RequestBody): Promise<ProofResponse> {
  if (!worker) {
    worker = new Worker(new URL('./proof.worker.ts', import.meta.url), { type: 'module', name: 'soft-proof' })
    worker.onmessage = (e: MessageEvent<ProofResponse>) => {
      const w = waiting.get(e.data.id)
      waiting.delete(e.data.id)
      w?.resolve(e.data)
    }
    worker.onerror = (e) => failAll(new Error(`Soft proofing's worker failed: ${e.message || 'unknown error'}`))
  }
  const id = ++seq
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    // The bytes are copied (not transferred): the caller keeps them.
    worker!.postMessage({ ...req, id })
  })
}

/** A profile's description, colour space and class; rejects with a message for people if it can't be proofed to. */
export async function inspectProfile(bytes: Uint8Array<ArrayBuffer>): Promise<ProfileInfo> {
  const r = await call({ type: 'inspect', bytes })
  if (!r.ok) throw new Error(r.error)
  if (!('info' in r)) throw new Error('Unexpected answer from the soft-proofing worker')
  return r.info
}

/** The tables kept, most recent last (each 8.8 MB at 65³). */
const KEEP = 3
const tables = new Map<string, Promise<ProofLut>>()

/**
 * The proof table for a destination profile (its bytes and their hash) and options, from the cache or built in the
 * worker. Rebuilt only when the key (profile, intent, options, size) changes.
 */
export function proofLut(hash: string, bytes: Uint8Array<ArrayBuffer>, options: LutOptions, size = LUT_SIZE): Promise<ProofLut> {
  const key = proofKey(hash, options, size)
  const hit = tables.get(key)
  if (hit) {
    tables.delete(key)
    tables.set(key, hit)
    return hit
  }
  const job = call({ type: 'build', bytes, options, size }).then((r) => {
    if (!r.ok) throw new Error(r.error)
    if (!('lut' in r)) throw new Error('Unexpected answer from the soft-proofing worker')
    return r.lut
  })
  // A failed build isn't kept: the next try builds again.
  job.catch(() => tables.get(key) === job && tables.delete(key))
  tables.set(key, job)
  while (tables.size > KEEP) tables.delete(tables.keys().next().value!)
  return job
}

/** Tables kept now (tests, the benchmark). */
export function cachedProofKeys(): string[] {
  return [...tables.keys()]
}

/** Drops the kept tables (the benchmark measures builds). */
export function clearProofCache() {
  tables.clear()
}
