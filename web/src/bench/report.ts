// The GPU benchmark's results (PHASE3.md Part 16) and their Markdown and JSON forms for "Copy results". Nothing is
// sent anywhere: the person copies the text and pastes it where they choose.

import type { Summary } from './stats'

export interface BenchRow {
  /** Stable id, e.g. `bayer24.stageA.demosaic`. */
  id: string
  /** What was measured, for people. */
  stage: string
  /** The test image (dataset label). */
  image: string
  /** Wall-clock time of the engine call until the GPU finished (performance.now() around onSubmittedWorkDone), ms. */
  wall: Summary | null
  /** GPU time from timestamp queries (sum of the stage's passes), ms; null without timestamp-query. */
  gpu: Summary | null
  /** The most bytes the engine had allocated on its device during the stage (estimated from its allocations). */
  peakBytes: number | null
  /** A part of the row above (e.g. Stage A's demosaic): GPU time only. */
  sub?: boolean
  note?: string
  /** The stage failed: the message. */
  error?: string
}

export interface AdapterReport {
  vendor: string
  architecture: string
  device: string
  description: string
  /** Null when the browser doesn't say. */
  isFallbackAdapter: boolean | null
  features: { 'timestamp-query': boolean; 'shader-f16': boolean }
  limits: Record<string, number>
}

export interface DatasetReport {
  id: string
  label: string
  width: number
  height: number
  /** Peak engine allocations while this image's stages ran, and what stayed allocated after `unload()`. */
  peakBytes: number | null
  afterUnloadBytes: number | null
}

export interface BenchReport {
  app: { version: string; commit: string | null }
  date: string
  userAgent: string
  mode: 'quick' | 'full'
  warmup: number
  runs: number
  /** `?benchmp=`: test images scaled to this many megapixels (testing only); null = nominal sizes. */
  scaledTo: number | null
  timing: {
    gpu: 'timestamp-query' | 'unavailable'
    /** Timestamps looked rounded to 0.1 ms (Chrome's default without its WebGPU developer features). */
    quantized: boolean
    wall: string
  }
  adapter: AdapterReport | null
  display: { presentMode: string; reason: string; devicePixelRatio: number; canvas: [number, number] }
  datasets: DatasetReport[]
  rows: BenchRow[]
  notes: string[]
  cancelled: boolean
}

/** The commit in the app's version string (`0.5.5+abc1234`); null when unknown (`+dev`). */
export function commitOf(version: string): string | null {
  const c = version.split('+')[1]
  return c && c !== 'dev' ? c : null
}

/** Milliseconds with three significant figures where it matters (0.123, 1.23, 12.3, 123, 1234). */
export function fmtMs(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const d = v < 1 ? 3 : v < 10 ? 2 : v < 100 ? 1 : 0
  return `${v.toFixed(d)} ms`
}

export function fmtBytes(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const mb = v / 2 ** 20
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')

export const yesNo = (v: boolean | null) => (v === null ? 'not reported' : v ? 'yes' : 'no')

/** The results as Markdown, for pasting into a conversation or an issue. */
export function toMarkdown(r: BenchReport): string {
  const a = r.adapter
  const lines = [
    '## LightBench GPU benchmark',
    '',
    `- App: ${r.app.version}${r.app.commit ? ` (commit ${r.app.commit})` : ''}`,
    `- Date: ${r.date}`,
    `- Browser: ${r.userAgent}`,
    a
      ? `- GPU: ${[a.vendor, a.architecture, a.device, a.description].filter(Boolean).join(' · ') || 'not reported'}; fallback (software) adapter: ${yesNo(a.isFallbackAdapter)}`
      : '- GPU: no adapter',
    ...(a
      ? [
          `- Features: timestamp-query ${yesNo(a.features['timestamp-query'])}, shader-f16 ${yesNo(a.features['shader-f16'])}`,
          `- Limits: ${Object.entries(a.limits).map(([k, v]) => `${k} ${v}`).join(', ')}`,
        ]
      : []),
    `- Display: ${r.display.presentMode} (${r.display.reason}), devicePixelRatio ${r.display.devicePixelRatio}, benchmark canvas ${r.display.canvas[0]}×${r.display.canvas[1]} device px`,
    `- Mode: ${r.mode === 'quick' ? 'Quick' : 'Full'} (${r.warmup} warm-up, ${r.runs} measured runs per stage)${r.cancelled ? ' — cancelled, partial results' : ''}`,
    `- Timing: wall = ${r.timing.wall}; GPU = ${r.timing.gpu === 'timestamp-query' ? `timestamp-query per pass${r.timing.quantized ? ' (rounded to 0.1 ms by the browser)' : ''}` : 'unavailable (no timestamp-query): wall-clock only'}`,
    ...(r.scaledTo ? [`- Test images scaled to ${r.scaledTo} MP (?benchmp=, for testing): not comparable with nominal sizes`] : []),
    `- Images: ${r.datasets.map((d) => `${d.label} ${d.width}×${d.height} (peak ${fmtBytes(d.peakBytes)}, after unload ${fmtBytes(d.afterUnloadBytes)})`).join('; ') || 'none'}`,
    '',
    '| Stage | Image | Median | Min | GPU median | GPU min | Runs | Peak memory | Note |',
    '|---|---|---:|---:|---:|---:|---:|---:|---|',
    ...r.rows.map((row) =>
      `| ${cell(row.sub ? `↳ ${row.stage}` : row.stage)} | ${cell(row.image)} | ${row.error ? 'failed' : fmtMs(row.wall?.median)} | ${fmtMs(row.wall?.min)} | ${fmtMs(row.gpu?.median)} | ${fmtMs(row.gpu?.min)} | ${row.wall?.runs ?? row.gpu?.runs ?? 0} | ${fmtBytes(row.peakBytes)} | ${cell(row.error ?? row.note ?? '')} |`),
  ]
  if (r.notes.length) lines.push('', ...r.notes.map((n) => `- ${n}`))
  return lines.join('\n')
}

const round = (v: number) => Math.round(v * 1000) / 1000

/** The results as JSON (times rounded to µs). */
export function toJson(r: BenchReport): string {
  return JSON.stringify(r, (_k, v: unknown) => (typeof v === 'number' && !Number.isInteger(v) ? round(v) : v), 2)
}
