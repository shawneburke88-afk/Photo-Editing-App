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
// fp16 or fp32: ONNX Runtime's WebGPU EP fails on fp16 graphs when the adapter lacks `shader-f16` ("requires f16 but the
// device does not support it"; it doesn't upcast: docs/research/cowork-2026-10-13b/F_MODEL_DELIVERY.md, F9), so a
// device without `shader-f16` gets the fp32 file and one with it the fp16 file (half the download).

/** Kept in sync with web/scripts/models.mjs. */
export const SHA256_RE = /^[0-9a-f]{64}$/
export const REVISION_RE = /^[0-9a-f]{40}$/

export type Variant = 'fp16' | 'fp32'
export type Task = 'depth' | 'inpaint'
export type Delivery = 'site' | 'huggingface'

export interface ModelFile {
  variant: Variant
  /** Path inside the source repository. */
  path: string
  bytes: number
  /** Lower-case hex; null until pinned. */
  sha256: string | null
  /** A model made of several graphs (AI Remove: "vae_encoder", "unet", "vae_decoder"): which one this file is. */
  part?: string
}

/** The depth model's preprocessing (Depth Anything V2's own). */
export interface DepthInput {
  shortSide: number
  multiple: number
  mean: [number, number, number]
  std: [number, number, number]
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
  source: { host: 'huggingface'; repo: string; revision: string | null }
  /** The depth model only. */
  input?: DepthInput
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

export interface Manifest {
  schema: 1
  models: ModelEntry[]
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
  if (o.schema !== 1) fail('schema must be 1')
  if (!Array.isArray(o.models)) fail('models must be a list')
  const ids = new Set<string>()
  const models = (o.models as unknown[]).map((v, i) => {
    if (!v || typeof v !== 'object') fail(`model ${i} is not an object`)
    const m = v as Record<string, unknown>
    if (!isStr(m.id) || !/^[a-z0-9-]+$/.test(m.id)) fail(`model ${i}: bad id`)
    const id = m.id as string
    if (ids.has(id)) fail(`duplicate id ${id}`)
    ids.add(id)
    if (m.task !== 'depth' && m.task !== 'inpaint') fail(`${id}: unknown task`)
    if (m.delivery !== undefined && m.delivery !== 'site' && m.delivery !== 'huggingface') fail(`${id}: unknown delivery`)
    for (const k of ['name', 'summary', 'credit', 'trainingData'] as const) if (!isStr(m[k])) fail(`${id}: ${k} missing`)
    const lic = m.licence as Record<string, unknown> | undefined
    if (!lic || !isStr(lic.id) || !isStr(lic.url) || !isStr(lic.statement)) fail(`${id}: licence incomplete`)
    const src = m.source as Record<string, unknown> | undefined
    if (!src || src.host !== 'huggingface' || !isStr(src.repo) || !/^[\w.-]+\/[\w.-]+$/.test(src.repo)) fail(`${id}: source incomplete`)
    const rev = src!.revision
    if (rev !== null && !(isStr(rev) && REVISION_RE.test(rev))) fail(`${id}: revision must be a 40-digit commit or null`)
    const inp = m.input as Record<string, unknown> | undefined
    if (m.task === 'depth' && (!inp || !isNum(inp.shortSide) || !isNum(inp.multiple) || !isTriple(inp.mean) || !isTriple(inp.std))) fail(`${id}: input incomplete`)
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
      const slot = `${x.variant as string}${x.part ? ` ${x.part as string}` : ''}`
      if (variants.has(slot)) fail(`${id}: two ${slot} files`)
      variants.add(slot)
      if (!isStr(x.path) || x.path.includes('..') || x.path.startsWith('/')) fail(`${id}: bad file path`)
      if (!isNum(x.bytes) || x.bytes <= 0 || !Number.isInteger(x.bytes)) fail(`${id}: bad byte count`)
      if (x.sha256 !== null && !(isStr(x.sha256) && SHA256_RE.test(x.sha256))) fail(`${id}: sha256 must be 64 hex digits or null`)
      return { variant: x.variant, path: x.path, bytes: x.bytes, sha256: x.sha256, ...(x.part ? { part: x.part } : {}) } as ModelFile
    })
    if (m.task === 'inpaint' && !['vae_encoder', 'unet', 'vae_decoder'].every((p) => files.some((f) => f.part === p))) fail(`${id}: an inpainting model needs vae_encoder, unet and vae_decoder files`)
    return { ...(m as unknown as ModelEntry), source: { host: 'huggingface', repo: src!.repo as string, revision: rev as string | null }, files } as ModelEntry
  })
  return { schema: 1, models }
}

/** A file can be served and downloaded: its model's revision and its own hash are pinned. */
export const filePinned = (m: ModelEntry, f: ModelFile) => !!m.source.revision && !!f.sha256

/** The model has at least one pinned file (a model of several graphs: all of them). */
export const modelPinned = (m: ModelEntry) => (m.task === 'inpaint' ? m.files.every((f) => filePinned(m, f)) : m.files.some((f) => filePinned(m, f)))

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

/** Where the deploy puts a file on LightBench's site, relative to the site root. */
export function servedPath(m: ModelEntry, f: ModelFile): string {
  if (!m.source.revision) throw new Error(`${m.id} is not pinned`)
  return `models/${m.id}/${m.source.revision.slice(0, 7)}/${f.variant}.onnx`
}

/** The file's pinned source URL (what the deploy workflow fetches; the app never does). */
export function sourceUrl(m: ModelEntry, f: ModelFile): string {
  if (!m.source.revision) throw new Error(`${m.id} is not pinned`)
  return `https://huggingface.co/${m.source.repo}/resolve/${m.source.revision}/${f.path}`
}

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
  if (m.task !== 'inpaint') {
    const f = chooseFile(m, gpu, prefer)
    return f ? [f] : []
  }
  if (!modelPinned(m)) return []
  const fp32 = m.files.filter((f) => f.variant === 'fp32')
  return PARTS.map((p) => fp32.find((f) => f.part === p)).filter((f): f is ModelFile => !!f)
}

export const filesBytes = (files: ModelFile[]) => files.reduce((n, f) => n + f.bytes, 0)

export interface DownloadItem {
  what: 'runtime' | 'model'
  /** Relative to the site root. */
  path: string
  bytes: number
  sha256: string
}

/** What installing a model downloads (the runtime only if it isn't on the device yet). */
export function downloadPlan(info: AiInfo, m: ModelEntry, f: ModelFile, runtimeInstalled: boolean): DownloadItem[] {
  const items: DownloadItem[] = []
  if (!runtimeInstalled) items.push({ what: 'runtime', path: info.runtime.wasm.path, bytes: info.runtime.wasm.bytes, sha256: info.runtime.wasm.sha256 })
  items.push({ what: 'model', path: servedPath(m, f), bytes: f.bytes, sha256: f.sha256! })
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
