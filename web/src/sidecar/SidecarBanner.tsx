import { useSyncExternalStore } from 'react'
import { sidecars } from './sync'

/** Asks for permission to write .xmp sidecars, and reports sidecar problems. */
export function SidecarBanner() {
  const status = useSyncExternalStore(
    (fn) => sidecars.subscribe(fn),
    () => sidecars.status,
  )
  if (!status.needsPermission.length && !status.lastError) return null
  return (
    <div className="sidecar-banner" role="status">
      {status.needsPermission.map((r) => (
        <div key={r.rootId} className="banner">
          <span>
            LightBench saves ratings, labels and edits in <strong>.xmp</strong> files next to your photos, so other apps
            (Lightroom, Bridge, darktable) can read them and nothing is lost if browser storage is cleared. Allow it to write
            in “{r.name}”?
          </span>
          <button className="button small primary" onClick={() => void sidecars.allow(r.rootId)}>Allow</button>
          <button className="button small" onClick={() => sidecars.dismiss(r.rootId)}>Not now</button>
        </div>
      ))}
      {status.lastError && (
        <div className="banner warn-banner">
          <span>Sidecar not saved: {status.lastError}</span>
          <button className="button small" onClick={() => sidecars.clearError()}>OK</button>
        </div>
      )}
    </div>
  )
}
