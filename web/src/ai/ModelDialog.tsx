// Asking before an AI model is downloaded (owner's decision 2026-10-17; docs/PHASE3.md Part 24): its size, its licence
// and, in plain words, what it was trained on. Nothing is downloaded until Download is clicked. Also the model's info
// panel (here and in Settings → AI models).

import { useEffect, useRef, useState } from 'react'
import { useEscapeKey } from '../settings/shortcuts'
import { formatBytes, type ModelEntry, type ModelFile } from './manifest'
import { AI, modelsChanged } from './models'
import { install, installSize, IntegrityError, type InstalledModel } from './store'

export function ModelInfo({ model, file }: { model: ModelEntry; file?: ModelFile | null }) {
  const rt = AI?.runtime
  return (
    <dl className="model-info small">
      <dt>What it does</dt>
      <dd>{model.summary} It runs on this computer: your photos never leave it.</dd>
      <dt>Licence</dt>
      <dd>
        <a href={model.licence.url} target="_blank" rel="noreferrer">{model.licence.id}</a>. {model.licence.statement}
      </dd>
      <dt>Training data</dt>
      <dd>{model.trainingData}</dd>
      <dt>Credit</dt>
      <dd>{model.credit}</dd>
      {rt && (
        <>
          <dt>Runtime</dt>
          <dd>{rt.name} {rt.version} ({rt.licence}, © Microsoft Corporation), shared by LightBench’s AI models.</dd>
        </>
      )}
      <dt>Files</dt>
      <dd>
        {model.files.map((f) => (
          <span key={f.variant} className={`model-file ${file?.variant === f.variant ? 'chosen' : ''}`}>
            {f.variant}: {formatBytes(f.bytes)}{f.sha256 ? <>, SHA-256 <code title={f.sha256}>{f.sha256.slice(0, 16)}…</code></> : ' (not published with this build)'}
            {file?.variant === f.variant ? ' — the one for this GPU' : ''}
          </span>
        ))}
        <span className="muted">From {model.source.repo}{model.source.revision ? ` at ${model.source.revision.slice(0, 7)}` : ''}, served by LightBench’s own site.</span>
      </dd>
    </dl>
  )
}

interface Props {
  model: ModelEntry
  file: ModelFile
  /** Why it is asked ("for the Depth range mask"). */
  purpose: string
  onInstalled: (rec: InstalledModel) => void
  onClose: () => void
}

export function ModelDialog({ model, file, purpose, onInstalled, onClose }: Props) {
  const [size, setSize] = useState<{ bytes: number; runtime: number } | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!AI) return
    void installSize(AI, model, file).then((s) => setSize({ bytes: s.bytes, runtime: s.items.find((i) => i.what === 'runtime')?.bytes ?? 0 }))
  }, [model, file])
  useEffect(() => ok.current?.focus(), [])
  useEscapeKey(() => {
    abort.current?.abort()
    onClose()
  }, true)

  const start = async () => {
    if (!AI) return
    setError(null)
    abort.current = new AbortController()
    setProgress({ done: 0, total: size?.bytes ?? file.bytes })
    try {
      const rec = await install(AI, model, file, (p) => setProgress({ done: p.done, total: p.total }), abort.current.signal)
      modelsChanged()
      onInstalled(rec)
    } catch (e) {
      setProgress(null)
      if ((e as Error).name === 'AbortError') return
      setError(e instanceof IntegrityError ? `${e.message} Try again later; if it keeps happening, the copy on this site may be damaged.` : `The download didn’t finish: ${(e as Error).message}`)
    }
  }

  const pct = progress ? Math.floor((100 * progress.done) / Math.max(1, progress.total)) : 0
  return (
    <div className="dialog-backdrop">
      <div className="dialog model-dialog" role="dialog" aria-label={`Download ${model.name}?`}>
        <h2>Download {model.name}?</h2>
        <p>
          {purpose} needs this AI model. It is downloaded <strong>once</strong>, from LightBench’s own site, only if you agree, and
          checked against its SHA-256. It then stays on this device (works offline); you can remove it any time in Settings → AI models.
        </p>
        <p className="model-size">
          Download: <strong>{size ? formatBytes(size.bytes) : formatBytes(file.bytes)}</strong>
          {size?.runtime ? ` (the model, ${file.variant}: ${formatBytes(file.bytes)}; the runtime it needs, ${AI?.runtime.name} ${AI?.runtime.version}: ${formatBytes(size.runtime)})` : ` (${file.variant})`}.
        </p>
        <p className="small">
          <strong>Training data, in plain words:</strong> {model.trainingData}
        </p>
        <details>
          <summary className="small">About this model</summary>
          <ModelInfo model={model} file={file} />
        </details>
        {progress && (
          <div className="model-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Download progress">
            <div style={{ width: `${pct}%` }} />
            <span className="small">{formatBytes(progress.done)} of {formatBytes(progress.total)}</span>
          </div>
        )}
        {error && <p className="masks-warn small" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button className="button" onClick={() => { abort.current?.abort(); onClose() }}>{progress ? 'Cancel' : 'Not now'}</button>
          <button ref={ok} className="button primary" disabled={!!progress} onClick={() => void start()}>
            {progress ? `Downloading… ${pct} %` : `Download ${size ? formatBytes(size.bytes) : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
