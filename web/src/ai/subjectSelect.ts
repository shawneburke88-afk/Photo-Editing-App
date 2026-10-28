// The Subject mask in the app (docs/PHASE3.md Part 30): BiRefNet_lite in the shared runtime worker, once per photo, and
// its matte moved into the sensor frame. The pre- and post-processing is ai/subject.ts.

import type { AsShot } from './depth'
import { segmentInput, type ModelEntry } from './manifest'
import { loadGraph, releaseGraph, runGraphNamed } from './runtime'
import type { GpuName } from './adapter'
import type { Provider } from './runtime.worker'
import { finiteAll, subjectProbabilities, subjectShare, subjectTensor, subjectToSensor, SUBJECT_IO } from './subject'

export class SubjectInvalidError extends Error {
  constructor() {
    super('The Subject model gave invalid numbers on this computer.')
    this.name = 'SubjectInvalidError'
  }
}

export interface SubjectRun {
  /** The matte in the sensor frame (8 bits, 255 = the subject). */
  matte: { px: Uint8Array; w: number; h: number }
  /** The share of the model's cells at ½ or more (its own answer, before the matte). */
  share: number
  provider: Provider
  gpu: GpuName | null
  loadMs: number
  inferMs: number
  /** The matte made from the model's logits (the sigmoid, the sensor frame). */
  postMs: number
}

/**
 * Loads the model (from this device, checked) and finds the subject in the photo as shot. On the processor the graph is
 * released after the run: its CPU run holds about 2 GB of the runtime's 4 GB WebAssembly memory at its peak (the
 * "AI models" workflow's measurements, PHASE3.md Part 30), and the subject is found once per photo.
 */
export async function computeSubject(m: ModelEntry, provider: Provider, shot: AsShot, long: number): Promise<SubjectRun> {
  const input = segmentInput(m)
  const t0 = performance.now()
  const g = await loadGraph(m, 'model', provider)
  const loadMs = performance.now() - t0
  try {
    const pixels = subjectTensor(shot.rgba, shot.width, shot.height, input)
    const r = await runGraphNamed(g.key, { [SUBJECT_IO.pixels]: { type: 'float32', data: pixels, dims: [1, 3, input.size, input.size] } }, { want: [SUBJECT_IO.matte] })
    const out = r.outputs[SUBJECT_IO.matte]
    if (!out) throw new Error('The model gave no matte.')
    if (!finiteAll(out.data)) throw new SubjectInvalidError()
    const t1 = performance.now()
    const p = subjectProbabilities(out.data, out.dims)
    const px = subjectToSensor(p, shot.uvToSensor, shot.sensor, long)
    return { matte: px, share: subjectShare(p), provider, gpu: g.gpu, loadMs, inferMs: r.ms, postMs: performance.now() - t1 }
  } finally {
    if (provider === 'wasm') await releaseGraph(g.key).catch(() => {})
  }
}
