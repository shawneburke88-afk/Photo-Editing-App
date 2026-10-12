import { useSyncExternalStore } from 'react'
import { storageProblems } from '../catalog/storage'
import { sidecars } from './sync'

/** Asks for permission to write .xmp sidecars, and reports sidecar and library storage problems. */
export function SidecarBanner() {
  const status = useSyncExternalStore(
    (fn) => sidecars.subscribe(fn),
    () => sidecars.status,
  )
  const storage = useSyncExternalStore(storageProblems.subscribe, storageProblems.get)
  if (!status.needsPermission.length && !status.lastError && !storage.notPersistent && !storage.catalogError) return null
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
          <span>
            Sidecar not saved: {status.lastError}
            {status.failed > 1 && ` (and ${status.failed - 1} more)`}
          </span>
          <button className="button small" onClick={() => sidecars.clearError()}>OK</button>
        </div>
      )}
      {storage.catalogError && (
        <div className="banner warn-banner">
          <span>
            LightBench couldn’t save {storage.catalogError.count > 1 ? `${storage.catalogError.count} changes` : 'a change'} to its
            library. The disk may be full: free up space, then reload the page. (Details: {storage.catalogError.message})
          </span>
          <button className="button small" onClick={() => storageProblems.hideCatalogError()}>OK</button>
        </div>
      )}
      {storage.notPersistent && (
        <div className="banner warn-banner">
          <span>
            This browser may clear LightBench’s library (ratings, keywords, edits, thumbnails) if the disk runs low on space.
            To keep it, install LightBench as an app (the install button in the address bar), or allow it to store data if
            the browser asks. Where you allow it, ratings and edits are also saved in .xmp files next to your photos.
          </span>
          <button className="button small" onClick={() => storageProblems.hidePersistNotice()}>OK</button>
        </div>
      )}
    </div>
  )
}
