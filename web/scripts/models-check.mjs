// Checks the real AI model files in Node, without a browser (docs/PHASE3.md Part 24, "Pinning and checking the
// models"). Run by .github/workflows/ai-models.yml on GitHub's servers, which can reach huggingface.co.
//
//   node scripts/models-check.mjs [--manifest FILE] [--files DIR] [--variant fp16|fp32] [--threads N] [--summary FILE]
//
// For each pinned file of the manifest (default web/models/manifest.json):
//   1. its byte count and SHA-256 against the manifest (models.mjs `check`);
//   2. its inputs and outputs (names, types, shapes; expected `pixel_values` float32 [1, 3, H, W] → `predicted_depth`
//      float32 [1, H, W]; the app feeds float32 to the first input and reads the first output, fp16 file included);
//   3. one depth map of a deterministic synthetic photo, made by THE APP'S OWN CODE (src/ai/depth.ts `modelSize`,
//      `toTensor`, `toSensorFrame`; src/engine/develop/depth-map.ts `quantizeDisparity`, `encodeDepth`, `decodeDepth`,
//      bundled for Node by Vite below) with ONNX Runtime Web's WebAssembly CPU backend (the pinned onnxruntime-web, its
//      Node build): run time, output min/max/mean, whether every value is finite, and the size of the map as stored in
//      the edit and the .xmp (also at half size and at 6 bits, the options Part 24 leaves to the owner).
//
// --files DIR reads the files from DIR laid out as under dist/models/ (<id>/<revision 7>/<variant>.onnx: what
// `models.mjs pin --save DIR` writes, and `models.mjs fetch --out X` under X/models); without it each file is
// downloaded from its pinned Hugging Face URL. Exit 1 on a size or hash mismatch, an unpinned or missing file, a model
// that doesn't load, run or give an output, or non-finite fp32 output (fp16's non-finite output, ORT issue #26732, is
// reported only: the app then tells the user to use fp32). The WebGPU provider isn't exercised here (no GPU in Node).

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { check, download, MANIFEST, pinned, servedPath, sha256, sourceUrl } from './models.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')

/** The photo the check runs on: a 6000 × 4000 camera file, rendered "as shot" at the size Develop would (renderSize). */
export const PHOTO = { sensor: [6000, 4000], render: [1176, 784] }

/** min, max, mean (of the finite values) and how many values aren't finite. */
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
  return { count: d.length, finite, nonFinite: d.length - finite, min: finite ? min : NaN, max: finite ? max : NaN, mean: finite ? sum / finite : NaN }
}

/**
 * A deterministic synthetic photo (RGBA, 8 bits) with depth cues a depth model responds to: a sky gradient, a horizon,
 * a ground plane whose texture gets finer towards the horizon, a near subject (a shaded ball) and a far building.
 */
export function syntheticPhoto(w, h) {
  const px = new Uint8ClampedArray(w * h * 4)
  const horizon = 0.42 * h
  const ball = { x: 0.32 * w, y: 0.7 * h, r: 0.17 * h }
  const house = { x0: 0.62 * w, x1: 0.78 * w, y0: 0.3 * h, y1: horizon }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r
      let g
      let b
      if (y < horizon) {
        const t = y / horizon
        r = 90 + 80 * t
        g = 140 + 70 * t
        b = 220 + 25 * t
        if (x >= house.x0 && x < house.x1 && y >= house.y0) {
          const win = Math.floor((x - house.x0) / 9) % 3 === 1 && Math.floor((y - house.y0) / 9) % 3 === 1
          r = win ? 60 : 170
          g = win ? 70 : 150
          b = win ? 90 : 130
        }
      } else {
        // Ground: stripes at a spacing that shrinks towards the horizon, as on a receding plane.
        const z = (y - horizon) / (h - horizon) // 0 at the horizon, 1 at the bottom
        const persp = 1 / Math.max(0.02, z)
        const stripe = Math.sin(persp * 6) > 0 ? 1 : 0.82
        const lx = Math.sin((x - w / 2) * z * 0.05) * 0.06
        r = (70 + 40 * z) * (stripe + lx)
        g = (110 + 50 * z) * (stripe + lx)
        b = (50 + 20 * z) * (stripe + lx)
      }
      const dx = x - ball.x
      const dy = y - ball.y
      const d2 = dx * dx + dy * dy
      if (d2 < ball.r * ball.r) {
        const nz = Math.sqrt(1 - d2 / (ball.r * ball.r))
        const shade = 0.25 + 0.75 * Math.max(0, (-dx * 0.5 - dy * 0.6) / ball.r + nz * 0.6)
        r = 230 * shade
        g = 60 * shade
        b = 40 * shade
      }
      const i = (y * w + x) * 4
      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
      px[i + 3] = 255
    }
  }
  return px
}

