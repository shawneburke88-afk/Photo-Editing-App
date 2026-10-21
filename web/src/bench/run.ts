// The GPU benchmark (System Check; PHASE3.md Part 16). Runs the develop pipeline's stages on test images through the
// engine's own API (DevelopEngine, develop/source.ts, the export's JPEG encoder), so the numbers are the real code's,
// on a private engine whose device is instrumented by GpuProfiler (pass times with timestamp-query, allocations).
//
// Method, per stage: the stage's settings; untimed preparation (the RAW stage built for those settings); `warmup`
// runs that aren't counted (pipelines, caches, the noise profiles, the JPEG encoder's WebAssembly); then `runs`
// measured runs. Each run changes the setting the stage's cache is keyed on by a step too small to change the work
// (e.g. Luminance 30 → 31), so every run does the stage's work again, as a slider move would. Reported: median and
// minimum of the wall-clock time (performance.now() around the engine call and queue.onSubmittedWorkDone()) and, with
// timestamp-query, of the GPU time of the stage's passes.
//
// It never runs while Develop works: before every run it waits for the foreground gate (engine/gpu/gate.ts) to be
// quiet, and before every stage for the background developer (Paste, Sync) to finish. A lost device (or an
// out-of-memory or internal error) fails the stage's `guarded` call; the stage is run again once on a new engine with
// the image loaded again (Part 14's recovery), and the row says so.

import { DEFAULT_LENS, LEGACY_LENS } from '../engine/lens/correction'
import { batch } from '../develop/batch'
import { loadIntoEngine, multipliers, renderThumbnail, stageOptions, type SensorInfo } from '../develop/source'
import { outputTrc, rec2020ToProfile, SRGB_PROFILE } from '../engine/color/icc'
import type { Vec3 } from '../engine/color/matrix'
import { DEFAULT_DETAIL } from '../engine/detail/settings'
import { DEFAULT_ADVANCED } from '../engine/develop/colour-mixer'
import { CURRENT_PROCESS } from '../engine/develop/process'
import { defaultsFor, displayUniforms, normalizeSettings, type DevelopSettings } from '../engine/develop/settings'
import { DevelopEngine, GpuWorkError, retryableGpuError, type OutputImage, type ViewState } from '../engine/gpu/develop-engine'
import { cpuBudget } from '../engine/cpu-budget'
import { gpuGate } from '../engine/gpu/gate'
import { presentChoice } from '../engine/gpu/present'
import type { DecodeResult } from '../engine/raw/types'
import { encodeJpeg } from '../export/jpeg-encoder'
import { DEFAULT_CLIP, DEFAULT_RAW_CLIP, type Indicators } from '../engine/develop/indicators'
import { clearProofCache, proofLut } from '../engine/proof/client'
import { builtinIcc } from '../engine/proof/profiles'
import { proofKey } from '../engine/proof/settings'
import { computeDepth, renderSize } from '../ai/depth'
import { AI, depthModel, providerFor } from '../ai/models'
import { installed } from '../ai/store'
import { DEFAULT_GEOMETRY } from '../engine/develop/geometry'
import { GpuProfiler, type PassTime } from './profiler'
import { commitOf, type AdapterReport, type BenchReport, type BenchRow, type DatasetReport } from './report'
import { looksQuantized, summarize, sumPasses } from './stats'
import { scaledSize, SYNTHETIC, syntheticDecode, type SyntheticSpec } from './synthetic'

export type BenchMode = 'quick' | 'full'

/** The stages, in pipeline order (the table's order). */
export type StageId =
  | 'stageA' | 'stageA3' | 'warp' | 'toneMask' | 'mixer' | 'mixerNoGuide' | 'grading' | 'masksFit' | 'masksExport'
  | 'vignetteFit' | 'vignetteExport' | 'grainFit' | 'grainExport' | 'tcFit' | 'tcExport' | 'dehazeFit' | 'dehazeExport' | 'glowFit' | 'glowExport'
  | 'denoise' | 'sharpen'
  | 'displayFit' | 'display100' | 'displayFitCurve' | 'display100Curve' | 'proof' | 'proofLut'
  | 'remove' | 'export' | 'exportAll' | 'jpeg' | 'thumb' | 'aiDepth'

type Kind = 'bayer' | 'xtrans' | 'srgb'

export interface DatasetPlan {
  id: string
  label: string
  kind: Kind
  stages: StageId[]
  /** Makes the decoded image (synthetic, or the user's photo read locally). */
  decode: () => Promise<DecodeResult>
  width: number
  height: number
}

export interface BenchPlan {
  mode: BenchMode
  /** `?benchmp=`: synthetic images scaled to this many megapixels (testing); null = nominal sizes. */
  scaledTo: number | null
  warmup: number
  runs: number
  datasets: DatasetPlan[]
}

/** The Effects rows (Part 25): each tool at fit and in the full-size export. */
const EFFECT_ROWS: StageId[] = ['vignetteFit', 'vignetteExport', 'grainFit', 'grainExport', 'tcFit', 'tcExport', 'dehazeFit', 'dehazeExport', 'glowFit', 'glowExport']
const ALL_RAW: StageId[] = ['stageA', 'warp', 'toneMask', 'mixer', 'mixerNoGuide', 'grading', 'masksFit', 'masksExport', ...EFFECT_ROWS, 'denoise', 'sharpen', 'displayFit', 'display100', 'displayFitCurve', 'display100Curve', 'proof', 'proofLut', 'remove', 'export', 'exportAll', 'jpeg', 'thumb']
const STAGES_FOR: Record<BenchMode, Record<Kind, StageId[]>> = {
  quick: {
    bayer: ALL_RAW,
    xtrans: ['stageA', 'displayFit', 'export'],
    srgb: ['stageA', 'displayFit', 'export', 'aiDepth'],
  },
  full: {
    bayer: ALL_RAW,
    xtrans: ['stageA', 'stageA3', 'displayFit', 'display100', 'export', 'exportAll'],
    srgb: ['stageA', 'mixer', 'mixerNoGuide', 'grading', 'masksFit', 'vignetteFit', 'grainFit', 'tcFit', 'dehazeFit', 'glowFit', 'displayFit', 'display100', 'displayFitCurve', 'export', 'jpeg', 'thumb', 'aiDepth'],
  },
}

