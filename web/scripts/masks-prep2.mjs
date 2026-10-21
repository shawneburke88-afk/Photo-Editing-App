// AI masks prep, follow-up (throwaway branch lightbench/ai-masks-prep): SAM 2.1 fp32 on WebGPU and BiRefNet_lite.
// Run by the "AI models" workflow's masks-prep2 task after masks-prep.mjs pin / run --ep cpu (which saves the exact
// CPU inputs and outputs under D/raw) and fix_models.py (patched models under D/fixed).
//
//   node scripts/masks-prep2.mjs bisect  --dir D   first node where WebGPU and CPU diverge in the SAM 2.1 fp32 encoder
//   node scripts/masks-prep2.mjs verify  --dir D   patched models: CPU vs original CPU, WebGPU (child processes)
//   node scripts/masks-prep2.mjs browser-jobs --dir D   job list for masks-prep/browser-run.mjs
//   node scripts/masks-prep2.mjs report  --dir D   MASKS_PREP2_RESULT lines and the step summary
//
// onnxruntime-node 1.30.0 from ORT_NODE_DIR; Python (onnx) from PYTHON (default python).

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = join(HERE, 'masks-prep', 'fix_models.py')
const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const DIR = opt('--dir', process.env.MASKS_DIR ?? '')
const PY = process.env.PYTHON ?? 'python'
const readJson = (p, d = null) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d)
const writeJson = (p, x) => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, `${JSON.stringify(x, null, 1)}\n`))
const pins = () => readJson(join(DIR, 'pins.json'))
const raw = (n) => {
  const b = readFileSync(join(DIR, 'raw', n))
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
}
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

let ort
const O = () => (ort ??= createRequire(join(process.env.ORT_NODE_DIR ?? '.', 'node_modules', 'x.js'))('onnxruntime-node'))
const sess = (p, ep, level = 'all') => O().InferenceSession.create(p, { executionProviders: [ep], graphOptimizationLevel: level })
const f32 = (t) => (t.type === 'float32' ? t.data : Float32Array.from(t.data, Number))

function py(argv) {
  const r = spawnSync(PY, ['-I', FIX, ...argv], { encoding: 'utf8', maxBuffer: 1 << 26 })
  if (r.status !== 0) throw new Error(`fix_models.py ${argv[0]}: ${(r.stderr || r.stdout).slice(-800)}`)
  return r.stdout
}

/** max / mean |a − b|, the reference's max |value|, rel = max|Δ| / (1 + ref max), non-finite count in a. */
function cmp(a, b) {
  if (a.length !== b.length) return { error: `length ${a.length} vs ${b.length}` }
  let mx = 0
  let sum = 0
  let ref = 0
  let nf = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    if (!(d <= mx)) mx = d
    sum += d
    const r = Math.abs(b[i])
    if (r > ref) ref = r
    if (!Number.isFinite(a[i])) nf++
  }
  return { maxAbsDiff: mx, meanAbsDiff: sum / a.length, refMaxAbs: ref, rel: mx / (1 + ref), nonFinite: nf }
}
/** IoU of (a > 0) and (b > 0) over [offset, offset + n). */
function iou(a, b, offset = 0, n = a.length) {
  let i2 = 0
  let u = 0
  for (let i = offset; i < offset + n; i++) {
    const x = a[i] > 0
    const y = b[i] > 0
    if (x && y) i2++
    if (x || y) u++
  }
  return u ? i2 / u : 1
}

// ------------------------------------------------------------------------------------------------------- bisect

