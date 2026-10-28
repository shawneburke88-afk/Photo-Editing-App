// LightBench's downloadable AI models: the pinned manifest (web/models/manifest.json, checked here and compiled into
// the app by web/models-plugin.ts) and the rules for which file a device downloads (docs/PHASE3.md Part 24).
//
// Delivery, two ways (`delivery`):
// - "site" (owner's decision, 2026-10-17; the depth model): the files are served from LightBench's own GitHub Pages site
//   (same origin, so no CORS question), put there by the deploy workflow, which fetches each pinned file by exact URL
//   and checks its SHA-256 (web/scripts/models.mjs).
// - "huggingface" (owner's decision, 2026-10-21; AI Remove's Moebius, about 1.24 GB, too big for Pages' 1 GB site
//   limit): the browser downloads the files itself from Hugging Face's commit-pinned `/resolve/<commit>/<file>` URLs
//   (CORS allowed, Range requests answered: docs/PHASE3.md Part 26), resumably, with no token. The deploy skips them.
// Either way the app downloads a model only when the user says so, once, checks the same SHA-256, keeps it on the
// device (ai/store.ts) and works offline afterwards. Nothing here touches the network.
//
// Sky (AI masks part 3, docs/PHASE3.md Part 29): LightBench's own ONNX conversion of a model whose authors publish
// PyTorch weights only, published as a GitHub Release asset of LightBench's own repository ("host": "github-release",
// the release's `tag` and the commit it points at as `revision`), with the licence and a note of where it came from. The
// deploy fetches it from the release and checks its SHA-256, and the site serves it like the others.
//
// Schema 2 (AI masks, docs/PHASE3.md Part 27): a model may be made of several graphs (`part`), each with its weights in a
// separate file beside it (`data`: ONNX external data, as the SAM 2.1 export has), served from the site as well as from
// Hugging Face; `task` names what the app uses it for. Schema 1 manifests (one file per variant) still parse.
//
// fp16 or fp32: ONNX Runtime's WebGPU EP fails on fp16 graphs when the adapter lacks `shader-f16` ("requires f16 but the
// device does not support it"; it doesn't upcast: docs/research/cowork-2026-10-13b/F_MODEL_DELIVERY.md, F9), so a
// device without `shader-f16` gets the fp32 file and one with it the fp16 file (half the download).

/** Kept in sync with web/scripts/models.mjs. */
export const SHA256_RE = /^[0-9a-f]{64}$/
export const REVISION_RE = /^[0-9a-f]{40}$/

export type Variant = 'fp16' | 'fp32'
/**
 * What the app uses a model for: the Depth range mask, AI Remove, Object select (AI masks part 1: a promptable
 * segmenter with an image encoder and a prompt decoder), and People (part 2, docs/PHASE3.md Part 28): finding people
 * ("detect": RF-DETR-Seg Nano), their faces ("face": YuNet) and their parts ("parse": MediaPipe Selfie Multiclass).
 * The later AI mask models (sky, subject) add their task here and a check below.
 */
export const TASKS = ['depth', 'inpaint', 'segment', 'sky', 'detect', 'face', 'parse'] as const
export type Task = (typeof TASKS)[number]
export type Delivery = 'site' | 'huggingface'
/**
 * Where the deploy fetches a model's files: Hugging Face (`/resolve/<revision>/<path>`), a GitHub Release of a
 * repository ("github-release": `/releases/download/<tag>/<path>`; LightBench's own conversions, Part 29), or a GitHub
 * repository at a commit ("github": YuNet, OpenCV Zoo's Git LFS file, fetched from `media.githubusercontent.com` at the
 * pinned commit, Part 28). The app gets GitHub-hosted files from LightBench's site.
 */
export type SourceHost = 'huggingface' | 'github-release' | 'github'