const synthetic = (spec: SyntheticSpec, mp: number | null, stages: StageId[]): DatasetPlan => {
  const [width, height] = scaledSize(spec, mp)
  // Scaled for testing: the label says the size actually used.
  const label = mp ? `${spec.label.split(' ')[0]} ${((width * height) / 1e6).toFixed(2)} MP (synthetic, scaled)` : spec.label
  return { id: spec.id, label, kind: spec.kind, stages, width, height, decode: async () => syntheticDecode(spec, width, height) }
}

/**
 * What a mode runs. Quick (about 30 s on a discrete GPU): the 24 MP Bayer image through every stage, and the sRGB
 * image's input stage, fitted view and export. Full (a few minutes): also the 45 MP Bayer image, the X-Trans image
 * (Markesteijn 1- and 3-pass) and more of the sRGB image, with more runs. `megapixels` (`?benchmp=`) scales the test
 * images for testing on software renderers.
 */
export function benchPlan(mode: BenchMode, megapixels: number | null = null, extra: DatasetPlan[] = []): BenchPlan {
  const s = STAGES_FOR[mode]
  const datasets = mode === 'quick'
    ? [synthetic(SYNTHETIC.bayer24, megapixels, s.bayer), synthetic(SYNTHETIC.srgb24, megapixels, s.srgb)]
    : [
        synthetic(SYNTHETIC.bayer24, megapixels, s.bayer),
        synthetic(SYNTHETIC.bayer45, megapixels, s.bayer),
        synthetic(SYNTHETIC.xtrans26, megapixels, s.xtrans),
        synthetic(SYNTHETIC.srgb24, megapixels, s.srgb),
      ]
  return { mode, scaledTo: megapixels, warmup: mode === 'quick' ? 1 : 2, runs: mode === 'quick' ? 3 : 5, datasets: [...datasets, ...extra] }
}

/** A user's photo as a dataset: the same stages as the synthetic image of its kind. Its name is never reported. */
export function photoDataset(mode: BenchMode, kind: Kind, width: number, height: number, decode: () => Promise<DecodeResult>): DatasetPlan {
  const name = kind === 'srgb' ? 'JPEG' : kind === 'xtrans' ? 'X-Trans RAW' : 'Bayer RAW'
  return { id: 'photo', label: `Your photo (${name}, ${(width * height / 1e6).toFixed(1)} MP)`, kind, stages: STAGES_FOR[mode][kind], width, height, decode }
}

/** Runs measured per stage, warm-ups included, for the progress bar. */
export function plannedRuns(p: BenchPlan): number {
  return p.datasets.reduce((n, d) => n + d.stages.length * (p.warmup + p.runs), 0)
}

// ---- stages

interface Ctx {
  engine: DevelopEngine
  info: SensorInfo
  kind: Kind
  base: DevelopSettings
  /** The last export render (the JPEG stage encodes it). */
  lastOut: OutputImage | null
}

interface Sub {
  id: string
  label: string
  match: (label: string) => boolean
}

interface StageDef {
  label: string
  /** The stage's settings from the image's defaults. */
  settings: (base: DevelopSettings, kind: Kind) => DevelopSettings
  /** One run; `k` counts runs from 0 (warm-ups first). */
  run: (c: Ctx, s: DevelopSettings, k: number) => Promise<unknown>
  /** Passes counted in the GPU column (all when absent; none for CPU-only stages). */
  gpu?: ((label: string) => boolean) | 'none'
  subs?: (kind: Kind) => Sub[]
  note?: string | ((kind: Kind) => string)
}

const FIT: ViewState = { zoom: 'fit', center: [0.5, 0.5] }
const FULL: ViewState = { zoom: 1, center: [0.5, 0.5] }

/** Settings from a plain object, as a saved edit would be read (normalizeSettings). */
const edit = (kind: Kind, s: object): DevelopSettings => normalizeSettings(JSON.parse(JSON.stringify(s)) as Partial<DevelopSettings>, kind === 'srgb' ? 'rgb' : 'raw')
const without = (s: DevelopSettings, ...keys: (keyof DevelopSettings)[]) => {
  const o: Record<string, unknown> = { ...s }
  for (const k of keys) delete o[k]
  return o
}
/** No lens correction and no Detail: exact geometry, the scene sampled as it is. */
const plain = (s: DevelopSettings) => ({ ...without(s, 'detail'), lens: LEGACY_LENS })

/** A representative Tone Curve (regions, an RGB S-curve and per-channel points). */
const TONE_CURVE = {
  regions: { shadows: 30, darks: 0, lights: 10, highlights: -46, splits: [25, 50, 60] },
  rgb: [[0, 0], [0.17, 0.11], [0.5, 0.575], [0.83, 0.89], [1, 1]],
  red: [[0, 0], [0.5, 0.55], [1, 1]],
  green: [[0, 0], [1, 1]],
  blue: [[0, 0.04], [0.5, 0.46], [1, 1]],
  saturation: 60,
  norm: 'max',
}