async function bisect() {
  const p = pins()
  const enc = p.models['sam21-tiny'].files['fp32/encoder'].local
  const bdir = join(DIR, 'bisect')
  mkdirSync(bdir, { recursive: true })
  py(['list', '--model', enc, '--out', join(bdir, 'nodes.json')])
  const nodes = readJson(join(bdir, 'nodes.json'))
  const byOut = new Map(nodes.flatMap((n) => n.outputs.map((o) => [o, n])))
  const cand = nodes.filter((n) => n.outputs[0] && n.outTypes[0] === 1)
  const pixel = raw('sam21-tiny-fp32-astronaut-pixel.f32')
  const feeds = () => ({ pixel_values: new (O().Tensor)('float32', pixel, [1, 3, 1024, 1024]) })
  const out = { model: enc, nodes: nodes.length, floatNodes: cand.length, passes: [] }

  async function pass(tag, tensors) {
    writeJson(join(bdir, `${tag}.json`), tensors)
    const model = join(bdir, `${tag}.onnx`)
    py(['instrument', '--model', enc, '--tensors', join(bdir, `${tag}.json`), '--out', model])
    const s1 = await sess(model, 'cpu')
    const c = await s1.run(feeds())
    const cpu = Object.fromEntries(tensors.map((t) => [t, { d: f32(c[t]), dims: c[t].dims }]))
    await s1.release()
    const t0 = performance.now()
    const s2 = await sess(model, 'webgpu')
    const g = await s2.run(feeds())
    const ms = Math.round(performance.now() - t0)
    const res = tensors.map((t) => ({ tensor: t, node: byOut.get(t)?.name, op: byOut.get(t)?.op, i: byOut.get(t)?.i, dims: cpu[t].dims, bytes: cpu[t].d.length * 4, ...cmp(f32(g[t]), cpu[t].d) }))
    await s2.release()
    out.passes.push({ tag, tensors: tensors.length, webgpuMs: ms, results: res })
    writeJson(join(DIR, 'bisect.json'), out)
    return res
  }
  const bad = (r) => r.error || r.nonFinite > 0 || r.rel > 1e-3
  // Pass 1: ~40 checkpoints spread over the graph.
  const step = Math.max(1, Math.ceil(cand.length / 40))
  const checkpoints = cand.filter((_, k) => k % step === step - 1 || k === cand.length - 1)
  const r1 = await pass('pass1', checkpoints.map((n) => n.outputs[0]))
  const j = r1.findIndex(bad)
  if (j < 0) {
    out.verdict = 'no divergence at the checkpoints'
    writeJson(join(DIR, 'bisect.json'), out)
    return
  }
  const lo = j === 0 ? -1 : r1[j - 1].i
  const hi = r1[j].i
  // Pass 2: every float node output in (lo, hi], plus their non-initializer float inputs.
  const window = cand.filter((n) => n.i > lo && n.i <= hi)
  const extra = window.flatMap((n) => n.inputs).filter((t) => byOut.has(t) && byOut.get(t).outTypes[0] === 1 && byOut.get(t).i <= lo)
  const r2 = await pass('pass2', [...new Set([...extra, ...window.map((n) => n.outputs[0])])])
  const inWin = r2.filter((r) => r.i > lo).sort((x, y) => x.i - y.i)
  const first = inWin.find(bad)
  if (first) {
    const n = nodes[first.i]
    const status = Object.fromEntries(r2.map((r) => [r.tensor, r]))
    out.firstDivergent = {
      node: n.name, op: n.op, domain: n.domain, attrs: n.attrs, index: n.i,
      inputs: n.inputs.map((t) => ({ name: t, dims: status[t]?.dims ?? null, bytes: status[t]?.bytes ?? null, matches: status[t] ? !bad(status[t]) : 'not exposed (initializer or earlier)' })),
      output: { name: first.tensor, dims: first.dims, bytes: first.bytes, maxAbsDiff: first.maxAbsDiff, rel: first.rel, refMaxAbs: first.refMaxAbs },
    }
    out.nextDivergent = inWin.filter(bad).slice(0, 6).map((r) => ({ node: r.node, op: r.op, dims: r.dims, rel: r.rel }))
  } else out.verdict = 'pass 2 found no divergent node in the window'
  writeJson(join(DIR, 'bisect.json'), out)
  console.log(`BISECT ${JSON.stringify({ firstDivergent: out.firstDivergent, nextDivergent: out.nextDivergent, pass1: r1.map((r) => [r.i, r.op, r.dims?.join('x'), +r.rel.toPrecision(3)]) })}`)
}

// ------------------------------------------------------------------------------------------------------- verify

const SAM_PT = { points: [220, 660], label: 1 } // (110, 330) in the 512 × 512 photo, scaled to 1024