export interface ModelFile {
  variant: Variant
  /** Path inside the source repository. */
  path: string
  bytes: number
  /** Lower-case hex; null until pinned. */
  sha256: string | null
  /** A model made of several graphs (AI Remove: "vae_encoder", "unet", "vae_decoder"; Object select: "encoder", "decoder"): which one this file is. */
  part?: string
  /**
   * This file holds the weights of the graph `part` of the same variant (ONNX external data, beside the graph file).
   * ONNX Runtime is given it under its own file name (the name the graph refers to).
   */
  data?: true
}

/** The depth model's preprocessing (Depth Anything V2's own). */
export interface DepthInput {
  shortSide: number
  multiple: number
  mean: [number, number, number]
  std: [number, number, number]
}

/** A promptable segmenter's preprocessing (SAM 2.1's own: the photo resized to size × size, ImageNet mean and std). */
export interface SegmentInput {
  size: number
  mean: [number, number, number]
  std: [number, number, number]
}

/**
 * The Sky model's preprocessing and labels (EfficientViT-Seg's own ADE20K evaluation: the short side to `shortSide`,
 * the long side up to a multiple of `multiple`; RGB 0…1 minus ImageNet's mean, over its std). Its output is `classes`
 * scores per cell, one cell per `stride` input pixels; `skyClass` is the sky's index. `bytesPerPixel`: the largest
 * tensor the graph makes, in bytes per input pixel (for the GPU limit gate). `maxLong` caps the long side (panoramas).
 */
export interface SkyInput {
  shortSide: number
  multiple: number
  maxLong: number
  stride: number
  classes: number
  skyClass: number
  bytesPerPixel: number
  mean: [number, number, number]
  std: [number, number, number]
}

/** What a conversion LightBench made itself was made from: the authors' weights file and code, pinned. */
export interface ConvertedFrom {
  weights: { repo: string; revision: string; path: string; bytes: number; sha256: string }
  code: { repo: string; revision: string }
}

/** What the manual update check compares (Settings → AI models; never automatic). */
export interface UpdateBaseline {
  /** The weights the conversion was made from: a file of another Hugging Face repository and its pinned LFS hash. */
  upstream: { repo: string; revision: string; path: string; bytes: number; sha256: string }
}

export interface ModelEntry {
  id: string
  name: string
  task: Task
  /** Where the app downloads the files from (default "site"). */
  delivery?: Delivery
  summary: string
  licence: { id: string; url: string; statement: string; file?: string; notes?: string }
  credit: string
  /** In plain words: what it was trained on (owner's rule: the sets must be named publicly, or an owner's exception). */
  trainingData: string
  /**
   * `pinnedBy: "owner"`: pinned by the owner's decision from a checked run (Object select's SAM 2.1: MASKS_PREP.md);
   * `models.mjs pin` leaves it alone, as it leaves the models delivered from Hugging Face.
   */
  source: { host: SourceHost; repo: string; revision: string | null; pinnedBy?: 'owner'; tag?: string }
  /** A conversion LightBench made itself (Sky, Part 29): what it was made from. */
  convertedFrom?: ConvertedFrom
  /**
   * The depth model's (DepthInput), the segmenter's (SegmentInput) or the Sky model's (SkyInput) preprocessing; the
   * People models ("detect", "parse") give theirs as a SegmentInput: a square input of `size`, (RGB / 255 − mean) / std.
   */
  input?: DepthInput | SegmentInput | SkyInput
  /** Which checkpoint of the original weights the files are, and where that is stated. */
  checkpoint?: { name: string; source: string }
  updates?: UpdateBaseline
  /**
   * WebGPU limits the model needs (bytes): its largest weight or activation must fit one buffer binding. Measured by
   * the "AI models" workflow (scripts/moebius-check.mjs); a GPU below them is told plainly instead of crashing.
   */
  gpu?: { maxStorageBufferBindingSize: number; maxBufferSize: number }
  files: ModelFile[]
}

