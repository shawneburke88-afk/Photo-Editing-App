import { useId } from 'react'
import type { ControlHelp } from './help'

interface Props {
  label: string
  value: number
  min: number
  max: number
  step: number
  /** Value restored on double-click (Lightroom behaviour). */
  defaultValue: number
  format?: (v: number) => string
  /** Optional colour gradient for the track (e.g. temperature). */
  track?: string
  disabled?: boolean
  /** Guidance: tooltip on hover/focus, plus a sublabel when `showHint` is on. */
  help?: ControlHelp
  showHint?: boolean
  onChange: (v: number) => void
}

/** A develop slider: label, value readout, double-click the label or value to reset. */
export function Slider({ label, value, min, max, step, defaultValue, format, track, disabled, help, showHint, onChange }: Props) {
  const id = useId()
  const tipId = `${id}-tip`
  const text = format ? format(value) : (Math.round(value * 100) / 100).toString()
  return (
    <div className={`dslider ${disabled ? 'disabled' : ''}`} onDoubleClick={() => !disabled && onChange(defaultValue)}>
      <div className="dslider-head">
        <label htmlFor={id} title={help ? undefined : 'Double-click to reset'}>{label}</label>
        <span className="dslider-value">{text}</span>
      </div>
      {help && showHint && <div className="dslider-hint">{help.hint}</div>}
      {help && (
        <div className="dslider-tip" id={tipId} role="tooltip">
          <p>{help.what}</p>
          <dl>
            <dt>◀ Left</dt>
            <dd>{help.left}</dd>
            <dt>Right ▶</dt>
            <dd>{help.right}</dd>
          </dl>
          {help.pitfalls && <p className="tip-warn">{help.pitfalls}</p>}
          <p className="tip-foot">Double-click to reset{help.engine ? ` · ${help.engine}` : ''}</p>
        </div>
      )}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-describedby={help ? tipId : undefined}
        style={track ? { background: track } : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}
