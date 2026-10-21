// Checks AI Remove's real model in Node, without a browser (docs/PHASE3.md Part 26). Run by the "AI models" workflow's
// moebius-check task on GitHub's servers, which can reach huggingface.co (this build machine can't).
//
//   node scripts/moebius-check.mjs [--files DIR] [--out DIR] [--backend node|wasm] [--threads N] [--manifest FILE]
//                                  [--strengths 1,0.99] [--cases bin,bollard] [--wasm-timing] [--summary FILE]
//
//   1. Downloads the three pinned files of web/models/manifest.json's Moebius entry from their commit-pinned Hugging
//      Face URLs (or reads them from --files DIR), streaming each to disk while hashing it, and checks its size and
//      SHA-256.
//   2. Lists each graph's inputs and outputs (expected: vae_encoder image [B,3,512,512] → moments [B,8,64,64]; unet
//      latent [B,9,64,64] + timesteps int64 [B] + input_ids int64 [B,10] → noise [B,4,64,64]; vae_decoder latent
//      [B,4,64,64] → image [B,3,512,512]) and the session creation times.
//   3. For each removal case of the committed test photo (scripts/fixtures/ai-remove/, a public-domain photo) and each
//      strength (default 1 and 0.99): THE APP'S OWN CODE, bundled for Node by Vite — the crop, the model input, the
//      sampling loop (src/ai/inpaint.ts), the stored patch's encoding (src/engine/develop/ai-patch.ts) and the spot's
//      rendering into the photo (src/engine/retouch/run.ts) — with ONNX Runtime's CPU kernels (onnxruntime-node by
//      default; the app's own onnxruntime-web WebAssembly with --backend wasm). It checks that every output is finite,
//      that the spot changed and that nothing outside it changed, and writes PNGs (input with the spot, the model's raw
//      512 × 512 output, the result) to --out for the run's artifact.
//   4. --wasm-timing: the app's CPU fallback speed (onnxruntime-web's WebAssembly, --threads threads): each graph's
//      session creation and one run, for the "slow" notice.
//
// Exit 1 on a size or hash mismatch, a graph that doesn't load or run, unexpected inputs or outputs, a non-finite
// output, a spot that didn't change, or a change outside the spot.

import { createHash } from 'node:crypto'
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'
import { MANIFEST, sourceUrl } from './models.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const FIXTURES = join(HERE, 'fixtures/ai-remove')

// ---- PNG (8-bit RGB/RGBA, no interlace) without a dependency

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (b) => {
  let c = 0xffffffff
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** PNG → { width, height, rgb } (8-bit RGB or RGBA input; alpha dropped). */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let o = 8
  let w = 0
  let h = 0
  let ct = 0
  const idat = []
  while (o < buf.length) {
    const len = buf.readUInt32BE(o)
    const type = buf.toString('latin1', o + 4, o + 8)
    const data = buf.subarray(o + 8, o + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      if (data[8] !== 8 || data[12] !== 0) throw new Error('only 8-bit, non-interlaced PNGs')
      ct = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    o += 12 + len
  }
  const bpp = ct === 2 ? 3 : ct === 6 ? 4 : 0
  if (!bpp) throw new Error('only RGB or RGBA PNGs')
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const px = new Uint8Array(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0
      const b = y ? px[(y - 1) * stride + x] : 0
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0
      let v = line[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      px[y * stride + x] = v & 255
    }
  }
  const rgb = new Uint8Array(w * h * 3)
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += bpp) {
    rgb[i] = px[j]
    rgb[i + 1] = px[j + 1]
    rgb[i + 2] = px[j + 2]
  }
  return { width: w, height: h, rgb }
}

