// Object select in the app (docs/PHASE3.md Part 27): SAM 2.1 Hiera Tiny in the shared runtime worker.
//
// The image encoder runs once per photo; its three image embeddings (about 16 MB) stay in the worker under handles
// (runtime.ts `runGraphNamed` keep), and the prompt decoder runs on every pointer move with only the prompt sent and one
// 256 × 256 mask back. Both graphs stay loaded while the masking tool is open (runtime.ts `holdModel`); the memory
// policy frees them when another large model loads, and a later decode then finds the embeddings gone and the photo is
// encoded again. The pre- and post-processing is ai/segment.ts.

import type { AsShot } from './depth'
import { segmentInput, type ModelEntry, type Variant } from './manifest'
import { KeptMissingError, loadGraph, runGraphNamed } from './runtime'
import type { GpuName } from './adapter'
import type { Provider } from './runtime.worker'
import { encoderInput, finiteAll, pickMask, promptFeeds, SAM_IO, type Logits, type ShotPrompt } from './segment'

export class ObjectInvalidError extends Error {
  constructor(variant: Variant) {
    super(variant === 'fp16' ? 'The half-precision (fp16) model gave invalid numbers on this GPU (ONNX Runtime issue #26732).' : 'The model gave invalid numbers on this computer.')
    this.name = 'ObjectInvalidError'
  }
}

/** A photo encoded for Object select: what the decoder needs, and the timings for Diagnostics. */
export interface Encoded {
  photo: string
  model: string
  variant: Variant
  provider: Provider
  encKey: string
  decKey: string
  /** The rendering's uv → sensor map and the sensor's size (prompts and mattes move through them). */
  shot: Pick<AsShot, 'uvToSensor' | 'sensor' | 'width' | 'height'>
  gpu: GpuName | null
  loadMs: number
  encodeMs: number
}

const handles = (m: ModelEntry) => SAM_IO.embeddings.map((_, i) => `${m.id}:embedding:${i}`)

/**
 * Loads both graphs (from this device, checked) and encodes the photo as shot; the embeddings stay in the worker. The
 * decoder is loaded first, so a pointer move after this answers at once.
 */
export async function encodePhoto(m: ModelEntry, variant: Variant, provider: Provider, shot: AsShot, photo: string): Promise<Encoded> {
  const input = segmentInput(m)
  const t0 = performance.now()
  const dec = await loadGraph(m, 'decoder', provider)
  const enc = await loadGraph(m, 'encoder', provider)
  const loadMs = performance.now() - t0
  const pixels = encoderInput(shot.rgba, shot.width, shot.height, input)
  const keep = Object.fromEntries(SAM_IO.embeddings.map((n, i) => [n, handles(m)[i]]))
  const r = await runGraphNamed(enc.key, { [SAM_IO.pixels]: { type: 'float32', data: pixels, dims: [1, 3, input.size, input.size] } }, { keep, want: [] })
  return { photo, model: m.id, variant, provider, encKey: enc.key, decKey: dec.key, shot: { uvToSensor: shot.uvToSensor, sensor: shot.sensor, width: shot.width, height: shot.height }, gpu: enc.gpu, loadMs, encodeMs: r.ms }
}

/**
 * The decoder's best mask for a prompt on the encoded photo. KeptMissingError when the embeddings are gone (the
 * caller encodes again); ObjectInvalidError for non-finite output.
 */
export async function decodePrompt(m: ModelEntry, e: Encoded, prompt: ShotPrompt): Promise<{ logits: Logits; ms: number }> {
  const f = promptFeeds(prompt, segmentInput(m).size)
  const [h0, h1, h2] = handles(m)
  const r = await runGraphNamed(
    e.decKey,
    {
      [SAM_IO.points]: { type: 'float32', data: f.points, dims: f.pointDims },
      [SAM_IO.labels]: { type: 'int64', data: f.labels, dims: f.labelDims },
      [SAM_IO.boxes]: { type: 'float32', data: f.boxes, dims: f.boxDims },
      [SAM_IO.embeddings[0]]: { kept: h0 },
      [SAM_IO.embeddings[1]]: { kept: h1 },
      [SAM_IO.embeddings[2]]: { kept: h2 },
    },
    { want: [SAM_IO.iou, SAM_IO.masks, SAM_IO.object] },
  )
  const masks = r.outputs[SAM_IO.masks]
  const iou = r.outputs[SAM_IO.iou]
  if (!masks || !iou) throw new Error('The model gave no mask.')
  if (!finiteAll(masks.data) || !finiteAll(iou.data)) throw new ObjectInvalidError(e.variant)
  return { logits: pickMask(masks.data, masks.dims, iou.data, r.outputs[SAM_IO.object]?.data ?? null), ms: r.ms }
}

export { KeptMissingError }
