// Checks the Subject mask's real model in Node, without a browser (docs/PHASE3.md Part 30). Run by the "AI models"
// workflow's birefnet-patch task (on the files it has just patched) and subject-check task (on the file the manifest
// pins, downloaded from its GitHub Release by the deploy's own step) on GitHub's servers.
//
//   node scripts/subject-check.mjs --photos A.png,B.png [--model FILE[,FILE2]] [--out DIR] [--threads N]
//                                  [--reference verify.json[,verify2.json]] [--manifest FILE] [--summary FILE]
//                                  [--max-run-ms N]
//
//   1. The model file(s): --model, or downloaded from the manifest's pinned URL; checked against the manifest's size and
//      SHA-256 when the manifest pins it (a file the manifest doesn't list, such as the fp32 patch kept for comparison,
//      is only described).
//   2. Its inputs and outputs: `input_image` float32 [1, 3, 1024, 1024] → `output_image` float32 [1, 1, 1024, 1024].
//   3. THE APP'S OWN pre- and post-processing (src/ai/subject.ts: the stretched 1024² input, the sigmoid, the matte in the
//      sensor frame; src/engine/develop/depth-map.ts: the stored encoding), bundled for Node by Vite, with the app's own
//      onnxruntime-web WebAssembly (its CPU fallback), --threads threads, default session options as the app's worker
//      has them. On each photo (PNG; the photo is the as-shot rendering and the sensor frame): the time of the first and
//      second run and of the matte, every output finite, the share of the model's cells at ½ or more, the mean
//      probability, the matte's coverage and its size in the edit (at most 1024 px), the process's memory.
//   4. Checks: the inputs and outputs; finite outputs; the stored matte decodes to itself; the astronaut's subject
//      (the astronaut) covers 0.30…0.50 of the photo; with --reference (birefnet_patch.py verify's JSON for the same
//      file), the app's mean probability within 0.02 of ONNX Runtime's in Python on the same photo (matched by SHA-256,
//      or by name for the committed photos; the app resizes by area, BiRefNet's code bilinearly); with two files, their
//      mattes' agreement (IoU at ½).
//   Mattes and overlays go to --out as PNGs (the run's artifact); results.json and summary.md beside them.

import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { decodePng, encodePng } from './moebius-check.mjs'
import { MANIFEST, sourceUrl, download } from './models.mjs'
import { asciiArt, iouOf } from './sky-check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
/** Expected subject coverage on the committed photos (the astronaut fills about 0.41 of the photo: MASKS_PREP.md). */
export const EXPECT = { 'astronaut.png': [0.3, 0.5] }
/** The photos committed to the repository (web/scripts/fixtures/ai-masks), the same in every run. */
const COMMITTED = new Set(['astronaut.png', 'rocket.png', 'rocket.jpg'])

