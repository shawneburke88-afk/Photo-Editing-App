import { useEffect, useState, useSyncExternalStore } from 'react'
import { storageProblems } from '../catalog/storage'
import { externalChanges } from './external'
import { sidecars } from './sync'
import { ignoreChanges, loadExternalChanges, readChanges, type Answer } from './watch'

/**
 * Asks for permission to write .xmp sidecars, asks what to do with sidecars changed by other apps, and reports
 * sidecar and library storage problems.
 */
export function SidecarBanner() {
  const status = useSyncExternalStore(
    (fn) => sidecars.subscribe(fn),
    () => sidecars.status,
  )
  const storage = useSyncExternalStore(storageProblems.subscribe, storageProblems.get)
  const changed = useSyncExternalStore(externalChanges.subscribe, externalChanges.get)
  const [answering, setAnswering] = useState(false)
  const [answered, setAnswered] = useState('')
  useEffect(() => void loadExternalChanges(), [])

  async function answer(read: boolean) {
    setAnswering(true)
    setAnswered('')
    try {
      const n = changed.length
      const r: Answer = await (read ? readChanges(changed) : ignoreChanges(changed))
      const what = r.done === n ? '' : `${r.done} of ${n}: `
      setAnswered(
        r.skipped
          ? `${what}${r.skipped} couldn’t be read now (folder not connected, or the file isn’t valid XMP). They are still listed.`
          : read
            ? `Read the other app’s changes into ${r.done === 1 ? '1 photo' : `${r.done} photos`}.`
            : 'Kept LightBench’s values. They will replace the other app’s in the .xmp files the next time LightBench saves these photos.',
      )
    } finally {
      setAnswering(false)
    }
  }

  if (!status.needsPermission.length && !status.lastError && !storage.notPersistent && !storage.catalogError && !changed.length && !answered) return null
  return (
    <div className="sidecar-banner" role="status">
      {changed.length > 0 && (
        <div className="banner">
          <span>
            {changed.length === 1 ? '1 photo was' : `${changed.length} photos were`} changed by another app (its .xmp file changed
            since LightBench last saved it). <strong>Read changes</strong> takes that app’s stars, labels, keywords and metadata, and Lightroom’s crop and Transform.{' '}
            <strong>Ignore</strong> keeps LightBench’s, which then replace the other app’s in the files the next time LightBench saves them.
          </span>
          <button className="button small primary" disabled={answering} onClick={() => void answer(true)}>Read changes</button>
          <button className="button small" disabled={answering} onClick={() => void answer(false)}>Ignore</button>
          <button className="button small" onClick={() => externalChanges.show(changed)}>Show photos</button>
        </div>
      )}
      {answered && (
        <div className="banner">
          <span>{answered}</span>
          <button className="button small" onClick={() => setAnswered('')}>OK</button>
        </div>
      )}
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