const wbOf = (c: Ctx, s: DevelopSettings): Vec3 => multipliers(s, c.info)
/** Exposure moved by a hundredth of a stop per run, as during a slider drag (nothing cached depends on it). */
const nudged = (s: DevelopSettings, k: number): DevelopSettings => ({ ...s, exposure: s.exposure + 0.01 * (k % 7) })
const outputOptions = (w: number, h: number) => ({ width: w, height: h, toOutput: rec2020ToProfile(SRGB_PROFILE), trc: outputTrc(SRGB_PROFILE), bits: 8 as const, dither: 0 })

const one = (...names: string[]) => (l: string) => names.includes(l)
const DENOISE = one('precondition', 'decompose', 'reduceFirst', 'reduceSecond', 'synthesize', 'backtransform', 'mip')
const CAPTURE = (l: string) => l.startsWith('cs') || l === 'mip'

const display = (view: ViewState, curve: boolean): StageDef => ({
  label: `Display pass, ${view.zoom === 'fit' ? 'fit' : '100 %'}, ${curve ? 'with' : 'without'} Tone Curve`,
  settings: (b, kind) => (curve ? edit(kind, { ...b, toneCurve: TONE_CURVE }) : b),
  run: (c, s, k) => c.engine.render(displayUniforms(nudged(s, k)), wbOf(c, s), view),
  gpu: one('display'),
  note: 'one redraw after an Exposure move (Detail, warp and masks cached); wall includes the read-back copy in compatibility mode',
})

/**
 * A representative Colour Mixer (PHASE3.md Part 15): a few bands moved in each channel. What it costs doesn't depend
 * on the values, only on whether the guided filter runs (`guided`).
 */
const COLOUR_MIXER = (guided: boolean) => ({
  hue: [0, 0, 0, 15, 0, 0, 0, 0],
  saturation: [0, 0, 0, 0, 0, 40, 0, 0],
  luminance: [0, 20, 0, 0, 0, -20, 0, 0],
  advanced: { ...DEFAULT_ADVANCED, guided },
})
/**
 * A representative Colour Grading (PHASE3.md Part 17): all four wheels tinted, two with luminance. Its cost doesn't depend
 * on the values: once on, every pixel runs darktable's color balance rgb twice (the grade, and the same steps with neutral
 * settings that are subtracted).
 */
const COLOUR_GRADING = {
  shadows: { hue: 200, sat: 30, lum: -10 },
  midtones: { hue: 40, sat: 15, lum: 0 },
  highlights: { hue: 45, sat: 25, lum: 10 },
  global: { hue: 30, sat: 10, lum: 0 },
  blending: 50,
  balance: 0,
}
/**
 * Soft proofing (PHASE3.md Part 20): its table for the built-in Adobe RGB (1998)-compatible profile, Relative
 * Colorimetric with black point compensation (the default), built by the worker the first time (a warm-up) and kept.
 * A loaded printer profile's table takes longer to build (its tables go through Little CMS); the GPU's work is the same.
 */
const PROOF_PROFILE = 'adobe-rgb-compatible'
const PROOF_OPTIONS = { intent: 'relative', bpc: true, simulatePaper: false } as const
const proofTable = () => proofLut(`builtin-${PROOF_PROFILE}`, builtinIcc(PROOF_PROFILE), PROOF_OPTIONS)
/** What Develop passes while proofing: no clipping overlays, both gamut warnings (the most the shader does). */
const proofIndicators = async (): Promise<Indicators> => ({
  clip: DEFAULT_CLIP,
  showClip: false,
  raw: DEFAULT_RAW_CLIP,
  showRaw: false,
  proof: { key: proofKey(`builtin-${PROOF_PROFILE}`, PROOF_OPTIONS), lut: await proofTable(), destWarning: true, screenWarning: true },
})

/**
 * Three masks (PHASE3.md Part 23): a brush stroke of 40 dabs, a radial gradient with Feather and Refine, and a luminance
 * range, each with its own local sliders. Their cost depends on the drawing's size, the number of masks and parts, the
 * dabs, and Feather and Refine (which run on a reduced grid); not on the slider values.
 */
const MASKS = [
  { id: 'b1', name: 'Brush 1', invert: false, amount: 100, feather: 0, refine: 0, adjust: { exposure: 0.5 }, components: [{ id: 'c1', op: 'add', invert: false, shape: { kind: 'brush', strokes: [{ size: 0.03, feather: 50, flow: 70, density: 100, erase: false, dabs: Array.from({ length: 80 }, (_, i) => (i % 2 ? 0.6 + 0.0005 * i : 0.2 + 0.005 * i)) }] } }] },
  { id: 'r1', name: 'Radial 1', invert: false, amount: 100, feather: 30, refine: 30, adjust: { shadows: 30, saturation: 20 }, components: [{ id: 'c2', op: 'add', invert: false, shape: { kind: 'radial', center: [0.5, 0.5], rx: 0.25, ry: 0.15, angle: 20, feather: 60 } }] },
  { id: 'l1', name: 'Luminance range 1', invert: false, amount: 100, feather: 0, refine: 0, adjust: { highlights: -40, temperature: -10 }, components: [{ id: 'c3', op: 'add', invert: false, shape: { kind: 'luminance', range: [50, 70, 100, 100] } }] },
]
const MASK_PASSES = (l: string) => l.startsWith('mask:') || l === 'display'

