// The Sky mask in the app (docs/PHASE3.md Part 29): EfficientViT-Seg B1 (ADE20K) in the shared runtime worker, once per
// photo, and its matte made and moved into the sensor frame. The pre- and post-processing is ai/sky.ts.

import type { AsShot } from './depth'
import { skyInput, type ModelEntry } from './manifest'
import { loadGraph, runGraphNamed } from './runtime'
import type { GpuName } from './adapter'
import type { Provider } from './runtime.worker'
import { finiteAll, skyArgmaxShare, skyMargin, skyMatte, skyModelSize, skyTensor, skyToSensor, SKY_IO } from './sky'

export class SkyInvalidError extends Error {
  constructor() {
    super('The Sky model gave invalid numbers on this computer.')
    this.name = 'SkyInvalidError'
  }
}

export interface SkyRun {
  /** The matte in the sensor frame (8 bits, 255 = sky). */
  matte: { px: Uint8Array; w: number; h: number }
  /** The model's input size (width, height). */
  size: [number, number]
  /** The share of the model's cells it calls sky (its own answer, before the matte). */
  argmaxShare: number
  provider: Provider
  gpu: GpuName | null
  loadMs: number
  inferMs: number
  /** The matte made from the model's scores (margins, enlarging, refining, the sensor frame). */
  postMs: number
}

/** Loads the model (from this device, checked) and finds the sky in the photo as shot. */
export async function computeSky(m: ModelEntry, provider: Provider, shot: AsShot, long: number): Promise<SkyRun> {
  const input = skyInput(m)
  const size = skyModelSize(shot.width, shot.height, input)
  const [mw, mh] = size
  const t0 = performance.now()
  const g = await loadGraph(m, 'model', provider)
  const loadMs = performance.now() - t0
  const pixels = skyTensor(shot.rgba, shot.width, shot.height, mw, mh, input)
  const r = await runGraphNamed(g.key, { [SKY_IO.pixels]: { type: 'float32', data: pixels, dims: [1, 3, mh, mw] } }, { want: [SKY_IO.logits] })
  const out = r.outputs[SKY_IO.logits]
  if (!out) throw new Error('The model gave no scores.')
  if (!finiteAll(out.data)) throw new SkyInvalidError()
  const t1 = performance.now()
  const lo = skyMargin(out.data, out.dims, input.skyClass)
  const matte = skyMatte(lo, shot.rgba, shot.width, shot.height)
  const px = skyToSensor(matte, shot.width, shot.height, shot.uvToSensor, shot.sensor, long)
  return { matte: px, size, argmaxShare: skyArgmaxShare(out.data, out.dims, input.skyClass), provider, gpu: g.gpu, loadMs, inferMs: r.ms, postMs: performance.now() - t1 }
}
