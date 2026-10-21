// Runs ONNX models in headless Chromium with onnxruntime-web 1.30.0's WebGPU bundle (masks-prep2 task; throwaway).
//
//   node browser-run.mjs --dir D --ort ORT_WEB_DIST --jobs JOBS.json --out RESULT.json [--adapter swiftshader|default]
//
// Serves D (models, raw inputs, CPU reference outputs) and ORT_WEB_DIST over http://127.0.0.1 with cross-origin
// isolation, opens a page that imports /ort/ort.webgpu.min.mjs (what `onnxruntime-web/webgpu` resolves to in 1.30.0)
// and runs each job with executionProviders ['webgpu'].
//
// A job: { key, model, externalData?: [{ path, url }], feeds: [{ name, type, dims, url? , values? }],
//          compare: { outputName: cpuRawUrl }, chain?: { model, externalData?, feeds, compare, fromFirst: [names] } }
// Raw files are little-endian float32. The page returns per output: dims, finite, max/mean |Δ| against the CPU file,
// and for outputs named in job.iou the IoU of (value > 0) masks.

import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, normalize } from 'node:path'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const DIR = opt('--dir')
const ORT = opt('--ort')
const ONLY = opt('--only')
const jobs = JSON.parse(readFileSync(opt('--jobs'), 'utf8')).filter((j) => !ONLY || ONLY.split(',').includes(j.key))
const OUT = opt('--out')
const ADAPTER = opt('--adapter', 'swiftshader')
const PW = opt('--playwright', process.env.PLAYWRIGHT_DIR ?? '')

const TYPES = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.json': 'application/json' }
const PAGE = `<!doctype html><meta charset="utf-8"><title>ort</title><body>ort webgpu runner</body>`

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  const head = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' }
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { ...head, 'Content-Type': 'text/html' })
    return res.end(PAGE)
  }
  let base = null
  let rel = null
  if (url.startsWith('/ort/')) ((base = ORT), (rel = url.slice(5)))
  else if (url.startsWith('/d/')) ((base = DIR), (rel = url.slice(3)))
  const p = base && normalize(join(base, rel))
  if (!p || !p.startsWith(normalize(base)) || !existsSync(p) || statSync(p).isDirectory()) {
    res.writeHead(404, head)
    return res.end('not found')
  }
  res.writeHead(200, { ...head, 'Content-Type': TYPES[extname(p)] ?? 'application/octet-stream', 'Content-Length': statSync(p).size })
  createReadStream(p).pipe(res)
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const origin = `http://127.0.0.1:${server.address().port}`

