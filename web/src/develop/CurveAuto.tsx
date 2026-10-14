// The Tone Curve's Auto row (PHASE3.md Part 21): Auto contrast, Auto colour, Suggestions (the curve presets and both
// Auto results drawn on this photo) and the Amount of the result just applied. It sits under the presets and leaves the
// group's layout as it was. State and GPU work: useCurveAuto.ts.

import { useEffect, useRef } from 'react'
import { CURVE_AUTO_HELP } from './help'
import type { CurveAutoProps } from './useCurveAuto'
import './section-eyes.css'

function Thumb({ image, label }: { image: ImageData | null; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !image) return
    c.width = image.width
    c.height = image.height
    c.getContext('2d')?.putImageData(image, 0, 0)
  }, [image])
  return image ? <canvas ref={ref} aria-label={label} /> : <span className="curve-suggest-empty" aria-hidden="true" />
}

export function CurveAuto(p: CurveAutoProps) {
  const s = p.suggestions
  return (
    <div className="curve-auto" role="group" aria-label="Tone curve Auto">
      <span className="small muted curve-auto-label">Auto</span>
      <button className="button small" disabled={p.disabled || !!p.busy} onClick={() => p.onAuto('contrast')} title={CURVE_AUTO_HELP.contrast}>
        {p.busy === 'contrast' ? 'Contrast…' : 'Contrast'}
      </button>
      <button className="button small" disabled={p.disabled || !!p.busy} onClick={() => p.onAuto('colour')} title={CURVE_AUTO_HELP.colour}>
        {p.busy === 'colour' ? 'Colour…' : 'Colour'}
      </button>
      <button className={`button small ${s.open ? 'on' : ''}`} aria-expanded={s.open} disabled={p.disabled} onClick={() => p.onSuggestions(!s.open)} title={CURVE_AUTO_HELP.suggestions}>
        Suggestions {s.open ? '▾' : '▸'}
      </button>
      {s.open && (
        <div className="curve-suggest" role="list" aria-label="Curve suggestions" aria-busy={s.busy} onMouseLeave={() => p.onHover(null)}>
          {s.items.map((it) => (
            <button
              key={it.id}
              role="listitem"
              className={s.applied === it.id ? 'on' : ''}
              data-suggestion={it.id}
              disabled={p.disabled || !!p.busy}
              onMouseEnter={() => p.onHover(it.id)}
              onFocus={() => p.onHover(it.id)}
              onBlur={() => p.onHover(null)}
              onClick={() => p.onSuggestion(it.id)}
              title={`${it.name}: hover to preview on the photo, click to apply`}
            >
              <Thumb image={it.image} label={it.name} />
              <span>{it.name}</span>
            </button>
          ))}
          {!s.items.length && <p className="small muted curve-auto-msg">Drawing the suggestions on this photo…</p>}
        </div>
      )}
      {p.amount && (
        <label className="curve-auto-amount" title={CURVE_AUTO_HELP.amount}>
          <span>Amount</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(p.amount.value * 100)}
            disabled={p.disabled}
            onChange={(e) => p.onAmount(Number(e.target.value) / 100)}
            onDoubleClick={() => p.onAmount(1)}
            aria-label={`Amount of ${p.amount.label.replace('Tone Curve: ', '')}`}
          />
          <span className="muted">{Math.round(p.amount.value * 100)} %</span>
        </label>
      )}
      {p.message && <p className="small muted curve-auto-msg" role="status">{p.message}</p>}
    </div>
  )
}