/** The depth model's preprocessing (parseManifest checked it is there). */
export const depthInput = (m: ModelEntry) => m.input as DepthInput
/** The segmenter's preprocessing (parseManifest checked it is there). */
export const segmentInput = (m: ModelEntry) => m.input as SegmentInput
/** The Sky model's preprocessing and labels (parseManifest checked they are there). */
export const skyInput = (m: ModelEntry) => m.input as SkyInput

export interface Manifest {
  schema: 1 | 2
  models: ModelEntry[]
}

/** The graphs a model of the task is made of (the files of one variant must hold each, plus any weights beside them). */
export const TASK_PARTS: Partial<Record<Task, readonly string[]>> = {
  inpaint: ['vae_encoder', 'unet', 'vae_decoder'],
  segment: ['encoder', 'decoder'],
  // The Sky model is one graph, recorded as a part named "model" (loaded and run as the graphs above are).
  sky: ['model'],
  // The People models are one graph each, recorded as a part named "model" too.
  detect: ['model'],
  face: ['model'],
  parse: ['model'],
}

/** The shared runtime (one for every model, as PHASE4_MODELS.md plans): ONNX Runtime Web's WebAssembly file. */
export interface RuntimeInfo {
  name: string
  version: string
  licence: string
  /** Path relative to the site root, its size and SHA-256 (computed from the npm package at build time). */
  wasm: { path: string; bytes: number; sha256: string }
}

export interface AiInfo {
  models: ModelEntry[]
  runtime: RuntimeInfo
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isTriple = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isNum)

