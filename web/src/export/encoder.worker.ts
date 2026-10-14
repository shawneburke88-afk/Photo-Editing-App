/// <reference lib="webworker" />
// An export encoder worker (PHASE3.md, Part 22): encodes one photo at a time (encode.ts). Export runs several, on the
// page's CPU budget (encoder-pool.ts), so a photo encodes while the next one develops on the GPU.

import { encodeImage, type EncodeJob, type EncodeResult } from './encode'

export type EncoderRequest = { id: number; job: EncodeJob }
export type EncoderReply = { id: number; ok: true; value: EncodeResult } | { id: number; ok: false; error: string }

self.onmessage = async (e: MessageEvent<EncoderRequest>) => {
  const { id, job } = e.data
  let reply: EncoderReply
  try {
    reply = { id, ok: true, value: await encodeImage(job) }
  } catch (err) {
    reply = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  self.postMessage(reply)
}
