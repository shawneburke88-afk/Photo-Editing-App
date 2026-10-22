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
  let rsum = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    if (!(d <= mx)) mx = d
    sum += d
    const r = Math.abs(b[i])
    rsum += r
    if (r > ref) ref = r
    if (!Number.isFinite(a[i])) nf++
  }
  return { maxAbsDiff: mx, meanAbsDiff: sum / a.length, refMaxAbs: ref, refMeanAbs: rsum / a.length, rel: mx / (1 + ref), meanRel: sum / a.length / (1e-6 + rsum / a.length), nonFinite: nf }
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

/**
 * Generic multi-level bisection: --model M --input NAME --raw FILE --dims 1,3,1024,1024 --out OUT.json [--per 40]
 * Each level exposes up to --per float node outputs spread over the current window (graph order), runs CPU and
 * WebGPU EP, and narrows the window to the first divergent checkpoint, until every node in the window is exposed.
 */
async function bisectAny() {
  const model = opt('--model')
  const outPath = opt('--out')
  const per = Number(opt('--per', 40))
  const work = join(dirname(outPath), 'bisect-work')
  mkdirSync(work, { recursive: true })
  py(['list', '--model', model, '--out', join(work, 'nodes.json')])
  const nodes = readJson(join(work, 'nodes.json'))
  const byOut = new Map(nodes.flatMap((n) => n.outputs.map((o) => [o, n])))
  const cand = nodes.filter((n) => n.outputs[0] && n.outTypes[0] === 1)
  const b = readFileSync(opt('--raw'))
  const data = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
  const dims = opt('--dims').split(',').map(Number)
  const feeds = () => ({ [opt('--input')]: new (O().Tensor)('float32', data, dims) })
  const bad = (r) => r.error || r.nonFinite > 0 || r.rel > Number(opt('--rel', 1e-3))
  const out = { model, nodes: nodes.length, floatNodes: cand.length, levels: [] }
  let win = cand
  for (let level = 1; level <= 6; level++) {
    const step = Math.max(1, Math.ceil(win.length / per))
    const picks = win.filter((_, k) => k % step === step - 1 || k === win.length - 1)
    const tensors = picks.map((n) => n.outputs[0])
    writeJson(join(work, `l${level}.json`), tensors)
    const mp = join(work, `l${level}.onnx`)
    py(['instrument', '--model', model, '--tensors', join(work, `l${level}.json`), '--out', mp])
    const s1 = await sess(mp, 'cpu')
    const c = await s1.run(feeds())
    const cpu = Object.fromEntries(tensors.map((t) => [t, { d: f32(c[t]).slice(), dims: c[t].dims }]))
    await s1.release()
    const t0 = performance.now()
    const s2 = await sess(mp, 'webgpu')
    const g = await s2.run(feeds())
    const ms = Math.round(performance.now() - t0)
    const res = tensors.map((t) => ({ tensor: t, node: byOut.get(t).name, op: byOut.get(t).op, i: byOut.get(t).i, dims: cpu[t].dims, bytes: cpu[t].d.length * 4, ...cmp(f32(g[t]), cpu[t].d) }))
    await s2.release()
    out.levels.push({ level, window: [win[0].i, win[win.length - 1].i], step, webgpuMs: ms, results: res })
    writeJson(outPath, out)
    const j = res.findIndex(bad)
    console.log(`level ${level}: window ${win[0].i}..${win[win.length - 1].i} step ${step} first bad ${j < 0 ? 'none' : `${res[j].i} ${res[j].op} ${res[j].node} rel ${res[j].rel}`}`)
    if (j < 0) break
    if (step === 1) {
      const n = nodes[res[j].i]
      out.firstDivergent = { ...res[j], attrs: n.attrs, inputs: n.inputs.map((t) => ({ name: t, producer: byOut.get(t)?.op ?? 'initializer/graph input' })) }
      break
    }
    const lo = j === 0 ? win[0].i - 1 : res[j - 1].i
    win = win.filter((n) => n.i > lo && n.i <= res[j].i)
  }
  writeJson(outPath, out)
  console.log(`BISECT_ANY ${JSON.stringify(out.firstDivergent ?? null)}`)
}

