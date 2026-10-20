// The Transform section of the Crop & Lens group: Upright (Off, Auto, Guided, Level, Vertical, Full) and
// Lightroom's Transform sliders. What each mode does is in engine/develop/upright.ts; DevelopView runs them.

import { DEFAULT_TRANSFORM, SCALE_RANGE, UPRIGHT_MODES, type TransformSettings, type UprightMode } from '../engine/develop/upright'
import { lightroomNote } from '../sidecar/lightroom'
import { withKey } from '../settings/shortcuts'
import { HELP } from './help'
import { Slider } from './Slider'
import { SectionEye } from './SectionEye'
import { openSections, useOpen } from './panelState'
import { SectionTitle } from './SectionTitle'

export type TransformSlider = 'vertical' | 'horizontal' | 'rotate' | 'aspect' | 'scale' | 'offsetX' | 'offsetY'

interface Props {
  transform: TransformSettings | undefined
  /** 35 mm-equivalent focal length from the photo, or null when the file has none. */
  focal: number | null
  /** Line detection or a fit is running. */
  busy: boolean
  /** The last Upright result or refusal, in plain words. */
  message: { text: string; warn: boolean } | null
  /** What the current correction does, in degrees. */
  summary: string | null
  guiding: boolean
  disabled: boolean
  showHint: boolean
  onMode: (mode: UprightMode) => void
  onSlider: (key: TransformSlider, value: number) => void
  onReset: () => void
}

const SLIDERS: { key: TransformSlider; label: string; min: number; max: number; step: number; help: keyof typeof HELP; unit?: string }[] = [
  { key: 'vertical', label: 'Vertical', min: -100, max: 100, step: 1, help: 'tVertical' },
  { key: 'horizontal', label: 'Horizontal', min: -100, max: 100, step: 1, help: 'tHorizontal' },
  { key: 'rotate', label: 'Rotate', min: -10, max: 10, step: 0.1, help: 'tRotate', unit: '°' },
  { key: 'aspect', label: 'Aspect', min: -100, max: 100, step: 1, help: 'tAspect' },
  { key: 'scale', label: 'Scale', min: SCALE_RANGE[0], max: SCALE_RANGE[1], step: 1, help: 'tScale', unit: ' %' },
  { key: 'offsetX', label: 'X Offset', min: -100, max: 100, step: 0.1, help: 'tOffsetX' },
  { key: 'offsetY', label: 'Y Offset', min: -100, max: 100, step: 0.1, help: 'tOffsetY' },
]

export function TransformPanel({ transform, focal, busy, message, summary, guiding, disabled, showHint, onMode, onSlider, onReset }: Props) {
  const t = transform ?? DEFAULT_TRANSFORM
  const mode = guiding ? 'guided' : t.upright
  // A secondary section of Crop & Lens: closed until opened (remembered); Guided Upright opens it.
  const [opened, setOpen] = useOpen(openSections, 'crop.transform')
  const open = opened || guiding
  const fmt = (v: number, step: number, unit = '') => `${v > 0 && unit !== ' %' ? '+' : ''}${step < 1 ? v.toFixed(1) : Math.round(v)}${unit}`
  return (
    <div className="dpanel transform-panel">
      <section>
        <div className="section-head"><SectionTitle title="Transform" open={open} onToggle={() => setOpen(!open)} summary={transform ? 'Changed' : undefined} /><SectionEye id="crop.transform" /></div>
        {open && (<>
        <div className="upright-modes" role="group" aria-label="Upright">
          {UPRIGHT_MODES.map((m) => (
            <button
              key={m.id}
              className={`button small ${mode === m.id ? 'on' : ''}`}
              aria-pressed={mode === m.id}
              aria-label={`Upright: ${m.label}`}
              disabled={disabled || busy}
              onClick={() => onMode(m.id)}
              title={m.id === 'guided' ? withKey(m.help, 'develop.guided') : m.help}
            >
              {m.label}
            </button>
          ))}
        </div>
        {busy && <p className="muted small crop-note">Looking for straight lines…</p>}
        {!busy && message && <p className={`small crop-note ${message.warn ? 'upright-warn' : 'muted'}`} role="status">{message.text}</p>}
        {!busy && summary && <p className="muted small crop-note">{summary}</p>}
        {!busy && !guiding && lightroomNote(transform) && (
          <p className={`small crop-note ${transform?.lightroom === 'guided' ? 'upright-warn' : 'muted'}`} data-note="lightroom">{lightroomNote(transform)}</p>
        )}
        {focal === null && <p className="muted small crop-note" title="Upright and the Transform sliders need the lens’s focal length; 28 mm is assumed when the file gives none">No focal length in the file: assuming 28 mm.</p>}
        {SLIDERS.map((s) => (
          <Slider
            key={s.key}
            label={s.label}
            help={HELP[s.help]}
            showHint={showHint}
            value={t[s.key]}
            min={s.min}
            max={s.max}
            step={s.step}
            defaultValue={DEFAULT_TRANSFORM[s.key]}
            format={(v) => fmt(v, s.step, s.unit)}
            disabled={disabled}
            onChange={(v) => onSlider(s.key, v)}
          />
        ))}
        <div className="crop-tools">
          <span className="muted small">No empty corners: the photo is enlarged to fill its frame.</span>
          <span className="crop-tools-gap" />
          <button className="button small" disabled={disabled || !transform} onClick={onReset} title="Reset Upright and the Transform sliders">
            Reset
          </button>
        </div>
        </>)}
      </section>
    </div>
  )
}
