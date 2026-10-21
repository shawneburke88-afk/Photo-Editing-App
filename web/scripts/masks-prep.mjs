// Preparation check for the AI masks candidates (throwaway branch lightbench/ai-masks-prep; nothing here is merged).
// Run by the "AI models" workflow's masks-prep task on GitHub's servers, which can reach huggingface.co.
//
//   node scripts/masks-prep.mjs pin    --dir D   pins every candidate (Hub API ?blobs=true: commit, lastModified,
//                                                licence, each file's size and LFS sha256; YuNet from opencv_zoo via
//                                                Git LFS media URL), downloads the files, checks them against the
//                                                pins, fetches ORT 1.30.0's WebGPU operator lists. Writes D/pins.json.
//   node scripts/masks-prep.mjs run    --dir D [--ep cpu|webgpu] [--only KEY] [--timeout S]
//                                                runs each model once (plus a warm-up) with onnxruntime-node on the
//                                                test photos; writes mask PNGs to D/out and D/run-<ep>.json. With
//                                                --ep webgpu each model runs in a child process (time limit, verbose
//                                                ORT log parsed for nodes the WebGPU EP has no kernel for).
//   node scripts/masks-prep.mjs report --dir D   merges pins, inspection, runs and the TFLite comparison; prints one
//                                                `MASKS_PREP_RESULT {json}` line per model and the step summary.
//
// onnxruntime-node is installed on the runner only (ORT_NODE_DIR, a folder with node_modules/onnxruntime-node).
//
// Test photos (web/scripts/masks-prep/, committed unchanged from scikit-image v0.24.0 skimage/data/):
//   astronaut.png  Eileen Collins, NASA. scikit-image: "This image was downloaded from the NASA Great Images database
//                  <https://flic.kr/p/r9qvLn>. No known copyright restrictions, released into the public domain."
//   rocket.jpg     DSCOVR launch on Falcon 9, SpaceX. scikit-image: "captured by SpaceX and released in the public
//                  domain" (https://www.flickr.com/photos/spacexphotos/16511594820/).

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, 'masks-prep')
const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : dflt
}
const DIR = opt('--dir', process.env.MASKS_DIR ?? '')
const ORT_TAG = 'v1.30.0'

/** The candidates. `files`: repository paths (exact path first; else the unique file with that basename). */
export const MODELS = [
  { id: 'sam21-tiny', name: 'SAM 2.1 Hiera Tiny', hf: 'onnx-community/sam2.1-hiera-tiny-ONNX', kind: 'sam',
    files: { 'fp32/encoder': 'onnx/vision_encoder.onnx', 'fp32/decoder': 'onnx/prompt_encoder_mask_decoder.onnx',
      'fp16/encoder': 'onnx/vision_encoder_fp16.onnx', 'fp16/decoder': 'onnx/prompt_encoder_mask_decoder_fp16.onnx' } },
  { id: 'slimsam-77', name: 'SlimSAM-77', hf: 'Xenova/slimsam-77-uniform', kind: 'sam',
    files: { 'fp16/encoder': 'onnx/vision_encoder_fp16.onnx', 'fp16/decoder': 'onnx/prompt_encoder_mask_decoder_fp16.onnx', 'fp32/encoder': 'onnx/vision_encoder.onnx', 'fp32/decoder': 'onnx/prompt_encoder_mask_decoder.onnx' } },
  { id: 'birefnet-lite', name: 'BiRefNet_lite', hf: 'onnx-community/BiRefNet_lite-ONNX', kind: 'birefnet',
    files: { fp16: 'onnx/model_fp16.onnx', fp32: 'onnx/model.onnx' } },
  { id: 'yunet', name: 'YuNet', gh: { repo: 'opencv/opencv_zoo', dir: 'models/face_detection_yunet' }, kind: 'yunet',
    files: { '2026may': 'models/face_detection_yunet/face_detection_yunet_2026may.onnx', '2023mar': 'models/face_detection_yunet/face_detection_yunet_2023mar.onnx' } },
  { id: 'selfie-multiclass', name: 'MediaPipe Selfie Multiclass (community ONNX)', hf: 'FreeHugsForRobots/ps-skin-seg', kind: 'selfie',
    files: { fp32: 'selfie_multiclass_256x256.onnx' },
    tflite: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite' },
  { id: 'rfdetr-seg-nano', name: 'RF-DETR-Seg Nano', hf: 'PierreMarieCurie/rf-detr-onnx', kind: 'rfdetr',
    files: { fp32: 'rf-detr-seg-nano.onnx' } },
  { id: 'efficientvit-seg-b1', name: 'EfficientViT-Seg B1 ADE20K', hf: 'han-cai/efficientvit-seg', kind: 'evit',
    files: { pt: 'efficientvit_seg_b1_ade20k.pt' }, exported: { fp32: 'efficientvit_seg_b1_ade20k_512.onnx' } },
]

/** The point prompt for SAM, on the astronaut's suit (x, y in the 512 × 512 photo). */
const SAM_POINT = [110, 330]
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const log = (...a) => console.log(...a)
const readJson = (p, dflt = null) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : dflt)
const writeJson = (p, x) => writeFileSync(p, `${JSON.stringify(x, null, 1)}\n`)

async function getJson(url, headers = {}) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return await r.json()
    } catch (e) {
      if (i >= 3) throw new Error(`${url}: ${e.message}`)
      await new Promise((ok) => setTimeout(ok, 2000 * i))
    }
  }
}

async function getText(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r.text()
}

