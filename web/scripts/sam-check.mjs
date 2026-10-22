// Checks Object select's real model in Node, without a browser (docs/PHASE3.md Part 27). Run by the "AI models"
// workflow's sam-check task on GitHub's servers, which can reach huggingface.co (this build machine can't).
//
//   node scripts/sam-check.mjs [--files DIR] [--out DIR] [--variants fp16,fp32] [--threads N] [--backend wasm|node]
//                              [--manifest FILE] [--summary FILE]
//
//   1. Downloads every pinned file of web/models/manifest.json's SAM 2.1 Hiera Tiny entry (the graphs and their weights
//      files) from their commit-pinned Hugging Face URLs (or reads them from --files DIR), checking size and SHA-256.
//   2. Lists each graph's inputs and outputs against the export's (pixel_values → image_embeddings.0/.1/.2; the
//      prompt decoder's points, labels, boxes and embeddings → iou_scores, pred_masks, object_score_logits).
//   3. Runs THE APP'S OWN pre- and post-processing (src/ai/segment.ts: the 1024² input, the prompt, the best mask, the
//      matte in the sensor frame; src/engine/develop/depth-map.ts: the stored encoding), bundled for Node by Vite, with
//      ONNX Runtime's CPU kernels: by default the app's own onnxruntime-web WebAssembly (its CPU fallback), --threads
//      threads. On the committed public-domain photo (scripts/fixtures/ai-masks/astronaut.png), the point prompt
//      (110, 330) on the suit that MASKS_PREP.md's run used (coverage 0.2246, predicted IoU 0.836 there), then a
//      removed point, an added point and a box (both ways the app can give a box). Checks every output is finite,
//      that the suit's selection covers about what that run found, and writes the mattes and overlays as PNGs to --out
//      (the run's artifact) and the suit's matte as raw bytes for the parity step (scripts/sam-parity.py).
//   4. Times the CPU fallback: session creation, the encoder (twice: the first run includes warm-up) and the decoder
//      (mean of five), against the owner's 15 s rule for a heavy model's CPU fallback (AI masks decision 7).
//
// Exit 1 on a size or hash mismatch, a graph that doesn't load or run, unexpected inputs or outputs, a non-finite
// output, or a suit selection far from the one MASKS_PREP.md found.

import { createHash } from 'node:crypto'
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { decodePng, encodePng } from './moebius-check.mjs'
import { MANIFEST, sourceUrl } from './models.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const PHOTO = join(HERE, 'fixtures/ai-masks/astronaut.png')
/** MASKS_PREP.md (run 39653265084, fp32 and fp16 on the CPU): the suit point's mask. */
export const REFERENCE = { point: [110, 330], coverage: 0.2246, iou: 0.836 }
export const CPU_LIMIT_MS = 15_000

/** Expected inputs and outputs (names; shapes after the free batch; null: any). */
export const EXPECTED = {
  encoder: { inputs: { pixel_values: ['float32', 3, 1024, 1024] }, outputs: { 'image_embeddings.0': ['float32', 32, 256, 256], 'image_embeddings.1': ['float32', 64, 128, 128], 'image_embeddings.2': ['float32', null, null, null] } },
  decoder: {
    inputs: { input_points: ['float32', 1, null, 2], input_labels: ['int64', 1, null], input_boxes: ['float32', null, 4], 'image_embeddings.0': ['float32', 32, 256, 256], 'image_embeddings.1': ['float32', 64, 128, 128], 'image_embeddings.2': ['float32', 256, 64, 64] },
    outputs: { iou_scores: ['float32', null, 3], pred_masks: ['float32', null, null, null, null], object_score_logits: ['float32', null, 1] },
  },
}

/** Problems with a graph's declared inputs and outputs ([] when as expected). */
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
      const rest = (m.shape ?? []).slice(1)
      if (m.shape?.length && (rest.length !== dims.length || rest.some((v, i) => dims[i] !== null && typeof v === 'number' && v !== dims[i]))) out.push(`${part}: ${kind} ${name} has shape [${m.shape.join(', ')}], expected [B, ${dims.map((d) => d ?? '*').join(', ')}]`)
    }
  }
  check('input', inputs, exp.inputs)
  check('output', outputs, exp.outputs)
  return out
}