async function samCase(encPath, ep) {
  const p = pins()
  const dec = p.models['sam21-tiny'].files['fp32/decoder'].local
  const T = O().Tensor
  const pixel = raw('sam21-tiny-fp32-astronaut-pixel.f32')
  const t0 = performance.now()
  const e = await sess(encPath, ep)
  const eo = await e.run({ pixel_values: new T('float32', pixel, [1, 3, 1024, 1024]) })
  const encMs = Math.round(performance.now() - t0)
  const res = { ep, encoder: relative(DIR, encPath), encMs, outputs: {} }
  for (const k of ['image_embeddings.0', 'image_embeddings.1', 'image_embeddings.2']) res.outputs[k] = cmp(f32(eo[k]), raw(`sam21-tiny-fp32-astronaut-enc-${k}-cpu.f32`))
  const d = await sess(dec, ep)
  const t1 = performance.now()
  const doo = await d.run({
    input_points: new T('float32', Float32Array.from(SAM_PT.points), [1, 1, 1, 2]), input_labels: new T('int64', BigInt64Array.from([1n]), [1, 1, 1]),
    input_boxes: new T('float32', new Float32Array(0), [1, 0, 4]), 'image_embeddings.0': eo['image_embeddings.0'], 'image_embeddings.1': eo['image_embeddings.1'], 'image_embeddings.2': eo['image_embeddings.2'],
  })
  res.decMs = Math.round(performance.now() - t1)
  const pm = f32(doo.pred_masks)
  const cpuPm = raw('sam21-tiny-fp32-astronaut-dec-pred_masks-cpu.f32')
  const cpuIou = raw('sam21-tiny-fp32-astronaut-dec-iou_scores-cpu.f32')
  const best = cpuIou.indexOf(Math.max(...cpuIou))
  const n = 256 * 256
  res.outputs.pred_masks = cmp(pm, cpuPm)
  res.outputs.iou_scores = { webgpuOrCase: Array.from(f32(doo.iou_scores), (v) => +v.toFixed(4)), cpuOriginal: Array.from(cpuIou, (v) => +v.toFixed(4)) }
  res.bestMaskIoUvsCpu = iou(pm, cpuPm, best * n, n)
  return res
}

async function birefnetCase(model, variant, ep) {
  const T = O().Tensor
  const pixel = raw(`birefnet-lite-${variant}-astronaut-pixel.f32`)
  const t0 = performance.now()
  const s = await sess(model, ep)
  const loadMs = Math.round(performance.now() - t0)
  const t1 = performance.now()
  const o = await s.run({ input_image: new T('float32', pixel, [1, 3, 1024, 1024]) })
  const ms = Math.round(performance.now() - t1)
  const d = f32(o.output_image)
  const ref = raw(`birefnet-lite-${variant}-astronaut-dec-output_image-cpu.f32`)
  return { ep, model: relative(DIR, model), loadMs, runMs: ms, vsOriginalCpu: cmp(d, ref), maskIoUvsOriginalCpu: iou(d, ref) }
}

async function runCase(c) {
  if (c.kind === 'sam') return samCase(join(DIR, c.model), c.ep)
  return birefnetCase(join(DIR, c.model), c.variant, c.ep)
}