const arg = (args, name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const ms = (t) => `${Math.round(t).toLocaleString('en')} ms`
const mb = (n) => `${Math.round(n / 1e6).toLocaleString('en')} MB`

/** The photo with the matte tinted orange over it. */
function overlayPng(rgb, w, h, matte) {
  const out = Uint8Array.from(rgb)
  for (let i = 0; i < w * h; i++) {
    const a = (matte[i] / 255) * 0.6
    out[i * 3] = Math.round(out[i * 3] * (1 - a) + 255 * a)
    out[i * 3 + 1] = Math.round(out[i * 3 + 1] * (1 - a) + 140 * a)
    out[i * 3 + 2] = Math.round(out[i * 3 + 2] * (1 - a))
  }
  return encodePng(w, h, out)
}
const grey = (px, w, h) => encodePng(w, h, Uint8Array.from({ length: w * h * 3 }, (_, i) => px[Math.floor(i / 3)]))

/** The app's own code, bundled for Node by Vite (SSR build, no app config), as sky-check.mjs does. */
async function loadAppCode() {
  const { build } = await import('vite')
  const outDir = join(WEB, 'node_modules/.cache/subject-check')
  const src = join(WEB, 'src').replace(/\\/g, '/')
  const ENTRY = '\0subject-check-entry'
  await build({
    configFile: false,
    root: WEB,
    logLevel: 'warn',
    plugins: [
      {
        name: 'subject-check',
        enforce: 'pre',
        resolveId: (id) => (id === 'subject-check-entry' ? ENTRY : null),
        load(id) {
          if (id !== ENTRY) return null
          return [
            `export * as subject from '${src}/ai/subject.ts'`,
            `export { coverage } from '${src}/ai/segment.ts'`,
            `export { encodeDepth, decodeRaster } from '${src}/engine/develop/depth-map.ts'`,
            `export { resolveGeometry, DEFAULT_GEOMETRY } from '${src}/engine/develop/geometry.ts'`,
          ].join('\n')
        },
      },
      {
        // subject.ts imports ai/depth.ts for its resize, which imports the runtime (a worker): never run here.
        name: 'subject-check-runtime-stub',
        enforce: 'pre',
        resolveId: (id, importer) => (importer && /src\/ai\/depth\.ts$/.test(importer) && id === './runtime' ? '\0subject-check-runtime' : null),
        load: (id) => (id === '\0subject-check-runtime' ? 'export const prepareModel = () => { throw new Error("not in subject-check") }; export const runModel = prepareModel' : null),
      },
    ],
    build: {
      ssr: true,
      outDir,
      emptyOutDir: true,
      minify: false,
      copyPublicDir: false,
      rollupOptions: { input: { 'app-code': 'subject-check-entry' }, output: { entryFileNames: '[name].mjs' } },
    },
  })
  return import(`${pathToFileURL(join(outDir, 'app-code.mjs')).href}?t=${Date.now()}`)
}

async function main(args) {
  const outDir = arg(args, '--out') ?? join(WEB, 'node_modules/.cache/subject-check-out')
  const threads = Math.max(1, Number(arg(args, '--threads') ?? Math.min(4, availableParallelism())))
  const photos = (arg(args, '--photos') ?? '').split(',').filter(Boolean)
  const summaryFile = arg(args, '--summary') ?? process.env.GITHUB_STEP_SUMMARY
  const refFiles = (arg(args, '--reference') ?? '').split(',').filter(Boolean)
  // A run this slow on the CPU is a finding in itself: the rest of that file's runs are skipped, so the report is written.
  const maxRunMs = Number(arg(args, '--max-run-ms') ?? 600_000)
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
  const finish = (results) => {
    md.push('', failures.length ? `**RESULT: ${failures.length} problem(s)**: ${failures.join('; ')}` : '**RESULT: all checks passed**', '')
    if (notes.length) md.push(...notes.map((n) => `- note: ${n}`), '')
    if (summaryFile) appendFileSync(summaryFile, `${md.join('\n')}\n`)
    writeFileSync(join(outDir, 'summary.md'), `${md.join('\n')}\n`)
    writeFileSync(join(outDir, 'results.json'), JSON.stringify({ failures, notes, ...results }, null, 1))
    log(failures.length ? `RESULT: ${failures.length} problem(s)` : 'RESULT: all checks passed')
    process.exitCode = failures.length ? 1 : 0
  }

  const manifest = JSON.parse(readFileSync(arg(args, '--manifest') ?? MANIFEST, 'utf8'))
  const m = manifest.models.find((x) => x.task === 'subject')
  if (!m) throw new Error('no subject model in the manifest')
  const pinned = /^[0-9a-f]{40}$/.test(m.source.revision ?? '') && m.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256 ?? ''))
  md.push('## Subject: BiRefNet_lite (LightBench’s patch) through the app’s code', '', `node ${process.version}, onnxruntime-web WebAssembly, the app's CPU fallback (${threads} threads).`, '')

  // 1. The file(s).
  let models = (arg(args, '--model') ?? '').split(',').filter(Boolean)
  if (!models.length) {
    if (!pinned) throw new Error('no --model, and the manifest does not pin the Subject model yet')
    for (const f of m.files) {
      log(`downloading ${sourceUrl(m, f)}`)
      const buf = await download(sourceUrl(m, f), 4)
      const file = join(outDir, f.path)
      writeFileSync(file, buf)
      models.push(file)
    }
  }
  models = models.filter((f) => {
    if (existsSync(f)) return true
    fail(`${f}: no such file`)
    return false
  })

  const app = await loadAppCode()
  const ort = await import('onnxruntime-web')
  ort.env.wasm.numThreads = threads
  ort.env.logLevel = 'error'
  const refs = refFiles.filter((f) => existsSync(f)).map((f) => JSON.parse(readFileSync(f, 'utf8')))
  const input = m.input
  const results = { models: [] }
  const mattes = {}
  for (const [k, file] of models.entries()) {
    const buf = readFileSync(file)
    const sha = createHash('sha256').update(buf).digest('hex')
    const name = basename(file)
    const listed = m.files.find((f) => f.path === name)
    log(`${name}: ${buf.length} bytes, sha256 ${sha}`)
    md.push(`### \`${name}\``, '', `${buf.length.toLocaleString('en')} bytes, SHA-256 \`${sha}\`${listed && pinned ? (sha === listed.sha256 && buf.length === listed.bytes ? ' (matches the manifest)' : ' (**does not match the manifest**)') : listed ? ' (the manifest does not pin it yet)' : ' (not in the manifest: kept for comparison)'}.`, '')
    if (listed && pinned && (sha !== listed.sha256 || buf.length !== listed.bytes)) {
      fail(`${name}: ${buf.length} bytes sha256 ${sha}, the manifest pins ${listed.bytes} ${listed.sha256}`)
      continue
    }
    // The app's worker's session options (src/ai/runtime.worker.ts): the WebAssembly provider, all graph optimisations.
    const t0 = performance.now()
    let sess
    try {
      sess = await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 })
    } catch (e) {
      fail(`${name}: the session could not be created (${e.message})`)
      continue
    }
    const createMs = performance.now() - t0
    const ins = (sess.inputMetadata ?? []).map((x) => ({ name: x.name, type: x.type, shape: x.shape }))
    const outs = (sess.outputMetadata ?? []).map((x) => ({ name: x.name, type: x.type, shape: x.shape }))
    log(`session ${ms(createMs)}; in ${JSON.stringify(ins)}; out ${JSON.stringify(outs)}`)
    if (sess.inputNames.join() !== app.subject.SUBJECT_IO.pixels || sess.outputNames.join() !== app.subject.SUBJECT_IO.matte) fail(`${name}: inputs ${sess.inputNames.join()} and outputs ${sess.outputNames.join()}, expected input_image and output_image`)
    md.push(`Session ${ms(createMs)}. Input ${ins.map((x) => `\`${x.name}\` ${x.type ?? ''} [${(x.shape ?? []).join(', ')}]`).join(', ')}; output ${outs.map((x) => `\`${x.name}\` ${x.type ?? ''} [${(x.shape ?? []).join(', ')}]`).join(', ')}.`, '')
    md.push('| photo | model, first run | model, second run | matte | cells at ½ or more | mean probability (Python) | matte | matte coverage | matte chars | memory after |', '|---|---|---|---|---|---|---|---|---|---|')
    const ref = refs[k] ?? null
    const runs = []
    for (const p of photos) {
      const img = decodePng(readFileSync(p))
      const { width: W, height: H } = img
      const pname = basename(p)
      const rgba = new Uint8ClampedArray(W * H * 4)
      for (let i = 0; i < W * H; i++) rgba.set([img.rgb[i * 3], img.rgb[i * 3 + 1], img.rgb[i * 3 + 2], 255], i * 4)
      // As shot = the sensor (no orientation): the matte's sensor frame is the photo.
      const geo = app.resolveGeometry(app.DEFAULT_GEOMETRY, W, H, 0)
      const tensor = app.subject.subjectTensor(rgba, W, H, input)
      const feeds = { [app.subject.SUBJECT_IO.pixels]: new ort.Tensor('float32', tensor, [1, 3, input.size, input.size]) }
      let r
      let first
      let second
      try {
        let t = performance.now()
        r = await sess.run(feeds)
        first = performance.now() - t
        if (first > maxRunMs) {
          fail(`${name} on ${pname}: one run took ${ms(first)} on the CPU, over ${ms(maxRunMs)}: the rest of this file's runs are skipped`)
          break
        }
        t = performance.now()
        r = await sess.run(feeds)
        second = performance.now() - t
      } catch (e) {
        fail(`${name} on ${pname}: the model did not run (${e.message})`)
        continue
      }
      const out = r[app.subject.SUBJECT_IO.matte]
      if (!out || out.dims.join() !== [1, 1, input.size, input.size].join()) fail(`${name} on ${pname}: output [${out?.dims?.join(', ')}], expected [1, 1, ${input.size}, ${input.size}]`)
      if (!app.subject.finiteAll(out.data)) fail(`${name} on ${pname}: non-finite output`)
      const tp = performance.now()
      const prob = app.subject.subjectProbabilities(out.data, out.dims)
      const s = app.subject.subjectToSensor(prob, geo.uvToSensor, [W, H], 1024)
      const postMs = performance.now() - tp
      const raster = await app.encodeDepth(s.px, s.w, s.h)
      const back = app.decodeRaster(raster)
      if (!back || back.some((x, i) => x !== s.px[i])) fail(`${name} on ${pname}: the stored matte doesn't decode to itself`)
      let mean = 0
      for (const v of prob.data) mean += v
      mean /= prob.data.length
      const share = app.subject.subjectShare(prob)
      const cov = app.coverage(s.px)
      const rss = process.memoryUsage().rss
      // The Python reference for the same photo only: by its SHA-256 when the reference records it; else only the
      // committed photos (a photo fetched from Wikimedia Commons can differ between runs: run 40633154518).
      const photoSha = createHash('sha256').update(readFileSync(p)).digest('hex')
      const refCase = ref?.cases?.find((c) => (c.case === pname || c.case === pname.replace(/\.png$/, '.jpg')) && (c.sha256 ? c.sha256 === photoSha : COMMITTED.has(pname)))
      const pyMean = refCase?.patchedVsOriginal?.coverage?.[0]
      const run = { photo: pname, size: [W, H], first, second, postMs, share, mean, pythonMean: pyMean ?? null, matte: [s.w, s.h], coverage: cov, chars: raster.data.length, rss }
      runs.push(run)
      ;(mattes[pname] ??= []).push(s.px)
      log(`${name} on ${pname} (${W} x ${H}): model ${ms(first)} / ${ms(second)}, matte ${ms(postMs)}, cells at 1/2 ${share.toFixed(4)}, mean ${mean.toFixed(4)}${pyMean !== undefined ? ` (Python ${pyMean.toFixed(4)})` : ''}, coverage ${cov.toFixed(4)}, ${raster.data.length} chars, rss ${mb(rss)}`)
      md.push(`| ${pname} | ${ms(first)} | ${ms(second)} | ${ms(postMs)} | ${share.toFixed(4)} | ${mean.toFixed(4)}${pyMean !== undefined ? ` (${pyMean.toFixed(4)})` : ''} | ${s.w} × ${s.h} | ${cov.toFixed(4)} | ${raster.data.length.toLocaleString('en')} | ${mb(rss)} |`)
      if (k === 0) {
        writeFileSync(join(outDir, `${pname}-subject-overlay.png`), overlayPng(img.rgb, W, H, s.px))
        writeFileSync(join(outDir, `${pname}-subject-matte.png`), grey(s.px, s.w, s.h))
        // A text picture for reading the result in the log (the artifact's PNGs can't always be opened).
        log(`${pname}: the matte (@ is the subject)\n${asciiArt(s.px, s.w, s.h)}`)
        const [lo, hi] = EXPECT[pname] ?? [0, 1]
        if (EXPECT[pname] && !(cov >= lo && cov <= hi)) fail(`${pname}: subject coverage ${cov.toFixed(4)}, expected ${lo}…${hi}`)
      }
      if (pyMean !== undefined && Math.abs(pyMean - mean) > 0.02) fail(`${name} on ${pname}: the app's mean probability ${mean.toFixed(4)}, ONNX Runtime in Python ${pyMean.toFixed(4)}`)
    }
    md.push('')
    await sess.release?.()
    results.models.push({ file: name, bytes: buf.length, sha256: sha, createMs, runs })
  }
  // Two files (the published fp16 and the fp32 kept for comparison): how much their mattes agree.
  if (models.length > 1) {
    md.push('### Agreement between the files', '', '| photo | IoU at ½ |', '|---|---|')
    results.agreement = {}
    for (const [pname, list] of Object.entries(mattes)) {
      if (list.length < 2) continue
      const iou = iouOf(list[0], list[1])
      results.agreement[pname] = iou
      log(`${pname}: ${basename(models[0])} and ${basename(models[1])} agree at IoU ${iou.toFixed(4)}`)
      md.push(`| ${pname} | ${iou.toFixed(4)} |`)
      if (iou < 0.98) note(`${pname}: the two files' mattes agree at IoU ${iou.toFixed(4)} only`)
    }
    md.push('')
  }
  finish(results)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