/** Streams `url` to `dest`; returns { bytes, sha256, headers }. */
async function downloadTo(url, dest, tries = 3) {
  mkdirSync(dirname(dest), { recursive: true })
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const h = createHash('sha256')
      let bytes = 0
      const src = Readable.fromWeb(r.body)
      src.on('data', (c) => {
        h.update(c)
        bytes += c.length
      })
      await pipeline(src, createWriteStream(dest))
      const headers = {}
      for (const k of ['etag', 'last-modified', 'x-goog-generation', 'x-goog-hash', 'content-length', 'x-repo-commit']) if (r.headers.has(k)) headers[k] = r.headers.get(k)
      return { bytes, sha256: h.digest('hex'), headers }
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`)
      await new Promise((ok) => setTimeout(ok, 3000 * i))
    }
  }
}

function findSibling(siblings, path) {
  const exact = siblings.find((s) => s.rfilename === path)
  if (exact) return exact
  const base = path.split('/').pop()
  const hits = siblings.filter((s) => s.rfilename.split('/').pop() === base)
  return hits.length === 1 ? hits[0] : null
}

// ---------------------------------------------------------------------------------------------------------- pin

async function pinHf(m, filesDir) {
  const info = await getJson(`https://huggingface.co/api/models/${m.hf}?blobs=true`)
  const siblings = info.siblings ?? []
  const out = {
    id: m.id, name: m.name, source: 'huggingface', repo: m.hf, commit: info.sha, lastModified: info.lastModified ?? null,
    createdAt: info.createdAt ?? null, licence: info.cardData?.license ?? null,
    licenceTags: (info.tags ?? []).filter((t) => t.startsWith('license:')), gated: info.gated ?? null,
    library: info.library_name ?? null, files: {}, onnxListed: siblings.filter((s) => /\.onnx(_data)?/.test(s.rfilename)).map((s) => `${s.rfilename} ${s.size ?? s.lfs?.size ?? '?'}`),
  }
  for (const [variant, path] of Object.entries(m.files)) {
    const s = findSibling(siblings, path)
    if (!s) {
      out.files[variant] = { path, error: 'not in the repository at this commit' }
      continue
    }
    // External-data companions sit beside the graph (e.g. vision_encoder.onnx_data).
    const parts = [s, ...siblings.filter((x) => x.rfilename !== s.rfilename && x.rfilename.startsWith(`${s.rfilename}_data`))]
    const recs = []
    for (const p of parts) {
      const dest = join(filesDir, m.id, p.rfilename.split('/').pop())
      const rec = { path: p.rfilename, bytes: p.lfs?.size ?? p.size ?? null, lfsSha256: p.lfs?.sha256 ?? null, blobId: p.blobId ?? null, local: dest }
      try {
        const got = await downloadTo(`https://huggingface.co/${m.hf}/resolve/${info.sha}/${p.rfilename}`, dest)
        rec.downloadBytes = got.bytes
        rec.sha256 = got.sha256
        rec.match = rec.lfsSha256 ? got.sha256 === rec.lfsSha256 && got.bytes === rec.bytes : null
      } catch (e) {
        rec.error = e.message
      }
      log(`${m.id} ${variant} ${p.rfilename}: ${rec.bytes} bytes lfs ${rec.lfsSha256} download ${rec.sha256 ?? rec.error} match ${rec.match}`)
      recs.push(rec)
    }
    out.files[variant] = { ...recs[0], companions: recs.slice(1) }
  }
  return out
}

async function pinGithub(m, filesDir) {
  const headers = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}
  // The workflow's token if it works, else unauthenticated (public repository).
  const gh = (u) => getJson(u, headers).catch(() => getJson(u))
  const head = await gh(`https://api.github.com/repos/${m.gh.repo}/commits/main`)
  const commit = head.sha
  const out = { id: m.id, name: m.name, source: 'github', repo: m.gh.repo, commit, lastModified: head.commit?.committer?.date ?? null, files: {} }
  try {
    const readme = await getText(`https://raw.githubusercontent.com/${m.gh.repo}/${commit}/${m.gh.dir}/README.md`)
    out.licence = /licensed under \[?([^\]\n]+?)\]?\(/i.exec(readme)?.[1]?.trim() ?? null
    out.licenceLine = readme.split('\n').find((l) => /licensed under/i.test(l))?.trim() ?? null
  } catch (e) {
    out.licence = `unread: ${e.message}`
  }
  for (const [variant, path] of Object.entries(m.files)) {
    const rec = { path }
    try {
      const last = await gh(`https://api.github.com/repos/${m.gh.repo}/commits?path=${encodeURIComponent(path)}&sha=${commit}&per_page=1`)
      rec.lastCommit = last[0]?.sha ?? null
      rec.lastCommitDate = last[0]?.commit?.committer?.date ?? null
      const ptr = await getText(`https://raw.githubusercontent.com/${m.gh.repo}/${commit}/${path}`)
      rec.lfsSha256 = /^oid sha256:([0-9a-f]{64})$/m.exec(ptr)?.[1] ?? null
      rec.bytes = Number(/^size (\d+)$/m.exec(ptr)?.[1] ?? NaN)
      const dest = join(filesDir, m.id, path.split('/').pop())
      const got = await downloadTo(`https://media.githubusercontent.com/media/${m.gh.repo}/${commit}/${path}`, dest)
      Object.assign(rec, { local: dest, downloadBytes: got.bytes, sha256: got.sha256, match: got.sha256 === rec.lfsSha256 && got.bytes === rec.bytes })
    } catch (e) {
      rec.error = e.message
    }
    log(`${m.id} ${variant}: ${rec.bytes} bytes lfs ${rec.lfsSha256} download ${rec.sha256 ?? rec.error} match ${rec.match}`)
    out.files[variant] = rec
  }
  return out
}

async function pinAll() {
  const filesDir = join(DIR, 'files')
  mkdirSync(filesDir, { recursive: true })
  const pins = { at: new Date().toISOString(), models: {} }
  for (const m of MODELS) {
    try {
      pins.models[m.id] = m.hf ? await pinHf(m, filesDir) : await pinGithub(m, filesDir)
    } catch (e) {
      pins.models[m.id] = { id: m.id, name: m.name, error: e.message }
      log(`${m.id}: ${e.message}`)
    }
    if (m.tflite) {
      const dest = join(filesDir, m.id, 'reference.tflite')
      try {
        const got = await downloadTo(m.tflite, dest)
        pins.models[m.id].tflite = { url: m.tflite, local: dest, bytes: got.bytes, sha256: got.sha256, headers: got.headers }
        log(`${m.id} tflite: ${got.bytes} bytes sha256 ${got.sha256} ${JSON.stringify(got.headers)}`)
      } catch (e) {
        pins.models[m.id].tflite = { url: m.tflite, error: e.message }
      }
    }
  }
  // ONNX Runtime Web 1.30.0's WebGPU operator lists: the JSEP doc the task names, and the native WebGPU EP's kernel
  // registrations (onnxruntime-web/webgpu is built with DISABLE_JSEP=true in 1.30.0, js/web/script/build.ts).
  const ortDir = join(DIR, 'ort')
  mkdirSync(ortDir, { recursive: true })
  pins.ort = { tag: ORT_TAG, files: {} }
  for (const [name, p] of [
    ['webgpu-operators.md', 'js/web/docs/webgpu-operators.md'],
    ['webgpu_execution_provider.cc', 'onnxruntime/core/providers/webgpu/webgpu_execution_provider.cc'],
    ['webgpu_contrib_kernels.cc', 'onnxruntime/contrib_ops/webgpu/webgpu_contrib_kernels.cc'],
    ['binary_elementwise_ops.cc', 'onnxruntime/core/providers/webgpu/math/binary_elementwise_ops.cc'],
    ['build.ts', 'js/web/script/build.ts'],
    ['package.json', 'js/web/package.json'],
  ]) {
    const url = `https://raw.githubusercontent.com/microsoft/onnxruntime/${ORT_TAG}/${p}`
    try {
      const got = await downloadTo(url, join(ortDir, name))
      pins.ort.files[name] = { url, bytes: got.bytes, sha256: got.sha256 }
    } catch (e) {
      pins.ort.files[name] = { url, error: e.message }
    }
  }
  writeJson(join(DIR, 'pins.json'), pins)
  const bad = Object.values(pins.models).flatMap((m) => Object.values(m.files ?? {}).flatMap((f) => [f, ...(f.companions ?? [])]).filter((f) => f.error || f.match === false))
  const failed = Object.values(pins.models).filter((m) => m.error).map((m) => m.id)
  log(`pinned ${Object.keys(pins.models).length - failed.length} of ${Object.keys(pins.models).length} models${failed.length ? ` (failed: ${failed.join(', ')})` : ''}; ${bad.length} file problem(s)`)
}

