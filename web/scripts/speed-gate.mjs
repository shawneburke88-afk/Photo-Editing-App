// The speed check run on every push to main and every pull request (.github/workflows/speed.yml; PLAN.md "Every
// release", Speed). It runs System Check's GPU benchmark (src/bench/run.ts, Quick mode, PHASE3.md Part 16) in headless
// Chromium on the software GPU (SwiftShader), on test images scaled down to SPEED_MP megapixels, and compares it with
// the committed baseline (scripts/speed-baseline.json).
//
// It only warns; it never fails the build. CI machines have no real GPU and differ from run to run, so:
// - Time is compared as each stage's SHARE of the whole run (its median ÷ the sum of all compared medians), which
//   cancels out a machine that is uniformly faster or slower. A stage warns when its share grew by more than
//   SHARE_TOLERANCE and the extra time is at least MIN_EXTRA_MS. The whole run warns only past TOTAL_TOLERANCE.
// - Memory is the benchmark's estimate of the engine's own allocations (deterministic for the same code and image
//   size); a stage warns past MEMORY_TOLERANCE.
// What it can't catch is written in the summary (`limitsText`) and in PHASE3.md ("Speed check on each release").
//
//   node scripts/speed-gate.mjs run [--out result.json] [--port 5530] [--mp 0.3]   run the benchmark (starts its own dev server)
//   node scripts/speed-gate.mjs compare result.json [--baseline scripts/speed-baseline.json] [--summary file.md]
//   node scripts/speed-gate.mjs baseline result.json                                write a result as the new baseline
//
// Playwright isn't one of the app's dependencies: `run` loads it from PLAYWRIGHT_FROM (a node_modules folder) or
// from the normal resolution. The browser flags are those of the project's other headless checks.

import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '..')
export const BASELINE = join(HERE, 'speed-baseline.json')

/** Test images' size for the check: at nominal size (24 MP) the software GPU needs minutes per stage. */
export const SPEED_MP = 0.3
/**
 * A stage warns when its share of the run grew by more than this (1 = twice its share). Two runs of the same code on
 * the build machine differed by up to 84 % in one stage's share (2026-10-21), so less would warn about noise.
 */
export const SHARE_TOLERANCE = 1
/** … and only when that growth is at least this many ms at this run's speed (short stages are mostly noise). */
export const MIN_EXTRA_MS = 40
/** The whole run warns when it took more than this many times the baseline's (another machine can differ this much). */
export const TOTAL_TOLERANCE = 2
/** A stage's peak engine memory warns past this (0.1 = 10 % more). */
export const MEMORY_TOLERANCE = 0.1
/**
 * Quick-mode stages left out to keep the check to a few minutes: the full-size export rows of the masks and effects
 * and the end-to-end export (on the software GPU they took about 60 % of the run). The slider-to-preview rows (fit,
 * 100 %), Stage A, Detail, the plain export render and the thumbnail stay.
 */
export const SKIPPED_STAGES = ['masksExport', 'vignetteExport', 'grainExport', 'tcExport', 'dehazeExport', 'glowExport', 'exportAll']

/** The rows compared: measured stage rows (not the ↳ parts, not failed or skipped rows), by id. */
export function stageRows(report) {
  const rows = new Map()
  for (const r of report?.rows ?? []) {
    if (r.sub || r.error || !r.wall || !Number.isFinite(r.wall.median)) continue
    rows.set(r.id, { id: r.id, stage: r.stage, image: r.image, median: r.wall.median, peakBytes: r.peakBytes ?? null })
  }
  return rows
}

/** Failed rows of a report, apart from the benchmark's own expected skips (e.g. no AI model on the machine). */
export function failedRows(report) {
  return (report?.rows ?? []).filter((r) => r.error && !/^skipped:/.test(r.error)).map((r) => ({ id: r.id, stage: r.stage, error: r.error }))
}