/** Intersection over union of two binary masks (≥ 128 counts as in). */
export function iouOf(a, b) {
  let i = 0
  let u = 0
  for (let k = 0; k < a.length; k++) {
    const x = a[k] >= 128
    const y = b[k] >= 128
    if (x && y) i++
    if (x || y) u++
  }
  return u ? i / u : 1
}

/** The centroid (x, y) and the bounding box of a matte's selection (≥ 128), in pixels. */
export function selectionGeometry(px, w, h) {
  let n = 0
  let sx = 0
  let sy = 0
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[y * w + x] < 128) continue
      n++
      sx += x
      sy += y
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  return n ? { centroid: [sx / n, sy / n], box: [x0, y0, x1 + 1, y1 + 1], pixels: n } : null
}

/** The photo with the matte tinted red over it and the prompt's points drawn (green adds, blue removes). */
function overlayPng(rgb, w, h, matte, points = [], box = null) {
  const out = Uint8Array.from(rgb)
  for (let i = 0; i < w * h; i++) {
    const a = (matte[i] / 255) * 0.55
    out[i * 3] = Math.round(out[i * 3] * (1 - a) + 255 * a)
    out[i * 3 + 1] = Math.round(out[i * 3 + 1] * (1 - a))
    out[i * 3 + 2] = Math.round(out[i * 3 + 2] * (1 - a))
  }
  const dot = (x, y, c) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const X = Math.round(x) + dx
      const Y = Math.round(y) + dy
      if (X < 0 || Y < 0 || X >= w || Y >= h || dx * dx + dy * dy > 16) continue
      out.set(c, (Y * w + X) * 3)
    }
  }
  for (const [x, y, l] of points) dot(x, y, l ? [0, 255, 0] : [0, 120, 255])
  if (box) {
    for (let x = Math.round(box[0]); x < Math.round(box[2]); x++) for (const y of [Math.round(box[1]), Math.round(box[3]) - 1]) if (y >= 0 && y < h && x >= 0 && x < w) out.set([255, 255, 0], (y * w + x) * 3)
    for (let y = Math.round(box[1]); y < Math.round(box[3]); y++) for (const x of [Math.round(box[0]), Math.round(box[2]) - 1]) if (y >= 0 && y < h && x >= 0 && x < w) out.set([255, 255, 0], (y * w + x) * 3)
  }
  return encodePng(w, h, out)
}