// ---------------------------------------------------------------------------------------------------------- images

/** Raw RGB8 written by inspect.py --decode: D/img/<name>.rgb + <name>.json {w, h}. */
function loadPhoto(name) {
  const meta = readJson(join(DIR, 'img', `${name}.json`))
  const rgb = readFileSync(join(DIR, 'img', `${name}.rgb`))
  return { name, w: meta.w, h: meta.h, rgb }
}

/** Bilinear resample of an interleaved image or a single-channel float map (half-pixel centres). */
function resize(src, sw, sh, ch, dw, dh) {
  const out = new Float32Array(dw * dh * ch)
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / dh - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / dw - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const tx = fx - x0
      for (let c = 0; c < ch; c++) {
        const a = src[(y0 * sw + x0) * ch + c]
        const b = src[(y0 * sw + x1) * ch + c]
        const d = src[(y1 * sw + x0) * ch + c]
        const e = src[(y1 * sw + x1) * ch + c]
        out[(y * dw + x) * ch + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty
      }
    }
  }
  return out
}

/** NCHW float32 from RGB8: resized to w × h (or longest side to `fit` and zero-padded to fit × fit). */
function toNCHW(photo, w, h, { norm = 'imagenet', bgr = false, fit = null } = {}) {
  let rw = w
  let rh = h
  if (fit) {
    const s = fit / Math.max(photo.w, photo.h)
    rw = Math.round(photo.w * s)
    rh = Math.round(photo.h * s)
  }
  const px = resize(photo.rgb, photo.w, photo.h, 3, rw, rh)
  const out = new Float32Array(3 * w * h)
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      for (let c = 0; c < 3; c++) {
        const v = px[(y * rw + x) * 3 + (bgr ? 2 - c : c)]
        const n = norm === 'imagenet' ? (v / 255 - MEAN[c]) / STD[c] : norm === 'pm1' ? (v - 127.5) / 127.5 : v
        out[c * w * h + y * w + x] = n
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------- PNG

const CRC = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
/** An 8-bit PNG: `channels` 1 (grey) or 3 (RGB). */
function png(px, w, h, channels = 1) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = channels === 3 ? 2 : 0
  const raw = Buffer.alloc((w * channels + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * channels + 1)] = 0
    for (let i = 0; i < w * channels; i++) raw[y * (w * channels + 1) + 1 + i] = Math.max(0, Math.min(255, Math.round(px[y * w * channels + i])))
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** Saves a 0…1 map (mw × mh) at the photo's size as grey, plus a red overlay on the photo. */
function saveMask(key, map, mw, mh, photo) {
  const outDir = join(DIR, 'out')
  mkdirSync(outDir, { recursive: true })
  const m = mw === photo.w && mh === photo.h ? map : resize(map, mw, mh, 1, photo.w, photo.h)
  const grey = new Uint8Array(photo.w * photo.h)
  const over = new Uint8Array(photo.w * photo.h * 3)
  for (let i = 0; i < grey.length; i++) {
    const a = Math.max(0, Math.min(1, m[i]))
    grey[i] = a * 255
    over[i * 3] = photo.rgb[i * 3] * (1 - 0.6 * a) + 255 * 0.6 * a
    over[i * 3 + 1] = photo.rgb[i * 3 + 1] * (1 - 0.6 * a)
    over[i * 3 + 2] = photo.rgb[i * 3 + 2] * (1 - 0.6 * a)
  }
  writeFileSync(join(outDir, `${key}.png`), png(grey, photo.w, photo.h, 1))
  writeFileSync(join(outDir, `${key}-overlay.png`), png(over, photo.w, photo.h, 3))
  let cover = 0
  for (let i = 0; i < m.length; i++) if (m[i] > 0.5) cover++
  return { png: `${key}.png`, coverage: +(cover / m.length).toFixed(4) }
}

// ---------------------------------------------------------------------------------------------------------- ORT

let ort
function loadOrt() {
  if (ort) return ort
  const base = process.env.ORT_NODE_DIR
  const req = createRequire(base ? join(base, 'node_modules', 'x.js') : import.meta.url)
  ort = req('onnxruntime-node')
  return ort
}

function f16ToF32(h) {
  const s = (h & 0x8000) >> 15
  const e = (h & 0x7c00) >> 10
  const f = h & 0x03ff
  if (e === 0) return (s ? -1 : 1) * 2 ** -14 * (f / 1024)
  if (e === 0x1f) return f ? NaN : (s ? -1 : 1) * Infinity
  return (s ? -1 : 1) * 2 ** (e - 15) * (1 + f / 1024)
}
const F32 = new Float32Array(1)
const U32 = new Uint32Array(F32.buffer)
function f32ToF16(v) {
  F32[0] = v
  const x = U32[0]
  const s = (x >>> 16) & 0x8000
  let e = ((x >>> 23) & 0xff) - 127 + 15
  let m = x & 0x7fffff
  if (e >= 0x1f) return s | 0x7c00 | (((x >>> 23) & 0xff) === 0xff && m ? 0x200 : 0)
  if (e <= 0) {
    if (e < -10) return s
    m = (m | 0x800000) >> (1 - e)
    return s | ((m + 0x1000) >> 13)
  }
  return s | (e << 10) | ((m + 0x1000) >> 13)
}

/** A tensor of the input's declared type from float32 / numbers. */
function tensorFor(type, data, dims) {
  const O = loadOrt()
  if (type === 'float16') return new O.Tensor('float16', Uint16Array.from(data, f32ToF16), dims)
  if (type === 'int64') return new O.Tensor('int64', BigInt64Array.from(data, (v) => BigInt(Math.round(v))), dims)
  if (type === 'int32') return new O.Tensor('int32', Int32Array.from(data, (v) => Math.round(v)), dims)
  return new O.Tensor('float32', Float32Array.from(data), dims)
}
/** A tensor's data as float32 (fp16 converted), plus non-finite count. */
function asF32(t) {
  let d = t.data
  if (t.type === 'float16') d = d instanceof Uint16Array ? Float32Array.from(d, f16ToF32) : Float32Array.from(d)
  else if (t.type === 'int64') d = Float32Array.from(d, Number)
  else if (!(d instanceof Float32Array)) d = Float32Array.from(d)
  return d
}
function stats(d) {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let nonFinite = 0
  for (let i = 0; i < d.length; i++) {
    const v = d[i]
    if (!Number.isFinite(v)) {
      nonFinite++
      continue
    }
    if (v < min) min = v
    if (v > max) max = v
    sum += v
  }
  const n = d.length - nonFinite
  return { count: d.length, nonFinite, finite: nonFinite === 0, min: n ? +min.toPrecision(6) : null, max: n ? +max.toPrecision(6) : null, mean: n ? +(sum / n).toPrecision(6) : null }
}
const sigmoid = (v) => 1 / (1 + Math.exp(-v))

/** Input metadata from inspect.json (names, ORT type names, dims). */
function inputsOf(inspect, file) {
  const f = inspect?.files?.[file]
  return f?.inputs ?? null
}

const SESSIONS = []
/** `ep` is 'cpu', 'webgpu' or 'webgpu-basic' (WebGPU with only basic graph optimisations: no fused contrib ops). */
async function session(path, ep) {
  const O = loadOrt()
  const [name, level] = ep.split('-')
  const opts = { executionProviders: [name], graphOptimizationLevel: level ?? 'all' }
  if (name === 'webgpu') {
    // Verbose: the EP logs each node it has no kernel for, and the session logs where nodes were placed.
    O.env.logLevel = 'verbose'
    opts.logSeverityLevel = 0
    opts.logVerbosityLevel = 0
  }
  const s = await O.InferenceSession.create(path, opts)
  SESSIONS.push(s)
  return s
}

/** Runs `feeds` twice (warm-up, then the timed run); returns outputs and both times. */
async function timedRun(s, feeds) {
  const t0 = performance.now()
  const first = await s.run(feeds)
  const t1 = performance.now()
  // WebGPU on software Vulkan is slow: one run only (its time includes shader compilation).
  if (RUN_EP === 'webgpu') return { out: first, firstMs: Math.round(t1 - t0), runMs: Math.round(t1 - t0) }
  const out = await s.run(feeds)
  const t2 = performance.now()
  return { out, firstMs: Math.round(t1 - t0), runMs: Math.round(t2 - t1) }
}
const RUN_EP = opt('--ep', 'cpu')

function describeOutputs(out) {
  const r = {}
  for (const [k, t] of Object.entries(out)) r[k] = { type: t.type, dims: t.dims, ...stats(asF32(t)) }
  return r
}

/** Saves the first float output as float32 for the CPU / WebGPU comparison; returns the max abs difference if both exist. */
function compareWithCpu(key, ep, t) {
  const d = asF32(t)
  const dir = join(DIR, 'raw')
  mkdirSync(dir, { recursive: true })
  const p = join(dir, `${key}-${ep}.f32`)
  writeFileSync(p, Buffer.from(d.buffer, d.byteOffset, d.byteLength))
  if (ep === 'cpu') return null
  const cp = join(dir, `${key}-cpu.f32`)
  if (!existsSync(cp)) return null
  const b = readFileSync(cp)
  const c = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
  if (c.length !== d.length) return { error: `length ${d.length} vs cpu ${c.length}` }
  let max = 0
  let sum = 0
  for (let i = 0; i < d.length; i++) {
    const x = Math.abs(d[i] - c[i])
    if (x > max || Number.isNaN(x)) max = Number.isNaN(x) ? NaN : x
    sum += x
  }
  return { maxAbsDiff: max, meanAbsDiff: sum / d.length }
}

// ---------------------------------------------------------------------------------------------------------- models

async function runSam(m, variant, files, ep, inspect, photo) {
  const enc = files[`${variant}/encoder`]
  const dec = files[`${variant}/decoder`]
  if (!enc?.local || !dec?.local) throw new Error('files missing')
  const encIn = inputsOf(inspect, enc.local)?.[0] ?? { name: 'pixel_values', type: 'float32' }
  const S = 1024
  const sam2 = m.id.startsWith('sam21')
  // SAM 2 (transformers Sam2Processor): resize to 1024 × 1024. SAM (SlimSAM): longest side to 1024, pad.
  const px = toNCHW(photo, S, S, sam2 ? {} : { fit: S })
  savePixels(`${m.id}-${variant}-${photo.name}`, ep, px)
  const es = await session(enc.local, ep)
  const er = await timedRun(es, { [encIn.name]: tensorFor(encIn.type, px, [1, 3, S, S]) })
  const scale = sam2 ? [S / photo.w, S / photo.h] : [S / Math.max(photo.w, photo.h), S / Math.max(photo.w, photo.h)]
  const pt = [SAM_POINT[0] * scale[0], SAM_POINT[1] * scale[1]]
  const ds = await session(dec.local, ep)
  const decIns = inputsOf(inspect, dec.local) ?? ds.inputNames.map((name) => ({ name, type: 'float32', dims: [] }))
  const feeds = {}
  for (const i of decIns) {
    if (er.out[i.name]) {
      const t = er.out[i.name]
      feeds[i.name] = i.type === t.type ? t : tensorFor(i.type, asF32(t), t.dims)
    } else if (/point/.test(i.name)) feeds[i.name] = tensorFor(i.type, pt, i.dims.length === 3 ? [1, 1, 2] : [1, 1, 1, 2])
    else if (/label/.test(i.name)) feeds[i.name] = tensorFor(i.type, [1], i.dims.length === 2 ? [1, 1] : [1, 1, 1])
    else if (/box/.test(i.name)) feeds[i.name] = tensorFor(i.type, [], [1, 0, 4])
    else throw new Error(`decoder input ${i.name} not handled`)
  }
  const dr = await timedRun(ds, feeds)
  const masksName = Object.keys(dr.out).find((k) => /mask/.test(k)) ?? Object.keys(dr.out)[0]
  const iouName = Object.keys(dr.out).find((k) => /iou/.test(k))
  const masks = dr.out[masksName]
  const md = asF32(masks)
  const [mh, mw] = masks.dims.slice(-2)
  const n = md.length / (mh * mw)
  const iou = iouName ? Array.from(asF32(dr.out[iouName])) : []
  const best = iou.length === n ? iou.indexOf(Math.max(...iou)) : 0
  let map = md.subarray(best * mh * mw, (best + 1) * mh * mw).map((v) => (v > 0 ? 1 : 0))
  // SAM (padded): the mask covers the padded square; crop to the photo's part.
  if (!sam2 && photo.w !== photo.h) {
    const s = Math.max(photo.w, photo.h)
    const cw = Math.round((photo.w / s) * mw)
    const ch = Math.round((photo.h / s) * mh)
    const c = new Float32Array(cw * ch)
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) c[y * cw + x] = map[y * mw + x]
    return finish(m, variant, ep, photo, c, cw, ch, er, dr, masks, { iou, best, point: SAM_POINT })
  }
  return finish(m, variant, ep, photo, map, mw, mh, er, dr, masks, { iou: iou.map((v) => +v.toFixed(4)), best, point: SAM_POINT })
}

/** The exact float32 input tensor of a CPU run, for the masks-prep2 checks (same input everywhere). */
function savePixels(key, ep, px) {
  if (ep !== 'cpu') return
  mkdirSync(join(DIR, 'raw'), { recursive: true })
  writeFileSync(join(DIR, 'raw', `${key}-pixel.f32`), Buffer.from(px.buffer, px.byteOffset, px.byteLength))
}

function finish(m, variant, ep, photo, map, mw, mh, er, dr, primary, extra) {
  const key = `${m.id}-${variant}-${photo.name}`
  const mask = saveMask(`${key}-${ep}`, map, mw, mh, photo)
  const outs = { ...(er ? prefixed('encoder.', describeOutputs(er.out)) : {}), ...prefixed(er ? 'decoder.' : '', describeOutputs(dr.out)) }
  return {
    ep, photo: photo.name, cpuMs: er ? { encoder: er.runMs, decoder: dr.runMs, total: er.runMs + dr.runMs, firstEncoder: er.firstMs, firstDecoder: dr.firstMs } : { total: dr.runMs, first: dr.firstMs },
    outputsFinite: Object.values(outs).every((o) => o.finite), outputs: outs, mask, vsCpu: compareWithCpu(key, ep, primary),
    vsCpuEach: { ...(er ? compareEach(`${key}-enc`, ep, er.out) : {}), ...compareEach(`${key}-dec`, ep, dr.out) }, ...extra,
  }
}
/** Every float output against the CPU's (max / mean absolute difference). */
function compareEach(key, ep, out) {
  const r = {}
  for (const [n, t] of Object.entries(out)) if (t.type === 'float32' || t.type === 'float16') r[n] = compareWithCpu(`${key}-${n}`, ep, t)
  return ep === 'cpu' ? {} : r
}
const prefixed = (p, o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [p + k, v]))

