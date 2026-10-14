import { useState, useSyncExternalStore } from 'react'
import { analysisPass } from './analysis-pass'

const subscribe = (fn: () => void) => analysisPass.subscribe(fn)
const snapshot = () => analysisPass.status

/** Follows the background culling analysis of photos already in the library (analysis-pass.ts). */
const useAnalysisStatus = () => useSyncExternalStore(subscribe, snapshot)

/**
 * A quiet note in the left panel while older photos are measured for the culling helpers, with Pause. Shows nothing
 * when there is nothing to do.
 */
export function AnalysisProgress() {
  const { active, paused, lastResult, runs } = useAnalysisStatus()
  const [dismissed, setDismissed] = useState(-1)
  if (active) {
    return (
      <div className="refresh-progress analysis-progress" role="status" aria-live="polite">
        <span className="small muted" title="Sharpness, motion blur, exposure and look-alikes, measured on each photo's camera preview. Nothing about the photos changes.">
          Analysing photos for culling: {active.done} of {active.total}
        </span>
        <div className="progress"><div className="progress-bar" style={{ width: `${Math.round((active.done / Math.max(1, active.total)) * 100)}%` }} /></div>
        <button className="button small" onClick={() => analysisPass.pause()} title="Stops for now; the rest is done the next time LightBench opens, or with Resume">Pause</button>
      </div>
    )
  }
  if (paused && paused.left > 0) {
    return (
      <div className="refresh-progress analysis-progress" role="status">
        <span className="small muted">Culling analysis is paused: {paused.left} left.</span>
        <button className="button small" onClick={() => analysisPass.resume()}>Resume</button>
      </div>
    )
  }
  if (!lastResult || dismissed === runs) return null
  return (
    <div className="refresh-progress analysis-progress done" role="status">
      <span className="small muted">{lastResult}</span>
      <button className="button small" onClick={() => setDismissed(runs)}>OK</button>
    </div>
  )
}