/** Checks a manifest (the build refuses a malformed one). A model with a revision must have well-formed hashes. */
export function parseManifest(json: unknown): Manifest {
  const fail = (why: string): never => {
    throw new Error(`models manifest: ${why}`)
  }
  if (!json || typeof json !== 'object') fail('not an object')
  const o = json as Record<string, unknown>
  if (o.schema !== 1 && o.schema !== 2) fail('schema must be 1 or 2')
  if (!Array.isArray(o.models)) fail('models must be a list')
  const ids = new Set<string>()
  const models = (o.models as unknown[]).map((v, i) => {
    if (!v || typeof v !== 'object') fail(`model ${i} is not an object`)
    const m = v as Record<string, unknown>
    if (!isStr(m.id) || !/^[a-z0-9-]+$/.test(m.id)) fail(`model ${i}: bad id`)
    const id = m.id as string
    if (ids.has(id)) fail(`duplicate id ${id}`)
    ids.add(id)
    if (!(TASKS as readonly unknown[]).includes(m.task)) fail(`${id}: unknown task`)
    if (m.delivery !== undefined && m.delivery !== 'site' && m.delivery !== 'huggingface') fail(`${id}: unknown delivery`)
    for (const k of ['name', 'summary', 'credit', 'trainingData'] as const) if (!isStr(m[k])) fail(`${id}: ${k} missing`)
    const lic = m.licence as Record<string, unknown> | undefined
    if (!lic || !isStr(lic.id) || !isStr(lic.url) || !isStr(lic.statement)) fail(`${id}: licence incomplete`)
    const src = m.source as Record<string, unknown> | undefined
    if (!src || (src.host !== 'huggingface' && src.host !== 'github-release' && src.host !== 'github') || !isStr(src.repo) || !/^[\w.-]+\/[\w.-]+$/.test(src.repo)) fail(`${id}: source incomplete`)
    if (src!.host === 'github-release' && !(isStr(src!.tag) && /^[\w.-]+$/.test(src!.tag))) fail(`${id}: a GitHub Release source needs its tag`)
    if (src!.host === 'github-release' && (m.delivery ?? 'site') !== 'site') fail(`${id}: a model from a GitHub Release is served by LightBench's site`)
    if (src!.host === 'github' && (m.delivery ?? 'site') !== 'site') fail(`${id}: a model from GitHub is served by LightBench's site`)
    const rev = src!.revision
    if (rev !== null && !(isStr(rev) && REVISION_RE.test(rev))) fail(`${id}: revision must be a 40-digit commit or null`)
    if (src!.pinnedBy !== undefined && src!.pinnedBy !== 'owner') fail(`${id}: pinnedBy must be "owner"`)
    const inp = m.input as Record<string, unknown> | undefined
    if (m.task === 'depth' && (!inp || !isNum(inp.shortSide) || !isNum(inp.multiple) || !isTriple(inp.mean) || !isTriple(inp.std))) fail(`${id}: input incomplete`)
    if (m.task === 'sky' && (!inp || ![inp.shortSide, inp.multiple, inp.maxLong, inp.stride, inp.classes, inp.skyClass, inp.bytesPerPixel].every((x) => isNum(x) && x >= 0) || (inp.shortSide as number) < 32 || (inp.maxLong as number) < (inp.shortSide as number) || (inp.skyClass as number) >= (inp.classes as number) || !isTriple(inp.mean) || !isTriple(inp.std))) fail(`${id}: input incomplete`)
    const cf = m.convertedFrom as { weights?: Record<string, unknown>; code?: Record<string, unknown> } | undefined
    if (cf !== undefined && (!cf.weights || !isStr(cf.weights.repo) || !REVISION_RE.test(String(cf.weights.revision)) || !isStr(cf.weights.path) || !isNum(cf.weights.bytes) || !SHA256_RE.test(String(cf.weights.sha256)) || !cf.code || !isStr(cf.code.repo) || !REVISION_RE.test(String(cf.code.revision)))) fail(`${id}: convertedFrom incomplete`)
    if ((m.task === 'segment' || m.task === 'detect' || m.task === 'parse') && (!inp || !isNum(inp.size) || inp.size < 64 || inp.size > 4096 || !isTriple(inp.mean) || !isTriple(inp.std))) fail(`${id}: input incomplete`)
    const up = (m.updates as { upstream?: Record<string, unknown> } | undefined)?.upstream
    if (m.updates !== undefined && (!up || !isStr(up.repo) || !REVISION_RE.test(String(up.revision)) || !isStr(up.path) || !isNum(up.bytes) || !SHA256_RE.test(String(up.sha256)))) fail(`${id}: updates incomplete`)
    const gpu = m.gpu as Record<string, unknown> | undefined
    if (gpu !== undefined && (!isNum(gpu.maxStorageBufferBindingSize) || !isNum(gpu.maxBufferSize))) fail(`${id}: gpu limits incomplete`)
    if (!Array.isArray(m.files) || !m.files.length) fail(`${id}: no files`)
    const variants = new Set<string>()
    const files = (m.files as unknown[]).map((f) => {
      const x = (f ?? {}) as Record<string, unknown>
      if (x.variant !== 'fp16' && x.variant !== 'fp32') fail(`${id}: file variant must be fp16 or fp32`)
      if (x.part !== undefined && !(isStr(x.part) && /^[a-z0-9_]+$/.test(x.part))) fail(`${id}: bad file part`)
      if (x.data !== undefined && (x.data !== true || !x.part)) fail(`${id}: a weights file (data) must name its graph (part)`)
      const slot = `${x.variant as string}${x.part ? ` ${x.part as string}` : ''}${x.data ? ' data' : ''}`
      if (variants.has(slot)) fail(`${id}: two ${slot} files`)
      variants.add(slot)
      if (!isStr(x.path) || x.path.includes('..') || x.path.startsWith('/')) fail(`${id}: bad file path`)
      if (!isNum(x.bytes) || x.bytes <= 0 || !Number.isInteger(x.bytes)) fail(`${id}: bad byte count`)
      if (x.sha256 !== null && !(isStr(x.sha256) && SHA256_RE.test(x.sha256))) fail(`${id}: sha256 must be 64 hex digits or null`)
      return { variant: x.variant, path: x.path, bytes: x.bytes, sha256: x.sha256, ...(x.part ? { part: x.part } : {}), ...(x.data ? { data: true } : {}) } as ModelFile
    })
    // A release's assets have plain names (no folders).
    if (src!.host === 'github-release' && files.some((f) => f.path.includes('/'))) fail(`${id}: a release asset's name has no folders`)
    // Two files served under one name would overwrite each other on the site.
    if (new Set(files.map((f) => servedName(f))).size !== files.length) fail(`${id}: two files with the same name`)
    for (const f of files) if (f.data && !files.some((g) => g.variant === f.variant && g.part === f.part && !g.data)) fail(`${id}: weights for ${f.variant} ${f.part}, which has no graph file`)
    const parts = TASK_PARTS[m.task as Task]
    if (parts) {
      for (const v of new Set(files.map((f) => f.variant))) {
        if (!parts.every((p) => files.some((f) => f.variant === v && f.part === p && !f.data))) fail(`${id}: ${v} needs the graphs ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`)
      }
    } else if (files.some((f) => f.part)) fail(`${id}: a ${m.task as string} model is one file per variant`)
    return { ...(m as unknown as ModelEntry), source: { host: src!.host as SourceHost, repo: src!.repo as string, revision: rev as string | null, ...(src!.pinnedBy ? { pinnedBy: 'owner' as const } : {}), ...(src!.host === 'github-release' ? { tag: src!.tag as string } : {}) }, files } as ModelEntry
  })
  return { schema: o.schema as 1 | 2, models }
}