async function runSingle(m, variant, file, ep, inspect, photo) {
  const ins = inputsOf(inspect, file.local)
  const inp = ins?.[0] ?? { name: 'input', type: 'float32', dims: [1, 3, 1024, 1024] }
  const s = await session(file.local, ep)
  const num = (d, dflt) => (typeof d === 'number' && d > 0 ? d : dflt)
  if (m.kind === 'birefnet') {
    const S = num(inp.dims?.[2], 1024)
    const px = toNCHW(photo, S, S)
    savePixels(`${m.id}-${variant}-${photo.name}`, ep, px)
    const r = await timedRun(s, { [inp.name]: tensorFor(inp.type, px, [1, 3, S, S]) })
    const names = Object.keys(r.out)
    const t = r.out[names[names.length - 1]]
    const d = asF32(t)
    const st = stats(d)
    const logits = st.min < 0 || st.max > 1
    const [h, w] = t.dims.slice(-2)
    const map = d.subarray(d.length - h * w).map((v) => (logits ? sigmoid(v) : v))
    return finish(m, variant, ep, photo, map, w, h, null, r, t, { sigmoidApplied: logits, inputSize: S })
  }
  if (m.kind === 'yunet') {
    const W = num(inp.dims?.[3], Math.ceil(photo.w / 32) * 32)
    const H = num(inp.dims?.[2], Math.ceil(photo.h / 32) * 32)
    const r = await timedRun(s, { [inp.name]: tensorFor(inp.type, toNCHW(photo, W, H, { norm: 'none', bgr: true }), [1, 3, H, W]) })
    const faces = decodeYunet(r.out, W, H).map((f) => ({ ...f, box: [f.box[0] * (photo.w / W), f.box[1] * (photo.h / H), f.box[2] * (photo.w / W), f.box[3] * (photo.h / H)].map((v) => +v.toFixed(1)) }))
    const map = new Float32Array(photo.w * photo.h)
    for (const f of faces) {
      const [x, y, w, h] = f.box
      for (let j = Math.max(0, Math.floor(y)); j < Math.min(photo.h, y + h); j++) for (let i = Math.max(0, Math.floor(x)); i < Math.min(photo.w, x + w); i++) map[j * photo.w + i] = 1
    }
    return finish(m, variant, ep, photo, map, photo.w, photo.h, null, r, r.out.cls_8 ?? Object.values(r.out)[0], { inputSize: [W, H], faces })
  }
  if (m.kind === 'selfie') {
    const nhwc = inp.dims?.[3] === 3
    const S = num(nhwc ? inp.dims?.[1] : inp.dims?.[2], 256)
    const chw = toNCHW(photo, S, S, { norm: 'pm1' })
    const hwc = new Float32Array(3 * S * S)
    for (let c = 0; c < 3; c++) for (let i = 0; i < S * S; i++) hwc[i * 3 + c] = chw[c * S * S + i]
    if (ep === 'cpu') {
      // The exact NHWC input, for the TFLite comparison (tflite_compare.py).
      mkdirSync(join(DIR, 'raw'), { recursive: true })
      writeFileSync(join(DIR, 'raw', `selfie-input-${photo.name}.f32`), Buffer.from(hwc.buffer))
    }
    const r = await timedRun(s, { [inp.name]: tensorFor(inp.type, nhwc ? hwc : chw, nhwc ? [1, S, S, 3] : [1, 3, S, S]) })
    const t = Object.values(r.out)[0]
    const d = asF32(t)
    const lastIsC = t.dims[t.dims.length - 1] === 6
    const C = 6
    const P = S * S
    const at = (p, c) => (lastIsC ? d[p * C + c] : d[c * P + p])
    let sumCheck = 0
    const person = new Float32Array(P)
    const classes = new Float32Array(P)
    const hist = new Array(C).fill(0)
    for (let p = 0; p < P; p++) {
      let best = 0
      let s2 = 0
      for (let c = 0; c < C; c++) {
        s2 += at(p, c)
        if (at(p, c) > at(p, best)) best = c
      }
      sumCheck += s2
      hist[best]++
      classes[p] = best / 5
      person[p] = best === 0 ? 0 : 1
    }
    if (ep === 'cpu') writeFileSync(join(DIR, 'raw', `selfie-output-${photo.name}.f32`), Buffer.from(Float32Array.from(lastIsC ? d : Array.from({ length: P * C }, (_, i) => d[(i % C) * P + Math.floor(i / C)])).buffer))
    saveMask(`${m.id}-${variant}-${photo.name}-classes-${ep}`, classes, S, S, photo)
    return finish(m, variant, ep, photo, person, S, S, null, r, t, {
      layout: nhwc ? 'NHWC' : 'NCHW', meanChannelSum: +(sumCheck / P).toFixed(4),
      classShare: Object.fromEntries(['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others'].map((n, i) => [n, +(hist[i] / P).toFixed(4)])),
    })
  }
  if (m.kind === 'rfdetr') {
    const H = num(inp.dims?.[2], 312)
    const W = num(inp.dims?.[3], 312)
    const r = await timedRun(s, { [inp.name]: tensorFor(inp.type, toNCHW(photo, W, H), [1, 3, H, W]) })
    const outs = Object.entries(r.out)
    const masksT = outs.find(([, t]) => t.dims.length === 4)?.[1]
    const boxesT = outs.find(([, t]) => t.dims.length === 3 && t.dims[2] === 4)?.[1]
    const logitsT = outs.find(([, t]) => t.dims.length === 3 && t.dims[2] !== 4)?.[1]
    if (!masksT || !logitsT) throw new Error(`outputs not recognised: ${outs.map(([k, t]) => `${k}${JSON.stringify(t.dims)}`).join(' ')}`)
    const L = asF32(logitsT)
    const [, Q, C] = logitsT.dims
    const dets = []
    for (let q = 0; q < Q; q++) {
      let bc = 0
      for (let c = 1; c < C; c++) if (L[q * C + c] > L[q * C + bc]) bc = c
      dets.push({ q, cls: bc, score: sigmoid(L[q * C + bc]) })
    }
    dets.sort((a, b) => b.score - a.score)
    const M = asF32(masksT)
    const [mh, mw] = masksT.dims.slice(-2)
    const map = new Float32Array(mh * mw)
    // COCO category id 1 is person in RF-DETR's 91-slot label space (assumption: the export keeps it).
    const people = dets.filter((d) => d.cls === 1 && d.score > 0.5)
    for (const d of people.length ? people : dets.slice(0, 1)) for (let i = 0; i < mh * mw; i++) if (M[d.q * mh * mw + i] > 0) map[i] = 1
    const B = boxesT ? asF32(boxesT) : null
    return finish(m, variant, ep, photo, map, mw, mh, null, r, masksT, {
      inputSize: [W, H], peopleAbove05: people.length,
      top: dets.slice(0, 5).map((d) => ({ cls: d.cls, score: +d.score.toFixed(3), box: B ? Array.from(B.subarray(d.q * 4, d.q * 4 + 4), (v) => +v.toFixed(3)) : null })),
    })
  }
  if (m.kind === 'evit') {
    const S = num(inp.dims?.[2], 512)
    const r = await timedRun(s, { [inp.name]: tensorFor(inp.type, toNCHW(photo, S, S), [1, 3, S, S]) })
    const t = Object.values(r.out)[0]
    const d = asF32(t)
    const [, C, h, w] = t.dims
    const P = h * w
    const sky = new Float32Array(P)
    const hard = new Float32Array(P)
    const top = new Array(C).fill(0)
    for (let p = 0; p < P; p++) {
      let mx = -Infinity
      let arg = 0
      for (let c = 0; c < C; c++) if (d[c * P + p] > mx) ((mx = d[c * P + p]), (arg = c))
      let z = 0
      for (let c = 0; c < C; c++) z += Math.exp(d[c * P + p] - mx)
      sky[p] = Math.exp(d[2 * P + p] - mx) / z // ADE20K class 2 = sky
      hard[p] = arg === 2 ? 1 : 0
      top[arg]++
    }
    const ADE = ['wall', 'building', 'sky', 'floor', 'tree', 'ceiling', 'road', 'bed', 'windowpane', 'grass', 'cabinet', 'sidewalk', 'person']
    const topClasses = top.map((n, c) => [c, n]).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => ({ cls: c, name: ADE[c] ?? null, share: +(n / P).toFixed(4) }))
    saveMask(`${m.id}-${variant}-${photo.name}-skyprob-${ep}`, sky, w, h, photo)
    return finish(m, variant, ep, photo, hard, w, h, null, r, t, { inputSize: S, outputSize: [w, h], skyArgmaxShare: +(hard.reduce((a, b) => a + b, 0) / P).toFixed(4), topClasses })
  }
  throw new Error(`kind ${m.kind}`)
}

