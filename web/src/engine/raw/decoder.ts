import type { DecodeRequest, DecodeResponse, DecodeResult } from './types'

type Pending = { resolve: (r: DecodeResult) => void; reject: (e: Error) => void }

/** Runs LibRaw in a Web Worker so decoding never freezes the interface. */
export class RawDecoder {
  private worker = new Worker(new URL('./decoder.worker.ts', import.meta.url), { type: 'module' })
  private pending = new Map<number, Pending>()
  private nextId = 1

  constructor() {
    this.worker.onmessage = (e: MessageEvent<DecodeResponse>) => {
      const msg = e.data
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new Error(msg.error))
    }
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'RAW decoder worker failed to start')
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
    }
  }

  decode(file: File, full: boolean): Promise<DecodeResult> {
    const id = this.nextId++
    const req: DecodeRequest = { id, file, full }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage(req)
    })
  }

  dispose() {
    this.worker.terminate()
  }
}

export const RAW_EXTENSIONS = [
  'nef', 'nrw', 'arw', 'srf', 'sr2', 'cr2', 'cr3', 'crw', 'raf', 'orf', 'rw2', 'pef', 'dng',
  'srw', 'x3f', '3fr', 'iiq', 'erf', 'mef', 'mos', 'mrw', 'kdc', 'dcr', 'rwl',
]

export function isRawFile(name: string): boolean {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return RAW_EXTENSIONS.includes(ext)
}