/** A file can be served and downloaded: its model's revision and its own hash are pinned. */
export const filePinned = (m: ModelEntry, f: ModelFile) => !!m.source.revision && !!f.sha256

/** The variants a model's files come in, in the manifest's order. */
export const variantsOf = (m: ModelEntry): Variant[] => [...new Set(m.files.map((f) => f.variant))]

/** Every file of one variant (a model of several graphs: each graph and its weights). */
export const filesOf = (m: ModelEntry, v: Variant): ModelFile[] => m.files.filter((f) => f.variant === v)

/** A variant can be downloaded: every one of its files is pinned. */
export const variantPinned = (m: ModelEntry, v: Variant) => filesOf(m, v).length > 0 && filesOf(m, v).every((f) => filePinned(m, f))

/** The model has at least one variant whose files are all pinned. */
export const modelPinned = (m: ModelEntry) => variantsOf(m).some((v) => variantPinned(m, v))

export const deliveryOf = (m: ModelEntry): Delivery => m.delivery ?? 'site'

/**
 * Where a file is kept in this device's cache (and, for "site" delivery, where it is served), relative to the site
 * root. A file downloaded from Hugging Face is keyed by the pinned commit and its file name, never by the URL the
 * download was redirected to (that one is signed and changes every time).
 */
export function cachePath(m: ModelEntry, f: ModelFile): string {
  if (!m.source.revision) throw new Error(`${m.id} is not pinned`)
  return deliveryOf(m) === 'huggingface' ? `models/${m.id}/${m.source.revision}/${f.path}` : servedPath(m, f)
}

/** A file's name on the site: "<variant>.onnx" for a one-file model, else its own file name (graphs and weights). */
export const servedName = (f: ModelFile) => (f.part ? baseName(f.path) : `${f.variant}.onnx`)

export const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** Where the deploy puts a file on LightBench's site, relative to the site root. Kept in sync with scripts/models.mjs. */
export function servedPath(m: ModelEntry, f: ModelFile): string {
  if (!m.source.revision) throw new Error(`${m.id} is not pinned`)
  return `models/${m.id}/${m.source.revision.slice(0, 7)}/${servedName(f)}`
}

/**
 * The file's pinned source URL (what the deploy workflow fetches; the app fetches it itself only for a model delivered
 * from Hugging Face). A GitHub file kept in Git LFS is served at media.githubusercontent.com (raw.githubusercontent.com
 * gives its LFS pointer). Kept in sync with scripts/models.mjs.
 */
