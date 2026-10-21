// Asking before an AI model is downloaded (owner's decisions 2026-10-17 and 2026-10-21; docs/PHASE3.md Parts 24 and 26):
// its size, its licence and, in plain words, what it was trained on. Nothing is downloaded until Download is clicked.
// Also the model's info panel (here and in Settings → AI models).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useEscapeKey } from '../settings/shortcuts'
import { deliveryOf, filesBytes, formatBytes, type ModelEntry, type ModelFile } from './manifest'
import { AI, modelsChanged } from './models'
import { install, installHf, installSize, IntegrityError, partialDownload, SpaceError, type HfProgress, type InstalledModel } from './store'

const PART_NAMES: Record<string, string> = { vae_encoder: 'image encoder', unet: 'denoiser', vae_decoder: 'image decoder' }

/** "about 1.24 GB" for a big download (its exact size is in About this model). */
const about = (n: number) => (n >= 1e9 ? `about ${formatBytes(n)}` : formatBytes(n))

export function ModelInfo({ model, file, files }: { model: ModelEntry; file?: ModelFile | null; files?: ModelFile[] }) {
  const rt = AI?.runtime
  const chosen = new Set((files ?? (file ? [file] : [])).map((f) => f.path))
  const hub = deliveryOf(model) === 'huggingface'
  return (
    <dl className="model-info small">
      <dt>What it does</dt>
      <dd>{model.summary} It runs on this computer: your photos never leave it.</dd>
      <dt>Licence</dt>
      <dd>
        <a href={model.licence.url} target="_blank" rel="noreferrer">{model.licence.id}</a>. {model.licence.statement}
        {model.licence.notes && <> {model.licence.notes}</>}
      </dd>
      <dt>Training data</dt>
      <dd>{model.trainingData}</dd>
      <dt>Credit</dt>
      <dd>{model.credit}</dd>
      {model.checkpoint && (
        <>
          <dt>Version</dt>
          <dd>The {model.checkpoint.name} weights (as named in the conversion’s {model.checkpoint.source.startsWith('export script') ? 'export script; the model card doesn’t say' : 'model card'}).</dd>
        </>
      )}
      {rt && (
        <>
          <dt>Runtime</dt>
          <dd>{rt.name} {rt.version} ({rt.licence}, © Microsoft Corporation), shared by LightBench’s AI models.</dd>
        </>
      )}
      <dt>Files</dt>
      <dd>
        {model.files.map((f) => (
          <span key={`${f.variant}${f.part ?? ''}`} className={`model-file ${chosen.has(f.path) && !f.part ? 'chosen' : ''}`}>
            {f.part ? `${PART_NAMES[f.part] ?? f.part} (${f.path})` : f.variant}: {formatBytes(f.bytes)}{f.sha256 ? <>, SHA-256 <code title={f.sha256}>{f.sha256.slice(0, 16)}…</code></> : ' (not published with this build)'}
            {chosen.has(f.path) && !f.part ? ' — the one for this GPU' : ''}
          </span>
        ))}
        <span className="muted">
          From {model.source.repo}{model.source.revision ? ` at ${model.source.revision.slice(0, 7)}` : ''}, {hub ? 'downloaded from Hugging Face (huggingface.co) at that exact version' : 'served by LightBench’s own site'}.
        </span>
      </dd>
    </dl>
  )
}

interface Props {
  model: ModelEntry
  /** The file this device gets (one-file models). */
  file?: ModelFile
  /** All the files this device gets (a model of several graphs). */
  files?: ModelFile[]
  /** Why it is asked ("The Depth range mask", "AI Remove"). */
  purpose: string
  onInstalled: (rec: InstalledModel) => void
  onClose: () => void
}