/**
 * Bisection with prefix models (exposed intermediates can read back wrongly when they are segmented):
 *   --model M --input NAME --raw FILE --dims D --out OUT.json [--max-steps 26]
 * Each check extracts the graph up to one tensor (its only output), runs CPU and WebGPU EP, compares. Binary search
 * over graph order for a bad tensor after a good one, then descent through the bad tensor's producer: an input that
 * is bad is followed; a node whose float inputs are all good and whose output is bad is reported.
 */
async function bisectPrefix() {
  const model = opt('--model')
  const outPath = opt('--out')
  const work = join(dirname(outPath), 'prefix-work')
  mkdirSync(work, { recursive: true })
  py(['list', '--model', model, '--out', join(work, 'nodes.json')])
  const nodes = readJson(join(work, 'nodes.json'))
  const byOut = new Map(nodes.flatMap((n) => n.outputs.map((o) => [o, n])))
  const cand = nodes.filter((n) => n.outputs[0] && n.outTypes[0] === 1 && n.op !== 'Constant')
  const b = readFileSync(opt('--raw'))
  const data = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
  const dims = opt('--dims').split(',').map(Number)
  const inName = opt('--input')
  const maxSteps = Number(opt('--max-steps', 26))
  const out = { model, nodes: nodes.length, candidates: cand.length, checks: [] }
  const cache = new Map()
  // --criterion max: max|Δ| / (1 + max|ref|) > 1e-3. mean: mean|Δ| / mean|ref| > 1e-3 (ignores a few flipped
  // values of discontinuous ops such as Floor, whose effect downstream is continuous in a bilinear sampler).
  const crit = opt('--criterion', 'max')
  const bad = (r) => r.error || r.nonFinite > 0 || (crit === 'mean' ? r.meanRel > 1e-3 : r.rel > 1e-3)
  out.criterion = crit
  async function check(t) {
    if (cache.has(t)) return cache.get(t)
    if (out.checks.length >= maxSteps) throw new Error('step limit')
    const mp = join(work, 'prefix.onnx')
    py(['prefix', '--model', model, '--tensor', t, '--out', mp])
    const T = O().Tensor
    const s1 = await sess(mp, 'cpu')
    const c = (await s1.run({ [inName]: new T('float32', data, dims) }))[t]
    const cd = f32(c).slice()
    await s1.release()
    const t0 = performance.now()
    let r
    try {
      const s2 = await sess(mp, 'webgpu')
      const g = (await s2.run({ [inName]: new T('float32', data, dims) }))[t]
      r = { tensor: t, node: byOut.get(t)?.name, op: byOut.get(t)?.op, i: byOut.get(t)?.i, dims: c.dims, bytes: cd.length * 4, webgpuMs: Math.round(performance.now() - t0), ...cmp(f32(g), cd) }
      await s2.release()
    } catch (e) {
      r = { tensor: t, node: byOut.get(t)?.name, op: byOut.get(t)?.op, i: byOut.get(t)?.i, error: String(e.message).slice(0, 400) }
    }
    r.bad = !!bad(r)
    cache.set(t, r)
    out.checks.push(r)
    writeJson(outPath, out)
    console.log(`check ${out.checks.length}: ${r.i} ${r.op} ${r.node} ${JSON.stringify(r.dims)} rel ${r.rel} meanRel ${r.meanRel} ${r.bad ? 'BAD' : 'ok'}`)
    return r
  }
  try {
    // The graph outputs (nodes whose outputs nobody consumes), latest first; start from the first bad one.
    const consumed = new Set(nodes.flatMap((n) => n.inputs))
    const finals = cand.filter((n) => !consumed.has(n.outputs[0])).reverse()
    let start = null
    for (const f of finals) if ((await check(f.outputs[0])).bad) { start = f; break }
    if (!start) out.verdict = 'graph outputs match'
    else {
      // Its float ancestors in graph order.
      const anc = new Set()
      const stack = [start]
      while (stack.length) {
        const n = stack.pop()
        for (const t of n.inputs) {
          const p = byOut.get(t)
          if (p && !anc.has(p.i)) (anc.add(p.i), stack.push(p))
        }
      }
      const cand2 = cand.filter((n) => anc.has(n.i))
      cand2.push(start)
      let lo = -1
      let hi = cand2.length - 1
      const candRef = cand2
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if ((await check(candRef[mid].outputs[0])).bad) hi = mid
        else lo = mid
      }
      let node = candRef[hi]
      for (;;) {
        const ins = node.inputs.filter((t) => byOut.has(t) && byOut.get(t).outTypes[0] === 1 && byOut.get(t).op !== 'Constant')
        let next = null
        for (const t of ins) if ((await check(t)).bad) { next = byOut.get(t); break }
        if (!next) {
          out.culprit = { node: node.name, op: node.op, index: node.i, attrs: node.attrs, inputs: node.inputs.map((t) => cache.get(t) ? { name: t, dims: cache.get(t).dims, bytes: cache.get(t).bytes, bad: cache.get(t).bad } : { name: t }), output: cache.get(node.outputs[0]) }
          break
        }
        node = next
      }
    }
  } catch (e) {
    out.error = String(e.message).slice(0, 300)
  }
  writeJson(outPath, out)
  console.log(`BISECT_PREFIX ${JSON.stringify({ verdict: out.verdict, culprit: out.culprit, error: out.error })}`)
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