export function sourceUrl(m: ModelEntry, f: ModelFile): string {
  if (!m.source.revision) throw new Error(`${m.id} is not pinned`)
  if (m.source.host === 'github-release') return releaseUrl(m.source.repo, m.source.tag!, f.path)
  if (m.source.host === 'github') return `https://media.githubusercontent.com/media/${m.source.repo}/${m.source.revision}/${f.path}`
  return `https://huggingface.co/${m.source.repo}/resolve/${m.source.revision}/${f.path}`
}

/** A GitHub Release asset's download URL. Kept in sync with scripts/models.mjs. */
export const releaseUrl = (repo: string, tag: string, asset: string) => `https://github.com/${repo}/releases/download/${tag}/${asset}`

/**
 * The file this device should download: fp16 when the adapter has `shader-f16` (half the size), else fp32; a pinned
 * file only. `prefer` forces a variant (after fp16 gave invalid numbers, ORT issue #26732). Null: none usable.
 */
export function chooseFile(m: ModelEntry, gpu: { f16: boolean }, prefer?: Variant): ModelFile | null {
  const pinned = m.files.filter((f) => filePinned(m, f))
  const by = (v: Variant) => pinned.find((f) => f.variant === v) ?? null
  if (prefer) return prefer === 'fp16' && !gpu.f16 ? null : by(prefer)
  return (gpu.f16 ? by('fp16') : null) ?? by('fp32')
}

/** The order a model's graphs run in (AI Remove): encoder, then the denoiser, then the decoder. */
export const PARTS = ['vae_encoder', 'unet', 'vae_decoder'] as const

/**
 * The files this device should download: the depth model's one file (`chooseFile`), or every graph of a model made of
 * several (fp32 only: AI Remove's conversion is published in fp32). Empty: none usable or not pinned.
 */
export function chooseFiles(m: ModelEntry, gpu: { f16: boolean }, prefer?: Variant): ModelFile[] {
  if (m.task === 'inpaint') {
    if (!modelPinned(m)) return []
    const fp32 = m.files.filter((f) => f.variant === 'fp32')
    return PARTS.map((p) => fp32.find((f) => f.part === p)).filter((f): f is ModelFile => !!f)
  }
  if (TASK_PARTS[m.task]) {
    // A model of several graphs that comes in variants (Object select): the variant is chosen by the caller (the run
    // plan in ai/models.ts), else fp16 with `shader-f16` and fp32 without; every file of that variant.
    const v = prefer ?? (gpu.f16 && variantPinned(m, 'fp16') ? 'fp16' : 'fp32')
    return variantPinned(m, v) ? filesOf(m, v) : []
  }
  const f = chooseFile(m, gpu, prefer)
  return f ? [f] : []
}

export const filesBytes = (files: ModelFile[]) => files.reduce((n, f) => n + f.bytes, 0)

export interface DownloadItem {
  what: 'runtime' | 'model'
  /** Relative to the site root. */
  path: string
  bytes: number
  sha256: string
  /** The model file it is (absent for the runtime). */
  file?: ModelFile
}

/** What installing a model downloads from the site (the runtime only if it isn't on the device yet), file by file. */
export function downloadPlan(info: AiInfo, m: ModelEntry, f: ModelFile | ModelFile[], runtimeInstalled: boolean): DownloadItem[] {
  const items: DownloadItem[] = []
  if (!runtimeInstalled) items.push({ what: 'runtime', path: info.runtime.wasm.path, bytes: info.runtime.wasm.bytes, sha256: info.runtime.wasm.sha256 })
  for (const x of Array.isArray(f) ? f : [f]) items.push({ what: 'model', path: servedPath(m, x), bytes: x.bytes, sha256: x.sha256!, file: x })
  return items
}

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const x of b) s += x.toString(16).padStart(2, '0')
  return s
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', data))
}

/** "49.6 MB" (decimal megabytes, as download sizes are usually given). */
export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  if (n >= 1e3) return `${Math.round(n / 1e3)} kB`
  return `${n} bytes`
}