/**
 * Compares a result with the baseline. Returns one entry per stage in either, the totals and the warnings (plain
 * sentences). Pure: no files, no clock.
 */
export function compare(result, baseline, tol = {}) {
  const shareTol = tol.share ?? SHARE_TOLERANCE
  const minExtra = tol.minExtraMs ?? MIN_EXTRA_MS
  const totalTol = tol.total ?? TOTAL_TOLERANCE
  const memTol = tol.memory ?? MEMORY_TOLERANCE
  const now = stageRows(result)
  const base = stageRows(baseline)
  const both = [...now.keys()].filter((id) => base.has(id))
  const sum = (m) => both.reduce((s, id) => s + m.get(id).median, 0)
  const totalNow = sum(now)
  const totalBase = sum(base)
  const warnings = []
  const stages = []
  for (const id of new Set([...base.keys(), ...now.keys()])) {
    const n = now.get(id)
    const b = base.get(id)
    if (!n || !b) {
      stages.push({ id, stage: (n ?? b).stage, image: (n ?? b).image, now: n?.median ?? null, base: b?.median ?? null, shareChange: null, memChange: null, status: n ? 'new' : 'missing' })
      continue
    }
    const shareNow = totalNow > 0 ? n.median / totalNow : 0
    const shareBase = totalBase > 0 ? b.median / totalBase : 0
    const shareChange = shareBase > 0 ? shareNow / shareBase - 1 : null
    // The extra time this run spent on the stage beyond what the baseline's share of this run's total would give.
    const extraMs = (shareNow - shareBase) * totalNow
    const memChange = b.peakBytes && n.peakBytes !== null ? n.peakBytes / b.peakBytes - 1 : null
    let status = 'ok'
    if (shareChange !== null && shareChange > shareTol && extraMs >= minExtra) {
      status = 'slower'
      warnings.push(`${n.stage} (${n.image}) took ${amount(shareChange)} more of the run than in the baseline (${fmt(n.median)} now; about ${fmt(extraMs)} extra at this machine's speed).`)
    }
    if (memChange !== null && memChange > memTol) {
      status = status === 'ok' ? 'more memory' : `${status}, more memory`
      warnings.push(`${n.stage} (${n.image}) needed ${amount(memChange)} more GPU memory than in the baseline (${mb(n.peakBytes)} instead of ${mb(b.peakBytes)}).`)
    }
    stages.push({ id, stage: n.stage, image: n.image, now: n.median, base: b.median, shareChange, memChange, status })
  }
  const totalRatio = totalBase > 0 ? totalNow / totalBase : null
  if (totalRatio !== null && totalRatio > totalTol) {
    warnings.push(`The whole run took ${totalRatio.toFixed(1)} times as long as the baseline (${fmt(totalNow)} instead of ${fmt(totalBase)}, the stages in both). A slower machine can do this too; check the stages above.`)
  }
  for (const f of failedRows(result)) warnings.push(`${f.stage} failed: ${f.error}`)
  if (result?.cancelled) warnings.push('The benchmark stopped before the end.')
  return { stages, totalNow, totalBase, totalRatio, compared: both.length, warnings }
}

const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`)
const mb = (b) => `${(b / 2 ** 20).toFixed(1)} MB`
const pct = (x) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)} %`
const amount = (x) => `${Math.round(x * 100)} %`

/** What the check measures and can't catch, for the run summary. */
export function limitsText(mp = SPEED_MP) {
  return [
    `**What this measures.** System Check's GPU benchmark (Quick, without its full-size export rows for the masks and effects and the end-to-end export) on synthetic test images scaled to ${mp} MP, in headless Chromium on the software GPU (SwiftShader, which runs the shaders on the CPU), with the median of 3 runs after 1 warm-up per stage. Time is compared as each stage's share of the whole run, so a uniformly faster or slower machine doesn't count; memory is the engine's own estimate of what it allocated.`,
    `**What it can't catch.** Speed on a real graphics card (memory bandwidth, drivers, integrated graphics); changes smaller than about ${Math.round(SHARE_TOLERANCE * 100)} % in a stage, or under ${MIN_EXTRA_MS} ms; a slowdown that hits every stage alike, unless the whole run takes ${TOTAL_TOLERANCE} times as long; work at full size (24 MP and up) that the scaled images don't reach; the masks' and effects' export rows, which it leaves out; the interface's own responsiveness (React, the main thread outside engine calls); real memory use by the driver. It only warns: it never fails the build.`,
  ].join('\n\n')
}

