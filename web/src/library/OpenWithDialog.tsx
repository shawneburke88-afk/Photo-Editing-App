import { useState } from 'react'
import { supportsFolderAccess } from '../platform/folders'

interface Props {
  files: FileSystemFileHandle[]
  /** Asks for the folder and opens it; resolves to an error to show, or '' when done or cancelled. */
  onOpenFolder: () => Promise<string>
  onClose: () => void
}

/**
 * Shown when photos are opened with the installed app from the computer's file manager. The library works
 * on folders (one library model, docs/USABILITY.md), so it asks for the photo's folder and opens it like
 * Open folder, then shows the photo.
 */
export function OpenWithDialog({ files, onOpenFolder, onClose }: Props) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const names = files.length === 1 ? `“${files[0].name}”` : `“${files[0].name}” and ${files.length - 1} more`
  return (
    <div className="dialog-backdrop open-with" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog open-with" role="dialog" aria-label="Open with LightBench">
        <h2>Open {names}</h2>
        {supportsFolderAccess() ? (
          <p className="muted small">
            LightBench opens whole folders. Choose the folder that contains {files.length === 1 ? 'this photo' : 'these photos'}: it is
            added to the library where it is (nothing is copied), and the photo is shown once it has been read.
          </p>
        ) : (
          <p className="muted small">This browser can’t open folders, so LightBench can’t add this photo. Use Chrome or Edge.</p>
        )}
        {error && <p className="error small">{error}</p>}
        <div className="dialog-actions">
          <button className="button" onClick={onClose}>Cancel</button>
          {supportsFolderAccess() && (
            <button
              className="button primary"
              autoFocus
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setError(await onOpenFolder())
                setBusy(false)
              }}
            >
              Open its folder…
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
