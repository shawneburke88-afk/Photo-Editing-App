// The zoom menu in Develop's toolbar (docs/PHASE3.md, "Zoom levels").
import { ZOOM_LEVELS, zoomLabel, type Zoom } from './zoom'

export function ZoomControl({ zoom, disabled, title, onChange }: { zoom: Zoom; disabled: boolean; title: string; onChange: (z: Zoom) => void }) {
  return (
    <select
      className="zoom-select"
      aria-label="Zoom"
      value={String(zoom)}
      disabled={disabled}
      title={title}
      onChange={(e) => {
        onChange(e.target.value === 'fit' ? 'fit' : Number(e.target.value))
        // The keys (Z, =, −, …) go back to the photo.
        e.currentTarget.blur()
      }}
    >
      <option value="fit">Fit</option>
      {ZOOM_LEVELS.map((l) => (
        <option key={l} value={String(l)}>
          {zoomLabel(l)}
        </option>
      ))}
    </select>
  )
}