function child(c, timeoutS) {
  return new Promise((resolve) => {
    const ch = spawn(process.execPath, [fileURLToPath(import.meta.url), 'one', '--dir', DIR, '--case', JSON.stringify(c)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let so = ''
    let se = ''
    ch.stdout.on('data', (x) => (so += x))
    ch.stderr.on('data', (x) => (se = (se + x).slice(-4000)))
    const t = setTimeout(() => ch.kill('SIGKILL'), timeoutS * 1000)
    ch.on('close', (code, sig) => {
      clearTimeout(t)
      const line = so.split('\n').find((l) => l.startsWith('ONE_RESULT '))
      resolve(line ? JSON.parse(line.slice(11)) : { error: sig ? `killed after ${timeoutS} s` : `exit ${code}`, stderr: se.split('\n').filter((l) => /\[E:|rror/.test(l)).slice(-4).join('\n').slice(0, 1200) })
    })
  })
}

async function verify() {
  const fixed = readJson(join(DIR, 'fixed', 'files.json'), {})
  const cases = []
  if (fixed.samFp32) for (const ep of ['cpu', 'webgpu']) cases.push({ key: `sam21-fp32-chunked/${ep}`, kind: 'sam', model: fixed.samFp32, ep })
  const p = pins()
  cases.push({ key: 'sam21-fp32-original/webgpu', kind: 'sam', model: relative(DIR, p.models['sam21-tiny'].files['fp32/encoder'].local), ep: 'webgpu' })
  for (const v of ['fp16', 'fp32']) {
    const f = fixed[`birefnet${v}`]
    if (!f) continue
    for (const ep of ['cpu', 'webgpu']) cases.push({ key: `birefnet-${v}-patched/${ep}`, kind: 'birefnet', model: f, variant: v, ep })
  }
  const out = {}
  for (const c of cases) {
    const t0 = Date.now()
    out[c.key] = await child(c, 900)
    out[c.key].wallMs = Date.now() - t0
    console.log(`VERIFY ${c.key} ${JSON.stringify(out[c.key])}`.slice(0, 2500))
    writeJson(join(DIR, 'verify.json'), out)
  }
}

// ------------------------------------------------------------------------------------------------------- browser

function browserJobs() {
  const p = pins()
  const rel = (x) => relative(DIR, x)
  const fixed = readJson(join(DIR, 'fixed', 'files.json'), {})
  const sam = p.models['sam21-tiny'].files
  const ext = (f) => (f.companions ?? []).map((c) => ({ path: c.path.split('/').pop(), url: rel(c.local) }))
  const samDec = (v) => ({
    model: rel(sam[`${v}/decoder`].local), externalData: ext(sam[`${v}/decoder`]), fromFirst: ['image_embeddings.0', 'image_embeddings.1', 'image_embeddings.2'],
    feeds: [{ name: 'input_points', type: 'float32', dims: [1, 1, 1, 2], values: SAM_PT.points }, { name: 'input_labels', type: 'int64', dims: [1, 1, 1], values: [1] }, { name: 'input_boxes', type: 'float32', dims: [1, 0, 4], values: [] }],
    compare: { pred_masks: `raw/sam21-tiny-${v}-astronaut-dec-pred_masks-cpu.f32`, iou_scores: `raw/sam21-tiny-${v}-astronaut-dec-iou_scores-cpu.f32` }, iou: ['pred_masks'],
  })
  const samEncCmp = (v) => Object.fromEntries([0, 1, 2].map((i) => [`image_embeddings.${i}`, `raw/sam21-tiny-${v}-astronaut-enc-image_embeddings.${i}-cpu.f32`]))
  const jobs = []
  jobs.push({ key: 'sam21-fp32-original', model: rel(sam['fp32/encoder'].local), externalData: ext(sam['fp32/encoder']), feeds: [{ name: 'pixel_values', type: 'float32', dims: [1, 3, 1024, 1024], url: 'raw/sam21-tiny-fp32-astronaut-pixel.f32' }], compare: samEncCmp('fp32'), chain: samDec('fp32') })
  if (fixed.samFp32) jobs.push({ key: 'sam21-fp32-chunked', model: fixed.samFp32, feeds: [{ name: 'pixel_values', type: 'float32', dims: [1, 3, 1024, 1024], url: 'raw/sam21-tiny-fp32-astronaut-pixel.f32' }], compare: samEncCmp('fp32'), chain: samDec('fp32') })
  jobs.push({ key: 'sam21-fp16-original', model: rel(sam['fp16/encoder'].local), externalData: ext(sam['fp16/encoder']), feeds: [{ name: 'pixel_values', type: 'float32', dims: [1, 3, 1024, 1024], url: 'raw/sam21-tiny-fp16-astronaut-pixel.f32' }], compare: samEncCmp('fp16'), chain: samDec('fp16') })
  const ss = p.models['slimsam-77'].files
  jobs.push({
    key: 'slimsam-fp16-original', model: rel(ss['fp16/encoder'].local), feeds: [{ name: 'pixel_values', type: 'float32', dims: [1, 3, 1024, 1024], url: 'raw/slimsam-77-fp16-astronaut-pixel.f32' }],
    compare: { image_embeddings: 'raw/slimsam-77-fp16-astronaut-enc-image_embeddings-cpu.f32', image_positional_embeddings: 'raw/slimsam-77-fp16-astronaut-enc-image_positional_embeddings-cpu.f32' },
    chain: { model: rel(ss['fp16/decoder'].local), fromFirst: ['image_embeddings', 'image_positional_embeddings'], feeds: [{ name: 'input_points', type: 'float32', dims: [1, 1, 1, 2], values: SAM_PT.points }, { name: 'input_labels', type: 'int64', dims: [1, 1, 1], values: [1] }],
      compare: { pred_masks: 'raw/slimsam-77-fp16-astronaut-dec-pred_masks-cpu.f32', iou_scores: 'raw/slimsam-77-fp16-astronaut-dec-iou_scores-cpu.f32' }, iou: ['pred_masks'] },
  })
  const bf = p.models['birefnet-lite'].files
  for (const v of ['fp16', 'fp32']) {
    const base = { feeds: [{ name: 'input_image', type: 'float32', dims: [1, 3, 1024, 1024], url: `raw/birefnet-lite-${v}-astronaut-pixel.f32` }], compare: { output_image: `raw/birefnet-lite-${v}-astronaut-dec-output_image-cpu.f32` }, iou: ['output_image'] }
    if (fixed[`birefnet${v}`]) jobs.push({ key: `birefnet-${v}-patched`, model: fixed[`birefnet${v}`], ...base })
    jobs.push({ key: `birefnet-${v}-original`, model: rel(bf[v].local), ...base })
  }
  writeJson(join(DIR, 'browser-jobs.json'), jobs)
  // At an emulated 128 MiB binding limit only fp32 has tensors above the limit (SAM 2.1 scores: 256 MiB; BiRefNet:
  // 64-channel 1024² maps), so only those are re-run there.
  const emu = ['sam21-fp32-original', 'sam21-fp32-chunked', 'birefnet-fp32-patched', 'birefnet-fp32-original']
  writeJson(join(DIR, 'browser-jobs-emulated.json'), emu.map((k) => jobs.find((j) => j.key === k)).filter(Boolean))
  console.log(`${jobs.length} browser jobs`)
}

// ------------------------------------------------------------------------------------------------------- report

function report() {
  const fixed = readJson(join(DIR, 'fixed', 'files.json'), {})
  const files = {}
  for (const [k, v] of Object.entries(fixed)) if (typeof v === 'string' && existsSync(join(DIR, v))) files[k] = { path: v, bytes: statSync(join(DIR, v)).size, sha256: sha256File(join(DIR, v)) }
  const r = {
    fixedFiles: files, samFix: readJson(join(DIR, 'fixed', 'sam21_vision_encoder_fp32_chunked.onnx.json')),
    birefnetFix: { fp16: readJson(join(DIR, 'fixed', 'birefnet_lite_fp16_patched.onnx.json')), fp32: readJson(join(DIR, 'fixed', 'birefnet_lite_fp32_patched.onnx.json')) },
    bisect: (({ passes, ...x }) => ({ ...x, pass1: passes?.[0]?.results?.map((q) => [q.i, q.op, q.dims?.join('x'), q.rel]) }))(readJson(join(DIR, 'bisect.json'), {})),
    verify: readJson(join(DIR, 'verify.json')),
  }
  for (const b of ['native', 'emulated128']) {
    const j = readJson(join(DIR, `browser-${b}.json`))
    r[`browser_${b}`] = j && { browser: j.browser, gpu: j.gpu, emulateBinding: j.emulateBinding, jobs: j.jobs, console: (j.console ?? []).filter((l) => /error|warn/i.test(l)).slice(0, 15) }
  }
  writeJson(join(DIR, 'results2.json'), r)
  for (const [k, v] of Object.entries(r)) console.log(`MASKS_PREP2_RESULT ${k} ${JSON.stringify(v)}`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['## AI masks prep 2', '', '```json', JSON.stringify({ fixedFiles: files, firstDivergent: r.bisect.firstDivergent }, null, 1), '```', ''].join('\n'))
  }
}

const cmd = args[0]
if (!DIR) throw new Error('--dir DIR is required')
if (cmd === 'bisect') await bisect()
else if (cmd === 'verify') await verify()
else if (cmd === 'one') {
  let res
  try {
    res = await runCase(JSON.parse(opt('--case')))
  } catch (e) {
    res = { error: String(e.message ?? e).slice(0, 1500) }
  }
  console.log(`ONE_RESULT ${JSON.stringify(res)}`)
  process.exit(0)
} else if (cmd === 'browser-jobs') browserJobs()
else if (cmd === 'report') report()
else throw new Error('usage: masks-prep2.mjs bisect|verify|browser-jobs|report --dir D')
