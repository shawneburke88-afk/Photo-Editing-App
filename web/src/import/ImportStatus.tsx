// The running import (session.ts) and its background details (details.ts): the Import window's progress view, and a
// small note in the Library's left panel while the window is closed.

import { useState, useSyncExternalStore } from 'react'
import { importDetails } from './details'
import type { ImportProgress } from './run'
import { importSession } from './session'

const useSession = () => useSyncExternalStore((fn) => importSession.subscribe(fn), () => importSession.status)
const useDetails = () => useSyncExternalStore((fn) => importDetails.subscribe(fn), () => importDetails.status)

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** "Copying the RAW files first: 12 of 40" / "The RAW files are in the library. Copying their JPEGs: 3 of 40". */
function passText(p: ImportProgress): string {
  if (p.firstPass >= p.total) return `${p.done.toLocaleString('en-US')} of ${plural(p.total, 'photo', 'photos')}`
  if (p.done < p.firstPass) return `Copying the RAW files first: ${p.done.toLocaleString('en-US')} of ${p.firstPass.toLocaleString('en-US')}`
  return `The RAW files are in the library. Copying their JPEGs: ${(p.done - p.firstPass).toLocaleString('en-US')} of ${(p.total - p.firstPass).toLocaleString('en-US')}`
}

function DetailsNote() {
  const { active } = useDetails()
  if (!active) return null
  return (
    <p className="muted small" role="status">
      Finishing in the background (ratings, keywords and edits from sidecars, presets): {active.done.toLocaleString('en-US')} of {active.total.toLocaleString('en-US')}. You can close
      LightBench: the rest is done the next time it opens.
    </p>
  )
}

/** The Import window while an import runs, and its summary when it is done. */
export function ImportProgressView({ onClose }: { onClose: () => void }) {
  const { progress, running, stopping, error } = useSession()
  const finished = !running
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0
  const stopped = !!progress && finished && progress.done < progress.total
  return (
    <div className="dialog-backdrop">
      <div className="dialog import-progress" role="dialog" aria-label="Importing">
        <h2>{finished ? (stopped ? 'Import stopped' : 'Import finished') : 'Importing…'}</h2>
        <div className="progress"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
        {progress && (
          <p>
            {finished ? `${progress.done.toLocaleString('en-US')} of ${plural(progress.total, 'photo', 'photos')}` : passText(progress)}
            {progress.current && !finished && <span className="muted"> · {progress.current}</span>}
          </p>
        )}
        {!finished && progress && progress.firstPass < progress.total && progress.done < progress.firstPass && (
          <p className="muted small">The JPEGs shot alongside follow, each joining its RAW&rsquo;s stack.</p>
        )}
        {finished && progress && (
          <ul className="summary">
            <li>{progress.imported.toLocaleString('en-US')} imported</li>
            {progress.skipped > 0 && <li>{progress.skipped.toLocaleString('en-US')} were already in the library</li>}
            {progress.rawOnlySkipped > 0 && <li>{plural(progress.rawOnlySkipped, 'JPEG', 'JPEGs')} with a RAW twin left on the card (RAW only)</li>}
            {progress.failed.length > 0 && <li className="error">{progress.failed.length.toLocaleString('en-US')} failed</li>}
            {stopped && <li>{plural(progress.total - progress.done, 'photo', 'photos')} not copied (stopped)</li>}
          </ul>
        )}
        {finished && progress && !stopped && progress.failed.length === 0 && progress.done > 0 && (
          <p className="small">Every file was copied and checked against the card.</p>
        )}
        {progress && progress.failed.length > 0 && (
          <details>
            <summary>Show problems</summary>
            <ul className="small">
              {progress.failed.map((f) => <li key={f.name}>{f.name}: {f.error}</li>)}
            </ul>
          </details>
        )}
        {finished && progress?.summary && <p className="muted small import-timing" title="Time taken and where it went (details in Settings → Diagnostics)">{progress.summary}</p>}
        {finished && <DetailsNote />}
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          {finished ? (
            <button
              className="button primary"
              onClick={() => {
                importSession.dismiss()
                onClose()
              }}
            >
              Go to library
            </button>
          ) : (
            <>
              <button className="button" disabled={stopping} onClick={() => importSession.stop()}>
                {stopping ? 'Stopping…' : 'Stop after the photos being copied'}
              </button>
              <button className="button primary" onClick={onClose} title="Close this window; the import goes on, and the Library shows the photos as they are added">
                Continue in the background
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** The Library's left panel: the import going on behind a closed Import window, then its summary; and the details. */
export function ImportStatus({ onShow }: { onShow: () => void }) {
  const { progress, running, stopping, runs } = useSession()
  const details = useDetails()
  const [dismissed, setDismissed] = useState(-1)
  if (running && progress) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
    return (
      <div className="index-progress" role="status" aria-live="polite">
        <span className="small">Importing from card: {passText(progress)}</span>
        <div className="progress"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
        <button className="button small" onClick={onShow}>Show</button>
        <button className="button small" disabled={stopping} onClick={() => importSession.stop()}>{stopping ? 'Stopping…' : 'Stop'}</button>
      </div>
    )
  }
  if (details.active) {
    return (
      <div className="refresh-progress" role="status" aria-live="polite">
        <span className="small muted">
          Finishing imported photos (ratings, keywords and edits from sidecars, presets): {details.active.done.toLocaleString('en-US')} of {details.active.total.toLocaleString('en-US')}
        </span>
        <div className="progress"><div className="progress-bar" style={{ width: `${Math.round((details.active.done / Math.max(1, details.active.total)) * 100)}%` }} /></div>
      </div>
    )
  }
  if (!progress || dismissed === runs) return null
  const stopped = progress.done < progress.total
  return (
    <div className="index-progress done" role="status">
      <span className="small">
        {stopped ? 'Import stopped' : 'Import finished'}: {progress.imported.toLocaleString('en-US')} imported
        {progress.failed.length > 0 && `, ${progress.failed.length} failed`}
        {progress.rawOnlySkipped > 0 && `, ${plural(progress.rawOnlySkipped, 'JPEG', 'JPEGs')} left on the card (RAW only)`}
      </span>
      {progress.summary && <span className="muted small">{progress.summary}</span>}
      <button className="button small" onClick={onShow}>Show</button>
      <button className="button small" onClick={() => { setDismissed(runs); importSession.dismiss() }}>OK</button>
    </div>
  )
}