/** A map at half size (each side rounded up; a box over the 2 × 2 texels, or fewer at an odd edge). */
export function halfSize(px, w, h) {
  const hw = Math.ceil(w / 2)
  const hh = Math.ceil(h / 2)
  const out = new Uint8Array(hw * hh)
  for (let j = 0; j < hh; j++) {
    for (let i = 0; i < hw; i++) {
      let s = 0
      let n = 0
      for (let y = 2 * j; y < Math.min(h, 2 * j + 2); y++) {
        for (let x = 2 * i; x < Math.min(w, 2 * i + 2); x++) {
          s += px[y * w + x]
          n++
        }
      }
      out[j * hw + i] = Math.round(s / n)
    }
  }
  return { px: out, w: hw, h: hh }
}

/** A map kept to `bits` bits (2^bits levels spread over 0…255, so it stays a valid 8-bit map). */
export function toBits(px, bits) {
  const top = (1 << bits) - 1
  return px.map((v) => Math.round((Math.round((v * top) / 255) * 255) / top))
}

/**
 * Mean map values (255 = nearest) over parts of the synthetic photo, in uv so any map size works: the sky, the far
 * building, the near ball and the ground along the bottom edge.
 */
export function regionMeans(px, w, h) {
  const mean = (u0, u1, v0, v1) => {
    let s = 0
    let n = 0
    for (let j = Math.floor(v0 * h); j < Math.max(Math.floor(v0 * h) + 1, Math.floor(v1 * h)); j++) {
      for (let i = Math.floor(u0 * w); i < Math.max(Math.floor(u0 * w) + 1, Math.floor(u1 * w)); i++) {
        s += px[Math.min(h - 1, j) * w + Math.min(w - 1, i)]
        n++
      }
    }
    return s / n
  }
  // The ball: centre (0.32 w, 0.7 h), radius 0.17 h, so about ±0.08 w and ±0.12 h fit inside it at a 3:2 aspect.
  return { sky: mean(0.05, 0.5, 0.02, 0.2), building: mean(0.64, 0.76, 0.33, 0.4), ball: mean(0.28, 0.36, 0.64, 0.76), bottom: mean(0.55, 0.95, 0.93, 1) }
}

/** Mean and largest absolute difference between two maps of the same size. */
export function mapDifference(a, b) {
  if (a.length !== b.length) return null
  let sum = 0
  let max = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    sum += d
    if (d > max) max = d
  }
  return { mean: sum / a.length, max }
}

const shapeText = (s) => `[${(s ?? []).map((d) => (typeof d === 'number' ? d : JSON.stringify(d))).join(', ')}]`

/**
 * What a session's inputs and outputs are, against what the app expects: `problems` stop the app (it feeds a float32
 * [1, 3, H, W] image to the first input and reads a float32 map from the first output); `notes` are only different
 * from the expected export (other names, fixed sizes).
 */
