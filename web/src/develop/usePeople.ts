// People and faces in Develop (docs/PHASE3.md Part 28): getting the three models ready (one dialog asking before any
// is downloaded: PeopleDialog), finding the people and faces on the photo once (ai/peopleSelect.ts), their outlines
// refined with SAM 2.1 when Object select's model is on this device, and the mattes of the parts the user ticks. The
// panel shows what is happening (`status`) and why it can't (`error`); Diagnostics get an `ai-mask` entry per photo
// analysed and per part made (counts and times only: no boxes, no names, no pixels).

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { AsShot } from '../ai/depth'
import { chooseFiles, modelPinned, type ModelEntry, type ModelFile } from '../ai/manifest'
import { AI, detectModel, faceModel, parseModel, peoplePlan } from '../ai/models'
import { boxToSensor, boxToShot, chooseOutline, peopleMatte, personAt, type Box, type PersonFound } from '../ai/people'
import { analysePhoto, PeopleInvalidError } from '../ai/peopleSelect'
import { probeGpu, runtimeMessage } from '../ai/runtime'
import { coverage } from '../ai/segment'
import { installed } from '../ai/store'
import { diagnostics } from '../diagnostics/recorder'
import { encodeDepth } from '../engine/develop/depth-map'
import type { Mat3 } from '../engine/color/matrix'
import { AI_RASTER_LONG, MAX_AI_BOXES, type AiPrompt, type AiShape, type PeoplePart } from '../engine/develop/masks'
import { gpuGate } from '../engine/gpu/gate'
import type { ObjectSelect } from './useObjectSelect'

/** The People models this device still needs (each with its files), asked for in one dialog. */
export interface PeopleAsk {
  items: { model: ModelEntry; files: ModelFile[] }[]
  slow: boolean
  done: (ok: boolean) => void
}

/** What was found on a photo, kept while it is shown. */
export interface PeopleFound {
  photo: string
  people: PersonFound[]
  faces: number
  uvToSensor: Mat3
  sensor: [number, number]
  /** "<id> <revision 7>/fp32" of each model that took part, and the runtime line. */
  versions: { detect: string; face: string; parse: string; outline: string | null }
  runtime: string
}

/** What a People part stores (masks.ts AiShape without kind and what), or `none` when nobody is there. */
export type PeopleResult = (Omit<AiShape, 'kind' | 'what' | 'prompt'> & { raster: NonNullable<AiShape['raster']>; prompt: AiPrompt }) | { none: true }

/** The People photo analyses and parts made (for the e2e tests and the console). */
export const peopleTimings: { step: string; people?: number; faces?: number; refined?: number; totalMs: number; chars?: number; coverage?: number }[] = []

interface Options {
  /** The photo as shot, rendered with its long side `long` (ai/depth.ts AsShot). */
  renderAsShot: (long: number) => Promise<AsShot | null>
  /** The photo shown now (its id), or null. */
  photo: () => string | null
  /** Object select: SAM 2.1's outline for each person's box, when its model is on this device. */
  object: ObjectSelect
}

/** The photo is rendered at most this large for People (crops of small people stay sharp enough for 256²). */
export const PEOPLE_RENDER_LONG = 2048

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : String(e).slice(0, 300))
const version = (m: ModelEntry, variant = 'fp32') => `${m.id} ${m.source.revision?.slice(0, 7) ?? 'unpinned'}/${variant}`

