// Soft proofing's worker (docs/PHASE3.md Part 20): Little CMS (lcms-wasm, MIT) runs here, so neither its 316 kB of
// WebAssembly nor the table's build time touch the page. Loaded on first use only (client.ts).

import { instantiate, type LcmsModule } from 'lcms-wasm'
import wasmUrl from 'lcms-wasm/dist/lcms.wasm?url'
import { buildProofLut, inspectProfile } from './lut'
import type { ProofRequest, ProofResponse } from './client'

let lcms: Promise<LcmsModule> | null = null
const load = () =>
  (lcms ??= instantiate({ locateFile: () => wasmUrl }).catch((e: unknown) => {
    lcms = null
    throw e
  }))

const post = (r: ProofResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(r, transfer)

self.onmessage = async (e: MessageEvent<ProofRequest>) => {
  const m = e.data
  try {
    const L = await load()
    if (m.type === 'inspect') {
      post({ id: m.id, ok: true, info: inspectProfile(L, m.bytes) })
    } else {
      const lut = buildProofLut(L, m.bytes, m.options, m.size)
      post({ id: m.id, ok: true, lut }, [lut.data.buffer])
    }
  } catch (err) {
    post({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
