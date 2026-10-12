import { useState } from 'react'
import { indexer, type IndexStatus } from './indexer'

/** Progress of Open folder in the left panel: what is being read, how far along, and a Stop button. */
export function IndexProgress({ status }: { status: IndexStatus }) {
  const { active, queued, failed, lastResult, runs } = status
  const [dismissed, setDismissed] = useState(-1)
  if (!active) {
    if (!lastResult || dismissed === runs) return null
    return (
      <div className="index-progress done" role="status">
        <span className="small">{lastResult}</span>
        {failed.length > 0 && (
          <details className="small">
            <summary>Show problems</summary>
            <ul>{failed.map((f) => <li key={f.name}>{f.name}: {f.error}</li>)}</ul>
          </details>
        )}
        <button className="button small" onClick={() => setDismissed(runs)}>OK</button>
      </div>
    )
  }
  const pct = active.total ? Math.round((active.done / active.total) * 100) : 0
  return (
    <div className="index-progress" role="status" aria-live="polite">
      <span className="small">
        {active.phase === 'scanning'
          ? `Looking for photos in “${active.name}”… ${active.found || ''}`
          : `Adding “${active.name}”: ${active.done} of ${active.total}`}
        {queued > 0 && <span className="muted"> · {queued} more {queued === 1 ? 'folder' : 'folders'} waiting</span>}
      </span>
      <div className="progress"><div className="progress-bar" style={{ width: `${active.phase === 'scanning' ? 0 : pct}%` }} /></div>
      <p className="muted small">You can start rating and flagging photos as they appear.</p>
      <button className="button small" onClick={() => indexer.stop()}>Stop</button>
    </div>
  )
}
