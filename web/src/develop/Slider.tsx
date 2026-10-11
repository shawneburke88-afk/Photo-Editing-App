import { useId } from 'react'

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
  onChange: (v: number) => void
}

/** A develop slider: label, value readout, double-click the label or value to reset. */
export function Slider({ label, value, min, max, step, defaultValue, format, track, disabled, onChange }: Props) {
  const id = useId()
  const text = format ? format(value) : (Math.round(value * 100) / 100).toString()
  return (
    <div className={`dslider ${disabled ? 'disabled' : ''}`} onDoubleClick={() => !disabled && onChange(defaultValue)}>
      <div className="dslider-head">
        <label htmlFor={id} title="Double-click to reset">{label}</label>
        <span className="dslider-value">{text}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={track ? { background: track } : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}
