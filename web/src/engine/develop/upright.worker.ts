/// <reference lib="webworker" />
// Runs darktable's line detector (lsd.ts via upright.ts) off the main thread.

import { detectSegments } from './upright'

self.onmessage = (e: MessageEvent<{ id: number; rgb: Float32Array; width: number; height: number }>) => {
  const { id, rgb, width, height } = e.data
  try {
    self.postMessage({ id, ok: true, segments: detectSegments(rgb, width, height) })
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