export function ioReport(inputs, outputs) {
  const lines = []
  const problems = []
  const notes = []
  for (const [kind, list] of [['input', inputs], ['output', outputs]]) {
    for (const m of list) lines.push(`${kind} ${m.name}: ${m.isTensor === false ? 'not a tensor' : `${m.type} ${shapeText(m.shape)}`}`)
  }
  const i = inputs[0]
  const o = outputs[0]
  if (!i) problems.push('no input')
  else {
    if (i.name !== 'pixel_values') notes.push(`first input is "${i.name}", not "pixel_values" (the app uses the first input whatever its name)`)
    if (i.type !== 'float32') problems.push(`first input is ${i.type}, not float32 (the app feeds float32)`)
    const s = i.shape ?? []
    if (s.length !== 4 || (typeof s[1] === 'number' && s[1] !== 3) || (s[3] === 3 && s[1] !== 3) || (typeof s[0] === 'number' && s[0] !== 1)) problems.push(`first input is ${shapeText(s)}, not [1, 3, H, W]`)
    else if (typeof s[2] === 'number' && typeof s[3] === 'number') notes.push(`fixed input size ${s[3]} × ${s[2]} (the app then uses it)`)
  }
  if (!o) problems.push('no output')
  else {
    if (o.name !== 'predicted_depth') notes.push(`first output is "${o.name}", not "predicted_depth" (the app uses the first output whatever its name)`)
    if (o.type !== 'float32') problems.push(`first output is ${o.type}, not float32 (the app reads float32)`)
    const s = o.shape ?? []
    if (!(s.length === 3 || s.length === 4)) problems.push(`first output is ${shapeText(s)}, not [1, H, W]`)
  }
  if (inputs.length > 1) notes.push(`${inputs.length} inputs (the app feeds only the first)`)
  return { lines, problems, notes }
}

/** The fixed (height, width) of an input of shape [1, 3, H, W], as runtime.ts `modelInputShape` reads it. */
export function fixedSize(shape) {
  const s = shape ?? []
  return s.length === 4 && typeof s[2] === 'number' && typeof s[3] === 'number' && s[2] > 0 && s[3] > 0 ? [s[2], s[3]] : null
}

const ROWS = ['file', 'inputs / outputs', 'input size', 'session', 'run', 'output min / max / mean', 'all finite', 'depth map', '.xmp map (chars)', 'fp16 vs fp32']

/** A Markdown table: one column per file checked, a row per check ("–" where a check didn't run). */
export function summaryTable(cols) {
  const esc = (v) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const used = ROWS.filter((r) => cols.some((c) => c.cells[r] !== undefined))
  return [`| | ${cols.map((c) => c.variant).join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`, ...used.map((r) => `| ${r} | ${cols.map((c) => esc(c.cells[r] ?? '–')).join(' | ')} |`)]
}

/**
 * The app's own code, bundled for Node by Vite (SSR build, no app config): depth.ts's preprocessing and depth-map.ts's
 * encoding. depth.ts's import of the browser runtime (a worker) is replaced by a stub that throws if called.
 */
export async function loadAppCode() {
  const { build } = await import('vite')
  const outDir = join(WEB, 'node_modules/.cache/models-check')
  const src = join(WEB, 'src').replace(/\\/g, '/')
  const ENTRY = '\0models-check-entry'
  await build({
    configFile: false,
    root: WEB,
    logLevel: 'warn',
    plugins: [
      {
        name: 'models-check',
        enforce: 'pre',
        resolveId: (id) => (id === 'models-check-entry' ? ENTRY : null),
        load(id) {
          if (id === ENTRY) {
            return [
              `export { modelSize, toTensor, toSensorFrame } from '${src}/ai/depth.ts'`,
              `export { encodeDepth, decodeDepth, quantizeDisparity } from '${src}/engine/develop/depth-map.ts'`,
              `export { IDENTITY_MAP } from '${src}/engine/develop/geometry.ts'`,
            ].join('\n')
          }
          if (id.replace(/\\/g, '/').endsWith('/src/ai/runtime.ts')) {
            return `const no = () => { throw new Error('the browser runtime is not used by models-check') }\nexport const prepareModel = no\nexport const runModel = no\n`
          }
          return null
        },
      },
    ],
    build: {
      ssr: true,
      outDir,
      emptyOutDir: true,
      minify: false,
      copyPublicDir: false,
      rollupOptions: { input: { 'app-code': 'models-check-entry' }, output: { entryFileNames: '[name].mjs' } },
    },
  })
  return import(`${pathToFileURL(join(outDir, 'app-code.mjs')).href}?t=${Date.now()}`)
}

