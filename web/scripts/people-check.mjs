// Checks the People models in Node, without a browser (docs/PHASE3.md Part 28). Run by the "AI models" workflow's
// people-check task on GitHub's servers, which can reach huggingface.co (this build machine can't).
//
//   node scripts/people-check.mjs [--files DIR] [--out DIR] [--threads N] [--backend wasm|node] [--no-sam]
//                                 [--manifest FILE] [--summary FILE]
//
//   1. Downloads every pinned file of the People models in web/models/manifest.json (RF-DETR-Seg Nano and MediaPipe
//      Selfie Multiclass from their commit-pinned Hugging Face URLs, YuNet from OpenCV Zoo's Git LFS at its pinned
//      commit), and SAM 2.1 Tiny's fp32 graphs for the outline (unless --no-sam), or reads them from --files DIR,
//      checking each file's size and SHA-256.
//   2. Lists each graph's inputs and outputs against the exports' (RF-DETR's swapped output names included).
//   3. Runs THE APP'S OWN pre- and post-processing (src/ai/people.ts, src/ai/segment.ts; the stored encoding,
//      src/engine/develop/depth-map.ts), bundled for Node by Vite, with ONNX Runtime's CPU kernels (by default the app's
//      own onnxruntime-web WebAssembly, --threads threads), on the committed public-domain photo
//      (scripts/fixtures/ai-masks/astronaut.png) and on a group made from it here (three copies at different sizes, one
//      mirrored, on grey: `trio`). Reports the people and faces found, each person's and each part's coverage, the
//      stored size, the timings, and checks every output is finite. Writes overlays to --out (the run's artifact).
//
// Exit 1 on a size or hash mismatch, a graph that doesn't load or run, unexpected inputs or outputs, a non-finite
// output, or no person (or no face) found on the astronaut photo.

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
/** MASKS_PREP.md (run 39653265084, CPU): RF-DETR's person on the astronaut (score 0.969, mask coverage 0.407); YuNet's face. */
export const REFERENCE = { personScore: 0.969, personCoverage: 0.407, face: [178.2, 62.9, 89.9, 113.3] }
export const PARTS = ['person', 'face', 'hair', 'bodySkin', 'clothes']

/** Expected inputs and outputs (full shapes; null: any, a string: a free dimension). */
export const EXPECTED = {
  detect: {
    inputs: { input: ['float32', [1, 3, 312, 312]] },
    // The export's names are swapped: pred_masks holds the boxes, pred_boxes the class logits, pred_logits the masks.
    outputs: { pred_masks: ['float32', [1, 100, 4]], pred_boxes: ['float32', [1, 100, 91]], pred_logits: ['float32', [1, null, 78, 78]] },
  },
  face: {
    inputs: { input: ['float32', [1, 3, null, null]] },
    outputs: Object.fromEntries([8, 16, 32].flatMap((s) => [[`cls_${s}`, ['float32', [1, null, 1]]], [`obj_${s}`, ['float32', [1, null, 1]]], [`bbox_${s}`, ['float32', [1, null, 4]]], [`kps_${s}`, ['float32', [1, null, 10]]]])),
  },
  parse: { inputs: { input_29: ['float32', [1, 256, 256, 3]] }, outputs: { Identity: ['float32', [1, 256, 256, 6]] } },
}

/** Problems with a graph's declared inputs and outputs ([] when as expected). */
export function ioProblems(task, inputs, outputs) {
  const exp = EXPECTED[task]
  const out = []
  const check = (kind, list, want) => {
    for (const [name, [type, dims]] of Object.entries(want)) {
      const m = list.find((x) => x.name === name)
      if (!m) {
        out.push(`${task}: no ${kind} named ${name}`)
        continue
      }
      if (m.type && m.type !== type) out.push(`${task}: ${kind} ${name} is ${m.type}, expected ${type}`)
      const s = m.shape ?? []
      if (s.length && (s.length !== dims.length || s.some((v, i) => dims[i] !== null && typeof v === 'number' && v !== dims[i]))) out.push(`${task}: ${kind} ${name} has shape [${s.join(', ')}], expected [${dims.map((d) => d ?? '*').join(', ')}]`)
    }
  }
  check('input', inputs, exp.inputs)
  check('output', outputs, exp.outputs)
  return out
}

