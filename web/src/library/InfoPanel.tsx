import type { ColorLabel, Flag, PhotoDetail } from '../catalog/types'
import { formatGps } from '../engine/meta/gps'
import { bytes } from '../syscheck/format'
import { captureText, COLOR_NAMES, exposureText } from './format'
import { Stars } from './Stars'
import { withKey } from '../settings/shortcuts'

interface Props {
  photo: PhotoDetail | null
  count: number
  onRating: (v: number) => void
  onFlag: (v: Flag) => void
  onColor: (v: ColorLabel) => void
  onDevelop: () => void
  /** Extra sections below the rating controls (keywords). */
  children?: React.ReactNode
  onVirtualCopy: () => void
  onRenameCopy: (name: string) => void
}

export function InfoPanel({ photo, count, onRating, onFlag, onColor, onDevelop, children, onVirtualCopy, onRenameCopy }: Props) {
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
  if (photo.gpsLat != null && photo.gpsLon != null) rows.push(['GPS', formatGps({ lat: photo.gpsLat, lon: photo.gpsLon, alt: photo.gpsAlt })])
  if (photo.originalName !== photo.fileName) rows.splice(1, 0, ['Original name', photo.originalName])
  return (
    <aside className="info">
      {count > 1 && <p className="info-multi">{count} photos selected — changes apply to all of them</p>}
      <div className="info-actions">
        {!/^jpe?g$/i.test(photo.fileType) && (
          <button className="button primary" onClick={onDevelop} title={withKey('Develop', 'photo.develop')}>Edit in Develop</button>
        )}
        <Stars value={photo.rating} onChange={onRating} />
        <div className="flag-buttons" role="group" aria-label="Flag">
          <button className={photo.flag === 1 ? 'on pick' : ''} onClick={() => onFlag(photo.flag === 1 ? 0 : 1)} title={withKey('Pick', 'photo.pick')}>⚑ Pick</button>
          <button className={photo.flag === -1 ? 'on reject' : ''} onClick={() => onFlag(photo.flag === -1 ? 0 : -1)} title={withKey('Reject', 'photo.reject')}>✕ Reject</button>
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
      <section className="keywords copies-section" aria-label="Virtual copy">
        <h3 className="panel-title">{photo.version > 0 ? 'Virtual copy' : 'Versions'}</h3>
        {photo.version > 0 && (
          <label className="field small">
            Name
            <input
              key={photo.id}
              type="text"
              defaultValue={photo.versionName ?? ''}
              onBlur={(e) => e.target.value.trim() && e.target.value !== photo.versionName && onRenameCopy(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>
        )}
        <button className="button small" onClick={onVirtualCopy} title={withKey("Another version of this photo with its own edits, rating and keywords; the file isn't copied", 'library.virtualCopy')}>
          Make virtual copy
        </button>
      </section>
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
