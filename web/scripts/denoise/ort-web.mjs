// AI Denoise spike (docs/AI_DENOISE_SPIKE.md): ONNX Runtime Web 1.30.0 on the RawNIND Bayer denoiser's graphs, in Node
// and in a headless Chromium tab. Research only; not app code. (Adapted from the unblur spike's ort-web.mjs.)
//
//   node ort-web.mjs browser --ort DIST --models a.onnx,b.onnx [--providers wasm,webgpu] [--threads 4] [--runs 3]
//                            [--input tile.f32] [--verbose] [--tiles N] [--size 512] [--out results.json] [--pw DIR]
//       Serves DIST (onnxruntime-web/dist) and the models with cross-origin isolation (so WebAssembly gets threads),
//       opens a tab (WebGPU on SwiftShader), and per model and provider: session creation time, each run's time, the
//       output's range and non-finite count, and the difference from the first provider's output (the WebAssembly
//       reference), absolute and relative to the reference's largest value (this model's output scale is about 1e6
//       times its input's). With --verbose, ONNX Runtime's own log is kept for the node placement. --tiles N runs N
//       tiles in a row on one session (a 24 MP photo is 35) and reports the total. The peak resident memory of the
//       Chromium process tree is sampled every 100 ms.
//   node ort-web.mjs node --model a.onnx [--threads 4] [--runs 3] [--input tile.f32] [--tiles N] [--out results.json]
//       The same with onnxruntime-web's WebAssembly build in Node (resolved from the current directory's node_modules).
//
// --input: a file of float32 values (little endian) of the model's input shape; without it, deterministic noise shaped
// like a dark raw tile (values around 0.02 to 0.3).

import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const flag = (name) => process.argv.includes(name)

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

// ---- the page's code (also used in Node)
const RUNNER = String.raw`
function noise(n, seed) {
  const a = new Float32Array(n)
  let s = seed >>> 0
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const u = s / 4294967296; a[i] = 0.02 + 0.28 * u * u }
  return a
}
async function runAll(ort, buf, { providers, runs, verbose, input, tiles, size }) {
  const res = []
  let ref = null
  for (const provider of providers) {
    const r = { provider }
    try {
      const t0 = performance.now()
      const s = await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: [provider], graphOptimizationLevel: 'all', logSeverityLevel: verbose ? 0 : 3, logVerbosityLevel: 0 })
      r.createMs = Math.round(performance.now() - t0)
      const meta = s.inputMetadata || []
      const name = s.inputNames[0]
      const shape = (meta[0] && meta[0].shape || []).map((d) => (typeof d === 'number' ? d : size))
      const type = meta[0] && meta[0].type
      r.input = { name, shape, type }
      const n = shape.reduce((a, b) => a * b, 1)
      let data = input ? new Float32Array(input) : noise(n, 1)
      if (data.length !== n) throw new Error('input has ' + data.length + ' values, the model wants ' + n)
      let tensor
      if (type === 'float16') {
        const h = new Float16Array(n)
        for (let i = 0; i < n; i++) h[i] = data[i]
        tensor = new ort.Tensor('float16', h, shape)
      } else tensor = new ort.Tensor('float32', data, shape)
      const feeds = { [name]: tensor }
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
      if (tiles > 0) {
        const t = performance.now()
        for (let k = 0; k < tiles; k++) {
          const o = await s.run(feeds)
          await o[s.outputNames[0]].getData()
          for (const v of Object.values(o)) if (v.dispose) v.dispose()
        }
        r.tilesMs = Math.round(performance.now() - t)
        r.tiles = tiles
      }
      r.outDims = out.dims
      let mn = Infinity, mx = -Infinity, bad = 0, sum = 0
      for (const v of out.data) { if (!Number.isFinite(v)) { bad++; continue } if (v < mn) mn = v; if (v > mx) mx = v; sum += v }
      r.outMin = mn; r.outMax = mx; r.nonFinite = bad; r.outMean = sum / out.data.length
      if (!ref) ref = out.data
      else if (ref.length === out.data.length) {
        let m = 0, s2 = 0, rm = 0
        for (let i = 0; i < ref.length; i++) { const a = Math.abs(ref[i]); if (a > rm) rm = a }
        for (let i = 0; i < ref.length; i++) { const e = Math.abs(ref[i] - out.data[i]); if (e > m || Number.isNaN(e)) m = Number.isNaN(e) ? Infinity : e; s2 += e }
        r.vsFirst = { maxAbs: m, meanAbs: s2 / ref.length, refAbsMax: rm, maxRel: m / rm, meanRel: s2 / ref.length / rm }
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

const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.html': 'text/html', '.f32': 'application/octet-stream' }

function playwright() {
  const dirs = [arg('--pw'), process.cwd(), '/opt/node-tools'].filter(Boolean)
  for (const d of dirs) {
    const req = createRequire(join(d, 'x.js'))
    for (const n of ['playwright-core', 'playwright']) {
      try {
        return req(n)
      } catch {
        // next
      }
    }
  }
  throw new Error('playwright not found (pass --pw DIR)')
}

async function browser() {
  const dist = resolve(arg('--ort'))
  const models = arg('--models').split(',').map((f) => resolve(f))
  const providers = arg('--providers', 'wasm,webgpu').split(',')
  const threads = Number(arg('--threads', '4'))
  const runs = Number(arg('--runs', '3'))
  const tiles = Number(arg('--tiles', '0'))
  const verbose = flag('--verbose')
  const size = Number(arg('--size', '512'))
  const inputFile = arg('--input') ? resolve(arg('--input')) : null
  const page = `<!doctype html><meta charset="utf-8"><script type="module">