/** OpenCV FaceDetectorYN's decoding (face_detect.cpp): strides 8/16/32, score sqrt(cls·obj), NMS 0.3. */
function decodeYunet(out, W, H) {
  const faces = []
  for (const s of [8, 16, 32]) {
    const cls = asF32(out[`cls_${s}`])
    const obj = asF32(out[`obj_${s}`])
    const bb = asF32(out[`bbox_${s}`])
    const cols = Math.floor(W / s)
    const rows = Math.floor(H / s)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])))
        if (score < 0.6) continue
        const cx = (c + bb[i * 4]) * s
        const cy = (r + bb[i * 4 + 1]) * s
        const w = Math.exp(bb[i * 4 + 2]) * s
        const h = Math.exp(bb[i * 4 + 3]) * s
        faces.push({ score, box: [cx - w / 2, cy - h / 2, w, h] })
      }
    }
  }
  faces.sort((a, b) => b.score - a.score)
  const keep = []
  const iou = (a, b) => {
    const x0 = Math.max(a[0], b[0])
    const y0 = Math.max(a[1], b[1])
    const x1 = Math.min(a[0] + a[2], b[0] + b[2])
    const y1 = Math.min(a[1] + a[3], b[1] + b[3])
    const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
    return i / (a[2] * a[3] + b[2] * b[3] - i)
  }
  for (const f of faces) if (keep.every((k) => iou(k.box, f.box) < 0.3)) keep.push(f)
  return keep.slice(0, 10).map((f) => ({ score: +f.score.toFixed(4), box: f.box }))
}

