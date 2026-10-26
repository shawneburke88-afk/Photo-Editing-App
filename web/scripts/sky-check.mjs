// Checks the Sky mask's real model in Node, without a browser (docs/PHASE3.md Part 29). Run by the "AI models"
// workflow's efficientvit-export task (on the file it has just exported) and sky-check task (on the file the manifest
// pins, downloaded from its GitHub Release) on GitHub's servers.
//
//   node scripts/sky-check.mjs --photos A.png,B.png [--files DIR | --model FILE] [--out DIR] [--threads N]
//                              [--backend wasm|node] [--sizes 384,512,640,768,1024] [--reference export.json]
//                              [--manifest FILE] [--summary FILE]
//
//   1. The model file: --model FILE, or DIR/<the manifest's file name> (--files), or downloaded from the manifest's pinned
//      URL; checked against the manifest's size and SHA-256 when the manifest pins it.
//   2. Its inputs and outputs: `pixel_values` float32 [1, 3, H, W] (H and W free) → `logits` float32 [1, 150, H/8, W/8].
//   3. THE APP'S OWN pre- and post-processing (src/ai/sky.ts: the input size, the tensor, the sky's margin, the edge
//      refinement and the matte in the sensor frame; src/engine/develop/depth-map.ts: the stored encoding), bundled for
//      Node by Vite, with ONNX Runtime's CPU kernels: by default the app's own onnxruntime-web WebAssembly (its CPU
//      fallback), --threads threads. On each photo (PNG; the photo is the as-shot rendering and the sensor frame), at
//      each short side of --sizes (the app uses the manifest's 512): the time of the model's first and second run and of
//      the matte, every output finite, the share of cells the model calls sky, the matte's coverage and its size in the
//      edit, and how much each size's matte agrees with the largest size's (IoU) — the quality against speed table.
//   4. Checks: finite outputs; the stored matte decodes to itself; at 512, rocket's sky between 0.80 and 0.95 of the
//      photo and astronaut's under 0.02 (no sky there); with --reference (the export's export.json), the app's share of
//      sky cells within 0.03 of PyTorch's on the same photo at the same size (the app resizes by area, the export check
//      bicubically); the CPU fallback's first run within the owner's 15 s rule.
//   Mattes and overlays go to --out as PNGs (the run's artifact); results.json and summary.md beside them.

import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { decodePng, encodePng } from './moebius-check.mjs'
import { MANIFEST, sourceUrl, download } from './models.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
export const CPU_LIMIT_MS = 15_000
/** Expected sky (matte coverage at the app's 512) on the committed photos. */
export const EXPECT = { 'rocket.png': [0.8, 0.95], 'astronaut.png': [0, 0.02] }

