// Asking before People's models are downloaded (docs/PHASE3.md Part 28; owner's decisions 2026-10-21): one dialog for
// the models this device still needs, each with its size, where it comes from, its licence and, in plain words, what
// it was trained on. Nothing is downloaded until Download is clicked; then each model is installed in turn (from
// LightBench's own site, or from Hugging Face with the resumable download of Part 26).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useEscapeKey } from '../settings/shortcuts'
import { deliveryOf, filesBytes, formatBytes, type ModelEntry, type ModelFile } from './manifest'
import { ModelInfo } from './ModelDialog'
import { AI, modelsChanged } from './models'
import { install, installHf, installSize, IntegrityError, partialDownload, SpaceError } from './store'

interface Props {
  items: { model: ModelEntry; files: ModelFile[] }[]
  /** People runs on the processor here (said in the purpose line). */
  slow: boolean
  onDone: (ok: boolean) => void
}

/** What each People model does, in the dialog's list. */
const ROLE: Record<string, string> = { detect: 'finds the people and outlines each one', face: 'finds their faces', parse: 'tells hair, face skin, body skin and clothes apart' }

export function PeopleDialog({ items, slow, onDone }: Props) {
  const [runtime, setRuntime] = useState(0)
  const [resumed, setResumed] = useState(0)
  const [progress, setProgress] = useState<{ done: number; total: number; name: string; waiting?: number; reason?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const ok = useRef<HTMLButtonElement>(null)
  const modelBytes = useMemo(() => items.reduce((n, x) => n + filesBytes(x.files), 0), [items])
  const total = modelBytes + runtime
  useEffect(() => {
    if (!AI || !items.length) return
    let live = true
    void (async () => {
      const s = await installSize(AI, items[0].model, items[0].files)
      let part = 0
      for (const x of items) if (deliveryOf(x.model) === 'huggingface') part += (await partialDownload(x.model, x.files)).done
      if (live) {
        setRuntime(s.items.find((i) => i.what === 'runtime')?.bytes ?? 0)
        setResumed(part)
      }
    })()
    return () => {
      live = false
    }
  }, [items])
  useEffect(() => ok.current?.focus(), [])
  useEscapeKey(() => {
    abort.current?.abort()
    onDone(false)
  }, true)

  const start = async () => {
    if (!AI) return
    setError(null)
    abort.current = new AbortController()
    const signal = abort.current.signal
    let before = 0
    try {
      for (const x of items) {
        const name = x.model.name
        const hub = deliveryOf(x.model) === 'huggingface'
        setProgress({ done: before, total, name })
        // The runtime comes with the first model when it isn't on this device yet; each install reports its own total.
        if (hub)
          await installHf(AI, x.model, x.files, (p) => setProgress({ done: before + p.done, total, name, waiting: p.waiting, reason: p.reason }), signal)
        else await install(AI, x.model, x.files, (p) => setProgress({ done: before + p.done, total, name }), signal)
        before += filesBytes(x.files) + (before === 0 ? runtime : 0)
        modelsChanged()
      }
      onDone(true)
    } catch (e) {
      setProgress(null)
      modelsChanged()
      if ((e as Error).name === 'AbortError') return
      if (e instanceof SpaceError) setError(e.message)
      else if (e instanceof IntegrityError) setError(`${e.message} Try again later; if it keeps happening, the published copy may be damaged.`)
      else setError(`The download didn’t finish: ${(e as Error).message}`)
    }
  }

  const pct = progress ? Math.min(100, Math.floor((100 * progress.done) / Math.max(1, progress.total))) : 0
  const big = (n: number) => (n >= 1e9 ? `about ${formatBytes(n)}` : formatBytes(n))
  return (
    <div className="dialog-backdrop">
      <div className="dialog model-dialog" role="dialog" aria-label="Download the People models?">
        <h2>Download the People models?</h2>
        <p>
          People{slow ? ' (on this computer it runs on the processor, without a suitable graphics card: it takes a little longer)' : ''} needs
          {items.length === 1 ? ' this AI model' : ` these ${items.length} AI models`}. They are downloaded <strong>once</strong>, only if you
          agree, and each file is checked against its SHA-256. They then stay on this device (works offline); you can remove them any time in
          Settings → AI models. Your photos are never uploaded.
        </p>
        <p className="model-size">
          Download: <strong>{big(total)}</strong>
          {runtime ? ` (the models: ${big(modelBytes)}; the runtime they need, ${AI?.runtime.name} ${AI?.runtime.version}: ${formatBytes(runtime)}, from LightBench’s own site)` : ''}.
          {resumed > 0 && !progress && <> Already downloaded: {formatBytes(resumed)}; the download continues from there.</>}
        </p>
        <ul className="people-models">
          {items.map(({ model, files }) => {
            const hub = deliveryOf(model) === 'huggingface'
            return (
              <li key={model.id}>
                <p className="small">
                  <strong>{model.name}</strong> ({ROLE[model.task] ?? model.summary}): {formatBytes(filesBytes(files))}, from{' '}
                  {hub ? 'Hugging Face (huggingface.co), where it is published, at the exact version LightBench was tested with' : 'LightBench’s own site'}.
                </p>
                <p className="small">
                  <strong>Licence:</strong> <a href={model.licence.url} target="_blank" rel="noreferrer">{model.licence.id}</a>.{model.licence.notes ? ` ${model.licence.notes}` : ''}
                </p>
                <p className="small">
                  <strong>Training data, in plain words:</strong> {model.trainingData}
                </p>
                <details>
                  <summary className="small" title={`Licence, training data, credit and files of ${model.name}`}>About this model</summary>
                  <ModelInfo model={model} files={files} />
                </details>
              </li>
            )
          })}
        </ul>
        {progress && (
          <div className="model-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Download progress">
            <div style={{ width: `${pct}%` }} />
            <span className="small">
              {formatBytes(progress.done)} of {formatBytes(progress.total)} ({progress.name})
              {progress.waiting ? (progress.reason === 'rate-limit' ? ` · Hugging Face asked to wait: continuing in ${progress.waiting} s` : ` · the connection dropped: trying again in ${progress.waiting} s`) : ''}
            </span>
          </div>
        )}
        {error && <p className="masks-warn small" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button className="button" title={progress ? 'Stop the download (what was downloaded from Hugging Face is kept for next time)' : 'Close without downloading anything'} onClick={() => { abort.current?.abort(); onDone(false) }}>{progress ? 'Cancel' : 'Not now'}</button>
          <button ref={ok} className="button primary" disabled={!!progress || !items.length} title="Download the People models to this device" onClick={() => void start()}>
            {progress ? `Downloading… ${pct} %` : `${resumed ? 'Continue download' : 'Download'} ${big(total)}`}
          </button>
        </div>
      </div>
    </div>
  )
}