/** The run summary in Markdown (GitHub's job summary). */
export function summaryMarkdown(result, baseline, cmp) {
  const lines = ['## Speed check', '']
  if (cmp.warnings.length) {
    lines.push(`**${cmp.warnings.length} warning${cmp.warnings.length === 1 ? '' : 's'}** (the build is not stopped):`, '')
    for (const w of cmp.warnings) lines.push(`- ${w}`)
  } else {
    lines.push(`No warnings: ${cmp.compared} stages compared with the baseline.`)
  }
  lines.push('')
  lines.push(`This run: ${result?.app?.version ?? '?'}, ${result?.date ?? '?'}, ${result?.adapter ? `${result.adapter.vendor} ${result.adapter.architecture}`.trim() : 'adapter not reported'}; total ${fmt(cmp.totalNow)} (stages in both).`)
  lines.push(`Baseline: ${baseline?.app?.version ?? '?'}, ${baseline?.date ?? '?'}; total ${fmt(cmp.totalBase)}${cmp.totalRatio ? ` (this run ${cmp.totalRatio.toFixed(2)}×)` : ''}.`)
  lines.push('')
  lines.push('| Stage | Image | Baseline | This run | Share of the run | Peak memory | |')
  lines.push('|---|---|---:|---:|---:|---:|---|')
  for (const s of cmp.stages) {
    const cell = (v) => (v === null ? '—' : fmt(v))
    const ch = (v) => (v === null ? '—' : pct(v))
    lines.push(`| ${s.stage.replace(/\|/g, '\\|')} | ${s.image.replace(/\|/g, '\\|')} | ${cell(s.base)} | ${cell(s.now)} | ${ch(s.shareChange)} | ${ch(s.memChange)} | ${s.status === 'ok' ? '' : s.status} |`)
  }
  lines.push('', limitsText(result?.scaledTo ?? SPEED_MP), '')
  lines.push('To make this run the new baseline (after a change that is meant to change speed): download the `speed-result` artifact and run `node scripts/speed-gate.mjs baseline speed-result.json` in `web/`, then commit `web/scripts/speed-baseline.json`.')
  return lines.join('\n') + '\n'
}

/** The part of a report kept as a baseline (no user agent details beyond what's needed). */
export function baselineOf(report) {
  return {
    app: report.app,
    date: report.date,
    mode: report.mode,
    scaledTo: report.scaledTo,
    warmup: report.warmup,
    runs: report.runs,
    adapter: report.adapter ? { vendor: report.adapter.vendor, architecture: report.adapter.architecture, isFallbackAdapter: report.adapter.isFallbackAdapter } : null,
    display: report.display,
    rows: report.rows.filter((r) => !r.sub).map((r) => ({ id: r.id, stage: r.stage, image: r.image, wall: r.wall, peakBytes: r.peakBytes, ...(r.error ? { error: r.error } : {}) })),
  }
}

// ---- running the benchmark

async function loadPlaywright() {
  const from = process.env.PLAYWRIGHT_FROM
  if (from) return createRequire(join(resolve(from), 'noop.js'))('playwright')
  return import('playwright')
}