async function slimCase(v, ep, encoder) {
  const f = pins().models['slimsam-77'].files
  const T = O().Tensor
  const key = `slimsam-77-${v}-astronaut`
  const t0 = performance.now()
  const e = await sess(encoder ? join(DIR, encoder) : f[`${v}/encoder`].local, ep)
  const eo = await e.run({ pixel_values: new T('float32', raw(`${key}-pixel.f32`), [1, 3, 1024, 1024]) })
  const res = { ep, variant: v, encMs: Math.round(performance.now() - t0), outputs: {} }
  for (const k of ['image_embeddings', 'image_positional_embeddings']) res.outputs[k] = cmp(f32(eo[k]), raw(`${key}-enc-${k}-cpu.f32`))
  const d = await sess(f[`${v}/decoder`].local, ep)
  const doo = await d.run({ input_points: new T('float32', Float32Array.from(SAM_PT.points), [1, 1, 1, 2]), input_labels: new T('int64', BigInt64Array.from([1n]), [1, 1, 1]), image_embeddings: eo.image_embeddings, image_positional_embeddings: eo.image_positional_embeddings })
  const pm = f32(doo.pred_masks)
  const cpuPm = raw(`${key}-dec-pred_masks-cpu.f32`)
  const cpuIou = raw(`${key}-dec-iou_scores-cpu.f32`)
  const best = cpuIou.indexOf(Math.max(...cpuIou))
  res.outputs.pred_masks = cmp(pm, cpuPm)
  res.iou_scores = { case: Array.from(f32(doo.iou_scores), (x) => +x.toFixed(4)), cpu: Array.from(cpuIou, (x) => +x.toFixed(4)) }
  res.bestMaskIoUvsCpu = iou(pm, cpuPm, best * 65536, 65536)
  return res
}

