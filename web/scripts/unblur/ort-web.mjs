// Unblur spike (docs/UNBLUR_SPIKE.md): ONNX Runtime Web 1.30.0 on the deblurring candidates' graphs, in Node and in a
// headless Chromium tab. Research only; not app code.
//
//   node ort-web.mjs browser --ort DIST --models a.onnx,b.onnx [--providers wasm,webgpu] [--threads 4] [--runs 2]
//                            [--verbose] [--chrome PATH] [--out results.json] [--dims name=1x3x256x256;...]
//       Serves DIST (onnxruntime-web/dist) and the models with cross-origin isolation (so WebAssembly gets threads),
//       opens a tab (WebGPU on SwiftShader: --enable-unsafe-webgpu --use-webgpu-adapter=swiftshader), and per model and
//       provider: session creation time, each run's time, the output's range and non-finite count, and the largest
//       difference from the first provider's output (the WebAssembly reference). With --verbose, ONNX Runtime's own
//       verbose log is kept for the node placement ("Node(s) placed on [CPUExecutionProvider]" lists every node the
//       WebGPU EP did not take). The peak resident memory of the Chromium processes is sampled every 100 ms.
//   node ort-web.mjs node --model a.onnx [--threads 4] [--runs 2] [--dims ...] [--out results.json]
//       The same with onnxruntime-web's WebAssembly build in Node (resolved from the current directory's node_modules).
//
// Inputs: an image-like test card in [0, 1] (--input pattern, the default, for a 3-channel image input) or deterministic
// noise (--input noise: uniform in [0, 1), or [-1.1, 1.1) for an input named "grid").

import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const flag = (name) => process.argv.includes(name)

/** name=1x3x256x256;other=1x2 → { name: [1,3,256,256], ... } */
function parseDims(s) {
  const out = {}
  for (const part of (s || '').split(';').filter(Boolean)) {
    const [k, v] = part.split('=')
    out[k] = v.split('x').map(Number)
  }
  return out
}

/** RSS (bytes) of a process tree rooted at pid (Linux `ps`). */
function treeRss(root) {
  try {
    const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number))
    const kids = new Map()
    for (const [pid, ppid] of rows) kids.set(ppid, [...(kids.get(ppid) || []), pid])
    const rss = new Map(rows.map(([pid, , r]) => [pid, r * 1024]))
    let sum = 0
    const stack = [...(kids.get(root) || [])]
    while (stack.length) {
      const p = stack.pop()
      sum += rss.get(p) || 0
      stack.push(...(kids.get(p) || []))
    }
    return sum
  } catch {
    return 0
  }
}