export async function runBenchmarkInBrowser({ port = 5530, mp = SPEED_MP, log = console.log } = {}) {
  process.env.npm_package_version ??= JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')).version
  const { createServer } = await import('vite')
  const server = await createServer({
    configFile: join(WEB, 'vite.config.ts'),
    root: WEB,
    logLevel: 'warn',
    server: { port, strictPort: true, hmr: false, watch: null },
  })
  await server.listen()
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.on('pageerror', (e) => log(`[page error] ${e.message}`))
    let last = 0
    page.on('console', (m) => {
      const t = m.text()
      if (t.startsWith('SPEED ')) {
        if (Date.now() - last > 10_000 || /Done|Cancelled/.test(t)) {
          last = Date.now()
          log(t.slice(6))
        }
      } else if (m.type() === 'error') log(`[console] ${t.slice(0, 300)}`)
    })
    await page.goto(`http://localhost:${port}/?gpu=readback`)
    await page.waitForSelector('#root *', { timeout: 120_000 })
    return await page.evaluate(async ([mp, skipped]) => {
      const { benchPlan, runBenchmark } = await import('/src/bench/run.ts')
      const plan = benchPlan('quick', mp)
      for (const d of plan.datasets) d.stages = d.stages.filter((s) => !skipped.includes(s))
      const stage = document.createElement('div')
      stage.style.cssText = 'position:fixed;left:0;top:0;width:938px;height:420px;z-index:10'
      document.body.append(stage)
      return runBenchmark(plan, {
        stage,
        signal: new AbortController().signal,
        onProgress: (done, total, label) => console.log(`SPEED ${done}/${total} ${label}`),
        onRow: () => {},
      })
    }, [mp, SKIPPED_STAGES])
  } finally {
    await browser.close().catch(() => {})
    await server.close().catch(() => {})
  }
}

// ---- command line

function arg(args, name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}

/** Appends to GitHub's job summary when there is one, else prints. */
function writeSummary(md, file = process.env.GITHUB_STEP_SUMMARY) {
  if (file) appendFileSync(file, md)
  else process.stdout.write(md)
}

/** A GitHub warning annotation (plain text elsewhere). */
const warn = (text) => console.log(process.env.GITHUB_ACTIONS ? `::warning title=Speed check::${text.replace(/\r?\n/g, ' ')}` : `warning: ${text}`)

async function main(args) {
  const [cmd, file] = args
  if (cmd === 'run') {
    const out = arg(args, '--out', 'speed-result.json')
    const t0 = Date.now()
    const report = await runBenchmarkInBrowser({ port: Number(arg(args, '--port', '5530')), mp: Number(arg(args, '--mp', String(SPEED_MP))) })
    writeFileSync(out, JSON.stringify(report, null, 1))
    console.log(`benchmark done in ${Math.round((Date.now() - t0) / 1000)} s: ${report.rows.length} rows written to ${out}`)
    return
  }
  if (cmd === 'compare') {
    const baselineFile = arg(args, '--baseline', BASELINE)
    const summaryFile = arg(args, '--summary', undefined)
    if (!file || !existsSync(file)) {
      const text = 'The speed check couldn’t run (no result was written); see the step above. The build is not stopped.'
      warn(text)
      writeSummary(`## Speed check\n\n${text}\n`, summaryFile)
      return
    }
    const result = JSON.parse(readFileSync(file, 'utf8'))
    const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'))
    const cmp = compare(result, baseline)
    for (const w of cmp.warnings) warn(w)
    writeSummary(summaryMarkdown(result, baseline, cmp), summaryFile)
    console.log(`${cmp.compared} stages compared, ${cmp.warnings.length} warning(s)`)
    return
  }
  if (cmd === 'baseline') {
    if (!file) throw new Error('usage: speed-gate.mjs baseline result.json')
    const report = JSON.parse(readFileSync(file, 'utf8'))
    writeFileSync(arg(args, '--to', BASELINE), JSON.stringify(baselineOf(report), null, 1) + '\n')
    console.log(`baseline written from ${file} (${report.app?.version}, ${report.date})`)
    return
  }
  throw new Error('usage: speed-gate.mjs run|compare|baseline …')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
