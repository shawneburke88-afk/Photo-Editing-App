// The Crop group of the tool stack: crop (aspect, lock, swap, overlay), straighten (angle, level line), rotate
// 90° and flip. The same controls work while cropping (they change the crop being edited) and outside it
// (each change is a history step).

import { ASPECTS, lockedRatio, type AspectId, type GeometrySettings } from '../engine/develop/geometry'
import { withKey } from '../settings/shortcuts'
import { HELP } from './help'
import { Slider } from './Slider'

import { CROP_OVERLAYS, type CropOverlayKind } from './tools'

export type GeometryEdit =
  | { kind: 'angle'; angle: number }
  | { kind: 'aspect'; aspect: AspectId; custom?: [number, number] }
  | { kind: 'lock'; locked: boolean }
  | { kind: 'swap' }
  | { kind: 'rotate'; dir: 1 | -1 }
  | { kind: 'flip'; axis: 'h' | 'v' }
  | { kind: 'reset' }

interface Props {
  geometry: GeometrySettings
  /** Straightened frame (the oriented, turned photo) in pixels; null until the photo is loaded. */
  frame: [number, number] | null
  /** The crop in whole pixels, as rendered and exported. */
  cropSize: [number, number] | null
  cropping: boolean
  leveling: boolean
  overlay: CropOverlayKind
  disabled: boolean
  showHint: boolean
  onToggleCrop: () => void
  onApply: () => void
  onCancel: () => void
  onLevel: () => void
  /** Auto straighten: levels the photo along the lines found (Upright's detector). */
  onAutoStraighten: () => void
  /** Auto straighten is looking for lines, and what it said last (a refusal), if anything. */
  straightening: boolean
  straightenMessage: string | null
  onOverlay: (o: CropOverlayKind) => void
  onEdit: (e: GeometryEdit) => void
}

const ICON = {
  lock: (locked: boolean) => (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="8" rx="1.5" fill="currentColor" />
      <path fill="none" stroke="currentColor" strokeWidth="1.6" d={locked ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 5.8-1'} />
    </svg>
  ),
  swap: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="4.5" width="8" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="4.5" y="1.5" width="10" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.5" />
    </svg>
  ),
  rotL: (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.5" d="M3.5 7.5A5 5 0 1 1 8 13" />
      <path fill="currentColor" d="M0.8 5.2h5.4L3.5 9z" />
    </svg>
  ),
  rotR: (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.5" d="M12.5 7.5A5 5 0 1 0 8 13" />
      <path fill="currentColor" d="M15.2 5.2H9.8L12.5 9z" />
    </svg>
  ),
  flipH: (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M7 2v12L1 14z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" d="M9 2v12h6z" />
    </svg>
  ),
  flipV: (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M2 7h12L14 1z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" d="M2 9h12v6z" />
    </svg>
  ),
  level: (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path stroke="currentColor" strokeWidth="1.6" d="M1 11 15 5" />
      <circle cx="1.8" cy="10.7" r="1.6" fill="currentColor" />
      <circle cx="14.2" cy="5.3" r="1.6" fill="currentColor" />
    </svg>
  ),
}

/** The user's turns and flips in words (stored as turns, then a left-right mirror). */
function orientationText(g: GeometrySettings): string {
  const turn = ['', 'Turned right', 'Turned 180°', 'Turned left'][g.turns]
  if (!g.mirror) return turn
  if (g.turns === 0) return 'Flipped horizontally'
  if (g.turns === 2) return 'Flipped vertically'
  return `${turn}, then flipped horizontally`
}