const req = createRequire(PW ? join(PW, 'x.js') : import.meta.url)
const { chromium } = req('playwright')
const flags = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist']
if (ADAPTER === 'swiftshader') flags.push('--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader')
else flags.push('--use-angle=vulkan')
const browser = await chromium.launch({ headless: true, args: flags })
// --emulate-binding N: the adapter reports maxStorageBufferBindingSize N (e.g. 134217728, WebGPU's default and the
// guaranteed minimum), so ORT creates its device with that limit: what an adapter at the minimum would give.
const EMULATE = Number(opt('--emulate-binding', 0))
const JOB_TIMEOUT = Number(opt('--job-timeout', 900)) * 1000
const consoleLines = []
let page
async function newPage() {
  page = await browser.newPage()
  if (EMULATE) {
    await page.addInitScript((n) => {
      const d = Object.getOwnPropertyDescriptor(GPUAdapter.prototype, 'limits')
      Object.defineProperty(GPUAdapter.prototype, 'limits', {
        get() {
          const l = d.get.call(this)
          return new Proxy(l, { get: (t, p) => (p === 'maxStorageBufferBindingSize' ? Math.min(n, t[p]) : typeof t[p] === 'function' ? t[p].bind(t) : t[p]) })
        },
      })
    }, EMULATE)
  }
  page.on('console', (m) => consoleLines.length < 200 && consoleLines.push(`[${m.type()}] ${m.text()}`.slice(0, 400)))
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`.slice(0, 400)))
  await page.goto(origin + '/')
}
await newPage()

const result = { adapter: ADAPTER, flags, emulateBinding: EMULATE || null, browser: browser.version(), jobs: {} }
result.gpu = await page.evaluate(async () => {
  if (!navigator.gpu) return { error: 'navigator.gpu missing' }
  const a = await navigator.gpu.requestAdapter()
  if (!a) return { error: 'no adapter' }
  const info = a.info ?? {}
  const l = a.limits
  const dev = await a.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize } })
  const devBinding = dev.limits.maxStorageBufferBindingSize
  dev.destroy()
  return {
    deviceMaxStorageBufferBindingSize: devBinding,
    info: { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description },
    limits: { maxStorageBufferBindingSize: l.maxStorageBufferBindingSize, maxBufferSize: l.maxBufferSize, maxStorageBuffersPerShaderStage: l.maxStorageBuffersPerShaderStage },
    features: [...a.features].sort(),
  }
})
console.log('browser', result.browser, 'gpu', JSON.stringify(result.gpu))

for (const job of jobs) {
  const t0 = Date.now()
  let r
  try {
    let timer
    const timeout = new Promise((_, no) => (timer = setTimeout(() => no(new Error(`job timed out after ${JOB_TIMEOUT / 1000} s`)), JOB_TIMEOUT)))
    r = await Promise.race([timeout, page.evaluate(
      async (job) => {
        const ort = await import('/ort/ort.webgpu.min.mjs')
        ort.env.wasm.wasmPaths = '/ort/'
        ort.env.wasm.numThreads = 1
        const raw = async (url) => new Float32Array(await (await fetch(url)).arrayBuffer())
        const mk = async (f) => {
          if (f.type === 'int64') return new ort.Tensor('int64', BigInt64Array.from(f.values, (v) => BigInt(v)), f.dims)
          const d = f.url ? await raw(f.url) : Float32Array.from(f.values ?? [])
          return new ort.Tensor('float32', d, f.dims)
        }
        const toF32 = (t) => (t.type === 'float32' ? t.data : t.type === 'float16' && t.data instanceof Uint16Array ? null : Float32Array.from(t.data, Number))
        const compare = async (out, cmp, iou) => {
          const res = {}
          for (const [name, t] of Object.entries(out)) {
            const d = toF32(t)
            const o = { dims: t.dims, type: t.type }
            if (d) {
              let nf = 0
              for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) nf++
              o.nonFinite = nf
              if (cmp?.[name]) {
                const c = await raw(cmp[name])
                if (c.length !== d.length) o.error = `length ${d.length} vs cpu ${c.length}`
                else {
                  let mx = 0
                  let sum = 0
                  let inter = 0
                  let uni = 0
                  for (let i = 0; i < d.length; i++) {
                    const x = Math.abs(d[i] - c[i])
                    if (!(x <= mx)) mx = x
                    sum += x
                    const a = d[i] > 0
                    const b = c[i] > 0
                    if (a && b) inter++
                    if (a || b) uni++
                  }
                  Object.assign(o, { maxAbsDiff: mx, meanAbsDiff: sum / d.length })
                  if (iou?.includes(name)) o.iouVsCpu = uni ? inter / uni : 1
                }
              }
            }
            res[name] = o
          }
          return res
        }
        // job.maxBinding: ORT's "ep.webgpuexecutionprovider.maxStorageBufferBindingSize" session config (onnxruntime
        // PR #26429), to emulate an adapter at WebGPU's default 128 MiB limit on an adapter that allows more.
        const extra = job.maxBinding ? { ep: { webgpuexecutionprovider: { maxStorageBufferBindingSize: String(job.maxBinding) } } } : undefined
        const session = (m) => ort.InferenceSession.create(m.model, { executionProviders: ['webgpu'], externalData: m.externalData, graphOptimizationLevel: 'all', extra })
        const out = { steps: [] }
        const s1 = await session(job)
        const feeds1 = {}
        for (const f of job.feeds) feeds1[f.name] = await mk(f)
        let t = performance.now()
        const o1 = await s1.run(feeds1)
        out.steps.push({ ms: Math.round(performance.now() - t), outputs: await compare(o1, job.compare, job.iou) })
        if (job.chain) {
          const s2 = await session(job.chain)
          const feeds2 = {}
          for (const f of job.chain.feeds) feeds2[f.name] = await mk(f)
          for (const n of job.chain.fromFirst) feeds2[n] = o1[n]
          t = performance.now()
          const o2 = await s2.run(feeds2)
          out.steps.push({ ms: Math.round(performance.now() - t), outputs: await compare(o2, job.chain.compare, job.chain.iou) })
          await s2.release()
        }
        await s1.release()
        return out
      },
      { ...job, model: `/d/${job.model}`, externalData: job.externalData?.map((e) => ({ path: e.path, data: `/d/${e.url}` })),
        feeds: job.feeds.map((f) => ({ ...f, url: f.url && `/d/${f.url}` })), compare: Object.fromEntries(Object.entries(job.compare ?? {}).map(([k, v]) => [k, `/d/${v}`])),
        chain: job.chain && { ...job.chain, model: `/d/${job.chain.model}`, externalData: job.chain.externalData?.map((e) => ({ path: e.path, data: `/d/${e.url}` })),
          feeds: job.chain.feeds.map((f) => ({ ...f, url: f.url && `/d/${f.url}` })), compare: Object.fromEntries(Object.entries(job.chain.compare ?? {}).map(([k, v]) => [k, `/d/${v}`])) } },
    )])
    clearTimeout(timer)
  } catch (e) {
    r = { error: String(e.message ?? e).slice(0, 1200) }
    if (/timed out|Target crashed|closed/.test(r.error)) {
      await page.close().catch(() => {})
      await newPage()
    }
  }
  r.wallMs = Date.now() - t0
  result.jobs[job.key] = r
  console.log(`BROWSER_JOB ${job.key} ${JSON.stringify(r)}`.slice(0, 3000))
  writeFileSync(OUT, JSON.stringify({ ...result, console: consoleLines }, null, 1))
}
await browser.close()
server.close()
result.console = consoleLines.filter((l) => !/DevTools|Download the React/.test(l)).slice(0, 60)
writeFileSync(OUT, JSON.stringify(result, null, 1))
