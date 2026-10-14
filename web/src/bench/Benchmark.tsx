// System Check's "GPU benchmark" card (PHASE3.md Part 16). Loaded only when the System Check page is opened
// (SystemCheck.tsx imports it lazily), so the main app doesn't carry it.

import { useEffect, useRef, useState } from 'react'
import { getCatalog } from '../catalog/client'
import { presentChoice, type PresentChoice } from '../engine/gpu/present'
import { RAW_EXTENSIONS } from '../engine/raw/decoder'
import type { DecodeResult } from '../engine/raw/types'
import { openPhotoFile } from '../platform/roots'
import { useReport } from '../syscheck/report'
import { getDecoder } from '../syscheck/shared'
import { Card, Facts, type Status } from '../syscheck/ui'
import { fmtBytes, fmtMs, toJson, toMarkdown, yesNo, type AdapterReport, type BenchReport, type BenchRow } from './report'
import { adapterReport, benchPlan, photoDataset, plannedRuns, runBenchmark, type BenchMode, type DatasetPlan } from './run'
import './bench.css'

/** `?benchmp=N`: synthetic images of N megapixels instead of their nominal sizes (for testing on software GPUs). */
function scaleParam(): number | null {
  const v = Number(new URLSearchParams(location.search).get('benchmp'))
  return Number.isFinite(v) && v > 0 ? Math.min(v, 100) : null
}

/** `?benchts=0`: wall-clock times only, even where timestamp-query is available (tests that path; or bad timestamps). */
function timestampsParam(): boolean {
  return new URLSearchParams(location.search).get('benchts') !== '0'
}

/** Development server only: `?benchlose=<stage id>` loses the device once before that stage (tests recovery). */
function loseParam(): string | null {
  return import.meta.env.DEV ? new URLSearchParams(location.search).get('benchlose') : null
}

const PHOTO_EXT = new Set([...RAW_EXTENSIONS, 'jpg', 'jpeg'])

interface LibraryPhoto {
  id: number
  name: string
}

async function libraryPhotos(): Promise<LibraryPhoto[]> {
  const rows = await getCatalog().queryPhotos({ sort: 'captureDesc', ungrouped: true })
  return rows
    .filter((r) => r.version === 0 && PHOTO_EXT.has(r.fileName.split('.').pop()?.toLowerCase() ?? ''))
    .slice(0, 40)
    .map((r) => ({ id: r.id, name: r.fileName }))
}

/** Reads one of the library's photos, locally (its folder must be connected in this session). */
async function decodeLibraryPhoto(id: number): Promise<DecodeResult> {
  const p = await getCatalog().getPhoto(id)
  if (!p) throw new Error('That photo is no longer in the library.')
  const file = await openPhotoFile(p.rootId, p.folderPath, p.fileName)
  if (!file) throw new Error('That photo’s folder isn’t connected in this session. Open the Library, reconnect the folder, and try again.')
  return getDecoder().decode(file, true)
}

