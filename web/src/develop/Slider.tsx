import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { ControlHelp } from './help'
import { nudge, snap } from './sliderKeys'

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
  /** Guidance: tooltip on hover/focus, plus a short hint on the label line when `showHint` is on. */
  help?: ControlHelp
  showHint?: boolean
  onChange: (v: number) => void
}

/**
 * A develop slider: label, value readout, double-click the label or value to reset. With the slider
 * focused, ←/→ (or ↓/↑) nudge it, Shift+arrows take bigger steps and Home resets it.
 */
export function Slider({ label, value, min, max, step, defaultValue, format, track, disabled, help, showHint, onChange }: Props) {
  const id = useId()
  const tipId = `${id}-tip`
  const text = format ? format(value) : (Math.round(value * 100) / 100).toString()
  const hintRef = useRef<HTMLSpanElement>(null)
  const [hintFits, setHintFits] = useState(true)
  const hint = help && showHint ? help.hint : ''

  // The hint shares the label's line and is shown only when it fits completely (owner's request:
  // hints must not add rows). Re-checked whenever the panel is resized.
  useLayoutEffect(() => {
    const el = hintRef.current
    if (!el) return
    const check = () => setHintFits(el.scrollWidth <= el.clientWidth + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [hint])

  return (
    <div className={`dslider ${disabled ? 'disabled' : ''}`} onDoubleClick={() => !disabled && onChange(defaultValue)}>
      <div className="dslider-head">
        <label htmlFor={id} title={help ? undefined : 'Double-click or Home to reset'}>{label}</label>
        {hint && (
          <span ref={hintRef} className="dslider-hint" style={hintFits ? undefined : { visibility: 'hidden' }} aria-hidden="true">
            {hint}
          </span>
        )}
        <span className="dslider-value">{text}</span>
      </div>
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
          <p className="tip-foot">Double-click or Home to reset{help.engine ? ` · ${help.engine}` : ''}</p>
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
        onKeyDown={(e) => {
          if (e.ctrlKey || e.metaKey || e.altKey) return
          const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
          if (dir) {
            e.preventDefault()
            onChange(snap(value + dir * nudge(min, max, step, e.shiftKey), min, max, step))
          } else if (e.key === 'Home') {
            // The browser would jump to the minimum; here Home means "back to the default" (owner's choice).
            e.preventDefault()
            onChange(defaultValue)
          }
        }}
      />
    </div>
  )
}