/** { width, height, rgb } → PNG bytes. */
export function encodePng(width, height, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc(height * (width * 3 + 1))
  for (let y = 0; y < height; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ---- small helpers (exported for the unit test)

/** min, max, mean of the finite values, and the count of non-finite ones. */
export function stats(d) {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let finite = 0
  for (let i = 0; i < d.length; i++) {
    const v = d[i]
    if (!Number.isFinite(v)) continue
    finite++
    sum += v
    if (v < min) min = v
    if (v > max) max = v
  }
  return { count: d.length, nonFinite: d.length - finite, min, max, mean: finite ? sum / finite : NaN }
}

/** Expected inputs and outputs of each graph (names; shapes with B the free batch). */
export const EXPECTED = {
  vae_encoder: { inputs: { image: ['float32', 3, 512, 512] }, outputs: { moments: ['float32', 8, 64, 64] } },
  unet: { inputs: { latent: ['float32', 9, 64, 64], timesteps: ['int64'], input_ids: ['int64', 10] }, outputs: { noise: ['float32', 4, 64, 64] } },
  vae_decoder: { inputs: { latent: ['float32', 4, 64, 64] }, outputs: { image: ['float32', 3, 512, 512] } },
}

/** Problems with a graph's declared inputs and outputs ([] when as expected). Metadata as ONNX Runtime gives it. */
export function ioProblems(part, inputs, outputs) {
  const exp = EXPECTED[part]
  const out = []
  const check = (kind, list, want) => {
    for (const [name, [type, ...dims]] of Object.entries(want)) {
      const m = list.find((x) => x.name === name)
      if (!m) {
        out.push(`${part}: no ${kind} named ${name}`)
        continue
      }
      if (m.type && m.type !== type) out.push(`${part}: ${kind} ${name} is ${m.type}, expected ${type}`)
      const shape = m.shape ?? []
      const rest = shape.slice(1)
      if (shape.length && dims.length && (rest.length !== dims.length || rest.some((v, i) => typeof v === 'number' && v !== dims[i]))) out.push(`${part}: ${kind} ${name} has shape [${shape.join(', ')}], expected [B, ${dims.join(', ')}]`)
    }
  }
  check('input', inputs, exp.inputs)
  check('output', outputs, exp.outputs)
  return out
}

const arg = (args, name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const ms = (t) => `${Math.round(t).toLocaleString('en')} ms`
const sec = (t) => `${(t / 1000).toFixed(1)} s`

/** Downloads a pinned file to disk while hashing it; returns its size and SHA-256 and the time taken. */
async function downloadTo(url, dest, tries = 4) {
  for (let i = 1; ; i++) {
    const t0 = performance.now()
    try {
      const r = await fetch(url, { redirect: 'follow' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const hash = createHash('sha256')
      const file = createWriteStream(dest)
      let n = 0
      for await (const piece of r.body) {
        hash.update(piece)
        n += piece.length
        if (!file.write(piece)) await new Promise((ok) => file.once('drain', ok))
      }
      await new Promise((ok, no) => file.end((e) => (e ? no(e) : ok())))
      return { bytes: n, sha256: hash.digest('hex'), ms: performance.now() - t0 }
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`)
      await new Promise((ok) => setTimeout(ok, 2000 * 2 ** i))
    }
  }
}

function sha256File(p) {
  const h = createHash('sha256')
  h.update(readFileSync(p))
  return h.digest('hex')
}

/** The app's own code, bundled for Node by Vite (SSR build, no app config), as models-check.mjs does. */
async function loadAppCode() {
  const { build } = await import('vite')
  const outDir = join(WEB, 'node_modules/.cache/moebius-check')
  const src = join(WEB, 'src').replace(/\\/g, '/')
  const ENTRY = '\0moebius-check-entry'
  await build({
    configFile: false,
    root: WEB,
    logLevel: 'warn',
    plugins: [
      {
        name: 'moebius-check',
        enforce: 'pre',
        resolveId: (id) => (id === 'moebius-check-entry' ? ENTRY : null),
        load(id) {
          if (id !== ENTRY) return null
          return [
            `export * as inpaint from '${src}/ai/inpaint.ts'`,
            `export * as patch from '${src}/engine/develop/ai-patch.ts'`,
            `export { normalizeSpot, spotPixels, spotBounds, clipRect } from '${src}/engine/develop/spots.ts'`,
            `export { runSpots, tilesNeeded } from '${src}/engine/retouch/run.ts'`,
            `export { rasterize } from '${src}/engine/retouch/plan.ts'`,
            `export { TileImage, tileRect, tilesAcross } from '${src}/engine/retouch/tiles.ts'`,
            `export { floatToHalf } from '${src}/engine/retouch/half.ts'`,
            `export { SRGB_TO_REC2020, REC2020_TO_SRGB } from '${src}/engine/color/matrix.ts'`,
          ].join('\n')
        },
      },
    ],
    build: {
      ssr: true,
      outDir,
      emptyOutDir: true,
      minify: false,
      copyPublicDir: false,
      rollupOptions: { input: { 'app-code': 'moebius-check-entry' }, output: { entryFileNames: '[name].mjs' } },
    },
  })
  return import(`${pathToFileURL(join(outDir, 'app-code.mjs')).href}?t=${Date.now()}`)
}

/** ONNX Runtime sessions for the three graphs, as a MoebiusRunner (src/ai/inpaint.ts). */
async function makeRunner(ort, paths, opts, log) {
  const sessions = {}
  const created = {}
  for (const part of ['vae_encoder', 'unet', 'vae_decoder']) {
    const t0 = performance.now()
    sessions[part] = await ort.InferenceSession.create(opts.fromBuffer ? new Uint8Array(readFileSync(paths[part])) : paths[part], opts.session)
    created[part] = performance.now() - t0
    log(`${part}: session created in ${ms(created[part])}`)
  }
  const run = async (part, feeds) => {
    const s = sessions[part]
    const out = await s.run(feeds)
    const t = out[s.outputNames[0]]
    const data = t.data instanceof Float32Array ? t.data : Float32Array.from(t.data)
    return data
  }
  return {
    sessions,
    created,
    runner: {
      encode: (image) => run('vae_encoder', { image: new ort.Tensor('float32', image, [1, 3, 512, 512]) }),
      unet: (latent, timesteps, ids) => run('unet', { latent: new ort.Tensor('float32', latent, [2, 9, 64, 64]), timesteps: new ort.Tensor('int64', timesteps, [2]), input_ids: new ort.Tensor('int64', ids, [2, 10]) }),
      decode: (latent) => run('vae_decoder', { latent: new ort.Tensor('float32', latent, [1, 4, 64, 64]) }),
    },
    release: async () => {
      for (const s of Object.values(sessions)) await s.release().catch(() => {})
    },
  }
}

/** sRGB bytes → linear Rec.2020 (the app's scene values). */
function toScene(app, rgb) {
  const out = new Float32Array(rgb.length)
  const m = app.SRGB_TO_REC2020
  const lin = Float32Array.from({ length: 256 }, (_, i) => app.patch.srgbToLinear(i / 255))
  for (let i = 0; i < rgb.length; i += 3) {
    const r = lin[rgb[i]]
    const g = lin[rgb[i + 1]]
    const b = lin[rgb[i + 2]]
    out[i] = m[0] * r + m[1] * g + m[2] * b
    out[i + 1] = m[3] * r + m[4] * g + m[5] * b
    out[i + 2] = m[6] * r + m[7] * g + m[8] * b
  }
  return out
}

/** Linear Rec.2020 → sRGB bytes. */
function toSrgb8(app, v) {
  const out = new Uint8Array(v.length)
  const m = app.REC2020_TO_SRGB
  for (let i = 0; i < v.length; i += 3) {
    const r = m[0] * v[i] + m[1] * v[i + 1] + m[2] * v[i + 2]
    const g = m[3] * v[i] + m[4] * v[i + 1] + m[5] * v[i + 2]
    const b = m[6] * v[i] + m[7] * v[i + 1] + m[8] * v[i + 2]
    out[i] = Math.round(app.patch.linearToSrgb(r) * 255)
    out[i + 1] = Math.round(app.patch.linearToSrgb(g) * 255)
    out[i + 2] = Math.round(app.patch.linearToSrgb(b) * 255)
  }
  return out
}

/** The scene as the GPU holds it (RGBA halves in 256 × 256 tiles), every tile. */
function sceneTiles(app, scene, w, h) {
  const tiles = []
  const n = app.tilesAcross(w) * Math.ceil(h / 256)
  for (let idx = 0; idx < n; idx++) {
    const r = app.tileRect(idx, w, h)
    const tw = r.x1 - r.x0
    const th = r.y1 - r.y0
    const data = new Uint16Array(tw * th * 4)
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const s = ((r.y0 + y) * w + r.x0 + x) * 3
        const d = (y * tw + x) * 4
        data[d] = app.floatToHalf(scene[s])
        data[d + 1] = app.floatToHalf(scene[s + 1])
        data[d + 2] = app.floatToHalf(scene[s + 2])
        data[d + 3] = app.floatToHalf(1)
      }
    }
    tiles.push({ idx, data })
  }
  return tiles
}

/** CHW −1…1 picture → sRGB bytes (interleaved). */
function chwToRgb8(chw, size) {
  const plane = size * size
  const out = new Uint8Array(plane * 3)
  for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(Math.min(1, Math.max(0, (chw[c * plane + i] + 1) / 2)) * 255)
  return out
}

/** Draws the outline of a mask (1 = in) over an RGB image in red. */
function outline(rgb, w, h, inside) {
  const out = rgb.slice()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue
      if (inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1)) continue
      const i = (y * w + x) * 3
      out[i] = 255
      out[i + 1] = 0
      out[i + 2] = 0
    }
  }
  return out
}

function crop8(rgb, w, r) {
  const cw = r.x1 - r.x0
  const out = new Uint8Array(cw * (r.y1 - r.y0) * 3)
  for (let y = r.y0; y < r.y1; y++) out.set(rgb.subarray((y * w + r.x0) * 3, (y * w + r.x1) * 3), (y - r.y0) * cw * 3)
  return out
}

async function main(args) {
  const filesDir = arg(args, '--files')
  const outDir = arg(args, '--out') ?? join(WEB, 'node_modules/.cache/moebius-check-out')
  const backend = arg(args, '--backend') ?? 'node'
  const threads = Math.max(1, Number(arg(args, '--threads') ?? Math.min(4, availableParallelism())))
  const strengths = (arg(args, '--strengths') ?? '1,0.99').split(',').map(Number)
  const only = arg(args, '--cases')?.split(',')
  const summaryFile = arg(args, '--summary') ?? process.env.GITHUB_STEP_SUMMARY
  const gha = !!process.env.GITHUB_ACTIONS
  const failures = []
  const md = []
  const fail = (msg) => {
    failures.push(msg)
    console.log(gha ? `::error::${msg}` : `FAIL ${msg}`)
  }
  const log = (s) => console.log(s)
  mkdirSync(outDir, { recursive: true })

  const manifest = JSON.parse(readFileSync(arg(args, '--manifest') ?? MANIFEST, 'utf8'))
  const m = manifest.models.find((x) => x.task === 'inpaint')
  if (!m) throw new Error('no inpainting model in the manifest')
  log(`${m.id}: ${m.source.repo} @ ${m.source.revision}`)
  md.push('## AI Remove: Moebius check', '', `\`${m.source.repo}\` @ \`${m.source.revision}\`, node ${process.version}, backend ${backend === 'node' ? 'onnxruntime-node (CPU)' : `onnxruntime-web WebAssembly (${threads} threads)`}.`, '')

  // 1. The files.
  const dir = filesDir ?? join(WEB, 'node_modules/.cache/moebius-files')
  mkdirSync(dir, { recursive: true })
  const paths = {}
  md.push('### Files', '', '| file | bytes | SHA-256 | download |', '|---|---|---|---|')
  for (const f of m.files) {
    const p = join(dir, f.path)
    paths[f.part] = p
    let got
    if (filesDir && existsSync(p)) {
      got = { bytes: statSync(p).size, sha256: sha256File(p), ms: 0 }
    } else {
      log(`downloading ${sourceUrl(m, f)}`)
      got = await downloadTo(sourceUrl(m, f), p)
    }
    const ok = got.bytes === f.bytes && got.sha256 === f.sha256
    log(`${ok ? 'ok' : 'MISMATCH'} ${f.path}: ${got.bytes} bytes, sha256 ${got.sha256}${got.ms ? `, downloaded in ${sec(got.ms)} (${(got.bytes / 1e6 / (got.ms / 1000)).toFixed(0)} MB/s)` : ''}`)
    md.push(`| ${f.path} | ${got.bytes.toLocaleString('en')} | ${ok ? 'ok' : `**mismatch** (${got.sha256})`} | ${got.ms ? sec(got.ms) : 'local'} |`)
    if (!ok) fail(`${f.path}: ${got.bytes} bytes sha256 ${got.sha256}, expected ${f.bytes} ${f.sha256}`)
  }
  md.push('')
  if (failures.length) return finish()

  // 2. The runtime and the graphs.
  const t0 = performance.now()
  const app = await loadAppCode()
  log(`app code bundled from web/src in ${ms(performance.now() - t0)}`)
  let ort
  let sessionOpts
  if (backend === 'node') {
    ort = await import('onnxruntime-node')
    sessionOpts = { executionProviders: ['cpu'], graphOptimizationLevel: 'all', logSeverityLevel: 3 }
  } else {
    ort = await import('onnxruntime-web')
    ort.env.wasm.numThreads = threads
    ort.env.logLevel = 'error'
    sessionOpts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 }
  }
  log(`ONNX Runtime ${ort.env.versions?.node ?? ort.env.versions?.web ?? '?'}`)
  let R
  try {
    R = await makeRunner(ort, paths, { session: sessionOpts, fromBuffer: backend !== 'node' }, log)
  } catch (e) {
    fail(`a graph doesn't load: ${e.message}`)
    return finish()
  }
  md.push('### Graphs', '', '| graph | inputs → outputs | session |', '|---|---|---|')
  for (const part of ['vae_encoder', 'unet', 'vae_decoder']) {
    const s = R.sessions[part]
    const meta = (names, list) => names.map((name, k) => ({ name, type: list?.[k]?.type, shape: list?.[k]?.shape }))
    const ins = meta(s.inputNames, s.inputMetadata)
    const outs = meta(s.outputNames, s.outputMetadata)
    const text = (l) => l.map((x) => `${x.name} ${x.type ?? '?'} [${(x.shape ?? []).join(', ')}]`).join(', ')
    log(`${part}: ${text(ins)} -> ${text(outs)}`)
    for (const p of ioProblems(part, ins, outs)) fail(p)
    md.push(`| ${part} | ${text(ins)} → ${text(outs)} | ${ms(R.created[part])} |`)
  }
  md.push('')
  if (failures.length) return finish()

  // 3. The removal cases through the app's own code.
  const fixture = JSON.parse(readFileSync(join(FIXTURES, 'cases.json'), 'utf8'))
  const photo = decodePng(readFileSync(join(FIXTURES, fixture.photo)))
  const { width: w, height: h } = photo
  const scene = toScene(app, photo.rgb)
  const before8 = toSrgb8(app, scene)
  log(`test photo ${fixture.photo}: ${w} x ${h}`)
  md.push('### Removals (the app’s own code, CPU)', '', `Photo: \`${fixture.photo}\` (${w} × ${h}). ${fixture.source}`, '', `Seed ${fixture.seed}, ${app.inpaint.STEPS} steps, guidance ${app.inpaint.GUIDANCE}.`, '',
    '| case | strength | crop → model | encode | step (mean) | decode | total | finite | spot changed (mean / max, 8-bit) | outside changed | patch (chars) | spot vs ring colour (8-bit) | resemblance to the removed object |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  const results = []
  const sheets = {}
  for (const c of fixture.cases) {
    if (only && !only.includes(c.name)) continue
    const spot = app.normalizeSpot({ id: c.name, mode: 'ai', points: c.points.map(([x, y]) => [x / w, y / h]), size: c.radius / Math.min(w, h), feather: 0.25, opacity: 1, offset: [0, 0], seed: fixture.seed })
    const px = app.spotPixels(spot, w, h)
    const bounds = app.clipRect(app.spotBounds(px), w, h)
    const crop = app.inpaint.contextRect(bounds, w, h)
    const cw = crop.x1 - crop.x0
    const chh = crop.y1 - crop.y0
    const cropScene = new Float32Array(cw * chh * 3)
    for (let y = 0; y < chh; y++) cropScene.set(scene.subarray(((crop.y0 + y) * w + crop.x0) * 3, ((crop.y0 + y) * w + crop.x1) * 3), y * cw * 3)
    const prep = app.inpaint.prepare(cropScene, crop, px, w, h)
    log(`\n-- ${c.name}: ${c.what}; crop ${cw} x ${chh} at (${crop.x0}, ${crop.y0}), scale ${prep.fit.scale.toFixed(3)}, gain ${prep.gain.toFixed(3)}, hole ${prep.holePixels} px`)
    writeFileSync(join(outDir, `${c.name}-input.png`), encodePng(512, 512, outline(chwToRgb8(prep.image, 512), 512, 512, (x, y) => x >= 0 && y >= 0 && x < 512 && y < 512 && prep.hole[y * 512 + x] > 0)))
    for (const strength of strengths) {
      const tag = `${c.name}-s${strength}`
      const tr = performance.now()
      let gen
      try {
        gen = await app.inpaint.generate(R.runner, prep, { seed: fixture.seed, strength, onStep: (i, n, t) => log(`  step ${i}/${n}: ${ms(t)}`) })
      } catch (e) {
        fail(`${tag}: the model didn't run: ${e.message}`)
        continue
      }
      const total = performance.now() - tr
      const st = app.inpaint.allFinite(gen.image)
      if (!st) fail(`${tag}: non-finite values in the decoded picture`)
      writeFileSync(join(outDir, `${tag}-model.png`), encodePng(512, 512, chwToRgb8(gen.image, 512)))
      // The patch as the edit stores it, and the photo with the spot drawn by the retouch code.
      const ex = app.inpaint.extractPatch(gen.image, prep, px, w, h)
      const data = await app.patch.encodePatch(ex.rgb, ex.width, ex.height)
      const ai = app.patch.normalizeAiFill({ model: m.id, modelVersion: `${m.source.revision.slice(0, 7)}/fp32`, runtime: `check ${backend}`, seed: fixture.seed, steps: app.inpaint.STEPS, strength, guidance: app.inpaint.GUIDANCE, rect: ex.rect, gain: prep.gain, width: ex.width, height: ex.height, encoding: app.patch.PATCH_ENCODING, data })
      if (!ai) {
        fail(`${tag}: the stored patch doesn't pass its own checks`)
        continue
      }
      const back = app.patch.decodePatchBytes(ai)
      if (!back || back.some((v, i) => v !== ex.rgb[i])) fail(`${tag}: the stored patch doesn't decode to itself`)
      const withAi = app.normalizeSpot({ ...spot, ai })
      const img = new app.TileImage(w, h, sceneTiles(app, scene, w, h))
      app.runSpots(img, [withAi], { canonical: null, completions: new Map() })
      const after = img.read({ x0: 0, y0: 0, x1: w, y1: h })
      const after8 = toSrgb8(app, after)
      writeFileSync(join(outDir, `${tag}-result.png`), encodePng(w, h, after8))
      const zoom = app.clipRect({ x0: crop.x0, y0: crop.y0, x1: crop.x1, y1: crop.y1 }, w, h)
      writeFileSync(join(outDir, `${tag}-result-crop.png`), encodePng(zoom.x1 - zoom.x0, zoom.y1 - zoom.y0, crop8(after8, w, zoom)))
      // Inside vs outside the spot (the brush's own coverage, as the retouch code computes it), and how the spot's
      // mean colour compares with a ring around it (lower: it blends in).
      const cov = app.rasterize(px, [px.points], { x0: 0, y0: 0, x1: w, y1: h })
      const ringCov = app.rasterize({ ...px, radius: px.radius + 16, feather: 0 }, [px.points], { x0: 0, y0: 0, x1: w, y1: h })
      const alpha = cov
      let inN = 0
      let inSum = 0
      let inMax = 0
      let outMax = 0
      let outN = 0
      const spotMean = [0, 0, 0]
      const ringMean = [0, 0, 0]
      let ringN = 0
      for (let i = 0; i < w * h; i++) {
        let dmax = 0
        let dsum = 0
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(after8[i * 3 + k] - before8[i * 3 + k])
          dmax = Math.max(dmax, d)
          dsum += d
        }
        if (alpha[i] > 0) {
          inN++
          inSum += dsum / 3
          inMax = Math.max(inMax, dmax)
          for (let k = 0; k < 3; k++) spotMean[k] += after8[i * 3 + k]
        } else {
          if (dmax) {
            outN++
            outMax = Math.max(outMax, dmax)
          }
          if (ringCov[i] > 0) {
            ringN++
            for (let k = 0; k < 3; k++) ringMean[k] += after8[i * 3 + k]
          }
        }
      }
      const blendIn = Math.hypot(...spotMean.map((v, k) => v / Math.max(1, inN) - ringMean[k] / Math.max(1, ringN)))
      // How much the spot still looks like what was removed: the correlation of the result's and the original's
      // luminance over the spot (1: the same picture; around 0: unrelated).
      const lum = (a, i) => 0.2126 * a[i * 3] + 0.7152 * a[i * 3 + 1] + 0.0722 * a[i * 3 + 2]
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0
      for (let i = 0; i < w * h; i++) {
        if (!(alpha[i] > 0)) continue
        const a = lum(after8, i)
        const b = lum(before8, i)
        sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b
      }
      const nn = Math.max(1, inN)
      const resemblance = (sab / nn - (sa / nn) * (sb / nn)) / Math.sqrt(Math.max(1e-9, (saa / nn - (sa / nn) ** 2) * (sbb / nn - (sb / nn) ** 2)))
      sheets[c.name] ??= { crop: zoom, parts: [outline(crop8(before8, w, zoom), zoom.x1 - zoom.x0, zoom.y1 - zoom.y0, (x, y) => x >= 0 && y >= 0 && x < zoom.x1 - zoom.x0 && y < zoom.y1 - zoom.y0 && alpha[(zoom.y0 + y) * w + zoom.x0 + x] > 0)] }
      sheets[c.name].parts.push(crop8(after8, w, zoom))
      const inMean = inSum / Math.max(1, inN)
      if (inMean < 2) fail(`${tag}: the spot hardly changed (mean ${inMean.toFixed(2)} levels)`)
      if (outN) fail(`${tag}: ${outN} pixels outside the spot changed (up to ${outMax} levels)`)
      const steps = gen.ms.steps
      const mean = steps.reduce((a, b) => a + b, 0) / steps.length
      const s = stats(gen.image)
      log(`  ${tag}: encode ${ms(gen.ms.encode)}, steps ${steps.length} x ${ms(mean)}, decode ${ms(gen.ms.decode)}, total ${sec(total)}; decoded min ${s.min.toFixed(3)} max ${s.max.toFixed(3)}, finite ${st}; spot changed mean ${inMean.toFixed(1)} max ${inMax}; outside changed ${outN}; patch ${ex.width} x ${ex.height}, ${data.length} chars`)
      results.push({ case: c.name, strength, total, mean, encode: gen.ms.encode, decode: gen.ms.decode, inMean, inMax, outN, blendIn, resemblance, chars: data.length, finite: st })
      md.push(`| ${c.name} | ${strength} | ${cw}×${chh} → ${prep.fit.cwS}×${prep.fit.chS} | ${ms(gen.ms.encode)} | ${ms(mean)} × ${steps.length} | ${ms(gen.ms.decode)} | ${sec(total)} | ${st ? 'yes' : '**no**'} | ${inMean.toFixed(1)} / ${inMax} | ${outN ? `**${outN} px**` : 'none'} | ${data.length.toLocaleString('en')} (${ex.width}×${ex.height}) | ${blendIn.toFixed(1)} | ${resemblance.toFixed(3)} |`)
    }
  }
  // One picture per case: the original with the spot outlined, then the result at each strength, side by side.
  for (const [name, sh] of Object.entries(sheets)) {
    const cw = sh.crop.x1 - sh.crop.x0
    const ch = sh.crop.y1 - sh.crop.y0
    const n = sh.parts.length
    const gap = 8
    const W = n * cw + (n - 1) * gap
    const out = new Uint8Array(W * ch * 3).fill(255)
    sh.parts.forEach((part, k) => {
      for (let y = 0; y < ch; y++) out.set(part.subarray(y * cw * 3, (y + 1) * cw * 3), (y * W + k * (cw + gap)) * 3)
    })
    writeFileSync(join(outDir, `sheet-${name}.png`), encodePng(W, ch, out))
  }
  md.push('', `Images (input with the spot outlined, the model’s 512 × 512 output, the result and its crop; \`sheet-<case>.png\`: original, then strength ${strengths.join(', then ')}) are in the run’s **moebius-check** artifact. “Resemblance” is the correlation of the spot’s luminance with the original’s (1: the object is still there).`, '')
  await R.release()

  // 4. The CPU fallback's speed: the app's own runtime (onnxruntime-web WebAssembly) in Node.
  if (args.includes('--wasm-timing')) {
    log(`\n-- WebAssembly timing (onnxruntime-web, ${threads} threads)`)
    const web = await import('onnxruntime-web')
    web.env.wasm.numThreads = threads
    web.env.logLevel = 'error'
    md.push(`### CPU fallback speed (onnxruntime-web WebAssembly, ${threads} threads, in Node)`, '', '| graph | session | one run |', '|---|---|---|')
    const feeds = {
      vae_encoder: () => ({ image: new web.Tensor('float32', new Float32Array(3 * 512 * 512), [1, 3, 512, 512]) }),
      unet: () => ({ latent: new web.Tensor('float32', new Float32Array(2 * 9 * 64 * 64).map((_, i) => Math.sin(i)), [2, 9, 64, 64]), timesteps: new web.Tensor('int64', new BigInt64Array([500n, 500n]), [2]), input_ids: new web.Tensor('int64', BigInt64Array.from({ length: 20 }, (_, i) => BigInt(i < 10 ? i + 10 : i - 10)), [2, 10]) }),
      vae_decoder: () => ({ latent: new web.Tensor('float32', new Float32Array(4 * 64 * 64).map((_, i) => Math.cos(i)), [1, 4, 64, 64]) }),
    }
    for (const part of ['vae_encoder', 'unet', 'vae_decoder']) {
      try {
        const t1 = performance.now()
        const s = await web.InferenceSession.create(new Uint8Array(readFileSync(paths[part])), { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 })
        const created = performance.now() - t1
        const t2 = performance.now()
        const out = await s.run(feeds[part]())
        const runMs = performance.now() - t2
        const o = out[s.outputNames[0]]
        const fin = stats(o.data).nonFinite === 0
        log(`${part}: session ${ms(created)}, run ${ms(runMs)}, finite ${fin}`)
        md.push(`| ${part} | ${ms(created)} | ${ms(runMs)}${fin ? '' : ' (**non-finite**)'} |`)
        await s.release()
      } catch (e) {
        log(`${part}: WebAssembly failed: ${e.message}`)
        md.push(`| ${part} | failed: ${String(e.message).slice(0, 120)} | |`)
      }
    }
    md.push('', 'One AI Remove spot runs the encoder once, the denoiser 20 times and the decoder once.', '')
  }
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 1))
  return finish()

  function finish() {
    md.push(failures.length ? `**${failures.length} problem(s):**\n\n${failures.map((f) => `- ${f}`).join('\n')}` : '**RESULT: all checks passed.**', '')
    const text = md.join('\n')
    if (summaryFile) appendFileSync(summaryFile, `${text}\n`)
    writeFileSync(join(outDir, 'summary.md'), `${text}\n`)
    console.log(failures.length ? `\nRESULT: ${failures.length} problem(s)` : '\nRESULT: all checks passed')
    return failures.length ? 1 : 0
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.error(e.stack ?? e.message)
    process.exit(1)
  })
}
