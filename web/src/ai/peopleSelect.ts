// People and faces in the app (docs/PHASE3.md Part 28): the three models in the shared runtime worker, once per photo.
// RF-DETR-Seg Nano finds the people, YuNet their faces, MediaPipe Selfie Multiclass their parts (on a crop around each
// person and each face); the pre- and post-processing is ai/people.ts. The graphs are freed when the photo is done
// (they run once per photo; the memory policy would free them anyway when a larger model loads).

import type { AsShot } from './depth'
import { segmentInput, type ModelEntry } from './manifest'
import { loadGraph, releaseGraph, runGraphNamed } from './runtime'
import type { GpuName } from './adapter'
import type { Provider } from './runtime.worker'
import {
  classMaps, decodeFaces, detectionMask, detectorInput, detectorOutputs, faceInput, faceInputSize, findPeople, finite, matchFaces, parserInput, squareCrop,
  FACE_CROP, PERSON_MARGIN, type ClassMaps, type Face, type PersonFound, type Tensor,
} from './people'

export class PeopleInvalidError extends Error {
  constructor() {
    super('The model gave invalid numbers on this computer.')
    this.name = 'PeopleInvalidError'
  }
}

export interface PeopleModels {
  detect: ModelEntry
  face: ModelEntry
  parse: ModelEntry
}

export interface PeopleProviders {
  detect: Provider
  face: Provider
  parse: Provider
}

/** What the models found on a photo (before the outline is refined), and the timings for Diagnostics. */
export interface PeopleAnalysis {
  people: PersonFound[]
  faces: Face[]
  gpu: GpuName | null
  ms: { load: number; detect: number; face: number; parse: number; parseRuns: number }
}

const tensors = (r: Record<string, Tensor>) => {
  for (const t of Object.values(r)) if (!finite(t.data)) throw new PeopleInvalidError()
  return r
}

/** Runs the three models on the photo as shot (shot: its pixels and size). */
export async function analysePhoto(m: PeopleModels, p: PeopleProviders, shot: Pick<AsShot, 'rgba' | 'width' | 'height'>): Promise<PeopleAnalysis> {
  const { rgba, width: W, height: H } = shot
  const t0 = performance.now()
  const det = await loadGraph(m.detect, 'model', p.detect)
  const face = await loadGraph(m.face, 'model', p.face)
  const parse = await loadGraph(m.parse, 'model', p.parse)
  const load = performance.now() - t0
  try {
    const di = segmentInput(m.detect)
    const d = await runGraphNamed(det.key, { input: { type: 'float32', data: detectorInput(rgba, W, H, di), dims: [1, 3, di.size, di.size] } })
    const out = detectorOutputs(tensors(d.outputs))
    const found = findPeople(out)
    const [fw, fh] = faceInputSize(W, H)
    const f = await runGraphNamed(face.key, { input: { type: 'float32', data: faceInput(rgba, W, H, fw, fh), dims: [1, 3, fh, fw] } })
    const faces = decodeFaces(tensors(f.outputs), fw, fh)
    const match = matchFaces(found, faces)
    const pi = segmentInput(m.parse)
    let parseMs = 0
    let runs = 0
    const people: PersonFound[] = []
    for (let k = 0; k < found.length; k++) {
      const x = found[k]
      const fc = match[k] >= 0 ? faces[match[k]] : null
      const crops = [squareCrop(x.box, W, H, 1 + 2 * PERSON_MARGIN), ...(fc ? [squareCrop(fc.box, W, H, FACE_CROP)] : [])]
      const parts: ClassMaps[] = []
      for (const crop of crops) {
        const r = await runGraphNamed(parse.key, { input_29: { type: 'float32', data: parserInput(rgba, W, H, crop, pi), dims: [1, pi.size, pi.size, 3] } })
        parseMs += r.ms
        runs++
        const o = tensors(r.outputs)
        parts.push(classMaps(o.Identity ?? Object.values(o)[0], crop))
      }
      const mask = detectionMask(out, x.query, x.score)
      people.push({ index: k + 1, score: x.score, box: x.box, mask, outline: mask, refined: false, face: fc, parts })
    }
    return { people, faces, gpu: det.gpu, ms: { load, detect: d.ms, face: f.ms, parse: parseMs, parseRuns: runs } }
  } finally {
    // Once per photo: the graphs go (Object select's, when loaded, stay).
    for (const k of [det.key, face.key, parse.key]) await releaseGraph(k)
  }
}