const arg = (args, name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const ms = (t) => `${Math.round(t).toLocaleString('en')} ms`

/** Intersection over union of two binary mattes (≥ 128 counts as in); 1 when both are empty. */
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

/** The photo with the matte tinted blue over it. */
function overlayPng(rgb, w, h, matte) {
  const out = Uint8Array.from(rgb)
  for (let i = 0; i < w * h; i++) {
    const a = (matte[i] / 255) * 0.6
    out[i * 3] = Math.round(out[i * 3] * (1 - a))
    out[i * 3 + 1] = Math.round(out[i * 3 + 1] * (1 - a) + 80 * a)
    out[i * 3 + 2] = Math.round(out[i * 3 + 2] * (1 - a) + 255 * a)
  }
  return encodePng(w, h, out)
}
const grey = (px, w, h) => encodePng(w, h, Uint8Array.from({ length: w * h * 3 }, (_, i) => px[Math.floor(i / 3)]))

/** The app's own code, bundled for Node by Vite (SSR build, no app config), as sam-check.mjs does. */
async function loadAppCode() {
  const { build } = await import('vite')
  const outDir = join(WEB, 'node_modules/.cache/sky-check')
  const src = join(WEB, 'src').replace(/\\/g, '/')
  const ENTRY = '\0sky-check-entry'
  await build({
    configFile: false,
    root: WEB,
    logLevel: 'warn',
    plugins: [
      {
        name: 'sky-check',
        enforce: 'pre',
        resolveId: (id) => (id === 'sky-check-entry' ? ENTRY : null),
        load(id) {
          if (id !== ENTRY) return null
          return [
            `export * as sky from '${src}/ai/sky.ts'`,
            `export { coverage } from '${src}/ai/segment.ts'`,
            `export { encodeDepth, decodeRaster } from '${src}/engine/develop/depth-map.ts'`,
            `export { resolveGeometry, DEFAULT_GEOMETRY } from '${src}/engine/develop/geometry.ts'`,
          ].join('\n')
        },
      },
      {
        // sky.ts imports ai/depth.ts for its resize, which imports the runtime (a worker): never run here.
        name: 'sky-check-runtime-stub',
        enforce: 'pre',
        resolveId: (id, importer) => (importer && /src\/ai\/depth\.ts$/.test(importer) && id === './runtime' ? '\0sky-check-runtime' : null),
        load: (id) => (id === '\0sky-check-runtime' ? 'export const prepareModel = () => { throw new Error("not in sky-check") }; export const runModel = prepareModel' : null),
      },
    ],
    build: {
      ssr: true,
      outDir,
      emptyOutDir: true,
      minify: false,
      copyPublicDir: false,
      rollupOptions: { input: { 'app-code': 'sky-check-entry' }, output: { entryFileNames: '[name].mjs' } },
    },
  })
  return import(`${pathToFileURL(join(outDir, 'app-code.mjs')).href}?t=${Date.now()}`)
}

async function main(args) {
  const outDir = arg(args, '--out') ?? join(WEB, 'node_modules/.cache/sky-check-out')
  const backend = arg(args, '--backend') ?? 'wasm'
  const threads = Math.max(1, Number(arg(args, '--threads') ?? Math.min(4, availableParallelism())))
  const sizes = (arg(args, '--sizes') ?? '384,512,640,768,1024').split(',').map(Number)
  const photos = (arg(args, '--photos') ?? '').split(',').filter(Boolean)
  const summaryFile = arg(args, '--summary') ?? process.env.GITHUB_STEP_SUMMARY
  const refFile = arg(args, '--reference')
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
  const m = manifest.models.find((x) => x.task === 'sky')
  if (!m) throw new Error('no sky model in the manifest')
  const f = m.files[0]
  const pinned = /^[0-9a-f]{40}$/.test(m.source.revision ?? '') && /^[0-9a-f]{64}$/.test(f.sha256 ?? '')
  md.push('## Sky: EfficientViT-Seg B1 (ADE20K) through the app’s code', '', `node ${process.version}, backend ${backend === 'node' ? 'onnxruntime-node (CPU)' : `onnxruntime-web WebAssembly, the app's CPU fallback (${threads} threads)`}.`, '')

  // 1. The file.
  let file = arg(args, '--model') ?? (arg(args, '--files') ? join(arg(args, '--files'), f.path) : null)
  let buf
  if (file && existsSync(file)) buf = readFileSync(file)
  else {
    if (!pinned) throw new Error('no --model or --files, and the manifest does not pin the Sky model yet')
    log(`downloading ${sourceUrl(m, f)}`)
    buf = await download(sourceUrl(m, f), 4)
    file = join(outDir, f.path)
    writeFileSync(file, buf)
  }
  const sha = createHash('sha256').update(buf).digest('hex')
  log(`${basename(file)}: ${buf.length} bytes, sha256 ${sha}`)
  md.push(`File \`${basename(file)}\`: ${buf.length.toLocaleString('en')} bytes, SHA-256 \`${sha}\`${pinned ? (sha === f.sha256 && buf.length === f.bytes ? ' (matches the manifest)' : ' (**does not match the manifest**)') : ' (the manifest does not pin it yet)'}.`, '')
  if (pinned && (sha !== f.sha256 || buf.length !== f.bytes)) {
    fail(`${f.path}: ${buf.length} bytes sha256 ${sha}, the manifest pins ${f.bytes} ${f.sha256}`)
    return finish({})
  }

  // 2. The runtime, the app's code, the session.
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
  const t0 = performance.now()
  const sess = await ort.InferenceSession.create(new Uint8Array(buf), sessionOpts)
  const createMs = performance.now() - t0
  const ins = (sess.inputMetadata ?? []).map((x) => ({ name: x.name, type: x.type, shape: x.shape }))
  const outs = (sess.outputMetadata ?? []).map((x) => ({ name: x.name, type: x.type, shape: x.shape }))
  log(`session ${ms(createMs)}; in ${JSON.stringify(ins)}; out ${JSON.stringify(outs)}`)
  if (sess.inputNames.join() !== 'pixel_values' || sess.outputNames.join() !== 'logits') fail(`inputs ${sess.inputNames.join()} and outputs ${sess.outputNames.join()}, expected pixel_values and logits`)
  md.push(`Session ${ms(createMs)}. Input ${ins.map((x) => `\`${x.name}\` ${x.type ?? ''} [${(x.shape ?? []).join(', ')}]`).join(', ')}; output ${outs.map((x) => `\`${x.name}\` ${x.type ?? ''} [${(x.shape ?? []).join(', ')}]`).join(', ')}.`, '')

  const ref = refFile && existsSync(refFile) ? JSON.parse(readFileSync(refFile, 'utf8')) : null
  const results = { file: { bytes: buf.length, sha256: sha }, createMs, runs: [] }
  md.push('### Each photo at each input size', '', '| photo | short side | input | model, first run | model, second run | matte | sky cells | matte coverage (no refinement) | IoU with the largest size | matte chars |', '|---|---|---|---|---|---|---|---|---|---|')
  for (const p of photos) {
    const img = decodePng(readFileSync(p))
    const { width: W, height: H } = img
    const name = basename(p)
    const rgba = new Uint8ClampedArray(W * H * 4)
    for (let i = 0; i < W * H; i++) rgba.set([img.rgb[i * 3], img.rgb[i * 3 + 1], img.rgb[i * 3 + 2], 255], i * 4)
    // As shot = the sensor (no orientation): the matte's sensor frame is the photo.
    const geo = app.resolveGeometry(app.DEFAULT_GEOMETRY, W, H, 0)
    const perSize = []
    for (const S of sizes) {
      const input = { ...m.input, shortSide: S }
      const [mw, mh] = app.sky.skyModelSize(W, H, input)
      const tensor = app.sky.skyTensor(rgba, W, H, mw, mh, input)
      const feeds = { pixel_values: new ort.Tensor('float32', tensor, [1, 3, mh, mw]) }
      let r
      let first
      let second
      try {
        let t = performance.now()
        r = await sess.run(feeds)
        first = performance.now() - t
        t = performance.now()
        r = await sess.run(feeds)
        second = performance.now() - t
      } catch (e) {
        fail(`${name} at ${S}: the model did not run (${e.message})`)
        continue
      }
      const out = r.logits
      if (!out || out.dims.join() !== [1, 150, mh / 8, mw / 8].join()) fail(`${name} at ${S}: output [${out?.dims?.join(', ')}], expected [1, 150, ${mh / 8}, ${mw / 8}]`)
      if (!app.sky.finiteAll(out.data)) fail(`${name} at ${S}: non-finite output`)
      const share = app.sky.skyArgmaxShare(out.data, out.dims, m.input.skyClass)
      const tp = performance.now()
      const lo = app.sky.skyMargin(out.data, out.dims, m.input.skyClass)
      const matte = app.sky.skyMatte(lo, rgba, W, H)
      const s = app.sky.skyToSensor(matte, W, H, geo.uvToSensor, [W, H], 1024)
      const postMs = performance.now() - tp
      const plain = app.sky.skyToSensor(app.sky.skyMatte(lo, rgba, W, H, null), W, H, geo.uvToSensor, [W, H], 1024)
      const raster = await app.encodeDepth(s.px, s.w, s.h)
      const back = app.decodeRaster(raster)
      if (!back || back.some((x, i) => x !== s.px[i])) fail(`${name} at ${S}: the stored matte doesn't decode to itself`)
      const cov = app.coverage(s.px)
      const run = { photo: name, S, input: [mw, mh], first, second, postMs, share, coverage: cov, plainCoverage: app.coverage(plain.px), chars: raster.data.length, px: s.px, matte: [s.w, s.h] }
      perSize.push(run)
      log(`${name} S=${S} (${mw} x ${mh}): model ${ms(first)} / ${ms(second)}, matte ${ms(postMs)}, sky cells ${share.toFixed(4)}, coverage ${cov.toFixed(4)} (no refinement ${run.plainCoverage.toFixed(4)}), ${raster.data.length} chars`)
      if (S === m.input.shortSide) {
        writeFileSync(join(outDir, `${name}-sky-overlay.png`), overlayPng(img.rgb, W, H, s.px))
        writeFileSync(join(outDir, `${name}-sky-matte.png`), grey(s.px, s.w, s.h))
        writeFileSync(join(outDir, `${name}-sky-matte-unrefined.png`), grey(plain.px, plain.w, plain.h))
        const [lo0, hi0] = EXPECT[name] ?? [0, 1]
        if (EXPECT[name] && !(cov >= lo0 && cov <= hi0)) fail(`${name}: sky coverage ${cov.toFixed(4)} at ${S}, expected ${lo0}…${hi0}`)
        const refCase = ref?.cases?.find((c) => c.case.startsWith(`${name} at the app's size`))
        if (refCase) {
          const d = Math.abs(refCase.skyShareTorch - share)
          log(`${name}: sky cells ${share.toFixed(4)} here, ${refCase.skyShareTorch.toFixed(4)} in PyTorch (bicubic resize): difference ${d.toFixed(4)}`)
          md.push(`| ${name} | (PyTorch, ${refCase.input.slice(2).reverse().join(' × ')}) | | | | | ${refCase.skyShareTorch.toFixed(4)} | | | |`)
          if (d > 0.03) fail(`${name}: the app's sky cells ${share.toFixed(4)}, PyTorch's ${refCase.skyShareTorch.toFixed(4)}`)
        }
        if (backend === 'wasm' && first > CPU_LIMIT_MS) note(`${name}: the CPU fallback's first run took ${ms(first)}, over the 15 s rule`)
      }
    }
    const top = perSize[perSize.length - 1]
    for (const r of perSize) {
      r.iouLargest = top ? iouOf(r.px, top.px) : 1
      md.push(`| ${name} | ${r.S}${r.S === m.input.shortSide ? ' (the app’s)' : ''} | ${r.input.join(' × ')} | ${ms(r.first)} | ${ms(r.second)} | ${ms(r.postMs)} | ${r.share.toFixed(4)} | ${r.coverage.toFixed(4)} (${r.plainCoverage.toFixed(4)}) | ${r.iouLargest.toFixed(4)} | ${r.chars.toLocaleString('en')} |`)
      const { px: _px, ...rest } = r
      void _px
      results.runs.push(rest)
    }
  }
  md.push('')
  await sess.release?.()
  finish(results)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