// ---- the page's code (also used in Node): deterministic inputs, sessions, runs, comparison.
const RUNNER = String.raw`
function pattern(shape) {
  // An image-like test card in [0, 1]: smooth gradients, stripes at several frequencies and hard edges.
  const [, C, H, W] = shape
  const a = new Float32Array(C * H * W)
  for (let c = 0; c < C; c++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0.45 + 0.2 * Math.sin(x / 9 + c) * Math.cos(y / 13) + 0.1 * Math.sin((x + 2 * y) / 3.1) + ((((x >> 5) + (y >> 5)) & 1) ? 0.12 : -0.12)
    a[(c * H + y) * W + x] = Math.min(1, Math.max(0, v + 0.05 * c))
  }
  return a
}
function noise(n, seed, lo, hi) {
  const a = new Float32Array(n)
  let s = seed >>> 0
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; a[i] = lo + (hi - lo) * (s / 4294967296) }
  return a
}
async function runAll(ort, buf, { providers, runs, dims, verbose, threads, input }) {
  const res = []
  let ref = null
  for (const provider of providers) {
    const r = { provider }
    try {
      const t0 = performance.now()
      const s = await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: [provider], graphOptimizationLevel: 'all', logSeverityLevel: verbose ? 0 : 3, logVerbosityLevel: 0 })
      r.createMs = Math.round(performance.now() - t0)
      const feeds = {}
      const meta = s.inputMetadata || []
      s.inputNames.forEach((name, i) => {
        const shape = dims[name] || (meta[i] && meta[i].shape)
        if (!shape || shape.some((d) => typeof d !== 'number')) throw new Error('no fixed shape for input ' + name + ': pass --dims')
        const n = shape.reduce((a, b) => a * b, 1)
        const data = name === 'grid' ? noise(n, 7 + i, -1.1, 1.1) : (input === 'pattern' && shape.length === 4 && shape[1] === 3 ? pattern(shape) : noise(n, 1 + i, 0, 1))
        feeds[name] = new ort.Tensor('float32', data, shape)
        r.inputs = { ...(r.inputs || {}), [name]: shape }
      })
      r.runMs = []
      let out
      for (let k = 0; k < runs; k++) {
        const t = performance.now()
        const o = await s.run(feeds)
        const t1 = o[s.outputNames[0]]
        const d = await t1.getData()
        r.runMs.push(Math.round(performance.now() - t))
        out = { data: d, dims: [...t1.dims] }
        for (const v of Object.values(o)) if (v.dispose) v.dispose()
      }
      r.outDims = out.dims
      let mn = Infinity, mx = -Infinity, bad = 0
      for (const v of out.data) { if (!Number.isFinite(v)) { bad++; continue } if (v < mn) mn = v; if (v > mx) mx = v }
      r.outMin = mn; r.outMax = mx; r.nonFinite = bad
      if (!ref) ref = out.data
      else if (ref.length === out.data.length) {
        let m = 0, sum = 0, big = 0
        for (let i = 0; i < ref.length; i++) { const e = Math.abs(ref[i] - out.data[i]); if (e > m || Number.isNaN(e)) m = Number.isNaN(e) ? Infinity : e; sum += e; if (e > 1e-3) big++ }
        r.vsFirst = { maxAbs: m, meanAbs: sum / ref.length, over1e3: big, n: ref.length }
      }
      await s.release()
    } catch (e) {
      r.error = String(e && e.message || e).slice(0, 2000)
    }
    res.push(r)
  }
  return res
}
`

const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.html': 'text/html' }

