import { useState, useSyncExternalStore } from 'react'
import { extrasRefresh } from './refresh'

const subscribe = (fn: () => void) => extrasRefresh.subscribe(fn)
const snapshot = () => extrasRefresh.status

/** Follows the one-time refresh of older photos (library/refresh.ts). */
const useRefreshStatus = () => useSyncExternalStore(subscribe, snapshot)

/**
 * A small note in the left panel while older photos are read again (location, Adobe RGB thumbnails), with Pause.
 * Shows nothing when there is nothing to do, and a summary only when something changed.
 */
export function RefreshProgress() {
  const { active, paused, lastResult, runs } = useRefreshStatus()
  const [dismissed, setDismissed] = useState(-1)
  if (active) {
    return (
      <div className="refresh-progress" role="status" aria-live="polite">
        <span className="small muted">
          Updating older photos (location, thumbnail colours): {active.done} of {active.total}
        </span>
        <div className="progress"><div className="progress-bar" style={{ width: `${Math.round((active.done / active.total) * 100)}%` }} /></div>
        <button className="button small" onClick={() => extrasRefresh.pause()} title="Stops for now; the rest is done the next time LightBench opens, or with Resume">Pause</button>
      </div>
    )
  }
  if (paused && paused.left > 0) {
    return (
      <div className="refresh-progress" role="status">
        <span className="small muted">Updating older photos is paused: {paused.left} left.</span>
        <button className="button small" onClick={() => extrasRefresh.resume()}>Resume</button>
      </div>
    )
  }
  if (!lastResult || dismissed === runs) return null
  return (
    <div className="refresh-progress done" role="status">
      <span className="small muted">{lastResult}</span>
      <button className="button small" onClick={() => setDismissed(runs)}>OK</button>
    </div>
  )
}