const arg = (args, name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const ms = (t) => `${Math.round(t).toLocaleString('en')} ms`

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

/** The app's own code, bundled for Node by Vite (SSR build, no app config), as models-check.mjs does. */
async function loadAppCode() {
  const { build } = await import('vite')
  const outDir = join(WEB, 'node_modules/.cache/sam-check')
  const src = join(WEB, 'src').replace(/\\/g, '/')
  const ENTRY = '\0sam-check-entry'
  await build({
    configFile: false,
    root: WEB,
    logLevel: 'warn',
    plugins: [
      {
        name: 'sam-check',
        enforce: 'pre',
        resolveId: (id) => (id === 'sam-check-entry' ? ENTRY : null),
        load(id) {
          if (id !== ENTRY) return null
          return [
            `export * as segment from '${src}/ai/segment.ts'`,
            `export { encodeDepth, decodeRaster } from '${src}/engine/develop/depth-map.ts'`,
            `export { resolveGeometry, DEFAULT_GEOMETRY } from '${src}/engine/develop/geometry.ts'`,
          ].join('\n')
        },
      },
      {
        // segment.ts imports ai/depth.ts for its resize, which imports the runtime (a worker): never run here.
        name: 'sam-check-runtime-stub',
        enforce: 'pre',
        resolveId: (id, importer) => (importer && /src\/ai\/depth\.ts$/.test(importer) && id === './runtime' ? '\0sam-check-runtime' : null),
        load: (id) => (id === '\0sam-check-runtime' ? 'export const prepareModel = () => { throw new Error("not in sam-check") }; export const runModel = prepareModel' : null),
      },
    ],
    build: {
      ssr: true,
      outDir,
      emptyOutDir: true,
      minify: false,
      copyPublicDir: false,
      rollupOptions: { input: { 'app-code': 'sam-check-entry' }, output: { entryFileNames: '[name].mjs' } },
    },
  })
  return import(`${pathToFileURL(join(outDir, 'app-code.mjs')).href}?t=${Date.now()}`)
}

const base = (p) => p.slice(p.lastIndexOf('/') + 1)

async function main(args) {
  const filesDir = arg(args, '--files')
  const outDir = arg(args, '--out') ?? join(WEB, 'node_modules/.cache/sam-check-out')
  const backend = arg(args, '--backend') ?? 'wasm'
  const threads = Math.max(1, Number(arg(args, '--threads') ?? Math.min(4, availableParallelism())))
  const variants = (arg(args, '--variants') ?? 'fp16,fp32').split(',')
  const summaryFile = arg(args, '--summary') ?? process.env.GITHUB_STEP_SUMMARY
  const gha = !!process.env.GITHUB_ACTIONS
  const failures = []
  const notes = []
  const md = []
  const fail = (msg) => {
    failures.push(msg)
    console.log(gha ? `::error::${msg}` : `FAIL ${msg}`)
  }
  const note = (msg) => {
    notes.push(msg)
    console.log(gha ? `::warning::${msg}` : `NOTE ${msg}`)
  }
  const log = (s) => console.log(s)
  mkdirSync(outDir, { recursive: true })
  const finish = () => {
    md.push('', failures.length ? `**RESULT: ${failures.length} problem(s)**: ${failures.join('; ')}` : '**RESULT: all checks passed**', '')
    if (notes.length) md.push(...notes.map((n) => `- note: ${n}`), '')
    if (summaryFile) appendFileSync(summaryFile, `${md.join('\n')}\n`)
    writeFileSync(join(outDir, 'summary.md'), `${md.join('\n')}\n`)
    log(failures.length ? `RESULT: ${failures.length} problem(s)` : 'RESULT: all checks passed')
    process.exitCode = failures.length ? 1 : 0
  }

  const manifest = JSON.parse(readFileSync(arg(args, '--manifest') ?? MANIFEST, 'utf8'))
  const m = manifest.models.find((x) => x.task === 'segment')
  if (!m) throw new Error('no segment model in the manifest')
  log(`${m.id}: ${m.source.repo} @ ${m.source.revision}`)
  md.push('## Object select: SAM 2.1 Hiera Tiny check', '', `\`${m.source.repo}\` @ \`${m.source.revision}\`, node ${process.version}, backend ${backend === 'node' ? 'onnxruntime-node (CPU)' : `onnxruntime-web WebAssembly, the app's CPU fallback (${threads} threads)`}.`, '')

  // 1. The files.
  const dir = filesDir ?? join(WEB, 'node_modules/.cache/sam-files')
  mkdirSync(dir, { recursive: true })
  const paths = {}
  md.push('### Files', '', '| file | bytes | SHA-256 | download |', '|---|---|---|---|')
  for (const f of m.files.filter((x) => variants.includes(x.variant))) {
    const p = join(dir, base(f.path))
    paths[`${f.variant}/${f.part}${f.data ? '/data' : ''}`] = p
    let got
    if (filesDir && existsSync(p)) got = { bytes: statSync(p).size, sha256: createHash('sha256').update(readFileSync(p)).digest('hex'), ms: 0 }
    else {
      log(`downloading ${sourceUrl(m, f)}`)
      got = await downloadTo(sourceUrl(m, f), p)
    }
    const ok = got.bytes === f.bytes && got.sha256 === f.sha256
    log(`${ok ? 'ok' : 'MISMATCH'} ${f.path}: ${got.bytes} bytes, sha256 ${got.sha256}`)
    md.push(`| ${f.path} | ${got.bytes.toLocaleString('en')} | ${ok ? 'ok' : `**mismatch** (${got.sha256})`} | ${got.ms ? `${(got.ms / 1000).toFixed(1)} s` : 'local'} |`)
    if (!ok) fail(`${f.path}: ${got.bytes} bytes sha256 ${got.sha256}, expected ${f.bytes} ${f.sha256}`)
  }
  md.push('')
  if (failures.length) return finish()

  // 2. The runtime, the app's code and the photo.
  const app = await loadAppCode()
  let ort
  let sessionOpts
  if (backend === 'node') {
    ort = await import('onnxruntime-node')
    sessionOpts = { graphOptimizationLevel: 'all', logSeverityLevel: 3, intraOpNumThreads: threads }
  } else {
    ort = await import('onnxruntime-web')
    ort.env.wasm.numThreads = threads
    ort.env.logLevel = 'error'
    sessionOpts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 }
  }
  log(`ONNX Runtime ${ort.env.versions?.node ?? ort.env.versions?.web ?? '?'}`)
  const photo = decodePng(readFileSync(PHOTO))
  const { width: W, height: H } = photo
  const rgba = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) rgba.set([photo.rgb[i * 3], photo.rgb[i * 3 + 1], photo.rgb[i * 3 + 2], 255], i * 4)
  // As shot = the sensor (no orientation): the matte's sensor frame is the photo.
  const geo = app.resolveGeometry(app.DEFAULT_GEOMETRY, W, H, 0)
  const input = m.input
  const S = input.size
  const toUv = ([x, y, l]) => [x / W, y / H, l]

  const results = {}
  const cases = []
  md.push('### Runs', '', '| variant | case | prompt | coverage | predicted IoU | object score | decoder | matte chars |', '|---|---|---|---|---|---|---|---|')
  const timing = []
  for (const v of variants) {
    log(`\n-- ${v}`)
    const sess = {}
    const created = {}
    for (const part of ['encoder', 'decoder']) {
      const t0 = performance.now()
      try {
        const graph = new Uint8Array(readFileSync(paths[`${v}/${part}`]))
        const dataPath = paths[`${v}/${part}/data`]
        sess[part] = await ort.InferenceSession.create(graph, { ...sessionOpts, ...(dataPath ? { externalData: [{ path: base(dataPath), data: new Uint8Array(readFileSync(dataPath)) }] } : {}) })
      } catch (e) {
        fail(`${v} ${part}: did not load (${e.message})`)
        continue
      }
      created[part] = performance.now() - t0
      const meta = (list) => list.map((x) => ({ name: x.name, type: x.type, shape: x.shape }))
      const ins = meta(sess[part].inputMetadata ?? [])
      const outs = meta(sess[part].outputMetadata ?? [])
      log(`${part}: created in ${ms(created[part])}; in ${ins.map((x) => `${x.name} ${x.type} [${(x.shape ?? []).join(', ')}]`).join('; ')}; out ${outs.map((x) => `${x.name} ${x.type} [${(x.shape ?? []).join(', ')}]`).join('; ')}`)
      for (const pr of ioProblems(part, ins, outs)) fail(`${v}: ${pr}`)
    }
    if (!sess.encoder || !sess.decoder) continue
    // The encoder: the app's input, run twice (the first includes warm-up).
    const pixels = app.segment.encoderInput(rgba, W, H, input)
    const feeds = { pixel_values: new ort.Tensor('float32', pixels, [1, 3, S, S]) }
    let t0 = performance.now()
    let emb = await sess.encoder.run(feeds)
    const enc1 = performance.now() - t0
    t0 = performance.now()
    emb = await sess.encoder.run(feeds)
    const enc2 = performance.now() - t0
    for (const [k, t] of Object.entries(emb)) {
      const d = t.data
      let bad = 0
      let mn = Infinity
      let mx = -Infinity
      for (let i = 0; i < d.length; i++) {
        if (!Number.isFinite(d[i])) bad++
        else {
          mn = Math.min(mn, d[i])
          mx = Math.max(mx, d[i])
        }
      }
      log(`${k}: [${t.dims.join(', ')}] min ${mn.toFixed(4)} max ${mx.toFixed(4)}${bad ? `, ${bad} non-finite` : ''}`)
      if (bad) fail(`${v}: ${k} has ${bad} non-finite values`)
    }
    log(`encoder: ${ms(enc1)} (first run), ${ms(enc2)} (second)`)
    // The decoder through the app's code.
    const decode = async (prompt, boxAs) => {
      const f = app.segment.promptFeeds(prompt, S, boxAs)
      const d = {
        input_points: new ort.Tensor('float32', f.points, f.pointDims),
        input_labels: new ort.Tensor('int64', f.labels, f.labelDims),
        input_boxes: new ort.Tensor('float32', f.boxes, f.boxDims),
        'image_embeddings.0': emb['image_embeddings.0'],
        'image_embeddings.1': emb['image_embeddings.1'],
        'image_embeddings.2': emb['image_embeddings.2'],
      }
      const t = performance.now()
      const out = await sess.decoder.run(d)
      const dt = performance.now() - t
      const masks = out.pred_masks
      const iou = out.iou_scores.data
      if (![masks.data, iou, out.object_score_logits.data].every((x) => app.segment.finiteAll(x))) throw new Error('non-finite output')
      const logits = app.segment.pickMask(masks.data, masks.dims, iou, out.object_score_logits.data)
      const matte = app.segment.matteToSensor(logits, geo.uvToSensor, [W, H], 2048)
      return { logits, matte, ms: dt, all: Array.from(iou).map((x) => +x.toFixed(4)), dims: masks.dims }
    }
    const runCase = async (name, prompt, boxAs, label) => {
      try {
        const r = await decode({ points: prompt.points.map(toUv), ...(prompt.box ? { box: [prompt.box[0] / W, prompt.box[1] / H, prompt.box[2] / W, prompt.box[3] / H] } : {}) }, boxAs)
        const cov = app.segment.coverage(r.matte.px)
        const raster = await app.encodeDepth(r.matte.px, r.matte.w, r.matte.h)
        const back = app.decodeRaster(raster)
        if (!back || back.some((x, i) => x !== r.matte.px[i])) fail(`${v} ${name}: the stored matte doesn't decode to itself`)
        results[`${v}/${name}`] = { ...r, cov, chars: raster.data.length }
        // For the parity step: the prompt (photo pixels) and the matte as raw bytes (W × H).
        writeFileSync(join(outDir, `${name}-${v}.u8`), r.matte.px)
        cases.push({ variant: v, name, points: prompt.points, box: prompt.box ?? null, boxAs, matte: `${name}-${v}.u8`, width: r.matte.w, height: r.matte.h })
        log(`${name}: coverage ${cov.toFixed(4)}, IoU scores ${r.all.join(' / ')} (best ${r.logits.iou.toFixed(4)}), object ${r.logits.object.toFixed(3)}, masks [${r.dims.join(', ')}], decoder ${ms(r.ms)}, matte ${r.matte.w} × ${r.matte.h} = ${raster.data.length} chars`)
        md.push(`| ${v} | ${name} | ${label} | ${cov.toFixed(4)} | ${r.logits.iou.toFixed(3)} | ${r.logits.object.toFixed(2)} | ${ms(r.ms)} | ${raster.data.length.toLocaleString('en')} |`)
        writeFileSync(join(outDir, `${name}-${v}.png`), overlayPng(photo.rgb, W, H, r.matte.px, prompt.points, prompt.box))
        writeFileSync(join(outDir, `${name}-${v}-matte.png`), encodePng(W, H, Uint8Array.from({ length: W * H * 3 }, (_, i) => r.matte.px[Math.floor(i / 3)])))
        return r
      } catch (e) {
        if (boxAs === 'boxes' && /box/.test(name)) note(`${v} ${name}: ${e.message}`)
        else fail(`${v} ${name}: ${e.message}`)
        md.push(`| ${v} | ${name} | ${label} | failed: ${e.message.slice(0, 80)} | | | | |`)
        return null
      }
    }
    const suit = await runCase('suit', { points: [[...REFERENCE.point, 1]] }, 'boxes', `(${REFERENCE.point.join(', ')}) adds`)
    if (!suit) continue
    if (Math.abs(results[`${v}/suit`].cov - REFERENCE.coverage) > 0.03) fail(`${v} suit: coverage ${results[`${v}/suit`].cov.toFixed(4)}, MASKS_PREP.md found ${REFERENCE.coverage}`)
    if (Math.abs(suit.logits.iou - REFERENCE.iou) > 0.05) note(`${v} suit: predicted IoU ${suit.logits.iou.toFixed(3)}, MASKS_PREP.md found ${REFERENCE.iou}`)
    if (suit.logits.object <= 0) fail(`${v} suit: no object found (score ${suit.logits.object})`)
    const g = selectionGeometry(suit.matte.px, W, H)
    // A point removed at the selection's centroid; a point added far from it (the photo's top right); a box around it.
    const c = g.centroid.map((x) => Math.round(x))
    await runCase('suit-minus', { points: [[...REFERENCE.point, 1], [c[0], c[1], 0]] }, 'boxes', `+ (${c.join(', ')}) removes`)
    await runCase('suit-plus', { points: [[...REFERENCE.point, 1], [440, 70, 1]] }, 'boxes', '+ (440, 70) adds')
    const box = g.box
    const boxed = await runCase('box', { points: [], box }, 'boxes', `box (${box.join(', ')}), input_boxes`)
    const corners = await runCase('box-corners', { points: [], box }, 'corners', 'the same box as corner points (labels 2, 3)')
    // Decoder speed: five more runs of the suit prompt.
    let dsum = 0
    for (let i = 0; i < 5; i++) dsum += (await decode({ points: [toUv([...REFERENCE.point, 1])] }, 'boxes')).ms
    timing.push({ v, created, enc1, enc2, dec: dsum / 5 })
    const minus = results[`${v}/suit-minus`]
    const plus = results[`${v}/suit-plus`]
    if (minus) log(`removing a point at the centroid: coverage ${results[`${v}/suit`].cov.toFixed(4)} → ${minus.cov.toFixed(4)}`)
    if (plus) log(`adding a point: coverage ${results[`${v}/suit`].cov.toFixed(4)} → ${plus.cov.toFixed(4)}`)
    if (boxed) log(`box (input_boxes) vs the suit's selection: IoU ${iouOf(boxed.matte.px, suit.matte.px).toFixed(3)}`)
    if (corners) log(`box (corners) vs the suit's selection: IoU ${iouOf(corners.matte.px, suit.matte.px).toFixed(3)}`)
    // A stored matte at the decision's 2048 px (as for a 2048 × 2048 sensor): the sidecar's size.
    for (const side of [2048, 1024]) {
      const big = app.segment.matteToSensor(suit.logits, app.resolveGeometry(app.DEFAULT_GEOMETRY, side, side, 0).uvToSensor, [side, side], side)
      const bigChars = (await app.encodeDepth(big.px, big.w, big.h)).data.length
      log(`the suit's matte stored at ${side} × ${side}: ${bigChars} characters`)
      md.push(`| ${v} | suit at ${side} × ${side} | (stored size only) | | | | | ${bigChars.toLocaleString('en')} |`)
    }
    for (const s of Object.values(sess)) await s.release().catch(() => {})
  }
  md.push('')
  if (variants.length === 2 && results['fp16/suit'] && results['fp32/suit']) {
    md.push('### fp16 against fp32 (binary masks, IoU)', '', '| case | IoU |', '|---|---|')
    for (const name of ['suit', 'suit-minus', 'suit-plus', 'box', 'box-corners']) {
      const a = results[`fp16/${name}`]
      const b = results[`fp32/${name}`]
      if (a && b) {
        const x = iouOf(a.matte.px, b.matte.px)
        log(`fp16 vs fp32, ${name}: IoU ${x.toFixed(4)}`)
        md.push(`| ${name} | ${x.toFixed(4)} |`)
      }
    }
    md.push('')
  }
  md.push(`### CPU fallback speed (${backend === 'node' ? 'onnxruntime-node' : `the app's WebAssembly runtime, ${threads} threads`})`, '', '| variant | sessions | encoder, first | encoder, second | decoder (mean of 5) |', '|---|---|---|---|---|')
  for (const t of timing) {
    md.push(`| ${t.v} | ${ms(t.created.encoder)} + ${ms(t.created.decoder)} | ${ms(t.enc1)} | ${ms(t.enc2)} | ${ms(t.dec)} |`)
    log(`${t.v}: sessions ${ms(t.created.encoder)} + ${ms(t.created.decoder)}, encoder ${ms(t.enc1)} / ${ms(t.enc2)}, decoder ${ms(t.dec)}`)
    if (backend === 'wasm') {
      const within = t.enc1 <= CPU_LIMIT_MS
      log(`${t.v}: the encoder's first run ${within ? 'is within' : 'is over'} the 15 s CPU fallback rule`)
      md.push(`| | ${within ? 'within' : '**over**'} the 15 s rule (first encoder run) | | | |`)
    }
  }
  md.push('')
  writeFileSync(join(outDir, 'cases.json'), JSON.stringify({ photo: 'astronaut.png', cases }, null, 2))
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ timing, results: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, { coverage: r.cov, iou: r.logits.iou, all: r.all, object: r.logits.object, decoderMs: r.ms, chars: r.chars }])) }, null, 2))
  finish()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