async function browser() {
  const dist = resolve(arg('--ort'))
  const models = arg('--models').split(',').map((f) => resolve(f))
  const providers = arg('--providers', 'wasm,webgpu').split(',')
  const threads = Number(arg('--threads', '4'))
  const runs = Number(arg('--runs', '2'))
  const dims = parseDims(arg('--dims'))
  const verbose = flag('--verbose')
  const input = arg('--input', 'pattern')
  const page = `<!doctype html><meta charset="utf-8"><script type="module">
import * as ort from '/ort/ort.webgpu.min.mjs'
ort.env.wasm.wasmPaths = '/ort/'
ort.env.wasm.numThreads = ${threads}
ort.env.wasm.proxy = false
ort.env.logLevel = ${verbose ? "'verbose'" : "'error'"}
${RUNNER}
window.go = async (url, opts) => runAll(ort, await (await fetch(url)).arrayBuffer(), opts)
window.info = async () => {
  const a = navigator.gpu ? await navigator.gpu.requestAdapter() : null
  return { isolated: crossOriginIsolated, cores: navigator.hardwareConcurrency, ua: navigator.userAgent, gpu: a ? { ...a.info, f16: a.features.has('shader-f16'), maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize, maxBufferSize: a.limits.maxBufferSize } : null }
}
window.ready = true
</script>`
  const server = createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0])
    let file = null
    if (u === '/') {
      res.writeHead(200, { 'content-type': 'text/html', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' })
      return res.end(page)
    }
    if (u.startsWith('/ort/')) file = join(dist, basename(u))
    if (u.startsWith('/m/')) file = models[Number(u.split('/')[2])]
    if (!file || !existsSync(file)) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin', 'content-length': statSync(file).size })
    res.end(readFileSync(file))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const req = createRequire(join(process.cwd(), 'x.js'))
  let pw
  try {
    pw = req('playwright-core')
  } catch {
    pw = req('playwright')
  }
  const args = ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--js-flags=--max-old-space-size=8192']
  const b = await pw.chromium.launch({ headless: true, args, ...(arg('--chrome') ? { executablePath: arg('--chrome') } : {}) })
  const p = await b.newPage()
  const logs = []
  p.on('console', (m) => logs.push(m.text()))
  p.on('pageerror', (e) => logs.push('pageerror: ' + e.message))
  await p.goto(`http://127.0.0.1:${port}/`)
  await p.waitForFunction(() => window.ready === true, null, { timeout: 60000 })
  const info = await p.evaluate(() => window.info())
  console.log(JSON.stringify({ browser: b.version(), ...info }))
  const results = []
  for (let i = 0; i < models.length; i++) {
    const start = logs.length
    let peak = 0
    const timer = setInterval(() => { peak = Math.max(peak, treeRss(process.pid)) }, 100)
    const t = Date.now()
    const r = await p.evaluate(([url, o]) => window.go(url, o), [`/m/${i}`, { providers, runs, dims, verbose, threads, input }])
    clearInterval(timer)
    const mine = logs.slice(start)
    const placement = mine.filter((l) => /placed on|not assigned|Number of nodes|CPUExecutionProvider|fallback|Fallback|VerifyEachNode/.test(l))
    // Nodes the WebGPU session left on the CPU, by operator ("Node(s) placed on [CPUExecutionProvider]" then "  Op (name)").
    const cpu = {}
    const cpuNames = []
    let inCpu = false, sessions = 0
    for (const l of placement) {
      if (/Node placements/.test(l)) sessions++
      if (/placed on \[/.test(l)) { inCpu = sessions >= 2 && /CPUExecutionProvider/.test(l) && /Node\(s\)/.test(l); continue }
      const mm = inCpu && l.match(/VerifyEachNodeIsAssignedToAnEp\]\s+(\S+) \((.*)\)\s*$/)
      if (mm) { cpu[mm[1]] = (cpu[mm[1]] || 0) + 1; if (cpuNames.length < 80) cpuNames.push(mm[1] + ' ' + mm[2]) }
    }
    const errors = mine.filter((l) => /error|Error|ERROR|pageerror/.test(l) && !/logSeverity/.test(l)).slice(0, 20)
    const summary = placement.filter((l) => /placed on/.test(l)).map((l) => l.replace(/^.*VerifyEachNodeIsAssignedToAnEp\]\s*/, ''))
    const row = { model: basename(models[i]), bytes: statSync(models[i]).size, input, results: r, peakRss: peak, wallMs: Date.now() - t, placementSummary: summary, webgpuCpuNodesByOp: cpu, webgpuCpuNodeNames: cpuNames, errors }
    results.push(row)
    console.log(JSON.stringify(row))
  }
  await b.close()
  server.close()
  if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify({ info, results }, null, 1))
}

async function node() {
  const model = resolve(arg('--model'))
  const threads = Number(arg('--threads', '4'))
  const runs = Number(arg('--runs', '2'))
  const dims = parseDims(arg('--dims'))
  const req = createRequire(join(process.cwd(), 'x.js'))
  const ort = await import(pathToFileURL(req.resolve('onnxruntime-web')).href)
  ort.env.wasm.numThreads = threads
  ort.env.logLevel = 'error'
  let peak = 0
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss) }, 100)
  const runAll = new Function('performance', RUNNER + '; return runAll')(performance)
  const r = await runAll(ort, readFileSync(model).buffer, { providers: ['wasm'], runs, dims, verbose: false, threads, input: arg('--input', 'pattern') })
  clearInterval(timer)
  peak = Math.max(peak, process.memoryUsage().rss)
  const row = { model: basename(model), node: process.version, threads, results: r, peakRss: peak }
  console.log(JSON.stringify(row))
  if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify(row, null, 1))
}

const cmd = process.argv[2]
if (cmd === 'browser') await browser()
else if (cmd === 'node') await node()
else {
  console.error('usage: ort-web.mjs browser|node ...')
  process.exit(2)
}