/** The runs: [key, model, variant, photo]. */
function plan(pins) {
  const jobs = []
  for (const m of MODELS) {
    const p = pins.models[m.id]
    if (!p) continue
    const photos = m.kind === 'evit' ? ['rocket', 'astronaut'] : ['astronaut']
    const variants = m.kind === 'sam' ? [...new Set(Object.keys(m.files).map((k) => k.split('/')[0]))] : m.kind === 'evit' ? Object.keys(m.exported) : Object.keys(m.files)
    for (const v of variants) for (const ph of photos) jobs.push({ key: `${m.id}/${v}/${ph}`, m, v, ph })
  }
  // Diagnostics on WebGPU: the models whose WebGPU result differed from the CPU or failed in run 1, again with only
  // basic graph optimisations (no fused com.microsoft kernels), compared with the same CPU result.
  if (RUN_EP === 'webgpu') {
    for (const k of ['sam21-tiny/fp32/astronaut', 'slimsam-77/fp16/astronaut', 'birefnet-lite/fp32/astronaut']) {
      const j = jobs.find((x) => x.key === k)
      if (j) jobs.push({ ...j, key: `${k}@basic`, ep: 'webgpu-basic' })
    }
  }
  return jobs
}

function filesFor(m, pins) {
  if (m.kind === 'evit') {
    const ex = readJson(join(DIR, 'evit.json'))
    return ex?.onnx ? { fp32: { local: ex.onnx } } : {}
  }
  return pins.models[m.id]?.files ?? {}
}