/**
 * A group photo made from the astronaut (public domain, so is this): a grey W × H canvas with three copies, at full,
 * 0.8 and 0.55 size, the middle one mirrored, standing on the bottom edge. Returns the RGB pixels and where each copy is.
 */
export function compositeTrio(photo, W = 1500, H = 600) {
  const rgb = new Uint8Array(W * H * 3).fill(128)
  const places = []
  const copies = [
    { scale: H / photo.height, x: 20, mirror: false },
    { scale: (0.8 * H) / photo.height, x: 560, mirror: true },
    { scale: (0.55 * H) / photo.height, x: 1080, mirror: false },
  ]
  for (const c of copies) {
    const w = Math.round(photo.width * c.scale)
    const h = Math.round(photo.height * c.scale)
    const y0 = H - h
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const X = c.x + x
        if (X < 0 || X >= W) continue
        // Nearest source pixel (box sampling is not needed for a test picture).
        const sx = Math.min(photo.width - 1, Math.floor(((c.mirror ? w - 1 - x : x) + 0.5) / c.scale))
        const sy = Math.min(photo.height - 1, Math.floor((y + 0.5) / c.scale))
        rgb.set(photo.rgb.subarray((sy * photo.width + sx) * 3, (sy * photo.width + sx) * 3 + 3), ((y0 + y) * W + X) * 3)
      }
    }
    places.push([c.x / W, y0 / H, (c.x + w) / W, 1])
  }
  return { width: W, height: H, rgb, places }
}

/** The photo with mattes tinted over it (one colour each) and boxes drawn. */
function overlayPng(rgb, w, h, layers, boxes = []) {
  const out = Uint8Array.from(rgb)
  const colours = [[255, 0, 0], [0, 200, 255], [255, 220, 0], [0, 255, 0], [255, 0, 255]]
  layers.forEach((m, k) => {
    const col = colours[k % colours.length]
    for (let i = 0; i < w * h; i++) {
      const a = (m[i] / 255) * 0.5
      for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(out[i * 3 + c] * (1 - a) + col[c] * a)
    }
  })
  for (const [b, col] of boxes) {
    const [x0, y0, x1, y1] = [b[0] * w, b[1] * h, b[2] * w, b[3] * h].map(Math.round)
    for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) for (const y of [y0, y1 - 1]) if (y >= 0 && y < h) out.set(col, (y * w + x) * 3)
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (const x of [x0, x1 - 1]) if (x >= 0 && x < w) out.set(col, (y * w + x) * 3)
  }
  return encodePng(w, h, out)
}