export function CropPanel({ geometry: g, frame, cropSize, cropping, leveling, overlay, disabled, showHint, onToggleCrop, onApply, onCancel, onLevel, onAutoStraighten, straightening, straightenMessage, onOverlay, onEdit }: Props) {
  const ratio = frame ? lockedRatio(g, frame[0], frame[1]) : null
  const portrait = cropSize ? cropSize[1] > cropSize[0] : false
  return (
    <div className="dpanel crop-panel">
      <section>
        <div className="crop-actions">
          {cropping ? (
            <>
              <button className="button small primary" onClick={onApply} disabled={disabled} title={withKey('Apply the crop', 'crop.apply')}>Done</button>
              <button className="button small" onClick={onCancel} disabled={disabled} title={withKey('Cancel the crop', 'crop.cancel')}>Cancel</button>
            </>
          ) : (
            <button className="button small" onClick={onToggleCrop} disabled={disabled} title={withKey('Crop and straighten on the photo', 'develop.crop')}>
              Crop…
            </button>
          )}
          <button className="button small" onClick={() => onEdit({ kind: 'reset' })} disabled={disabled} title="Reset crop, straighten, rotate and flip">
            Reset
          </button>
          {cropSize && <span className="muted small crop-size" title="Size of the crop in pixels, as exported at 100 %">{cropSize[0]} × {cropSize[1]}</span>}
        </div>

        <div className="crop-row">
          <label className="crop-label" htmlFor="crop-aspect">Aspect</label>
          <select
            id="crop-aspect"
            value={g.aspect}
            disabled={disabled}
            onChange={(e) => onEdit({ kind: 'aspect', aspect: e.target.value as AspectId })}
            title="Shape of the crop. Picking one locks it."
          >
            {ASPECTS.map((a) => (
              // Ratios follow the crop's shape: 3 : 2 for a landscape crop, 2 : 3 for a portrait one.
              <option key={a.id} value={a.id}>{a.ratio ? (portrait ? `${a.ratio[1]} : ${a.ratio[0]}` : `${a.ratio[0]} : ${a.ratio[1]}`) : a.label}</option>
            ))}
          </select>
          <button
            className={`button small icon ${g.locked ? 'on' : ''}`}
            disabled={disabled}
            aria-pressed={g.locked}
            onClick={() => onEdit({ kind: 'lock', locked: !g.locked })}
            title={g.locked ? 'Aspect locked: dragging keeps the shape. Click to unlock.' : 'Aspect free: click to lock the current shape.'}
            aria-label={g.locked ? 'Unlock aspect' : 'Lock aspect'}
          >
            {ICON.lock(g.locked)}
          </button>
          <button className="button small icon" disabled={disabled} onClick={() => onEdit({ kind: 'swap' })} title={withKey('Swap portrait and landscape', 'crop.swap')} aria-label="Swap portrait and landscape">
            {ICON.swap}
          </button>
        </div>
        {g.aspect === 'custom' && (
          <div className="crop-row crop-custom">
            <label className="crop-label">Custom</label>
            {[0, 1].map((i) => (
              <input
                key={i}
                type="number"
                min={0.1}
                step={0.1}
                value={g.custom[i]}
                disabled={disabled}
                aria-label={i === 0 ? 'Custom aspect width' : 'Custom aspect height'}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!(v > 0)) return
                  const custom: [number, number] = i === 0 ? [v, g.custom[1]] : [g.custom[0], v]
                  onEdit({ kind: 'aspect', aspect: 'custom', custom })
                }}
              />
            ))}
          </div>
        )}
        {ratio && (g.aspect === 'original' || g.aspect === 'custom') && <p className="muted small crop-note">Locked to {ratio >= 1 ? `${ratio.toFixed(3).replace(/\.?0+$/, '')} : 1` : `1 : ${(1 / ratio).toFixed(3).replace(/\.?0+$/, '')}`}</p>}

        <div className="crop-row">
          <label className="crop-label" htmlFor="crop-overlay">Overlay</label>
          <select id="crop-overlay" value={overlay} onChange={(e) => onOverlay(e.target.value as CropOverlayKind)} title={withKey('Guides shown while cropping', 'crop.overlay')}>
            {CROP_OVERLAYS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      </section>

      <section>
        <h3>Straighten</h3>
        <Slider
          label="Angle"
          help={HELP.angle}
          showHint={showHint}
          value={g.angle}
          min={-45}
          max={45}
          step={0.01}
          defaultValue={0}
          format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}°`}
          disabled={disabled}
          onChange={(v) => onEdit({ kind: 'angle', angle: v })}
        />
        <div className="crop-tools">
          <button
            className={`button small ${leveling ? 'on' : ''}`}
            disabled={disabled}
            aria-pressed={leveling}
            onClick={onLevel}
            title="Draw a line along the horizon or a wall; the photo turns to make it level (or upright). While cropping, Ctrl-drag does the same."
          >
            {ICON.level} Level
          </button>
          <button
            className="button small"
            disabled={disabled || straightening}
            onClick={onAutoStraighten}
            aria-label="Auto straighten"
            title={withKey('Level the photo along the lines found in it (horizon, walls). With Level on, double-clicking the photo does the same.', 'develop.autoStraighten')}
          >
            Auto
          </button>
          <span className="crop-tools-gap" />
          <button className="button small icon" disabled={disabled} onClick={() => onEdit({ kind: 'rotate', dir: -1 })} title={withKey('Rotate left', 'develop.rotateLeft')} aria-label="Rotate left">{ICON.rotL}</button>
          <button className="button small icon" disabled={disabled} onClick={() => onEdit({ kind: 'rotate', dir: 1 })} title={withKey('Rotate right', 'develop.rotateRight')} aria-label="Rotate right">{ICON.rotR}</button>
          <button className="button small icon" disabled={disabled} onClick={() => onEdit({ kind: 'flip', axis: 'h' })} title="Flip horizontal" aria-label="Flip horizontal">{ICON.flipH}</button>
          <button className="button small icon" disabled={disabled} onClick={() => onEdit({ kind: 'flip', axis: 'v' })} title="Flip vertical" aria-label="Flip vertical">{ICON.flipV}</button>
        </div>
        {straightening && <p className="muted small crop-note">Looking for straight lines…</p>}
        {!straightening && straightenMessage && <p className="small crop-note upright-warn" role="status">{straightenMessage}</p>}
        {(g.turns !== 0 || g.mirror) && <p className="muted small crop-note">{orientationText(g)} (on top of the camera’s orientation)</p>}
      </section>
    </div>
  )
}