async function runJob(job, ep, pins, inspect) {
  const photo = loadPhoto(job.ph)
  const files = filesFor(job.m, pins)
  if (job.m.kind === 'sam') return runSam(job.m, job.v, files, ep, inspect, photo)
  const f = files[job.v]
  if (!f?.local || !existsSync(f.local)) throw new Error(`file missing for ${job.key}`)
  return runSingle(job.m, job.v, f, ep, inspect, photo)
}

function runChild(job, timeoutS) {
  return new Promise((resolve) => {
    const logPath = join(DIR, 'webgpu-logs', `${job.key.replaceAll('/', '_')}.log`)
    mkdirSync(dirname(logPath), { recursive: true })
    const logStream = createWriteStream(logPath)
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run-one', '--dir', DIR, '--ep', 'webgpu', '--only', job.key], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', (c) => {
      stdout += c
      logStream.write(c)
    })
    child.stderr.on('data', (c) => logStream.write(c))
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutS * 1000)
    child.on('close', (code, signal) => {
      clearTimeout(t)
      logStream.end(() => {
        const text = readFileSync(logPath, 'utf8')
        const notFound = {}
        for (const mm of text.matchAll(/webgpu kernel not found in registries for Op type: (\S+) node name: (\S*)/g)) notFound[mm[1]] = (notFound[mm[1]] ?? 0) + 1
        // session_state.cc VerifyEachNodeIsAssignedToAnEp: "All nodes placed on [EP]. Number of nodes: N" or
        // "Node(s) placed on [EP]. Number of nodes: N" followed by one "  OpType (name)" line per node.
        const placed = {}
        const cpuOps = {}
        let cur = null
        for (const l of text.split('\n')) {
          const pm = /(?:All nodes|Node\(s\)) placed on \[(\w+)\]\. Number of nodes: (\d+)/.exec(l)
          if (pm) {
            placed[pm[1]] = (placed[pm[1]] ?? 0) + Number(pm[2])
            cur = pm[1]
            continue
          }
          const om = /VerifyEachNodeIsAssignedToAnEp\]\s+(\w+) \(/.exec(l)
          if (om && cur === 'CPUExecutionProvider') cpuOps[om[1]] = (cpuOps[om[1]] ?? 0) + 1
          else if (!om) cur = null
        }
        const cpuPlaced = placed.CPUExecutionProvider ?? (Object.keys(placed).length ? 0 : null)
        const webgpuPlaced = placed.WebGpuExecutionProvider ?? (Object.keys(placed).length ? 0 : null)
        const adapter = text.split('\n').filter((l) => /adapter|vendor|architecture|lavapipe|llvmpipe|swiftshader/i.test(l)).slice(0, 4).map((l) => l.slice(0, 300))
        const errors = text.split('\n').filter((l) => /\[E:|error|failed|Exception/i.test(l) && !/kernel not found/.test(l)).slice(0, 8).map((l) => l.slice(0, 400))
        const line = stdout.split('\n').find((l) => l.startsWith('RUN_ONE_RESULT '))
        const res = line ? JSON.parse(line.slice('RUN_ONE_RESULT '.length)) : { error: signal ? `killed (${signal}) after ${timeoutS} s` : `exit ${code}` }
        resolve({ ...res, webgpu: { kernelNotFound: notFound, nodesOnCpu: cpuPlaced, nodesOnWebgpu: webgpuPlaced, cpuOps, adapterLines: adapter, errorLines: res.error ? errors : errors.slice(0, 3), log: logPath } })
      })
    })
  })
}

async function runAll(ep) {
  const pins = readJson(join(DIR, 'pins.json'))
  const inspect = readJson(join(DIR, 'inspect.json'))
  const only = opt('--only')
  const timeoutS = Number(opt('--timeout', 300))
  const results = {}
  for (const job of plan(pins)) {
    if (only && job.key !== only) continue
    const t0 = performance.now()
    try {
      results[job.key] = ep === 'webgpu' ? await runChild(job, timeoutS) : await runJob(job, ep, pins, inspect)
    } catch (e) {
      results[job.key] = { ep, error: String(e.message ?? e).slice(0, 1500) }
    }
    for (const s of SESSIONS.splice(0)) await s.release?.()
    results[job.key].wallMs = Math.round(performance.now() - t0)
    const r = results[job.key]
    writeJson(join(DIR, `run-${ep}.json`), results) // after each model, so a crash or time-out keeps the rest
    log(`${ep} ${job.key}: ${r.error ? `ERROR ${r.error.slice(0, 300)}` : `time ${JSON.stringify(r.cpuMs)} finite ${r.outputsFinite} mask ${JSON.stringify(r.mask)}${r.vsCpu ? ` vsCpu ${JSON.stringify(r.vsCpu)}` : ''}`}${r.webgpu ? ` webgpu ${JSON.stringify({ nf: r.webgpu.kernelNotFound, cpu: r.webgpu.nodesOnCpu, gpu: r.webgpu.nodesOnWebgpu, cpuOps: r.webgpu.cpuOps })}` : ''}`)
  }
  writeJson(join(DIR, `run-${ep}.json`), results)
}

async function runOne() {
  const pins = readJson(join(DIR, 'pins.json'))
  const inspect = readJson(join(DIR, 'inspect.json'))
  const job = plan(pins).find((j) => j.key === opt('--only'))
  let res
  try {
    res = await runJob(job, job.ep ?? opt('--ep', 'webgpu'), pins, inspect)
  } catch (e) {
    res = { ep: opt('--ep'), error: String(e.message ?? e).slice(0, 1500) }
  }
  console.log(`RUN_ONE_RESULT ${JSON.stringify(res)}`)
  process.exit(0)
}