const arg = (args, name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const ms = (t) => `${Math.round(t).toLocaleString('en')} ms`
const base = (p) => p.slice(p.lastIndexOf('/') + 1)

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

/** The app's own code, bundled for Node by Vite (SSR build, no app config), as sam-check.mjs does. */
async function loadAppCode() {
  const { build } = await import('vite')
  const outDir = join(WEB, 'node_modules/.cache/people-check')
  const src = join(WEB, 'src').replace(/\\/g, '/')
  const ENTRY = '\0people-check-entry'
  await build({
    configFile: false,
    root: WEB,
    logLevel: 'warn',
    plugins: [
      {
        name: 'people-check',
        enforce: 'pre',
        resolveId: (id) => (id === 'people-check-entry' ? ENTRY : null),
        load(id) {
          if (id !== ENTRY) return null
          return [
            `export * as people from '${src}/ai/people.ts'`,
            `export * as segment from '${src}/ai/segment.ts'`,
            `export { encodeDepth, decodeRaster } from '${src}/engine/develop/depth-map.ts'`,
            `export { resolveGeometry, DEFAULT_GEOMETRY } from '${src}/engine/develop/geometry.ts'`,
          ].join('\n')
        },
      },
      {
        // ai/depth.ts (for its resize) imports the runtime (a worker): never run here.
        name: 'people-check-runtime-stub',
        enforce: 'pre',
        resolveId: (id, importer) => (importer && /src\/ai\/depth\.ts$/.test(importer) && id === './runtime' ? '\0people-check-runtime' : null),
        load: (id) => (id === '\0people-check-runtime' ? 'export const prepareModel = () => { throw new Error("not in people-check") }; export const runModel = prepareModel' : null),
      },
    ],
    build: {
      ssr: true,
      outDir,
      emptyOutDir: true,
      minify: false,
      copyPublicDir: false,
      rollupOptions: { input: { 'app-code': 'people-check-entry' }, output: { entryFileNames: '[name].mjs' } },
    },
  })
  return import(`${pathToFileURL(join(outDir, 'app-code.mjs')).href}?t=${Date.now()}`)
}

async function main(args) {
  const filesDir = arg(args, '--files')
  const outDir = arg(args, '--out') ?? join(WEB, 'node_modules/.cache/people-check-out')
  const backend = arg(args, '--backend') ?? 'wasm'
  const threads = Math.max(1, Number(arg(args, '--threads') ?? Math.min(4, availableParallelism())))
  const useSam = !args.includes('--no-sam')
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
  const models = Object.fromEntries(['detect', 'face', 'parse', 'segment'].map((t) => [t, manifest.models.find((x) => x.task === t)]))
  for (const t of ['detect', 'face', 'parse']) if (!models[t]) throw new Error(`no ${t} model in the manifest`)
  md.push('## People: RF-DETR-Seg Nano, YuNet and MediaPipe Selfie Multiclass check', '', `node ${process.version}, backend ${backend === 'node' ? 'onnxruntime-node (CPU)' : `onnxruntime-web WebAssembly, the app's CPU provider (${threads} threads)`}.`, '')

  // 1. The files.
  const dir = filesDir ?? join(WEB, 'node_modules/.cache/people-files')
  mkdirSync(dir, { recursive: true })
  const paths = {}
  md.push('### Files', '', '| model | file | bytes | SHA-256 | download |', '|---|---|---|---|---|')
  const want = [['detect', models.detect.files], ['face', models.face.files], ['parse', models.parse.files]]
  if (useSam && models.segment) want.push(['segment', models.segment.files.filter((f) => f.variant === 'fp32')])
  for (const [task, files] of want) {
    const m = models[task]
    for (const f of files) {
      const p = join(dir, `${m.id}--${base(f.path)}`)
      paths[`${task}/${f.part ?? 'model'}${f.data ? '/data' : ''}`] = p
      let got
      try {
        if (existsSync(p)) got = { bytes: statSync(p).size, sha256: createHash('sha256').update(readFileSync(p)).digest('hex'), ms: 0 }
        else {
          log(`downloading ${sourceUrl(m, f)}`)
          got = await downloadTo(sourceUrl(m, f), p)
        }
      } catch (e) {
        fail(`${m.id} ${f.path}: ${e.message}`)
        continue
      }
      const ok = got.bytes === f.bytes && got.sha256 === f.sha256
      log(`${ok ? 'ok' : 'MISMATCH'} ${m.id} ${f.path}: ${got.bytes} bytes, sha256 ${got.sha256}`)
      md.push(`| ${m.id} | ${f.path} | ${got.bytes.toLocaleString('en')} | ${ok ? 'ok' : `**mismatch** (${got.sha256})`} | ${got.ms ? `${(got.ms / 1000).toFixed(1)} s` : 'local'} |`)
      if (!ok) fail(`${m.id} ${f.path}: ${got.bytes} bytes sha256 ${got.sha256}, expected ${f.bytes} ${f.sha256}`)
    }
  }
  md.push('')
  if (failures.length) return finish()

  // 2. The runtime, the app's code, the sessions.
  const app = await loadAppCode()
  const P = app.people
  let ort
  let opts
  if (backend === 'node') {
    ort = await import('onnxruntime-node')
    opts = { graphOptimizationLevel: 'all', logSeverityLevel: 3, intraOpNumThreads: threads }
  } else {
    ort = await import('onnxruntime-web')
    ort.env.wasm.numThreads = threads
    ort.env.logLevel = 'error'
    opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 }
  }
  const sess = {}
  const created = {}
  const meta = (list) => (list ?? []).map((x) => ({ name: x.name, type: x.type, shape: x.shape }))
  for (const task of ['detect', 'face', 'parse', ...(useSam && models.segment ? ['encoder', 'decoder'] : [])]) {
    const key = task === 'encoder' || task === 'decoder' ? `segment/${task}` : `${task}/model`
    const t0 = performance.now()
    try {
      const graph = new Uint8Array(readFileSync(paths[key]))
      const dataPath = paths[`${key}/data`]
      sess[task] = await ort.InferenceSession.create(graph, { ...opts, ...(dataPath ? { externalData: [{ path: base(models.segment.files.find((f) => f.variant === 'fp32' && f.part === task && f.data).path), data: new Uint8Array(readFileSync(dataPath)) }] } : {}) })
    } catch (e) {
      fail(`${task}: did not load (${e.message})`)
      continue
    }
    created[task] = performance.now() - t0
    const ins = meta(sess[task].inputMetadata)
    const outs = meta(sess[task].outputMetadata)
    log(`${task}: created in ${ms(created[task])}; in ${ins.map((x) => `${x.name} ${x.type} [${(x.shape ?? []).join(', ')}]`).join('; ')}; out ${outs.map((x) => `${x.name} ${x.type} [${(x.shape ?? []).join(', ')}]`).join('; ')}`)
    if (EXPECTED[task]) for (const pr of ioProblems(task, ins, outs)) fail(pr)
  }
  if (!sess.detect || !sess.face || !sess.parse) return finish()

  const asObj = (out) => Object.fromEntries(Object.entries(out).map(([k, t]) => [k, { data: t.data, dims: [...t.dims] }]))
  const finiteAll = (out, what) => {
    for (const [k, t] of Object.entries(out)) if (!P.finite(t.data)) fail(`${what}: ${k} has non-finite values`)
  }

  const astronaut = decodePng(readFileSync(PHOTO))
  const trio = compositeTrio(astronaut)
  writeFileSync(join(outDir, 'trio.png'), encodePng(trio.width, trio.height, trio.rgb))
  const photos = [{ name: 'astronaut', ...astronaut }, { name: 'trio', ...trio }]
  const results = {}
  const timings = []
  md.push('### People found', '', '| photo | people (score) | faces found / matched | SAM outline used | detector | faces | parts (per person) | SAM (encoder + boxes) |', '|---|---|---|---|---|---|---|---|')
  const partRows = []
  for (const ph of photos) {
    const { width: W, height: H } = ph
    const rgba = new Uint8ClampedArray(W * H * 4)
    for (let i = 0; i < W * H; i++) rgba.set([ph.rgb[i * 3], ph.rgb[i * 3 + 1], ph.rgb[i * 3 + 2], 255], i * 4)
    const geo = app.resolveGeometry(app.DEFAULT_GEOMETRY, W, H, 0)
    const t = {}
    // RF-DETR.
    const di = models.detect.input
    const dIn = P.detectorInput(rgba, W, H, di)
    let t0 = performance.now()
    let dOut = await sess.detect.run({ input: new ort.Tensor('float32', dIn, [1, 3, di.size, di.size]) })
    t.detectFirst = performance.now() - t0
    t0 = performance.now()
    dOut = await sess.detect.run({ input: new ort.Tensor('float32', dIn, [1, 3, di.size, di.size]) })
    t.detect = performance.now() - t0
    finiteAll(dOut, `${ph.name} detector`)
    const det = P.detectorOutputs(asObj(dOut))
    const found = P.findPeople(det)
    log(`${ph.name}: ${found.length} people: ${found.map((d) => `${d.score.toFixed(3)} [${d.box.map((x) => x.toFixed(3)).join(', ')}]`).join('; ')}`)
    // YuNet.
    const [fw, fh] = P.faceInputSize(W, H)
    t0 = performance.now()
    const fOut = await sess.face.run({ input: new ort.Tensor('float32', P.faceInput(rgba, W, H, fw, fh), [1, 3, fh, fw]) })
    t.face = performance.now() - t0
    finiteAll(fOut, `${ph.name} faces`)
    const faces = P.decodeFaces(asObj(fOut), fw, fh)
    const match = P.matchFaces(found, faces)
    log(`${ph.name}: ${faces.length} faces (input ${fw} × ${fh}): ${faces.map((f) => `${f.score.toFixed(3)} [${f.box.map((x, i) => (x * (i % 2 ? H : W)).toFixed(1)).join(', ')}]`).join('; ')}; matched ${match.filter((x) => x >= 0).length}`)
    // MediaPipe, per person and per face.
    const pi = models.parse.input
    let parseMs = 0
    let parseRuns = 0
    const people = []
    for (let k = 0; k < found.length; k++) {
      const d = found[k]
      const face = match[k] >= 0 ? faces[match[k]] : null
      const crops = [P.squareCrop(d.box, W, H, 1 + 2 * P.PERSON_MARGIN), ...(face ? [P.squareCrop(face.box, W, H, P.FACE_CROP)] : [])]
      const parts = []
      for (const crop of crops) {
        t0 = performance.now()
        const o = await sess.parse.run({ input_29: new ort.Tensor('float32', P.parserInput(rgba, W, H, crop, pi), [1, pi.size, pi.size, 3]) })
        parseMs += performance.now() - t0
        parseRuns++
        finiteAll(o, `${ph.name} parts`)
        parts.push(P.classMaps(asObj(o).Identity, crop))
      }
      const mask = P.detectionMask(det, d.query, d.score)
      people.push({ index: k + 1, score: d.score, box: d.box, mask, outline: mask, refined: false, face, parts })
    }
    t.parse = parseMs
    t.parseRuns = parseRuns
    // SAM 2.1's outline from each person's box.
    if (sess.encoder && sess.decoder && people.length) {
      const S = models.segment.input.size
      t0 = performance.now()
      const emb = await sess.encoder.run({ pixel_values: new ort.Tensor('float32', app.segment.encoderInput(rgba, W, H, models.segment.input), [1, 3, S, S]) })
      t.samEncoder = performance.now() - t0
      t0 = performance.now()
      for (const p of people) {
        const f = app.segment.promptFeeds({ points: [], box: p.box }, S)
        const o = await sess.decoder.run({
          input_points: new ort.Tensor('float32', f.points, f.pointDims),
          input_labels: new ort.Tensor('int64', f.labels, f.labelDims),
          input_boxes: new ort.Tensor('float32', f.boxes, f.boxDims),
          'image_embeddings.0': emb['image_embeddings.0'],
          'image_embeddings.1': emb['image_embeddings.1'],
          'image_embeddings.2': emb['image_embeddings.2'],
        })
        finiteAll(o, `${ph.name} SAM`)
        const sam = app.segment.pickMask(o.pred_masks.data, o.pred_masks.dims, o.iou_scores.data, o.object_score_logits.data)
        const c = P.chooseOutline(p.mask, sam)
        p.outline = c.outline
        p.refined = c.refined
        p.agree = c.agree
      }
      t.samBoxes = performance.now() - t0
    }
    // The mattes (1024 px at most, as the app stores them).
    const row = { people: [], faces: faces.length, matched: match.filter((x) => x >= 0).length }
    const layers = {}
    for (const p of people) {
      const cov = {}
      for (const what of PARTS) {
        const m = P.personPartMatte(p, what, geo.uvToSensor, [W, H], 1024)
        cov[what] = app.segment.coverage(m.px)
        layers[`${p.index}/${what}`] = m.px
      }
      const rf = P.sensorMatte(geo.uvToSensor, [W, H], 1024, (u, v) => app.segment.matteAlpha(app.segment.logitAt(p.mask, u, v)))
      row.people.push({ index: p.index, score: +p.score.toFixed(4), box: p.box.map((x) => +x.toFixed(4)), face: !!p.face, refined: p.refined, samAgree: p.agree === undefined || p.agree === null ? null : +p.agree.toFixed(4), rfCoverage: +app.segment.coverage(rf.px).toFixed(4), coverage: Object.fromEntries(Object.entries(cov).map(([k, v]) => [k, +v.toFixed(4)])) })
      partRows.push(`| ${ph.name} | ${p.index} (${p.score.toFixed(3)}) | ${p.face ? 'yes' : 'no'} | ${p.refined ? `SAM (agrees ${p.agree.toFixed(2)})` : p.agree != null ? `RF-DETR (SAM ${p.agree.toFixed(2)})` : 'RF-DETR'} | ${PARTS.map((w) => cov[w].toFixed(4)).join(' | ')} |`)
      writeFileSync(join(outDir, `${ph.name}-person${p.index}.png`), overlayPng(ph.rgb, W, H, ['person', 'face', 'hair', 'bodySkin', 'clothes'].map((w) => layers[`${p.index}/${w}`]), [[p.box, [255, 255, 255]], ...(p.face ? [[p.face.box, [0, 255, 0]]] : [])]))
    }
    // All people, each part (the union), and its stored size.
    const all = {}
    for (const what of PARTS) {
      const m = P.peopleMatte(people, what, geo.uvToSensor, [W, H], 1024)
      const raster = await app.encodeDepth(m.px, m.w, m.h)
      const back = app.decodeRaster(raster)
      if (!back || back.some((x, i) => x !== m.px[i])) fail(`${ph.name} all people ${what}: the stored matte doesn't decode to itself`)
      all[what] = { coverage: +app.segment.coverage(m.px).toFixed(4), chars: raster.data.length, size: [m.w, m.h] }
      if (what === 'person') writeFileSync(join(outDir, `${ph.name}-all-people.png`), overlayPng(ph.rgb, W, H, [m.px], found.map((d) => [d.box, [255, 255, 255]])))
    }
    row.all = all
    results[ph.name] = row
    timings.push({ photo: ph.name, ...t })
    md.push(`| ${ph.name} (${W} × ${H}) | ${found.length} (${found.map((d) => d.score.toFixed(3)).join(', ')}) | ${faces.length} / ${row.matched} | ${people.filter((p) => p.refined).length} of ${people.length} | ${ms(t.detect)} (first ${ms(t.detectFirst)}) | ${ms(t.face)} | ${ms(t.parse)} (${t.parseRuns} runs) | ${t.samEncoder ? `${ms(t.samEncoder)} + ${ms(t.samBoxes)}` : '—'} |`)
  }
  md.push('', '### Coverage of each part (share of the photo, 0…1; mattes at most 1024 px, as stored)', '', '| photo | person | face found | outline | whole person | face skin | hair | body skin | clothes |', '|---|---|---|---|---|---|---|---|---|', ...partRows, '')
  md.push('### All people (the union), as stored', '', '| photo | part | coverage | matte | characters in the edit |', '|---|---|---|---|---|')
  for (const [name, r] of Object.entries(results)) for (const [what, a] of Object.entries(r.all)) md.push(`| ${name} | ${what} | ${a.coverage} | ${a.size.join(' × ')} | ${a.chars.toLocaleString('en')} |`)
  md.push('', `Sessions created: ${Object.entries(created).map(([k, v]) => `${k} ${ms(v)}`).join(', ')}.`, '')

  // Expectations on the astronaut (MASKS_PREP.md's run).
  const a = results.astronaut
  if (!a?.people.length) fail('astronaut: no person found')
  else {
    const p1 = a.people[0]
    if (Math.abs(p1.score - REFERENCE.personScore) > 0.05) note(`astronaut: person score ${p1.score}, MASKS_PREP.md found ${REFERENCE.personScore}`)
    if (Math.abs(p1.rfCoverage - REFERENCE.personCoverage) > 0.05) fail(`astronaut: RF-DETR's person covers ${p1.rfCoverage}, MASKS_PREP.md found ${REFERENCE.personCoverage}`)
    if (!p1.face) fail('astronaut: no face matched to the person')
    for (const w of ['face', 'hair', 'clothes']) if (!(p1.coverage[w] > 0.005)) fail(`astronaut: ${w} covers ${p1.coverage[w]}`)
  }
  if (a && a.faces < 1) fail('astronaut: YuNet found no face')
  const t3 = results.trio
  if (t3 && t3.people.length !== 3) note(`trio: ${t3.people.length} people found (three copies of the astronaut)`)
  if (t3 && t3.matched !== Math.min(3, t3.people.length)) note(`trio: ${t3.matched} faces matched to ${t3.people.length} people`)
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ created, timings, results }, null, 2))
  for (const s of Object.values(sess)) await s.release?.().catch(() => {})
  finish()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