export default function Benchmark() {
  const { set } = useReport()
  const stageRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [adapter, setAdapter] = useState<AdapterReport | string | null>(null)
  const [present, setPresent] = useState<PresentChoice | null>(null)
  const [running, setRunning] = useState<BenchMode | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null)
  const [rows, setRows] = useState<BenchRow[]>([])
  const [report, setReport] = useState<BenchReport | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [photos, setPhotos] = useState<LibraryPhoto[] | null>(null)
  const [photoId, setPhotoId] = useState<number | null>(null)
  const [scale] = useState(scaleParam)

  useEffect(() => {
    let live = true
    void (async () => {
      const a = 'gpu' in navigator ? await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null) : null
      if (!live) return
      setAdapter(a ? adapterReport(a) : 'No WebGPU adapter is available in this browser.')
      setPresent(await presentChoice().catch(() => null))
    })()
    libraryPhotos().then((p) => live && setPhotos(p), () => live && setPhotos([]))
    return () => {
      live = false
      // Leaving the page cancels a run (and its engine is destroyed when it stops).
      abortRef.current?.abort()
    }
  }, [])

  async function run(mode: BenchMode) {
    setError('')
    setRows([])
    setReport(null)
    setCopied('')
    const abort = new AbortController()
    abortRef.current = abort
    setRunning(mode)
    try {
      const extra: DatasetPlan[] = []
      if (photoId !== null) {
        setProgress({ done: 0, total: 1, label: 'Reading your photo (locally)…' })
        const decoded = await decodeLibraryPhoto(photoId)
        const kind = decoded.rgb ? 'srgb' : decoded.sensor?.layout === 'xtrans' ? 'xtrans' : decoded.sensor?.layout === 'linear' || !decoded.sensor ? null : 'bayer'
        if (!kind) throw new Error('That photo can’t be used: its sensor layout isn’t a Bayer or X-Trans mosaic, or a JPEG.')
        const w = decoded.rgb?.width ?? decoded.sensor!.width
        const h = decoded.rgb?.height ?? decoded.sensor!.height
        extra.push(photoDataset(mode, kind, w, h, async () => decoded))
      }
      const plan = benchPlan(mode, scale, extra)
      setProgress({ done: 0, total: plannedRuns(plan), label: 'Starting…' })
      const r = await runBenchmark(plan, {
        stage: stageRef.current!,
        signal: abort.signal,
        onProgress: (done, total, label) => setProgress({ done, total, label }),
        onRow: (row) => setRows((rs) => [...rs, row]),
        loseDeviceAt: loseParam(),
        timestamps: timestampsParam(),
      })
      setReport(r)
      set('GPU benchmark', [
        `Mode: ${r.mode}${r.cancelled ? ' (cancelled)' : ''}; GPU timing: ${r.timing.gpu}; rows: ${r.rows.length}`,
        ...r.rows.filter((x) => !x.sub).map((x) => `${x.stage} — ${x.image}: ${x.error ? `failed (${x.error})` : `median ${fmtMs(x.wall?.median)}, GPU ${fmtMs(x.gpu?.median)}`}`),
        'Use “Copy results” in the GPU benchmark section for the full table.',
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(null)
      abortRef.current = null
    }
  }

  async function copy(what: 'markdown' | 'json') {
    if (!report) return
    const text = what === 'markdown' ? toMarkdown(report) : toJson(report)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
    } catch {
      setCopied('failed')
    }
  }

  const status: Status = running ? 'running' : report ? (report.rows.some((r) => r.error) ? 'warn' : 'pass') : typeof adapter === 'string' ? 'fail' : 'idle'
  const a = typeof adapter === 'object' ? adapter : null
  const pct = progress && progress.total ? Math.min(100, (100 * progress.done) / progress.total) : 0
  const markdown = report ? toMarkdown(report) : ''

  return (
    <Card
      title="GPU benchmark"
      status={status}
      intro={
        <>
          Times each step of LightBench’s photo pipeline on this computer’s graphics card, with test images made in the page
          (no photo of yours is needed). <strong>Quick</strong> takes about 30 seconds on a discrete graphics card,{' '}
          <strong>Full</strong> a few minutes. Close other apps that use the graphics card first. Nothing is sent anywhere:
          use <strong>Copy results</strong> and paste them where you choose.
        </>
      }
    >
      {a && (
        <Facts
          rows={[
            ['Graphics adapter', [a.vendor, a.architecture, a.device, a.description].filter(Boolean).join(' · ') || 'Not reported by the browser'],
            ['Software (fallback) adapter', yesNo(a.isFallbackAdapter), a.isFallbackAdapter ? 'warn' : undefined],
            ['GPU timing (timestamp-query)', a.features['timestamp-query'] ? 'Available: per-step GPU times' : 'Not available: wall-clock times only', a.features['timestamp-query'] ? 'pass' : 'warn'],
            ['Half-float shaders (shader-f16)', yesNo(a.features['shader-f16'])],
            ['Largest texture / buffer', `${a.limits.maxTextureDimension2D} px / ${fmtBytes(a.limits.maxBufferSize)} (storage binding ${fmtBytes(a.limits.maxStorageBufferBindingSize)})`],
            ['Screen pixel ratio', String(window.devicePixelRatio || 1)],
            ['Canvas present mode', present ? `${present.mode} (${present.reason})` : '…'],
          ]}
        />
      )}
      {typeof adapter === 'string' && <p className="error">{adapter}</p>}

      <div className="row bench-controls">
        <button className="button primary" disabled={!!running || !a} onClick={() => void run('quick')}>Run Quick</button>
        <button className="button" disabled={!!running || !a} onClick={() => void run('full')}>Run Full</button>
        {running && <button className="button" onClick={() => abortRef.current?.abort()}>Cancel</button>}
        {photos && photos.length > 0 && (
          <label className="bench-photo">
            <span className="muted small">Also use a photo from my library (read locally; its name isn’t reported)</span>
            <select value={photoId ?? ''} disabled={!!running} onChange={(e) => setPhotoId(e.target.value ? Number(e.target.value) : null)} aria-label="Photo from my library">
              <option value="">No, test images only</option>
              {photos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {scale && <p className="warn small">Test images scaled to {scale} MP (?benchmp=): for testing only, not comparable.</p>}

      {(running || progress) && (
        <div className="bench-progress" role="status" aria-live="polite">
          <div className="progress"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
          <span className="small muted">{progress?.label}</span>
        </div>
      )}
      <div className="bench-stage" ref={stageRef} hidden={!running} />
      {error && <p className="error">{error}</p>}

      {rows.length > 0 && (
        <div className="bench-table-wrap">
          <table className="bench-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Image</th>
                <th>Median</th>
                <th>Min</th>
                <th>GPU median</th>
                <th>GPU min</th>
                <th>Peak memory</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.sub ? 'sub' : undefined} title={r.error ?? r.note}>
                  <td>{r.sub ? `↳ ${r.stage}` : r.stage}{r.note && !r.sub && /new engine/.test(r.note) ? ' (recovered)' : ''}</td>
                  <td>{r.image}</td>
                  <td>{r.error ? <span className="error">failed</span> : fmtMs(r.wall?.median)}</td>
                  <td>{fmtMs(r.wall?.min)}</td>
                  <td>{fmtMs(r.gpu?.median)}</td>
                  <td>{fmtMs(r.gpu?.min)}</td>
                  <td>{fmtBytes(r.peakBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report && (
        <>
          <p className="small muted">
            {report.cancelled ? 'Cancelled: partial results. ' : ''}
            Median and minimum of {report.runs} runs after {report.warmup} warm-up{report.warmup > 1 ? 's' : ''}. Wall = until the
            GPU finished (performance.now() and onSubmittedWorkDone()); GPU = {report.timing.gpu === 'timestamp-query' ? `timestamp queries per pass${report.timing.quantized ? ', rounded to 0.1 ms by the browser' : ''}` : 'not available here (no timestamp-query)'}. Hover a row for what it includes.
          </p>
          <div className="row">
            <button className="button primary" onClick={() => void copy('markdown')}>{copied === 'markdown' ? 'Copied!' : 'Copy results (Markdown)'}</button>
            <button className="button" onClick={() => void copy('json')}>{copied === 'json' ? 'Copied!' : 'Copy results (JSON)'}</button>
            {copied === 'failed' && <span className="error small">The browser didn’t allow copying; select the text below instead.</span>}
          </div>
          <details className="bench-md">
            <summary>Show the results as text</summary>
            <pre className="report">{markdown}</pre>
          </details>
        </>
      )}
    </Card>
  )
}