// ---------------------------------------------------------------------------------------------------------- report

function report() {
  const pins = readJson(join(DIR, 'pins.json'), { models: {} })
  const inspect = readJson(join(DIR, 'inspect.json'), { files: {} })
  const cpu = readJson(join(DIR, 'run-cpu.json'), {})
  const gpu = readJson(join(DIR, 'run-webgpu.json'), {})
  const tfl = readJson(join(DIR, 'tflite.json'))
  const evit = readJson(join(DIR, 'evit.json'))
  const L = ['## AI masks prep', '', `Pinned ${pins.at ?? '?'}. ORT lists: ${pins.ort?.tag ?? '?'}. CPU = onnxruntime-node 1.30.0 CPU EP; webgpu = onnxruntime-node 1.30.0 WebGPU EP (Dawn/Vulkan) on the runner's software Vulkan, if it came up.`, '']
  const all = {}
  for (const m of MODELS) {
    const p = pins.models[m.id] ?? {}
    const files = m.kind === 'evit' && evit?.onnx ? { ...p.files, fp32: { path: '(exported here)', local: evit.onnx, bytes: evit.onnxBytes, sha256: evit.onnxSha256 } } : (p.files ?? {})
    const fileRows = Object.entries(files).map(([v, f]) => {
      const ins = inspect.files?.[f.local] ?? null
      return {
        variant: v, path: f.path, bytes: f.bytes ?? f.downloadBytes ?? null, lfsSha256: f.lfsSha256 ?? null, sha256: f.sha256 ?? null, match: f.match ?? null, error: f.error ?? null,
        companions: (f.companions ?? []).map((c) => ({ path: c.path, bytes: c.bytes, lfsSha256: c.lfsSha256, sha256: c.sha256, match: c.match })),
        opset: ins?.opset ?? null, inputs: ins?.inputs ?? null, outputs: ins?.outputs ?? null, ops: ins?.ops ?? null,
        unsupportedNative: ins?.unsupportedNative ?? null, unsupportedJsep: ins?.unsupportedJsep ?? null, initializerTypes: ins?.initializerTypes ?? null, inspectError: ins?.error ?? null,
        notes: ins?.notes ?? null,
      }
    })
    const runs = Object.fromEntries(Object.entries(cpu).filter(([k]) => k.startsWith(`${m.id}/`)).map(([k, r]) => [k, { cpu: r, webgpu: gpu[k] ?? null, webgpuBasic: gpu[`${k}@basic`] ?? null }]))
    const res = { id: m.id, name: m.name, repo: p.repo, commit: p.commit, lastModified: p.lastModified, licence: p.licence, licenceTags: p.licenceTags, licenceLine: p.licenceLine, pinError: p.error ?? null, onnxListed: p.onnxListed, tflite: p.tflite, files: fileRows, runs }
    if (m.kind === 'selfie') res.tfliteCompare = tfl
    if (m.kind === 'evit') res.export = evit
    all[m.id] = res
    console.log(`MASKS_PREP_RESULT ${JSON.stringify(res)}`)

    L.push(`### ${m.name}`, '', `\`${p.repo ?? '?'}\` @ \`${p.commit ?? p.error ?? '?'}\` · lastModified ${p.lastModified ?? '?'} · licence ${p.licence ?? '—'} ${(p.licenceTags ?? []).join(' ')}`, '')
    L.push('| file | bytes | sha256 (download) | LFS match | opset | inputs | outputs | no native WebGPU kernel | not in JSEP doc |', '|---|---|---|---|---|---|---|---|---|')
    for (const f of fileRows) {
      const io = (xs) => (xs ? xs.map((x) => `${x.name} ${x.type} [${x.dims.join(',')}]`).join('<br>') : '—')
      L.push(`| ${f.variant} \`${f.path}\`${f.companions.length ? ` (+${f.companions.map((c) => `${c.path.split('/').pop()} ${c.bytes}`).join(', ')})` : ''} | ${f.bytes} | \`${f.sha256 ?? f.error}\` | ${f.match} | ${f.opset ? JSON.stringify(f.opset) : '—'} | ${io(f.inputs)} | ${io(f.outputs)} | ${f.unsupportedNative ? f.unsupportedNative.join(', ') || 'none' : '—'} | ${f.unsupportedJsep ? f.unsupportedJsep.join(', ') || 'none' : '—'} |`)
    }
    L.push('', '| run | CPU ms (timed run) | finite | mask coverage | WebGPU (software Vulkan) |', '|---|---|---|---|---|')
    for (const [k, r] of Object.entries(runs)) {
      const c = r.cpu
      const g = r.webgpu
      const gs = !g ? '—' : g.error ? `error: ${g.error.slice(0, 160)}` : `ran, finite ${g.outputsFinite}, max|Δ| vs CPU ${g.vsCpu?.maxAbsDiff ?? '—'}, no-kernel ${JSON.stringify(g.webgpu?.kernelNotFound ?? {})}`
      const b = r.webgpuBasic
      if (b) L.push(`| ${k} @basic | | | | ${b.error ? `error: ${b.error.slice(0, 160)}` : `ran, finite ${b.outputsFinite}, max|Δ| vs CPU ${b.vsCpu?.maxAbsDiff ?? '—'}`} |`)
      L.push(`| ${k} | ${c.error ? `error: ${c.error.slice(0, 200)}` : JSON.stringify(c.cpuMs)} | ${c.outputsFinite ?? '—'} | ${c.mask?.coverage ?? '—'} | ${gs} |`)
    }
    if (m.kind === 'selfie') L.push('', `TFLite comparison: ${tfl ? JSON.stringify(tfl.summary ?? tfl) : 'not run'}`)
    if (m.kind === 'evit') L.push('', `Export: ${evit ? JSON.stringify({ ok: !!evit.onnx, error: evit.error, repoCommit: evit.repoCommit, opset: evit.opset, torch: evit.torch, torchVsOrt: evit.torchVsOrt }) : 'not run'}`)
    L.push('')
  }
  writeJson(join(DIR, 'results.json'), all)
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) appendFileSync(summary, `${L.join('\n')}\n`)
}

// ---------------------------------------------------------------------------------------------------------- main

const cmd = args[0]
if (!DIR) throw new Error('--dir DIR is required')
if (cmd === 'pin') await pinAll()
else if (cmd === 'run') await runAll(opt('--ep', 'cpu'))
else if (cmd === 'run-one') await runOne()
else if (cmd === 'report') report()
else throw new Error('usage: masks-prep.mjs pin|run|report --dir DIR')
void ASSETS