/**
 * The Effects (Part 25): one tool each, at values that run all of its work (the cost doesn't depend on the values).
 * Dehaze's ambient light is measured once per photo, crop and white balance (cached: not in these rows' runs).
 */
const FX_ROWS: Record<'vignette' | 'grain' | 'tc' | 'dehaze' | 'glow', { name: string; fx: object; what: string }> = {
  vignette: { name: 'Post-crop vignette (Highlight Priority)', fx: { vignette: { amount: -40, midpoint: 50, roundness: 0, feather: 50, highlights: 30, style: 'highlight', centerX: 0, centerY: 0, shape: 1 } }, what: 'per pixel in the display pass' },
  grain: { name: 'Grain', fx: { grain: { amount: 40, size: 25, roughness: 70, seed: 12345, colour: false, midtonesBias: 100 } }, what: 'per pixel in the display pass (21 noise samples a pixel when zoomed out, darktable\'s lattice)' },
  tc: { name: 'Texture + Clarity', fx: { texture: 40, clarity: 30 }, what: 'darktable contrast & texture\'s pyramid around each 1024 px tile (its luminance drawn, then the EIGF levels), then the display pass' },
  dehaze: { name: 'Dehaze', fx: { dehaze: 40 }, what: 'darktable haze removal\'s two maps around each tile (box min/max and the colour guided filter in 512 px chunks), then the display pass' },
  glow: { name: 'Glow (Bloom)', fx: { glow: { amount: 50, style: 'bloom', range: 60, spread: 50, warmth: 0 } }, what: 'Glow\'s source (the drawing again at most 1024 px long), its threshold and five blurs, then the display pass' },
}
const FX_PASSES = (l: string) => l.startsWith('effects:') || l === 'display' || l === 'develop' || l === 'mixerInput' || l === 'effectsInput'
const fxStages = (): Partial<Record<StageId, StageDef>> => {
  const out: Partial<Record<StageId, StageDef>> = {}
  for (const [k, r] of Object.entries(FX_ROWS)) {
    out[`${k}Fit` as StageId] = {
      label: `Effects: ${r.name}, display pass, fit`,
      settings: (b, kind) => edit(kind, { ...b, effects: r.fx }),
      run: (c, s, n) => c.engine.render(displayUniforms(nudged(s, n)), wbOf(c, s), FIT),
      gpu: FX_PASSES,
      note: `one redraw after an Exposure move: ${r.what}; compare with "Display pass, fit, without Tone Curve"`,
    }
    out[`${k}Export` as StageId] = {
      label: `Effects: ${r.name}, export render, full size`,
      settings: (b, kind) => edit(kind, { ...b, effects: r.fx }),
      run: async (c, s, n) => {
        const [w, h] = c.engine.outputSize(s.geometry)
        c.lastOut = await c.engine.renderOutput(displayUniforms(nudged(s, n)), wbOf(c, s), outputOptions(w, h))
      },
      gpu: FX_PASSES,
      note: `the export render: ${r.what}; compare with "Export render"`,
    }
  }
  return out
}

const MIXER_PREPASS = one('mixerInput', 'prefilterStats', 'prefilterApply', 'guideStats', 'guideApply')

/** Where the k-th Remove spot goes: spread over the frame, away from the edges and the highlight. */
const spotAt = (k: number): [number, number] => [0.15 + 0.5 * ((k * 0.6180339) % 1), 0.45 + 0.4 * ((k * 0.3819660) % 1)]