async function runCase(c) {
  if (c.kind === 'slimsam') return slimCase(c.variant, c.ep, c.model)
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
  for (const v of ['fp32', 'fp16']) {
    if (p.models['slimsam-77'].files[`${v}/encoder`]?.local) cases.push({ key: `slimsam-${v}/webgpu`, kind: 'slimsam', variant: v, ep: 'webgpu' })
    const fx = fixed[`slimsam${v}`]
    if (fx) for (const ep of ['cpu', 'webgpu']) cases.push({ key: `slimsam-${v}-chunked/${ep}`, kind: 'slimsam', variant: v, ep, model: fx })
  }
  const only = opt('--only')
  const out = {}
  for (const c of cases.filter((x) => !only || only.split(',').includes(x.key))) {
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
  if (ss['fp32/encoder']?.local) {
    jobs.push({
      key: 'slimsam-fp32-original', model: rel(ss['fp32/encoder'].local), feeds: [{ name: 'pixel_values', type: 'float32', dims: [1, 3, 1024, 1024], url: 'raw/slimsam-77-fp32-astronaut-pixel.f32' }],
      compare: { image_embeddings: 'raw/slimsam-77-fp32-astronaut-enc-image_embeddings-cpu.f32', image_positional_embeddings: 'raw/slimsam-77-fp32-astronaut-enc-image_positional_embeddings-cpu.f32' },
      chain: { model: rel(ss['fp32/decoder'].local), fromFirst: ['image_embeddings', 'image_positional_embeddings'], feeds: [{ name: 'input_points', type: 'float32', dims: [1, 1, 1, 2], values: SAM_PT.points }, { name: 'input_labels', type: 'int64', dims: [1, 1, 1], values: [1] }],
        compare: { pred_masks: 'raw/slimsam-77-fp32-astronaut-dec-pred_masks-cpu.f32', iou_scores: 'raw/slimsam-77-fp32-astronaut-dec-iou_scores-cpu.f32' }, iou: ['pred_masks'] },
    })
  }
  if (fixed.slimsamfp32) {
    const o = jobs.find((j) => j.key === 'slimsam-fp32-original')
    if (o) jobs.push({ ...o, key: 'slimsam-fp32-chunked', model: fixed.slimsamfp32 })
  }
  const bf = p.models['birefnet-lite'].files
  for (const v of ['fp16', 'fp32']) {
    const base = { feeds: [{ name: 'input_image', type: 'float32', dims: [1, 3, 1024, 1024], url: `raw/birefnet-lite-${v}-astronaut-pixel.f32` }], compare: { output_image: `raw/birefnet-lite-${v}-astronaut-dec-output_image-cpu.f32` }, iou: ['output_image'] }
    if (fixed[`birefnet${v}`]) jobs.push({ key: `birefnet-${v}-patched`, model: fixed[`birefnet${v}`], ...base })
    jobs.push({ key: `birefnet-${v}-original`, model: rel(bf[v].local), ...base })
  }
  writeJson(join(DIR, 'browser-jobs.json'), jobs)
  // At an emulated 128 MiB binding limit only fp32 has tensors above the limit (SAM 2.1 scores: 256 MiB; BiRefNet:
  // 64-channel 1024² maps), so only those are re-run there.
  const emu = ['slimsam-fp32-original', 'slimsam-fp32-chunked', 'sam21-fp32-original', 'sam21-fp32-chunked', 'birefnet-fp32-patched', 'birefnet-fp32-original']
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
    slimsamFix: Object.fromEntries(['fp32', 'fp16'].map((v) => [v, (({ softmaxInputShapes, ...x }) => x)(readJson(join(DIR, 'fixed', `slimsam_vision_encoder_${v}_chunked.onnx.json`), {}))])),
    birefnetFix: Object.fromEntries(['fp16', 'fp32'].map((v) => [v, { stage1: readJson(join(DIR, 'fixed', `birefnet_lite_${v}_stage1.onnx.json`)), chunkBig: readJson(join(DIR, 'fixed', `birefnet_lite_${v}_patched.onnx.chunk.json`)) }])),
    bisectBirefnet: Object.fromEntries(['fp32', 'fp16'].map((v) => [v, (({ checks, ...x }) => ({ ...x, checks: checks?.map((c) => [c.i, c.op, c.node, c.dims?.join('x'), c.rel, c.bad, c.error]) }))(readJson(join(DIR, `bisect-birefnet-${v}.json`), {}))])),
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
else if (cmd === 'bisect-any') await bisectAny()
else if (cmd === 'bisect-prefix') await bisectPrefix()
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