export function ModelDialog({ model, file, files: filesIn, purpose, onInstalled, onClose }: Props) {
  const files = useMemo(() => filesIn ?? (file ? [file] : []), [filesIn, file])
  const hub = deliveryOf(model) === 'huggingface'
  const modelBytes = filesBytes(files)
  const [size, setSize] = useState<{ bytes: number; runtime: number; done: number } | null>(null)
  const [progress, setProgress] = useState<HfProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!AI || !files.length) return
    let live = true
    void (async () => {
      const s = await installSize(AI, model, files[0])
      const runtime = s.items.find((i) => i.what === 'runtime')?.bytes ?? 0
      const part = hub ? await partialDownload(model, files) : { done: 0 }
      if (live) setSize({ bytes: modelBytes + runtime, runtime, done: part.done })
    })()
    return () => {
      live = false
    }
  }, [model, files, hub, modelBytes])
  useEffect(() => ok.current?.focus(), [])
  useEscapeKey(() => {
    abort.current?.abort()
    onClose()
  }, true)

  const start = async () => {
    if (!AI || !files.length) return
    setError(null)
    abort.current = new AbortController()
    setProgress({ done: size?.done ?? 0, total: size?.bytes ?? modelBytes, what: 'model' })
    try {
      const rec = hub
        ? await installHf(AI, model, files, (p) => setProgress({ ...p }), abort.current.signal)
        : await install(AI, model, files[0], (p) => setProgress({ done: p.done, total: p.total, what: p.what }), abort.current.signal)
      modelsChanged()
      onInstalled(rec)
    } catch (e) {
      setProgress(null)
      modelsChanged()
      if ((e as Error).name === 'AbortError') return
      if (e instanceof SpaceError) setError(e.message)
      else if (e instanceof IntegrityError) setError(`${e.message} Try again later; if it keeps happening, the copy ${hub ? 'on Hugging Face' : 'on this site'} may be damaged.`)
      else setError(`The download didn’t finish: ${(e as Error).message}`)
      if (hub) void partialDownload(model, files).then((p) => setSize((s) => (s ? { ...s, done: p.done } : s)))
    }
  }

  const pct = progress ? Math.floor((100 * progress.done) / Math.max(1, progress.total)) : 0
  const total = size?.bytes ?? modelBytes
  const resuming = !!size?.done && !progress
  return (
    <div className="dialog-backdrop">
      <div className="dialog model-dialog" role="dialog" aria-label={`Download ${model.name}?`}>
        <h2>Download {model.name}?</h2>
        {hub ? (
          <p>
            {purpose} needs this AI model. It is downloaded <strong>once</strong>, only if you agree, straight from Hugging Face
            (huggingface.co), where it is published, at the exact version LightBench was tested with, and each file is checked
            against its SHA-256. It then stays on this device (works offline); you can remove it any time in Settings → AI models.
            Your photos are never uploaded.
          </p>
        ) : (
          <p>
            {purpose} needs this AI model. It is downloaded <strong>once</strong>, from LightBench’s own site, only if you agree, and
            checked against its SHA-256. It then stays on this device (works offline); you can remove it any time in Settings → AI models.
          </p>
        )}
        <p className="model-size">
          Download: <strong>{about(total)}</strong>
          {size?.runtime
            ? ` (the model${files.length > 1 ? `, ${files.length} files` : `, ${files[0]?.variant}`}: ${about(modelBytes)}; the runtime it needs, ${AI?.runtime.name} ${AI?.runtime.version}: ${formatBytes(size.runtime)}${hub ? ', from LightBench’s own site' : ''})`
            : files.length > 1 ? ` (${files.length} files)` : ` (${files[0]?.variant})`}.
          {resuming && <> Already downloaded: {formatBytes(size!.done)}; the download continues from there.</>}
        </p>
        {hub && (
          <p className="small muted">
            It is a large download: over a slow connection it can take a long while. If it stops (or you cancel), what was
            downloaded is kept and Download continues where it stopped.
          </p>
        )}
        <p className="small">
          <strong>Licence:</strong> <a href={model.licence.url} target="_blank" rel="noreferrer">{model.licence.id}</a>.
          {model.licence.notes ? ` ${model.licence.notes}` : ''}
        </p>
        <p className="small">
          <strong>Training data, in plain words:</strong> {model.trainingData}
        </p>
        <details>
          <summary className="small">About this model</summary>
          <ModelInfo model={model} files={files} />
        </details>
        {progress && (
          <div className="model-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Download progress">
            <div style={{ width: `${pct}%` }} />
            <span className="small">
              {formatBytes(progress.done)} of {formatBytes(progress.total)}
              {progress.what === 'runtime' ? ' (the runtime)' : progress.file && files.length > 1 ? ` (${progress.file})` : ''}
              {progress.waiting ? (progress.reason === 'rate-limit' ? ` · Hugging Face asked to wait: continuing in ${progress.waiting} s` : ` · the connection dropped: trying again in ${progress.waiting} s`) : ''}
            </span>
          </div>
        )}
        {error && <p className="masks-warn small" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button className="button" title={progress ? (hub ? 'Stop the download (what was downloaded is kept for next time)' : 'Stop the download') : 'Close without downloading anything'} onClick={() => { abort.current?.abort(); onClose() }}>{progress ? 'Cancel' : 'Not now'}</button>
          <button ref={ok} className="button primary" disabled={!!progress || !files.length} title={`Download ${model.name} to this device`} onClick={() => void start()}>
            {progress ? `Downloading… ${pct} %` : `${resuming ? 'Continue download' : 'Download'} ${about(total)}`}
          </button>
        </div>
      </div>
    </div>
  )
}