export const STAGES: Record<StageId, StageDef> = {
  ...(fxStages() as Record<'vignetteFit' | 'vignetteExport' | 'grainFit' | 'grainExport' | 'tcFit' | 'tcExport' | 'dehazeFit' | 'dehazeExport' | 'glowFit' | 'glowExport', StageDef>),
  stageA: {
    label: 'Stage A: RAW → scene (process)',
    settings: (b) => b,
    run: (c, s) => c.engine.process(stageOptions(s, c.info)),
    subs: (kind) => kind === 'srgb'
      ? [{ id: 'input', label: 'input profile + inverse tone map', match: one('rgbInput') }, { id: 'mips', label: 'mip chain', match: one('mip') }]
      : [
          { id: 'rawprepare', label: 'rawprepare (black/white, white balance)', match: one('prepare', 'linPrepare') },
          { id: 'highlights', label: 'highlights (inpaint opposed)', match: (l) => l.startsWith('hl') || l === 'linInitMask' || l === 'linChroma' },
          kind === 'xtrans'
            ? { id: 'demosaic', label: 'demosaic (Markesteijn 1-pass)', match: (l) => l.startsWith('xt') }
            : { id: 'demosaic', label: 'demosaic (RCD)', match: (l) => l.startsWith('rcd') || l === 'writeRcd' || l === 'writeBilinear' },
          { id: 'mips', label: 'mip chain', match: one('mip') },
        ],
    note: (kind) => (kind === 'srgb' ? 'the JPEG input stage: input profile, inverse tone mapping, mips' : 'includes one read-back of the highlight chroma statistics (a GPU → CPU round trip)'),
  },
  stageA3: {
    label: 'Stage A, Markesteijn 3-pass',
    settings: (b, kind) => edit(kind, { ...b, advanced: { ...b.advanced, demosaic: 'markesteijn3' } }),
    run: (c, s) => c.engine.process(stageOptions(s, c.info)),
    subs: () => [{ id: 'demosaic', label: 'demosaic (Markesteijn 3-pass)', match: (l) => l.startsWith('xt') }],
  },
  warp: {
    label: 'Geometry warp: lens correction + straighten, full size',
    settings: (b, kind) => edit(kind, { ...plain(b), lens: { ...DEFAULT_LENS }, geometry: { ...b.geometry, angle: 0.5 } }),
    // The angle moves by 0.001° per run: a new warp each time (its cache is keyed on the map).
    run: (c, s, k) => {
      const t = { ...s, geometry: { ...s.geometry, angle: 0.5 + 0.001 * (k + 1) } }
      return c.engine.renderStats(displayUniforms(t), wbOf(c, t), 64)
    },
    gpu: one('warp', 'mip'),
    note: 'bicubic warp through the lens and straighten map, and its mip chain; wall includes a 64 px measurement',
  },
  toneMask: {
    label: 'Tone equalizer mask pre-pass (process 2, Shadows +40)',
    settings: (b, kind) => edit(kind, { ...plain(b), process: Math.max(2, CURRENT_PROCESS), shadows: 40 }),
    // The mask is keyed on the white balance: a 0.01 % change per run computes it again.
    run: (c, s, k) => {
      const wb = wbOf(c, s)
      return c.engine.renderStats(displayUniforms(s), [wb[0] * (1 + 1e-4 * (k + 1)), wb[1], wb[2]], 64)
    },
    gpu: one('moments', 'reduce', 'blurX', 'blurY'),
    note: 'full-size guided-filter statistics; wall includes a 64 px measurement',
  },
  // The Colour Mixer (Part 15). Its guided filter isn't cached: every drawing draws the mixer's input around each
  // 1024 px tile and runs darktable's two guided filters on it, then the display pass with the corrections. So one
  // redraw after an Exposure move is one run, as in the display rows (compare with "Display pass, fit, without Tone
  // Curve"); the second row is the same mixer with the guided filter off (per-pixel tables only, no pre-pass).
  mixer: {
    label: 'Colour Mixer, guided filter on: pre-pass + display pass, fit',
    settings: (b, kind) => edit(kind, { ...b, colourMixer: COLOUR_MIXER(true) }),
    run: (c, s, k) => c.engine.render(displayUniforms(nudged(s, k)), wbOf(c, s), FIT),
    gpu: (l) => MIXER_PREPASS(l) || l === 'display',
    subs: () => [
      { id: 'input', label: 'the mixer\'s input around each tile (display shader, rgba32float)', match: one('mixerInput') },
      { id: 'filters', label: 'darktable\'s guided filters (4 compute passes per tile)', match: one('prefilterStats', 'prefilterApply', 'guideStats', 'guideApply') },
      { id: 'display', label: 'display pass with the corrections', match: one('display') },
    ],
    note: 'one redraw after an Exposure move with a mixer on (Hue, Saturation and Luminance moved on 4 bands); wall includes the read-back copy in compatibility mode',
  },
  mixerNoGuide: {
    label: 'Colour Mixer, guided filter off: display pass, fit',
    settings: (b, kind) => edit(kind, { ...b, colourMixer: COLOUR_MIXER(false) }),
    run: (c, s, k) => c.engine.render(displayUniforms(nudged(s, k)), wbOf(c, s), FIT),
    gpu: one('display'),
    note: 'the same mixer with Advanced → guided filter off: the bands from the tables per pixel, no pre-pass',
  },
  // Colour Grading (Part 17): per pixel in the display pass, after the mixer; no pre-pass and no texture.
  grading: {
    label: 'Colour Grading on: display pass, fit',
    settings: (b, kind) => edit(kind, { ...b, colourGrading: COLOUR_GRADING }),
    run: (c, s, k) => c.engine.render(displayUniforms(nudged(s, k)), wbOf(c, s), FIT),
    gpu: one('display'),
    note: 'one redraw after an Exposure move with all four wheels tinted; compare with "Display pass, fit, without Tone Curve"; wall includes the read-back copy in compatibility mode',
  },
  // Masks (Part 23): rasterised per drawing (per 1024 px tile) and read by the display pass.
  masksFit: {
    label: 'Masks: 3 masks (brush + radial + luminance), display pass, fit',
    settings: (b, kind) => edit(kind, { ...b, masks: MASKS } as Partial<DevelopSettings>),
    run: (c, s, k) => c.engine.render(displayUniforms(nudged(s, k)), wbOf(c, s), FIT),
    gpu: MASK_PASSES,
    note: 'one redraw after an Exposure move: the three masks rasterised at the canvas\'s size (Feather and Refine on the radial) and the display pass; compare with "Display pass, fit, without Tone Curve"',
  },
  masksExport: {
    label: 'Masks: 3 masks, export render, full size',
    settings: (b, kind) => edit(kind, { ...b, masks: MASKS } as Partial<DevelopSettings>),
    run: async (c, s, k) => {
      const [w, h] = c.engine.outputSize(s.geometry)
      c.lastOut = await c.engine.renderOutput(displayUniforms(nudged(s, k)), wbOf(c, s), outputOptions(w, h))
    },
    gpu: (l) => MASK_PASSES(l) || l === 'develop',
    note: 'the export render with the three masks rasterised at full size in 1024 px tiles; compare with "Export render"',
  },
  denoise: {
    label: 'Detail: denoise (profiled, wavelets), full size',
    settings: (b, kind) => edit(kind, { ...plain(b), detail: { ...DEFAULT_DETAIL, sharpen: { ...DEFAULT_DETAIL.sharpen, amount: 0 }, noise: { ...DEFAULT_DETAIL.noise, luminance: 30, color: 25 } } }),
    run: (c, s, k) => {
      const t = { ...s, detail: { ...s.detail!, noise: { ...s.detail!.noise, luminance: 30 + (k % 3) } } }
      return c.engine.render(displayUniforms(t), wbOf(c, t), FULL)
    },
    gpu: DENOISE,
    note: 'Luminance 30, Color 25; the 100 % view (full-size Detail); wall includes one redraw',
  },
  sharpen: {
    label: 'Detail: capture sharpening, Amount 40 (separable blur), full size',
    settings: (b, kind) => edit(kind, { ...plain(b), detail: { ...DEFAULT_DETAIL, sharpen: { ...DEFAULT_DETAIL.sharpen, amount: 40 } } }),
    run: (c, s, k) => {
      const t = { ...s, detail: { ...s.detail!, sharpen: { ...s.detail!.sharpen, detail: 25 + (k % 3) } } }
      return c.engine.render(displayUniforms(t), wbOf(c, t), FULL)
    },
    gpu: CAPTURE,
    note: '8 Richardson–Lucy iterations, two 9-tap passes per blur (the 9 × 9 kernel is no longer in the code); wall includes one redraw',
  },
  // Soft proofing (Part 20): per pixel in the display pass, a trilinear lookup in the proof table (65³, a 3D texture)
  // and the two gamut warnings; the table is built once (cached) and uploaded once.
  proof: {
    label: 'Soft proofing on: display pass, fit (both gamut warnings)',
    settings: (b) => b,
    run: async (c, s, k) => c.engine.render(displayUniforms(nudged(s, k)), wbOf(c, s), FIT, await proofIndicators()),
    gpu: one('display'),
    note: 'one redraw after an Exposure move with an Adobe RGB (1998)-compatible proof; compare with "Display pass, fit, without Tone Curve"; wall includes the read-back copy in compatibility mode',
  },
  proofLut: {
    label: 'Soft proof table: build 65³ with Little CMS (worker)',
    settings: (b) => b,
    run: async () => {
      clearProofCache()
      await proofTable()
    },
    gpu: 'none',
    note: 'CPU (WebAssembly in a worker): the built-in Adobe RGB (1998)-compatible profile, Relative Colorimetric; a printer profile takes longer; built once per profile and options, then cached',
  },
  displayFit: display(FIT, false),
  display100: display(FULL, false),
  displayFitCurve: display(FIT, true),
  display100Curve: display(FULL, true),
  remove: {
    label: 'Remove: one spot (fill search on the CPU, tiles on the GPU)',
    settings: (b) => b,
    run: (c, s, k) => {
      const [x, y] = spotAt(k)
      const t = edit(c.kind, { ...plain(s), spots: [{ id: `b${k}`, mode: 'remove', points: [[x, y]], size: 0.01, feather: 0.5, opacity: 1, offset: [0.05, 0], seed: 1 }] })
      return c.engine.renderStats(displayUniforms(t), wbOf(c, t), 64)
    },
    note: () => `a round spot of radius 1 % of the short side, at a new place each run; the fill on up to ${cpuBudget.total} worker threads (PHASE3.md Part 22); wall includes a 64 px measurement`,
  },
  export: {
    label: 'Export render, full size, 8-bit sRGB (develop + read back)',
    settings: (b) => b,
    run: async (c, s, k) => {
      const [w, h] = c.engine.outputSize(s.geometry)
      c.lastOut = await c.engine.renderOutput(displayUniforms(nudged(s, k)), wbOf(c, s), outputOptions(w, h))
    },
    note: 'the image\'s default edit with Detail, warp and masks already cached (as right after editing); no encoding',
  },
  exportAll: {
    label: 'Export end to end: Stage A + Detail + warp + render',
    settings: (b) => b,
    run: async (c, s) => {
      await c.engine.process(stageOptions(s, c.info))
      const [w, h] = c.engine.outputSize(s.geometry)
      c.lastOut = await c.engine.renderOutput(displayUniforms(s), wbOf(c, s), outputOptions(w, h))
    },
    note: 'what one exported photo costs on the GPU after decoding; no encoding',
  },
  jpeg: {
    label: 'JPEG encode, full size (jpegli, quality 90)',
    settings: (b) => b,
    run: async (c, s) => {
      if (!c.lastOut) {
        const [w, h] = c.engine.outputSize(s.geometry)
        c.lastOut = await c.engine.renderOutput(displayUniforms(s), wbOf(c, s), outputOptions(w, h))
      }
      const o = c.lastOut
      await encodeJpeg(o.rgba as Uint8ClampedArray<ArrayBuffer>, o.width, o.height, { quality: 90, subsampling: 'auto', maxBytes: 0 })
    },
    gpu: 'none',
    note: 'CPU (WebAssembly in a worker), as Export does; no metadata',
  },
  thumb: {
    label: 'Thumbnail: 512 px JPEG (renderThumbnail)',
    settings: (b) => b,
    run: (c, s, k) => renderThumbnail(c.engine, nudged(s, k), c.info),
    note: 'as the background developer refreshes one; Detail at the thumbnail\'s level cached after the warm-up',
  },
  // The AI Depth range (Part 24): one depth map, as Develop computes it for a new Depth range. Never downloads: skipped
  // (with a message) unless the model is on this device.
  aiDepth: {
    label: 'AI depth: DA-V2 Small inference',
    settings: (b, kind) => edit(kind, plain(b)),
    run: async (c, s) => {
      const m = depthModel()
      if (!m || !AI || !(await installed(m))) throw new Error('skipped: the AI Depth model isn’t on this device (Settings → AI models downloads it; the benchmark never does)')
      const p = await providerFor()
      if (!p.provider) throw new Error(`skipped: ${p.why}`)
      const g = c.engine.geometry(DEFAULT_GEOMETRY)
      const img = await c.engine.renderImage(displayUniforms(s), wbOf(c, s), renderSize(g.size[0], g.size[1], m.input!))
      const r = await computeDepth(m, { rgba: img.data, width: img.width, height: img.height, uvToSensor: g.uvToSensor, sensor: [c.engine.sensorLayout.width, c.engine.sensorLayout.height] }, p.provider, AI.runtime.version)
      lastDepth = { inferMs: r.inferMs, size: r.size, provider: r.provider, variant: r.depth.modelVersion }
    },
    gpu: 'none',
    note: () => `wall: the photo rendered as shot, resized, one model run on the AI runtime's own GPU device (a worker: not in the GPU column) and the depth map encoded; the first warm-up also loads the model${lastDepth ? `; last model run ${Math.round(lastDepth.inferMs)} ms at ${lastDepth.size.join(' × ')} (${lastDepth.provider}, ${lastDepth.variant})` : ''}`,
  },
}