const arg = (args, name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const fmt = (v, d = 4) => (Number.isFinite(v) ? Number(v.toFixed(d)).toString() : String(v))
const ms = (t) => `${Math.round(t)} ms`

async function main(args) {
  const manifestPath = arg(args, '--manifest') ?? MANIFEST
  const filesDir = arg(args, '--files')
  const only = arg(args, '--variant')
  const threads = Math.max(1, Number(arg(args, '--threads') ?? Math.min(4, availableParallelism())))
  const summaryFile = arg(args, '--summary') ?? process.env.GITHUB_STEP_SUMMARY
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const failures = []
  const warnings = []
  const md = []
  const gha = !!process.env.GITHUB_ACTIONS
  const warn = (msg) => {
    warnings.push(msg)
    console.log(gha ? `::warning::${msg}` : `WARNING ${msg}`)
  }
  const fail = (msg) => {
    failures.push(msg)
    console.log(`FAIL ${msg}`)
  }

  console.log(`manifest ${manifestPath}`)
  console.log(`node ${process.version}, ${threads} thread(s)`)
  const t0 = performance.now()
  const app = await loadAppCode()
  console.log(`app code bundled from web/src in ${ms(performance.now() - t0)}`)
  const ort = await import('onnxruntime-web')
  ort.env.wasm.numThreads = threads
  ort.env.logLevel = 'error'
  console.log(`onnxruntime-web ${ort.env.versions?.web ?? '?'} (WebAssembly CPU backend, Node build)`)

  const [rw, rh] = PHOTO.render
  const rgba = syntheticPhoto(rw, rh)
  console.log(`test photo: synthetic ${rw} x ${rh} (a ${PHOTO.sensor.join(' x ')} photo as Develop renders it for the model), sha256 ${sha256(Buffer.from(rgba.buffer)).slice(0, 16)}`)

  for (const m of manifest.models) {
    if (m.task !== 'depth') {
      // AI Remove's Moebius has its own check (scripts/moebius-check.mjs, the workflow's moebius-check task).
      console.log(`\n== ${m.id}: skipped here (checked by scripts/moebius-check.mjs)`)
      continue
    }
    console.log(`\n== ${m.id} (${m.source.repo} @ ${m.source.revision ?? 'not pinned'})`)
    md.push(`### ${m.name}`, '', `\`${m.source.repo}\` @ \`${m.source.revision ?? 'not pinned'}\``, '')
    const cols = []
    const maps = {}
    for (const f of m.files) {
      if (only && f.variant !== only) continue
      console.log(`\n-- ${f.variant}: ${f.path}`)
      const cells = {}
      cols.push({ variant: f.variant, cells })
      const row = (name, v) => (cells[name] = v)
      // 1. Integrity.
      if (!pinned(m, f)) {
        fail(`${m.id} ${f.variant}: not pinned (no revision or SHA-256 in the manifest): nothing to check against; run the pin task first`)
        row('file', 'not pinned')
        continue
      }
      let buf
      try {
        if (filesDir) {
          const p = join(filesDir, servedPath(m, f).slice('models/'.length))
          if (!existsSync(p)) throw new Error(`missing ${p}`)
          buf = readFileSync(p)
        } else {
          console.log(`downloading ${sourceUrl(m, f)}`)
          buf = await download(sourceUrl(m, f))
        }
      } catch (e) {
        fail(`${m.id} ${f.variant}: ${e.message}`)
        row('file', 'missing')
        continue
      }
      const why = check(buf, f)
      if (why) {
        fail(`${m.id} ${f.variant}: ${why}`)
        row('file', `**mismatch: ${why}**`)
        continue
      }
      console.log(`ok size ${buf.length} bytes, sha256 ${f.sha256}`)
      row('file', `${buf.length.toLocaleString('en')} bytes, SHA-256 ok`)

      // 2. Inputs and outputs.
      let session
      const ts = performance.now()
      try {
        session = await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 })
      } catch (e) {
        fail(`${m.id} ${f.variant}: doesn't load: ${e.message}`)
        row('inputs / outputs', `**doesn’t load:** ${e.message}`)
        continue
      }
      const sessionMs = performance.now() - ts
      const meta = (names, list) => names.map((name, k) => ({ name, ...(list?.[k] ?? {}) }))
      const io = ioReport(meta(session.inputNames, session.inputMetadata), meta(session.outputNames, session.outputMetadata))
      for (const l of io.lines) console.log(l)
      for (const n of io.notes) console.log(`note: ${n}`)
      if (f.variant === 'fp16') console.log(io.problems.length ? 'fp16 file: its inputs/outputs are not all float32 (see below)' : 'fp16 file: float32 inputs and outputs, as the app needs')
      for (const p of io.problems) fail(`${m.id} ${f.variant}: ${p}`)
      row('inputs / outputs', io.lines.map((l) => l.replace(/^(input|output) /, '')).join('<br>') + (io.problems.length ? `<br>**${io.problems.join('; ')}**` : ''))

      // 3. One depth map through the app's own code.
      const fixed = fixedSize(session.inputMetadata?.[0]?.shape)
      const [mw, mh] = app.modelSize(PHOTO.sensor[0], PHOTO.sensor[1], m.input, fixed)
      const tensor = app.toTensor(rgba, rw, rh, mw, mh, m.input.mean, m.input.std)
      console.log(`input ${mw} x ${mh} (float32 [1, 3, ${mh}, ${mw}])`)
      row('input size', `${mw} × ${mh}`)
      row('session', ms(sessionMs))
      let out
      const times = []
      try {
        for (let k = 0; k < 2; k++) {
          const tr = performance.now()
          const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, mh, mw]) })
          times.push(performance.now() - tr)
          out = res[session.outputNames[0]]
        }
      } catch (e) {
        fail(`${m.id} ${f.variant}: run failed: ${e.message}`)
        row('run', `**failed:** ${e.message}`)
        await session.release().catch(() => {})
        continue
      }
      await session.release().catch(() => {})
      if (!out) {
        fail(`${m.id} ${f.variant}: no output`)
        row('run', '**no output**')
        continue
      }
      const data = out.data instanceof Float32Array ? out.data : Float32Array.from(out.data)
      const dims = [...out.dims]
      const oh = dims[dims.length - 2]
      const ow = dims[dims.length - 1]
      console.log(`session created in ${ms(sessionMs)}; run ${times.map(ms).join(', then ')} (first run includes warm-up)`)
      console.log(`output ${out.type} [${dims.join(', ')}]`)
      row('run', `${times.map(ms).join(', ')} (${threads} thread${threads > 1 ? 's' : ''})`)
      const st = stats(data)
      console.log(`output min ${fmt(st.min)} max ${fmt(st.max)} mean ${fmt(st.mean)}; ${st.nonFinite ? `${st.nonFinite} of ${st.count} values NOT finite` : `all ${st.count} values finite`}`)
      row('output min / max / mean', `${fmt(st.min)} / ${fmt(st.max)} / ${fmt(st.mean)}`)
      row('all finite', st.nonFinite ? `**no: ${st.nonFinite} of ${st.count}**` : 'yes')
      if (ow * oh !== data.length || ow < 1 || oh < 1) {
        fail(`${m.id} ${f.variant}: output [${dims.join(', ')}] doesn't hold one ${ow} x ${oh} map`)
        continue
      }
      if (ow !== mw || oh !== mh) console.log(`note: output map ${ow} x ${oh} for a ${mw} x ${mh} input`)
      if (st.nonFinite) {
        if (f.variant === 'fp32') fail(`${m.id} fp32: non-finite output`)
        else warn(`${m.id} fp16 gave ${st.nonFinite} non-finite values on ONNX Runtime's CPU backend (ORT issue #26732 is the GPU case); the app tells the user to use fp32 when this happens`)
        continue
      }
      const q = app.quantizeDisparity(data)
      const sensor = app.toSensorFrame(q, ow, oh, app.IDENTITY_MAP, PHOTO.sensor)
      maps[f.variant] = sensor.px
      const raster = await app.encodeDepth(sensor.px, sensor.w, sensor.h)
      const back = app.decodeDepth(raster)
      const roundTrip = !!back && back.every((v, k) => v === sensor.px[k])
      if (!roundTrip) fail(`${m.id} ${f.variant}: the encoded depth map doesn't decode to itself`)
      const half = halfSize(sensor.px, sensor.w, sensor.h)
      const sizes = {
        full: raster.data.length,
        half: (await app.encodeDepth(half.px, half.w, half.h)).data.length,
        six: (await app.encodeDepth(toBits(sensor.px, 6), sensor.w, sensor.h)).data.length,
        halfSix: (await app.encodeDepth(toBits(half.px, 6), half.w, half.h)).data.length,
      }
      const r = regionMeans(sensor.px, sensor.w, sensor.h)
      console.log(`depth map ${sensor.w} x ${sensor.h} (sensor frame, 255 = nearest), round trip ${roundTrip ? 'ok' : 'FAILED'}`)
      console.log(`depth map means: sky ${fmt(r.sky, 1)}, far building ${fmt(r.building, 1)}, near ball ${fmt(r.ball, 1)}, ground at the bottom ${fmt(r.bottom, 1)} (a depth model should give sky < building < ball and bottom; reported, not checked)`)
      row('depth map', `${sensor.w} × ${sensor.h}, round trip ${roundTrip ? 'ok' : '**failed**'}; means: sky ${fmt(r.sky, 0)}, building ${fmt(r.building, 0)}, ball ${fmt(r.ball, 0)}, bottom ${fmt(r.bottom, 0)}`)
      console.log(`.xmp depth map: ${sizes.full} chars (${fmt(sizes.full / 1024, 1)} KiB); half size (${half.w} x ${half.h}) ${sizes.half}; 6-bit ${sizes.six}; half size and 6-bit ${sizes.halfSix}`)
      row('.xmp map (chars)', `${sizes.full.toLocaleString('en')} (${sensor.w} × ${sensor.h}); half ${sizes.half.toLocaleString('en')}; 6-bit ${sizes.six.toLocaleString('en')}; half + 6-bit ${sizes.halfSix.toLocaleString('en')}`)
    }
    if (maps.fp16 && maps.fp32) {
      const d = mapDifference(maps.fp16, maps.fp32)
      if (d) {
        console.log(`\nfp16 vs fp32 depth maps (8-bit levels): mean difference ${fmt(d.mean, 2)}, largest ${d.max}`)
        cols.find((c) => c.variant === 'fp16').cells['fp16 vs fp32'] = `mean ${fmt(d.mean, 2)}, largest ${d.max} (8-bit levels)`
      }
    }
    md.push(...summaryTable(cols), '')
  }

  console.log(failures.length ? `\nRESULT: ${failures.length} problem(s):\n${failures.map((f) => `  - ${f}`).join('\n')}` : `\nRESULT: all checks passed${warnings.length ? ` (${warnings.length} warning(s))` : ''}`)
  if (gha && failures.length) console.log(`::error::AI model check: ${failures.length} problem(s), the first: ${failures[0]}`)
  if (summaryFile) {
    const head = ['## AI model check', '', `Node ${process.version}, onnxruntime-web ${ort.env.versions?.web ?? '?'} (WebAssembly CPU backend), ${threads} thread(s). Test photo: synthetic, ${rw} × ${rh} (a ${PHOTO.sensor.join(' × ')} photo as Develop renders it), through the app's own preprocessing and depth-map encoding.`, '']
    const tail = [
      ...(failures.length ? [`**${failures.length} problem(s):**`, '', ...failures.map((f) => `- ${f}`), ''] : ['**All checks passed.**', '']),
      ...(warnings.length ? ['Warnings:', '', ...warnings.map((w) => `- ${w}`), ''] : []),
    ]
    appendFileSync(summaryFile, [...head, ...md, ...tail].join('\n') + '\n')
  }
  return failures.length ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`FAIL ${e.stack ?? e.message}`)
      process.exit(1)
    },
  )
}
