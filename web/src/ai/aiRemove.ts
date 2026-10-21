// AI Remove in the app (docs/PHASE3.md Part 26): one spot's patch, made by Moebius in the shared runtime worker.
//
// The three graphs run one after another, each loaded from this device (and checked) when its phase starts: the image
// encoder, then the 907 MB denoiser 20 times (the encoder is freed once the denoiser is loaded: ONNX Runtime ends its
// GPU device when its last session goes), then the decoder (freed after it ran). The denoiser stays loaded for the next
// spot until the runtime's idle timeout. So at most the denoiser and one image graph are in GPU memory at once. Each run is held as foreground GPU work (Part 14's gate: Export and the background developer wait between
// runs) and has its own watchdog (runtime.ts), sized so a slow 20-step run is never stopped while a hung step is.

import { gpuGate } from '../engine/gpu/gate'
import { PATCH_ENCODING, encodePatch, type AiFill } from '../engine/develop/ai-patch'
import { clipRect, spotBounds, spotPixels, type PxRect, type Spot } from '../engine/develop/spots'
import { allFinite, contextRect, extractPatch, generate, GUIDANCE, prepare, STEPS, STRENGTH, type MoebiusRunner } from './inpaint'
import type { ModelEntry } from './manifest'
import { loadGraph, releaseGraph, runGraph } from './runtime'
import type { Provider } from './runtime.worker'

/** Step-by-step trace in the console when `globalThis.__lbAiDebug` is set (tests and support; off by default). */
const trace = (m: string) => {
  if ((globalThis as { __lbAiDebug?: boolean }).__lbAiDebug) console.debug(`[ai-remove] ${m}`)
}

export class AiInvalidError extends Error {
  constructor() {
    super('The AI model gave invalid numbers on this GPU, so nothing was changed.')
    this.name = 'AiInvalidError'
  }
}

export interface AiRun {
  fill: AiFill
  /** For the log (never file names or pixels). */
  log: { provider: Provider; crop: [number, number]; patch: [number, number]; chars: number; loadMs: number; encodeMs: number; stepMs: number; steps: number; decodeMs: number; totalMs: number }
}

export interface AiRemoveOptions {
  seed: number
  provider: Provider
  runtimeVersion: string
  /** "Preparing", then each step, then "finishing". */
  onProgress?: (p: { phase: 'load' | 'encode' | 'denoise' | 'decode'; step?: number; steps?: number }) => void
  signal?: AbortSignal
}

/**
 * The patch for an AI Remove spot. `readCrop` gives the photo's pixels (linear Rec.2020, interleaved RGB) over a
 * rectangle of the w × h scene, as it is with the spots before this one.
 */
export async function makeAiFill(m: ModelEntry, spot: Spot, size: [number, number], readCrop: (r: PxRect) => Promise<Float32Array>, o: AiRemoveOptions): Promise<AiRun> {
  const t0 = performance.now()
  const [w, h] = size
  const px = spotPixels(spot, w, h)
  const crop = contextRect(clipRect(spotBounds(px), w, h), w, h)
  trace(`read ${crop.x1 - crop.x0} x ${crop.y1 - crop.y0}`)
  const prep = prepare(await readCrop(crop), crop, px, w, h)
  trace(`prepared (gain ${prep.gain.toFixed(3)})`)
  let loadMs = 0
  const keys: Record<string, string> = {}
  const load = async (part: string) => {
    o.onProgress?.({ phase: 'load' })
    trace(`load ${part}`)
    const r = await loadGraph(m, part, o.provider)
    trace(`loaded ${part} in ${Math.round(r.ms)} ms`)
    loadMs += r.ms
    keys[part] = r.key
    return r.key
  }
  const run = async (part: string, feeds: Parameters<typeof runGraph>[1]) => {
    const key = keys[part] ?? (await load(part))
    trace(`run ${part}`)
    const r = await gpuGate.foreground(() => runGraph(key, feeds))
    trace(`ran ${part} in ${Math.round(r.ms)} ms`)
    return r.data
  }
  const runner: MoebiusRunner = {
    phase: async (name) => {
      if (name === 'encode') await load('vae_encoder')
      if (name === 'denoise') {
        // The denoiser first, then the encoder freed: ONNX Runtime ends its GPU device when its last session goes.
        await load('unet')
        trace('free vae_encoder')
        if (keys.vae_encoder) await releaseGraph(keys.vae_encoder)
      }
      if (name === 'decode') await load('vae_decoder')
      o.onProgress?.({ phase: name })
    },
    encode: (image) => run('vae_encoder', { image: { type: 'float32', data: image, dims: [1, 3, 512, 512] } }),
    unet: (latent, timesteps, ids) => run('unet', { latent: { type: 'float32', data: latent, dims: [2, 9, 64, 64] }, timesteps: { type: 'int64', data: timesteps, dims: [2] }, input_ids: { type: 'int64', data: ids, dims: [2, 10] } }),
    decode: (latent) => run('vae_decoder', { latent: { type: 'float32', data: latent, dims: [1, 4, 64, 64] } }),
  }
  const gen = await generate(runner, prep, { seed: o.seed, signal: o.signal, onStep: (step, steps) => o.onProgress?.({ phase: 'denoise', step, steps }) }).finally(() => {
    if (keys.vae_decoder) void releaseGraph(keys.vae_decoder)
    if (keys.vae_encoder) void releaseGraph(keys.vae_encoder)
  })
  if (!allFinite(gen.image)) throw new AiInvalidError()
  const ex = extractPatch(gen.image, prep, px, w, h)
  const data = await encodePatch(ex.rgb, ex.width, ex.height)
  const fill: AiFill = {
    model: m.id,
    modelVersion: `${m.source.revision?.slice(0, 7) ?? 'unpinned'}/${m.files[0].variant}`,
    runtime: `onnxruntime-web ${o.runtimeVersion} ${o.provider}`,
    seed: o.seed,
    steps: STEPS,
    strength: STRENGTH,
    guidance: GUIDANCE,
    rect: ex.rect,
    gain: Number(prep.gain.toPrecision(7)),
    width: ex.width,
    height: ex.height,
    encoding: PATCH_ENCODING,
    data,
  }
  const steps = gen.ms.steps
  return {
    fill,
    log: {
      provider: o.provider,
      crop: [crop.x1 - crop.x0, crop.y1 - crop.y0],
      patch: [ex.width, ex.height],
      chars: data.length,
      loadMs: Math.round(loadMs),
      encodeMs: Math.round(gen.ms.encode),
      stepMs: Math.round(steps.reduce((a, b) => a + b, 0) / Math.max(1, steps.length)),
      steps: steps.length,
      decodeMs: Math.round(gen.ms.decode),
      totalMs: Math.round(performance.now() - t0),
    },
  }
}
