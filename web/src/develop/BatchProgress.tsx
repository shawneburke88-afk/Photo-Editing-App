import { useState, useSyncExternalStore } from 'react'
import { batch } from './batch'

const subscribe = (fn: () => void) => batch.subscribe(fn)
const snapshot = () => batch.status

/** Progress of Paste / Sync in the corner of the window, with Stop, then a summary until dismissed. */
export function BatchProgress() {
  const { active, queued, lastResult, problems, runs } = useSyncExternalStore(subscribe, snapshot)
  const [dismissed, setDismissed] = useState(-1)
  if (!active) {
    if (!lastResult || dismissed === runs) return null
    return (
      <div className="batch-progress done" role="status">
        <p className="small">{lastResult}</p>
        {problems.length > 0 && (
          <details className="small">
            <summary>Show problems</summary>
            <ul>{problems.map((f, i) => <li key={i}>{f.name}: {f.error}</li>)}</ul>
          </details>
        )}
        <button className="button small" onClick={() => setDismissed(runs)}>OK</button>
      </div>
    )
  }
  return (
    <div className="batch-progress" role="status" aria-live="polite">
      <p className="small">
        {active.label}: {active.done + 1} of {active.total}
        {active.current && <span className="muted"> · {active.current}</span>}
        {queued > 0 && <span className="muted"> · {queued} more waiting</span>}
      </p>
      <div className="progress"><div className="progress-bar" style={{ width: `${Math.round((active.done / active.total) * 100)}%` }} /></div>
      <button className="button small" onClick={() => batch.stop()}>Stop</button>
    </div>
  )
}