import * as ort from '/ort/ort.webgpu.min.mjs'
ort.env.wasm.wasmPaths = '/ort/'
ort.env.wasm.numThreads = ${threads}
ort.env.wasm.proxy = false
ort.env.logLevel = ${verbose ? "'verbose'" : "'error'"}
${RUNNER}
window.go = async (url, inputUrl, opts) => runAll(ort, await (await fetch(url)).arrayBuffer(), { ...opts, input: inputUrl ? await (await fetch(inputUrl)).arrayBuffer() : null })
window.info = async () => {
  const a = navigator.gpu ? await navigator.gpu.requestAdapter() : null
  return { isolated: crossOriginIsolated, cores: navigator.hardwareConcurrency, ua: navigator.userAgent, gpu: a ? { vendor: a.info.vendor, architecture: a.info.architecture, device: a.info.device, description: a.info.description, f16: a.features.has('shader-f16'), maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize, maxBufferSize: a.limits.maxBufferSize } : null }
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
    if (u === '/input.f32') file = inputFile
    if (!file || !existsSync(file)) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin' })
    res.end(readFileSync(file))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const pw = playwright()
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
    const r = await p.evaluate(([url, inp, o]) => window.go(url, inp, o), [`/m/${i}`, inputFile ? '/input.f32' : null, { providers, runs, verbose, tiles, size }])
    clearInterval(timer)
    const mine = logs.slice(start)
    const placement = mine.filter((l) => /placed on|Number of nodes|VerifyEachNode/.test(l))
    const cpu = {}
    const cpuNames = []
    let inCpu = false
    let sessions = 0
    const webgpuIndex = providers.indexOf('webgpu')
    for (const l of placement) {
      if (/Node placements/.test(l)) sessions++
      if (/placed on \[/.test(l)) { inCpu = sessions === webgpuIndex + 1 && /CPUExecutionProvider/.test(l) && /Node\(s\)/.test(l); continue }
      const mm = inCpu && l.match(/VerifyEachNodeIsAssignedToAnEp\]\s+(\S+) \((.*)\)\s*$/)
      if (mm) { cpu[mm[1]] = (cpu[mm[1]] || 0) + 1; if (cpuNames.length < 40) cpuNames.push(mm[1] + ' ' + mm[2]) }
    }
    const errors = mine.filter((l) => /error|Error|ERROR|pageerror/.test(l) && !/logSeverity/.test(l)).slice(0, 10).map((l) => l.slice(0, 400))
    const summary = placement.filter((l) => /placed on|All nodes/.test(l)).map((l) => l.replace(/^.*VerifyEachNodeIsAssignedToAnEp\]\s*/, ''))
    const row = { model: basename(models[i]), bytes: statSync(models[i]).size, results: r, peakRss: peak, wallMs: Date.now() - t, placementSummary: summary, webgpuCpuNodesByOp: cpu, webgpuCpuNodeNames: cpuNames, errors }
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
  const runs = Number(arg('--runs', '3'))
  const tiles = Number(arg('--tiles', '0'))
  const req = createRequire(join(process.cwd(), 'x.js'))
  const ort = await import(pathToFileURL(req.resolve('onnxruntime-web')).href)
  ort.env.wasm.numThreads = threads
  ort.env.logLevel = 'error'
  let peak = 0
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss) }, 100)
  const runAll = new Function('performance', RUNNER + '; return runAll')(performance)
  const inp = arg('--input') ? readFileSync(resolve(arg('--input'))) : null
  const r = await runAll(ort, readFileSync(model).buffer, { providers: ['wasm'], runs, verbose: false, tiles, size: Number(arg('--size', '512')), input: inp ? inp.buffer.slice(inp.byteOffset, inp.byteOffset + inp.byteLength) : null })
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