let lastDepth: { inferMs: number; size: [number, number]; provider: string; variant: string } | null = null

// ---- running

/** Stages whose runs build the scene themselves (no preparation needed). */
const BUILDS_SCENE: StageId[] = ['stageA', 'stageA3', 'exportAll']

export interface BenchCallbacks {
  /** The element the engine's canvas is shown in. */
  stage: HTMLElement
  signal: AbortSignal
  onProgress: (done: number, total: number, label: string) => void
  onRow: (row: BenchRow) => void
  /** Testing (development server only): lose the device once, just before this stage's first run. */
  loseDeviceAt?: string | null
  /** False: don't use timestamp-query even where the adapter has it (`?benchts=0`; wall-clock only). */
  timestamps?: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class Cancelled extends Error {}

const LIMITS = ['maxTextureDimension2D', 'maxBufferSize', 'maxStorageBufferBindingSize', 'maxStorageBuffersPerShaderStage', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupSizeX', 'maxBindGroups'] as const

/** What the adapter says about itself and its limits; nothing else (no serial numbers, nothing identifying). */
export function adapterReport(adapter: GPUAdapter): AdapterReport {
  const info = adapter.info as GPUAdapterInfo & { isFallbackAdapter?: boolean }
  const fb = info?.isFallbackAdapter ?? (adapter as GPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter
  const limits: Record<string, number> = {}
  for (const k of LIMITS) limits[k] = Number(adapter.limits[k])
  return {
    vendor: info?.vendor ?? '',
    architecture: info?.architecture ?? '',
    device: info?.device ?? '',
    description: info?.description ?? '',
    isFallbackAdapter: typeof fb === 'boolean' ? fb : null,
    features: { 'timestamp-query': adapter.features.has('timestamp-query'), 'shader-f16': adapter.features.has('shader-f16') },
    limits,
  }
}

/** Runs a plan; resolves with the report (partial, `cancelled`, when the signal aborts). */
export async function runBenchmark(plan: BenchPlan, cb: BenchCallbacks): Promise<BenchReport> {
  const choice = await presentChoice().catch(() => ({ mode: 'readback' as const, reason: 'probe-failed' as const }))
  const report: BenchReport = {
    app: { version: __APP_VERSION__, commit: commitOf(__APP_VERSION__) },
    date: new Date().toISOString(),
    userAgent: navigator.userAgent,
    mode: plan.mode,
    warmup: plan.warmup,
    runs: plan.runs,
    scaledTo: plan.scaledTo,
    timing: { gpu: 'unavailable', quantized: false, wall: 'performance.now() around the engine call and queue.onSubmittedWorkDone()' },
    adapter: null,
    display: { presentMode: choice.mode, reason: choice.reason, devicePixelRatio: window.devicePixelRatio || 1, canvas: [0, 0] },
    datasets: [],
    rows: [],
    notes: [
      'Median and minimum over the measured runs, after the warm-up runs. GPU = sum of the stage\'s passes from timestamp queries (↳ rows: parts of the stage above).',
      'Peak memory: the most bytes of buffers and textures the benchmark\'s engine had allocated during the stage (estimated from its allocations; driver overhead and the canvas not included).',
      'Capture sharpening: only the shipped separable kernel is measured; the 9 × 9 kernel it replaced is no longer in the code.',
    ],
    cancelled: false,
  }
  const total = plannedRuns(plan)
  let done = 0
  const allPassTimes: number[] = []
  let lostOnce = false

  let profiler = new GpuProfiler(cb.timestamps !== false)
  let engine: DevelopEngine | null = null
  /** The engine now (assigned in closures, so TypeScript's narrowing can't follow it). */
  const current = () => engine as DevelopEngine | null
  const makeEngine = async () => {
    engine?.destroy()
    profiler.destroy()
    profiler = new GpuProfiler(cb.timestamps !== false)
    const e = await DevelopEngine.create('auto', profiler)
    cb.stage.replaceChildren(e.canvas)
    engine = e
    report.display.presentMode = e.mode
    if (profiler.adapter && !report.adapter) report.adapter = adapterReport(profiler.adapter)
    report.timing.gpu = profiler.timestamps ? 'timestamp-query' : 'unavailable'
    return e
  }

  const check = () => {
    if (cb.signal.aborted) throw new Cancelled()
  }
  /** Develop (the foreground) and the background developer go first. */
  const waitForQuiet = async (label: string) => {
    let said = false
    while (gpuGate.busy || batch.status.active || batch.status.queued) {
      check()
      if (!said) cb.onProgress(done, total, `Waiting for other GPU work to finish… (${label})`)
      said = true
      if (gpuGate.busy) await gpuGate.background(1000)
      else await sleep(250)
    }
  }

  try {
    for (const ds of plan.datasets) {
      check()
      cb.onProgress(done, total, `${ds.label}: making the test image…`)
      const decoded = await ds.decode()
      const dsReport: DatasetReport = { id: ds.id, label: ds.label, width: ds.width, height: ds.height, peakBytes: null, afterUnloadBytes: null }
      report.datasets.push(dsReport)
      let ctx: Ctx | null = null
      let built = ''
      const load = async () => {
        const e = engine && !engine.isLost ? engine : await makeEngine()
        e.unload()
        const info = loadIntoEngine(e, decoded)
        const base = defaultsFor(info.kind, info.iso)
        ctx = { engine: e, info, kind: ds.kind, base, lastOut: null }
        built = ''
        return ctx
      }
      await load()

      for (const id of ds.stages) {
        check()
        const def = STAGES[id]
        await waitForQuiet(def.label)
        let note = (typeof def.note === 'function' ? def.note(ds.kind) : def.note) ?? ''
        let row: BenchRow | null = null
        let subRows: BenchRow[] = []
        for (let attempt = 0; attempt < 2 && !row; attempt++) {
          const c: Ctx = attempt === 0 && ctx ? ctx : await load()
          const e = c.engine
          const s = def.settings(c.base, c.kind)
          const startDone = done
          try {
            const result = await e.guarded(async () => {
              profiler.resetPeak()
              // Untimed: the RAW stage these settings need (the stages that run Stage A build it themselves).
              const key = JSON.stringify(stageOptions(s, c.info))
              if (built !== key && !BUILDS_SCENE.includes(id)) {
                cb.onProgress(done, total, `${ds.label}: preparing ${def.label}…`)
                await e.process(stageOptions(s, c.info))
              }
              built = key
              const wall: number[] = []
              const gpu: number[] = []
              const subs = def.subs?.(c.kind) ?? []
              const subTimes = subs.map(() => [] as number[])
              for (let k = 0; k < plan.warmup + plan.runs; k++) {
                check()
                const warm = k < plan.warmup
                cb.onProgress(done, total, `${ds.label}: ${def.label} — ${warm ? `warm-up ${k + 1}` : `run ${k - plan.warmup + 1} of ${plan.runs}`}`)
                if (gpuGate.busy) await waitForQuiet(def.label)
                if (import.meta.env.DEV && cb.loseDeviceAt === id && !lostOnce) {
                  lostOnce = true
                  profiler.device?.destroy()
                }
                profiler.begin()
                const t0 = performance.now()
                await def.run(c, s, k)
                await profiler.device!.queue.onSubmittedWorkDone()
                const t = performance.now() - t0
                const { passes } = await profiler.end()
                done++
                if (warm) continue
                wall.push(t)
                if (profiler.timestamps && def.gpu !== 'none') {
                  const match = def.gpu
                  gpu.push(sumPasses(passes, typeof match === 'function' ? match : undefined))
                  subs.forEach((sub, i) => subTimes[i].push(sumPasses(passes, sub.match)))
                  allPassTimes.push(...passes.map((p: PassTime) => p.ms))
                }
              }
              return { wall, gpu, subs, subTimes, peak: profiler.peak }
            })
            const image = ds.label
            row = { id: `${ds.id}.${id}`, stage: def.label, image, wall: summarize(result.wall), gpu: summarize(result.gpu), peakBytes: result.peak, note }
            subRows = result.subs.map((sub, i) => ({
              id: `${ds.id}.${id}.${sub.id}`,
              stage: sub.label,
              image,
              wall: null,
              gpu: summarize(result.subTimes[i]),
              peakBytes: null,
              sub: true,
              note: profiler.timestamps ? '' : 'needs timestamp-query',
            }))
            dsReport.peakBytes = Math.max(dsReport.peakBytes ?? 0, result.peak)
          } catch (err) {
            if (err instanceof Cancelled) throw err
            done = startDone
            if (attempt === 0 && retryableGpuError(err)) {
              const kind = (err as GpuWorkError).kind
              note = `GPU ${kind === 'lost' ? 'device lost' : kind} during the stage: run again on a new engine${note ? `; ${note}` : ''}`
              console.warn('GPU benchmark: running the stage again on a new engine:', err)
              ctx = null
              await makeEngine()
              continue
            }
            const msg = err instanceof Error ? err.message : String(err)
            row = { id: `${ds.id}.${id}`, stage: def.label, image: ds.label, wall: null, gpu: null, peakBytes: null, error: msg }
            // Skip this stage's remaining runs in the progress count.
            done = startDone + plan.warmup + plan.runs
            if (current()?.isLost) {
              ctx = null
              await load()
            }
          }
        }
        report.rows.push(row!)
        cb.onRow(row!)
        for (const r of subRows) {
          report.rows.push(r)
          cb.onRow(r)
        }
        const shown = current()
        if (shown) report.display.canvas = [shown.canvas.width, shown.canvas.height]
      }
      const e = current()
      if (e && !e.isLost) {
        e.unload()
        dsReport.afterUnloadBytes = profiler.live
      }
    }
  } catch (err) {
    if (!(err instanceof Cancelled)) throw err
    report.cancelled = true
  } finally {
    report.timing.quantized = looksQuantized(allPassTimes)
    current()?.destroy()
    profiler.destroy()
    cb.stage.replaceChildren()
  }
  cb.onProgress(done, total, report.cancelled ? 'Cancelled' : 'Done')
  return report
}
