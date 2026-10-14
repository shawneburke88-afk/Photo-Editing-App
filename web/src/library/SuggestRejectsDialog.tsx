import { useEffect, useMemo, useState } from 'react'
import { suggestReasons, type SuggestOptions } from '../catalog/analysis'
import type { PhotoRow } from '../catalog/types'
import { keyText, useEscapeKey } from '../settings/shortcuts'
import { cullPrefs } from './cull-badges'

interface Props {
  /** Every photo in the view, stacks' hidden members included (an ungrouped query). Null while loading. */
  rows: PhotoRow[] | null
  /** Rejects these photos (one undoable step). */
  onApply: (ids: number[]) => void
  onClose: () => void
}

const REASONS: { key: keyof SuggestOptions; name: string; about: string }[] = [
  { key: 'softInGroup', name: 'Clearly softer than the best of its stack or look-alikes', about: 'The most reliable: the same scene, camera and settings, compared shot against shot.' },
  { key: 'shake', name: 'Camera shake or motion blur', about: 'Detail smeared in one direction across the frame.' },
  { key: 'soft', name: 'Possibly soft compared with the library', about: 'Less fine detail than usual for the camera and ISO. Weaker evidence: shallow depth of field, mist or a plain subject can look the same.' },
  { key: 'exposure', name: 'Badly exposed', about: 'Heavily clipped highlights, or almost black or white in the camera preview (a RAW may still hold more).' },
]

/**
 * Suggest rejects (docs/PHASE3.md Part 18): lists the photos the analysis would reject and why, with the reasons to use.
 * Nothing changes until Apply, which only adds reject flags (catalog and sidecar, as X does), in one step that Undo
 * reverses. Picked photos, already rejected ones and the best of each group are never suggested; files are never
 * deleted.
 */
export function SuggestRejectsDialog({ rows, onApply, onClose }: Props) {
  const [opts, setOpts] = useState<SuggestOptions>(() => cullPrefs.get().suggest)
  useEscapeKey(onClose)
  useEffect(() => cullPrefs.update((p) => ({ ...p, suggest: opts })), [opts])
  const list = useMemo(
    () => (rows ?? []).flatMap((r) => {
      const why = suggestReasons(r, opts)
      return why ? [{ row: r, why }] : []
    }),
    [rows, opts],
  )
  const analysed = (rows ?? []).filter((r) => r.cull).length
  const total = rows?.length ?? 0
  const undo = keyText('library.undoSuggested')
  return (
    <div className="dialog-backdrop">
      <div className="dialog collection-dialog suggest-dialog" role="dialog" aria-label="Suggest rejects">
        <h2>Suggest rejects</h2>
        <p className="muted small">
          Photos the analysis finds soft or shaken, among the {total.toLocaleString()} in this view ({analysed.toLocaleString()} analysed). Measured on each
          photo's camera preview, so check doubtful ones at 100 % (Z in culling zooms to the measured focus point). Picked photos, rejected ones and the
          best of each stack are never suggested.
        </p>
        <fieldset className="suggest-reasons">
          <legend className="small">Suggest photos that are</legend>
          {REASONS.map((r) => (
            <label key={r.key} className="check small" title={r.about}>
              <input type="checkbox" checked={opts[r.key]} onChange={(e) => setOpts({ ...opts, [r.key]: e.target.checked })} />
              {r.name}
            </label>
          ))}
        </fieldset>
        {rows === null ? (
          <p className="muted">Looking…</p>
        ) : list.length === 0 ? (
          <p>No suggested rejects{analysed < total ? ' among the photos analysed so far' : ''}.</p>
        ) : (
          <>
            <ol className="suggest-list" aria-label="Suggested rejects">
              {list.slice(0, 300).map(({ row, why }) => (
                <li key={row.id}>
                  {row.fileName}
                  {row.version > 0 && row.versionName ? ` (${row.versionName})` : ''}
                  <span className="muted">{why.join(' ')}</span>
                </li>
              ))}
              {list.length > 300 && <li className="muted">…and {list.length - 300} more</li>}
            </ol>
            <p className="small">
              Apply rejects {list.length.toLocaleString()} of {total.toLocaleString()} photos: it sets their reject flag (as X does, also in their .xmp
              files). Files are never deleted{undo ? `, and ${undo} or Undo puts the flags back` : ', and Undo puts the flags back'}.
            </p>
          </>
        )}
        <div className="dialog-actions">
          <button className="button" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={!list.length} onClick={() => onApply(list.map((x) => x.row.id))}>
            {list.length ? `Apply: reject ${list.length.toLocaleString()}` : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}