export function usePeople(o: Options) {
  const [ask, setAsk] = useState<PeopleAsk | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<PeopleFound | null>(null)
  /** The row the pointer is on in the list (its people framed on the photo). */
  const [hot, setHot] = useState<number | 'all' | null>(null)
  const opts = useRef(o)
  useLayoutEffect(() => {
    opts.current = o
  })
  const cache = useRef<PeopleFound | null>(null)
  const running = useRef<Promise<PeopleFound | null> | null>(null)

  const askFor = (items: PeopleAsk['items'], slow: boolean) => new Promise<boolean>((resolve) => setAsk({ items, slow, done: (ok) => { setAsk(null); resolve(ok) } }))

  /**
   * The people and faces on the photo shown (asking to download the models first); `show` opens the list in the panel.
   * Null: declined or failed.
   */
  const find = useCallback(async (show = true): Promise<PeopleFound | null> => {
    const photo = opts.current.photo()
    if (!photo) return null
    if (cache.current?.photo === photo) {
      if (show) setFound(cache.current)
      return cache.current
    }
    if (running.current) {
      const f = await running.current
      if (f && show) setFound(f)
      return f
    }
    const run = (async (): Promise<PeopleFound | null> => {
      setError(null)
      const detect = detectModel()
      const face = faceModel()
      const parse = parseModel()
      if (!AI || !detect || !face || !parse || ![detect, face, parse].every(modelPinned)) {
        setError('People isn’t available in this build of LightBench: its model files haven’t been published with it yet.')
        return null
      }
      try {
        const gpu = await probeGpu()
        const plan = peoplePlan(detect, gpu)
        if (!plan.detect) {
          setError(plan.why)
          return null
        }
        const missing: PeopleAsk['items'] = []
        for (const m of [detect, face, parse]) if (!(await installed(m))) missing.push({ model: m, files: chooseFiles(m, gpu) })
        if (missing.some((x) => !x.files.length)) {
          setError('No files of the People models suit this computer in this build.')
          return null
        }
        if (missing.length && !(await askFor(missing, !!plan.slow))) return null
        setStatus(plan.slow ? 'Finding people and faces on the processor (once for this photo)…' : 'Finding people and faces (once for this photo)…')
        const t0 = performance.now()
        const shot = await opts.current.renderAsShot(PEOPLE_RENDER_LONG)
        if (!shot) return null
        const renderMs = performance.now() - t0
        const a = await gpuGate.foreground(() => analysePhoto({ detect, face, parse }, { detect: plan.detect!, face: plan.face, parse: plan.parse }, shot))
        if (opts.current.photo() !== photo) return null
        // The whole person's outline: SAM 2.1 from the person's box, when Object select's model is here.
        let outline: string | null = null
        let outlineMs = 0
        let refined = 0
        if (a.people.length) {
          setStatus('Outlining each person…')
          const t1 = performance.now()
          const sam = await opts.current.object.outlines(a.people.map((p) => p.box))
          outlineMs = performance.now() - t1
          if (sam) {
            a.people.forEach((p, i) => {
              const c = chooseOutline(p.mask, sam.logits[i] ?? null)
              p.outline = c.outline
              p.refined = c.refined
              if (c.refined) refined++
            })
            const segment = AI.models.find((m) => m.task === 'segment')
            if (refined && segment) outline = version(segment, sam.variant)
          }
        }
        const providers = [...new Set([plan.detect, plan.face, plan.parse])].join('+')
        const f: PeopleFound = {
          photo,
          people: a.people,
          faces: a.faces.length,
          uvToSensor: shot.uvToSensor,
          sensor: shot.sensor,
          versions: { detect: version(detect), face: version(face), parse: version(parse), outline },
          runtime: `onnxruntime-web ${AI.runtime.version} ${providers}`,
        }
        const totalMs = performance.now() - t0
        const matched = a.people.filter((p) => p.face).length
        diagnostics.log('ai-mask', {
          what: 'people', step: 'find', models: [detect.id, face.id, parse.id], providers: { detect: plan.detect, face: plan.face, parse: plan.parse }, gpu: a.gpu,
          people: a.people.length, faces: a.faces.length, matched, refined, renderMs: Math.round(renderMs), loadMs: Math.round(a.ms.load), detectMs: Math.round(a.ms.detect),
          faceMs: Math.round(a.ms.face), parseMs: Math.round(a.ms.parse), parseRuns: a.ms.parseRuns, outlineMs: Math.round(outlineMs), totalMs: Math.round(totalMs),
        })
        peopleTimings.push({ step: 'find', people: a.people.length, faces: a.faces.length, refined, totalMs })
        console.info(`People: ${a.people.length} people, ${a.faces.length} faces (${matched} matched), ${refined} outlines refined, in ${Math.round(totalMs)} ms (${providers})`)
        cache.current = f
        if (show) setFound(f)
        return f
      } catch (err) {
        diagnostics.log('ai-mask', { what: 'people', step: 'find', error: errText(err) })
        setError(err instanceof PeopleInvalidError ? `${err.message} People can’t be used on this computer for now.` : runtimeMessage(err))
        return null
      } finally {
        setStatus(null)
      }
    })()
    running.current = run
    try {
      return await run
    } finally {
      running.current = null
    }
  }, [])

  /** The stored part for one person (1-based index) or all of them, made from what was found. */
  async function make(f: PeopleFound, who: number | 'all', what: PeoplePart, step: string): Promise<PeopleResult> {
    const t0 = performance.now()
    const people = who === 'all' ? f.people : f.people.filter((p) => p.index === who)
    if (!people.length) return { none: true }
    const m = peopleMatte(people, what, f.uvToSensor, f.sensor, AI_RASTER_LONG)
    const raster = await encodeDepth(m.px, m.w, m.h)
    const cov = coverage(m.px)
    const refined = what === 'person' && people.some((p) => p.refined) && f.versions.outline
    const main = what === 'person' ? (refined ? f.versions.outline! : f.versions.detect) : f.versions.parse
    const [model, modelVersion] = main.split(' ')
    const models = [f.versions.detect, f.versions.face, f.versions.parse, ...(refined ? [f.versions.outline!] : [])]
    const toSensor = (b: Box) => boxToSensor(f.uvToSensor, b)
    const prompt: AiPrompt = who === 'all' ? { all: true, boxes: f.people.slice(0, MAX_AI_BOXES).map((p) => toSensor(p.box)) } : { person: who, box: toSensor(people[0].box) }
    const totalMs = performance.now() - t0
    peopleTimings.push({ step, totalMs, chars: raster.data.length, coverage: cov })
    diagnostics.log('ai-mask', { what, step, who: who === 'all' ? 'all' : 'one', matte: [m.w, m.h], chars: raster.data.length, totalMs: Math.round(totalMs) })
    return { model, modelVersion, runtime: f.runtime, models, prompt, raster }
  }

  /** The parts ticked in the list, for the photo shown (what was found there). */
  async function parts(picks: { who: number | 'all'; what: PeoplePart }[]): Promise<{ who: number | 'all'; what: PeoplePart; r: PeopleResult }[] | null> {
    const f = cache.current
    if (!f || f.photo !== opts.current.photo()) return null
    const out = []
    for (const p of picks) out.push({ ...p, r: await make(f, p.who, p.what, 'new') })
    return out
  }

  /**
   * A stored People part made for the photo shown (pasted, from a preset, or computed again): "All people" from
   * everyone found here, one person from whoever stands where that person's box was. Null: declined or failed.
   */
  async function compute(s: AiShape, step: string): Promise<PeopleResult | null> {
    const f = await find(false)
    if (!f) return null
    const what = s.what as PeoplePart
    if (s.prompt?.all) return make(f, 'all', what, step)
    if (!s.prompt?.box) return { none: true }
    const i = personAt(f.people, boxToShot(f.uvToSensor, s.prompt.box))
    if (i < 0) return { none: true }
    const r = await make(f, f.people[i].index, what, step)
    // Keep the number it had (its name) unless it is a new photo's person.
    return 'none' in r ? r : { ...r, prompt: { ...r.prompt, person: s.prompt.person ?? f.people[i].index } }
  }

  /** Another photo: its people are found when People is next used. */
  const resetForPhoto = useCallback(() => {
    cache.current = null
    setFound(null)
    setError(null)
  }, [])

  return { ask, status, error, setError, found, hot, setHot, find, parts, compute, close: () => { setFound(null); setHot(null) }, resetForPhoto }
}

export type People = ReturnType<typeof usePeople>
