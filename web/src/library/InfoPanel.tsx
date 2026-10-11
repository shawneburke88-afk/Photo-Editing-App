import type { ColorLabel, Flag, PhotoDetail } from '../catalog/types'
import { bytes } from '../syscheck/format'
import { captureText, COLOR_NAMES, exposureText } from './format'
import { Stars } from './Stars'

interface Props {
  photo: PhotoDetail | null
  count: number
  onRating: (v: number) => void
  onFlag: (v: Flag) => void
  onColor: (v: ColorLabel) => void
  onDevelop: () => void
  /** Extra sections below the rating controls (keywords). */
  children?: React.ReactNode
}

export function InfoPanel({ photo, count, onRating, onFlag, onColor, onDevelop, children }: Props) {
  if (!photo) return <aside className="info"><p className="muted small pad">Select a photo to see its details.</p></aside>
  const rows: [string, string][] = [
    ['File', photo.fileName],
    ['Folder', photo.folderPath || '(top level)'],
    ['Captured', captureText(photo.capturedAt)],
    ['Camera', [photo.cameraMake, photo.cameraModel].filter(Boolean).join(' ') || 'Unknown'],
    ['Lens', photo.lens || 'Not recorded'],
    ['Exposure', exposureText(photo)],
    ['Size', photo.width ? `${photo.width} × ${photo.height}  ·  ${bytes(photo.fileSize)}` : bytes(photo.fileSize)],
  ]
  if (photo.originalName !== photo.fileName) rows.splice(1, 0, ['Original name', photo.originalName])
  return (
    <aside className="info">
      {count > 1 && <p className="info-multi">{count} photos selected — changes apply to all of them</p>}
      <div className="info-actions">
        {!/^jpe?g$/i.test(photo.fileType) && (
          <button className="button primary" onClick={onDevelop} title="Develop (D)">Edit in Develop</button>
        )}
        <Stars value={photo.rating} onChange={onRating} />
        <div className="flag-buttons" role="group" aria-label="Flag">
          <button className={photo.flag === 1 ? 'on pick' : ''} onClick={() => onFlag(photo.flag === 1 ? 0 : 1)} title="Pick (P)">⚑ Pick</button>
          <button className={photo.flag === -1 ? 'on reject' : ''} onClick={() => onFlag(photo.flag === -1 ? 0 : -1)} title="Reject (X)">✕ Reject</button>
        </div>
        <div className="label-buttons" role="group" aria-label="Color label">
          {[1, 2, 3, 4, 5].map((c) => (
            <button
              key={c}
              className={`label label-${c} ${photo.color === c ? 'on' : ''}`}
              title={`${COLOR_NAMES[c]}${c <= 4 ? ` (${c + 5})` : ''}`}
              aria-label={COLOR_NAMES[c]}
              aria-pressed={photo.color === c}
              onClick={() => onColor((photo.color === c ? 0 : c) as ColorLabel)}
            />
          ))}
        </div>
      </div>
      {children}
      <dl className="info-list">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </aside>
  )
}
