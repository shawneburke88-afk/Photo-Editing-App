// The Remove group of the tool stack (PHASE3.md, Part 11): Lightroom's Remove / Heal / Clone tool without AI.
// The brush is used on the photo (RemoveOverlay); here are its mode, Size, Feather and Opacity, and what is
// selected. With a spot selected, the controls change that spot; otherwise they set the brush for new spots.

import { SPOT_MODES, type Spot, type SpotMode } from '../engine/develop/spots'
import { withKey } from '../settings/shortcuts'
import { HELP } from './help'
import { DEFAULT_BRUSH, SIZE_RANGE, type BrushSettings } from './removeBrush'
import { Slider } from './Slider'


interface Props {
  active: boolean
  brush: BrushSettings
  /** The selected spot (with its number) and its size in photo pixels. */
  selected: { spot: Spot; number: number; size: number } | null
  count: number
  showAll: boolean
  /** Status line: finding a source, filling a spot. */
  status: string | null
  disabled: boolean
  showHint: boolean
  onToggle: () => void
  onMode: (m: SpotMode) => void
  onSize: (v: number) => void
  onFeather: (v: number) => void
  onOpacity: (v: number) => void
  onShowAll: (on: boolean) => void
  onDelete: () => void
  onClear: () => void
}

export function RemovePanel({ active, brush, selected, count, showAll, status, disabled, showHint, onToggle, onMode, onSize, onFeather, onOpacity, onShowAll, onDelete, onClear }: Props) {
  const mode = selected ? selected.spot.mode : brush.mode
  const size = selected ? selected.size : brush.size
  const feather = selected ? Math.round(selected.spot.feather * 100) : brush.feather
  const opacity = selected ? Math.round(selected.spot.opacity * 100) : brush.opacity
  return (
    <div className="dpanel remove-panel">
      <section>
        <div className="crop-tools">
          <button className={`button small ${active ? 'on' : ''}`} disabled={disabled} onClick={onToggle} aria-pressed={active} title={withKey(active ? 'Finish with the brush' : 'Paint on the photo over what to remove', 'develop.remove')}>
            {active ? 'Done' : 'Brush…'}
          </button>
          <span className="muted small">{count ? `${count} ${count === 1 ? 'spot' : 'spots'}` : 'No spots yet'}</span>
          <span className="crop-tools-gap" />
          {active && (
            <label className="check small" title={withKey('Show the pins of all spots, or only the selected one', 'remove.showAll')}>
              <input type="checkbox" checked={showAll} onChange={(e) => onShowAll(e.target.checked)} />
              Show all
            </label>
          )}
        </div>
        <div className="upright-modes" role="group" aria-label={selected ? `Mode of spot ${selected.number}` : 'Mode for new spots'}>
          {SPOT_MODES.map((m) => (
            <button
              key={m.id}
              className={`button small ${mode === m.id ? 'on' : ''}`}
              aria-pressed={mode === m.id}
              disabled={disabled}
              onClick={() => onMode(m.id)}
              title={`${m.help}${selected ? ` Changes spot ${selected.number}.` : ' For the next spots painted.'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <Slider label="Size" help={HELP.removeSize} showHint={showHint} value={size} min={SIZE_RANGE[0]} max={SIZE_RANGE[1]} step={1} defaultValue={DEFAULT_BRUSH.size} format={(v) => `${Math.round(v)} px`} disabled={disabled} onChange={onSize} />
        <Slider label="Feather" help={HELP.removeFeather} showHint={showHint} value={feather} min={0} max={100} step={1} defaultValue={DEFAULT_BRUSH.feather} format={(v) => `${Math.round(v)} %`} disabled={disabled} onChange={onFeather} />
        <Slider label="Opacity" help={HELP.removeOpacity} showHint={showHint} value={opacity} min={1} max={100} step={1} defaultValue={DEFAULT_BRUSH.opacity} format={(v) => `${Math.round(v)} %`} disabled={disabled} onChange={onOpacity} />
        {status && <p className="muted small crop-note" role="status">{status}</p>}
        {active && !status && (
          <p className="muted small crop-note">
            {selected
              ? `Spot ${selected.number} selected: drag its dashed outline to take the fill from somewhere else. Delete removes it; Esc deselects.`
              : 'Paint over what to remove; LightBench picks where to take the fill from. Click a pin to select a spot. [ ] size · Space-drag moves the photo.'}
          </p>
        )}
        <div className="crop-tools">
          <span className="muted small">{selected ? `Spot ${selected.number} of ${count}` : 'No AI: fills come from the photo itself.'}</span>
          <span className="crop-tools-gap" />
          {selected && (
            <button className="button small" disabled={disabled} onClick={onDelete} title={withKey('Delete the selected spot', 'remove.delete')}>
              Delete
            </button>
          )}
          <button className="button small" disabled={disabled || !count} onClick={onClear} title="Delete all spots (one history step)">
            Clear all
          </button>
        </div>
      </section>
    </div>
  )
}
