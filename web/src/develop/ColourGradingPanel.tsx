// The Colour Grading group (PHASE3.md Part 17; owner's decisions 2026-10-14): Lightroom's Color Grading layout, with
// views 3-Way · Shadows · Midtones · Highlights · Global. Each wheel has its hue and saturation as a point on the wheel,
// a Luminance slider and Hue/Saturation number fields; Blending and Balance are under the wheels in every view; darktable's
// color balance rgb settings are under Advanced. The maths is in engine/develop/colour-grading.ts.
//
// Wheel gestures, as Adobe describes Lightroom's (its 2020-10-20 launch post and Lightroom Classic's October 2020 help):
// drag the point (or anywhere on the wheel), Shift = saturation only, Ctrl/⌘ = hue only, Alt/Option = fine, double-click =
// reset the wheel's colour. Adobe's soft "spoke" constraint is not copied (Shift is a hard constraint here). Keyboard (the
// Tone Curve's rules, Part 12): the point is a focusable slider; ← → turn the hue, ↑ ↓ change the saturation, Shift ×10,
// Home resets; changes are announced.

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  DEFAULT_GRADING,
  DEFAULT_GRADING_ADVANCED,
  falloffOf,
  hueCss,
  RANGE_NAMES,
  WHEEL_KEYS,
  WHEEL_NAMES,
  wrapHue,
  type ColourGradingSettings,
  type GradingAdvanced,
  type GradingWheel,
  type WheelKey,
} from '../engine/develop/colour-grading'
import { GRADING_GUIDE, HELP } from './help'
import { Slider } from './Slider'
import type { GradingView } from './gradingUi'

interface Props {
  /** The grade shown (a drag in progress included); undefined = untouched. */
  grading: ColourGradingSettings | undefined
  view: GradingView
  onView: (v: GradingView) => void
  disabled: boolean
  showHint: boolean
  /** A change (`separate`: the end of a drag or a reset, one history step of its own). */
  onChange: (label: string, g: ColourGradingSettings | undefined, separate?: boolean) => void
  /** A drag in progress (shown, not recorded); null ends it. */
  onDraft: (g: ColourGradingSettings | undefined | null) => void
  /** Alt-drag on Blending: show the tints at full saturation while it lasts (a view only). */
  onBoost: (on: boolean) => void
}

const VIEWS: { id: GradingView; label: string; title: string }[] = [
  { id: '3way', label: '3-Way', title: 'Shadows, Midtones and Highlights together' },
  { id: 'shadows', label: 'Shadows', title: 'The Shadows wheel, large' },
  { id: 'midtones', label: 'Midtones', title: 'The Midtones wheel, large' },
  { id: 'highlights', label: 'Highlights', title: 'The Highlights wheel, large' },
  { id: 'global', label: 'Global', title: 'The Global wheel: a tint and brightness over the whole photo' },
]

const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`
const DEG = Math.PI / 180
/** The hue ring, as on an HSL wheel: hue 0 (red) at the right, hues rising anticlockwise (LightBench's layout). */
const RING = `conic-gradient(from 90deg, ${Array.from({ length: 13 }, (_, i) => `${hueCss(360 - i * 30, 0.85, 0.55)} ${i * 30}deg`).join(', ')})`
const DISC = `radial-gradient(closest-side, hsl(0 0% 50%) 0%, hsl(0 0% 50% / 0.55) 55%, hsl(0 0% 50% / 0) 100%), ${RING}`

const wheelText = (name: string, w: GradingWheel) => `${name}: hue ${w.hue}°, saturation ${w.sat}`

interface WheelProps {
  k: WheelKey
  w: GradingWheel
  size: number
  disabled: boolean
  big: boolean
  onDrag: (w: GradingWheel) => void
  onDone: (w: GradingWheel | null) => void
  onKey: (w: GradingWheel) => void
  onReset: () => void
}

function Wheel({ k, w, size, disabled, big, onDrag, onDone, onKey, onReset }: WheelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ start: GradingWheel; x0: number; y0: number; last: GradingWheel } | null>(null)
  const R = size / 2
  const r = (w.sat / 100) * (R - 6)
  const px = R + r * Math.cos(w.hue * DEG)
  const py = R - r * Math.sin(w.hue * DEG)

  const fromPointer = (e: ReactPointerEvent<HTMLDivElement>): GradingWheel => {
    const d = drag.current!
    const box = ref.current!.getBoundingClientRect()
    const scale = (R - 6) / 100
    let dx: number
    let dy: number
    if (e.altKey) {
      // Fine: a quarter of the pointer's movement, from where the drag started.
      dx = d.start.sat * Math.cos(d.start.hue * DEG) * scale + (e.clientX - d.x0) / 4
      dy = d.start.sat * Math.sin(d.start.hue * DEG) * scale - (e.clientY - d.y0) / 4
    } else {
      dx = e.clientX - box.left - R
      dy = R - (e.clientY - box.top)
    }
    const sat = Math.min(100, Math.round(Math.hypot(dx, dy) / scale))
    const hue = wrapHue(Math.atan2(dy, dx) / DEG)
    if (e.shiftKey) {
      // Saturation only: the distance along the wheel's current spoke.
      const along = (dx * Math.cos(d.start.hue * DEG) + dy * Math.sin(d.start.hue * DEG)) / scale
      return { ...d.start, sat: Math.max(0, Math.min(100, Math.round(along))) }
    }
    if (e.ctrlKey || e.metaKey) return { ...d.start, hue }
    return { ...d.start, hue: sat > 0 ? hue : d.start.hue, sat }
  }

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { start: w, x0: e.clientX, y0: e.clientY, last: w }
    // A plain click puts the point where it lands; with a modifier the point moves only as the pointer does.
    if (!e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const next = fromPointer(e)
      drag.current.last = next
      onDrag(next)
    }
    ;(ref.current?.querySelector('.grade-point') as HTMLElement | null)?.focus()
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const next = fromPointer(e)
    drag.current.last = next
    onDrag(next)
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    if (d) onDone(d.last.hue === d.start.hue && d.last.sat === d.start.sat ? null : d.last)
  }
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled || e.ctrlKey || e.metaKey) return
    const step = e.shiftKey ? 10 : 1
    let next: GradingWheel | null = null
    switch (e.key) {
      case 'ArrowLeft':
        next = { ...w, hue: wrapHue(w.hue - step) }
        break
      case 'ArrowRight':
        next = { ...w, hue: wrapHue(w.hue + step) }
        break
      case 'ArrowUp':
        next = { ...w, sat: Math.min(100, w.sat + step) }
        break
      case 'ArrowDown':
        next = { ...w, sat: Math.max(0, w.sat - step) }
        break
      case 'Home':
        next = { ...w, hue: 0, sat: 0 }
        break
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
    if (next.hue !== w.hue || next.sat !== w.sat) onKey(next)
  }

  return (
    <div
      ref={ref}
      className={`grade-wheel ${big ? 'big' : ''} ${disabled ? 'disabled' : ''}`}
      style={{ width: size, height: size, background: DISC }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => !disabled && onReset()}
      title={`${WHEEL_NAMES[k]}: drag to tint · Shift saturation only · Ctrl (⌘) hue only · Alt fine · double-click resets · arrow keys`}
    >
      {big && (
        <svg className="grade-rings" width={size} height={size} aria-hidden="true">
          {[0.25, 0.5, 0.75].map((f) => (
            <circle key={f} cx={R} cy={R} r={f * (R - 6)} />
          ))}
        </svg>
      )}
      <span className="grade-centre" style={{ left: R, top: R }} aria-hidden="true" />
      <div
        className="grade-point"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${WHEEL_NAMES[k]} colour`}
        aria-roledescription="colour wheel"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={w.sat}
        aria-valuetext={`hue ${w.hue}°, saturation ${w.sat}`}
        aria-disabled={disabled || undefined}
        style={{ left: px, top: py, background: w.sat ? hueCss(w.hue, w.sat / 100, 0.5) : 'hsl(0 0% 50%)' }}
        onKeyDown={key}
      />
    </div>
  )
}

export function ColourGradingPanel(p: Props) {
  const { disabled } = p
  const g = p.grading ?? DEFAULT_GRADING
  const adv = g.advanced ?? DEFAULT_GRADING_ADVANCED
  const [advanced, setAdvanced] = useState(false)
  const [announce, setAnnounce] = useState('')
  const live = useId()
  const set = (patch: Partial<ColourGradingSettings>) => ({ ...g, ...patch })
  const setWheel = (k: WheelKey, w: GradingWheel) => set({ [k]: w } as Partial<ColourGradingSettings>)
  const setAdv = (label: string, patch: Partial<GradingAdvanced>) => p.onChange(`Colour grading: ${label}`, set({ advanced: { ...adv, ...patch } }))

  // Alt-drag on Blending (Lightroom: the tints at saturation 100 while dragging).
  const [blendDrag, setBlendDrag] = useState(false)
  const [alt, setAlt] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === 'Alt' && setAlt(true)
    const upKey = (e: KeyboardEvent) => e.key === 'Alt' && setAlt(false)
    const blur = () => setAlt(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', upKey)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', upKey)
      window.removeEventListener('blur', blur)
    }
  }, [])
  useEffect(() => {
    if (!blendDrag) return
    const end = () => setBlendDrag(false)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [blendDrag])
  const boost = blendDrag && alt && !disabled
  const { onBoost } = p
  useEffect(() => onBoost(boost), [boost, onBoost])
  useEffect(() => () => onBoost(false), [onBoost])

  const wheelBlock = (k: WheelKey, size: number, big: boolean) => {
    const w = g[k]
    const name = WHEEL_NAMES[k]
    return (
      <div key={k} className={`grade-block ${big ? 'big' : ''}`} role="group" aria-label={`${name} wheel`}>
        <div className="grade-block-head">
          <span className="grade-name">{name}</span>
          {(w.sat !== 0 || w.lum !== 0) && <span className="curve-edited-inline" aria-label="(changed)">•</span>}
        </div>
        <Wheel
          k={k}
          w={w}
          size={size}
          big={big}
          disabled={disabled}
          onDrag={(next) => p.onDraft(setWheel(k, next))}
          onDone={(next) => {
            p.onDraft(null)
            if (next) {
              p.onChange(`Colour grading: ${name}`, setWheel(k, next), true)
              setAnnounce(wheelText(name, next))
            }
          }}
          onKey={(next) => {
            p.onChange(`Colour grading: ${name}`, setWheel(k, next))
            setAnnounce(wheelText(name, next))
          }}
          onReset={() => {
            p.onChange(`Colour grading: reset ${name} colour`, setWheel(k, { ...w, hue: 0, sat: 0 }), true)
            setAnnounce(wheelText(name, { ...w, hue: 0, sat: 0 }))
          }}
        />
        <div className="grade-numbers">
          <label title={`${name} hue, 0–359° (as on an sRGB colour wheel: 0 red, 120 green, 240 blue)`}>
            <span>{big ? 'Hue' : 'H'}</span>
            <input type="number" min={0} max={359} step={1} value={w.hue} disabled={disabled} aria-label={`${name} hue`}
              onChange={(e) => e.target.value !== '' && p.onChange(`Colour grading: ${name} hue`, setWheel(k, { ...w, hue: wrapHue(Number(e.target.value)) }))} />
          </label>
          <label title={`${name} saturation, 0–100`}>
            <span>{big ? 'Saturation' : 'S'}</span>
            <input type="number" min={0} max={100} step={1} value={w.sat} disabled={disabled} aria-label={`${name} saturation`}
              onChange={(e) => e.target.value !== '' && p.onChange(`Colour grading: ${name} saturation`, setWheel(k, { ...w, sat: Math.max(0, Math.min(100, Math.round(Number(e.target.value)))) }))} />
          </label>
        </div>
        <Slider
          label="Luminance"
          value={w.lum}
          min={-100}
          max={100}
          step={1}
          defaultValue={0}
          format={signed}
          track="linear-gradient(to right, #1b1b1b, #808080, #f0f0f0)"
          disabled={disabled}
          help={HELP.gradeLuminance}
          showHint={p.showHint && big}
          onChange={(v) => p.onChange(`Colour grading: ${name} Luminance`, setWheel(k, { ...w, lum: Math.round(v) }))}
        />
      </div>
    )
  }

  const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)} %`
  const advSlider = (label: string, value: number, onChange: (v: number) => void, help: { hint: string; what: string; left: string; right: string; engine: string }, opts: { min?: number; max?: number; step?: number; def?: number; format?: (v: number) => string } = {}) => (
    <Slider key={label} label={label} value={value} min={opts.min ?? -100} max={opts.max ?? 100} step={opts.step ?? 1} defaultValue={opts.def ?? 0} format={opts.format ?? pct} disabled={disabled} help={help} showHint={p.showHint} onChange={onChange} />
  )
  const list = (key: 'chroma' | 'saturation' | 'brilliance', title: string, what: string) => (
    <div className="grade-adv-list" key={key}>
      <h4>{title}</h4>
      {RANGE_NAMES.map((n, i) =>
        advSlider(`${title}: ${n}`, adv[key][i], (v) => setAdv(`${title} ${n}`, { [key]: adv[key].map((x, j) => (j === i ? Math.round(v) : x)) }), {
          hint: i === 0 ? 'Whole photo' : `${n} only`,
          what,
          left: 'Less.',
          right: 'More.',
          engine: `darktable color balance rgb: ${key === 'chroma' ? 'linear chroma' : `perceptual ${key}`}, ${n.toLowerCase()}`,
        }),
      )}
    </div>
  )
  const fromBlending = falloffOf(g.blending)
  const edited = (k: WheelKey) => g[k].sat !== 0 || g[k].lum !== 0

  return (
    <div className="dpanel grading-panel">
      <section>
        {p.showHint && (
          <p className="small muted curve-guide" title={`${GRADING_GUIDE.what}\n\n${GRADING_GUIDE.order}\n\n${GRADING_GUIDE.pitfalls}`}>
            {GRADING_GUIDE.hint}. <span className="curve-guide-order">Basic first; grade last.</span>
          </p>
        )}
        <div className="seg curve-views grade-views" role="tablist" aria-label="Colour grading view">
          {VIEWS.map((v) => {
            const changed = v.id === '3way' ? (['shadows', 'midtones', 'highlights'] as const).some(edited) : edited(v.id)
            return (
              <button key={v.id} role="tab" aria-selected={p.view === v.id} className={p.view === v.id ? 'on' : ''} title={v.title} disabled={disabled} onClick={() => p.onView(v.id)}>
                {v.label}
                {changed && <span className="curve-edited" aria-label="(changed)">•</span>}
              </button>
            )
          })}
        </div>
        {p.view === '3way' ? (
          <div className="grade-3way">
            <div className="grade-row">{wheelBlock('midtones', 112, false)}</div>
            <div className="grade-row">
              {wheelBlock('shadows', 112, false)}
              {wheelBlock('highlights', 112, false)}
            </div>
          </div>
        ) : (
          <div className="grade-single">{wheelBlock(p.view, 196, true)}</div>
        )}
        {p.showHint && <p className="small muted grade-wheel-hint">{HELP.gradeWheel.left} {HELP.gradeWheel.right}</p>}
        <div
          className="grade-blending"
          onPointerDownCapture={(e) => {
            setBlendDrag(true)
            if (e.altKey) setAlt(true)
          }}
        >
          <Slider label="Blending" value={g.blending} min={0} max={100} step={1} defaultValue={50} format={(v) => String(Math.round(v))} disabled={disabled} help={HELP.gradeBlending} showHint={p.showHint}
            onChange={(v) => p.onChange('Colour grading: Blending', set({ blending: Math.round(v) }))} />
        </div>
        <Slider label="Balance" value={g.balance} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={disabled} help={HELP.gradeBalance} showHint={p.showHint}
          onChange={(v) => p.onChange('Colour grading: Balance', set({ balance: Math.round(v) }))} />
        <div className="visually-hidden" id={live} aria-live="polite">{announce}</div>
        <div className="curve-foot">
          <button
            className="button small"
            disabled={disabled || !p.grading || (WHEEL_KEYS.every((k) => g[k].hue === 0 && g[k].sat === 0 && g[k].lum === 0) && g.blending === 50 && g.balance === 0)}
            onClick={() => p.onChange('Reset colour grading', g.advanced ? { ...DEFAULT_GRADING, advanced: g.advanced } : undefined, true)}
            title="Every wheel, Blending and Balance back to their defaults (the Advanced settings stay)"
          >
            Reset
          </button>
          {p.view !== '3way' && (
            <button className="button small" disabled={disabled || (g[p.view].sat === 0 && g[p.view].lum === 0 && g[p.view].hue === 0)} onClick={() => p.onChange(`Reset colour grading ${WHEEL_NAMES[p.view as WheelKey]}`, setWheel(p.view as WheelKey, { hue: 0, sat: 0, lum: 0 }), true)}>
              Reset {WHEEL_NAMES[p.view]}
            </button>
          )}
          <button className="adv-toggle curve-adv" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
            {advanced ? '▾' : '▸'} Advanced
          </button>
        </div>
        {advanced && (
          <div className="curve-advanced grade-advanced">
            <p className="small muted">darktable’s color balance rgb, which the wheels drive (its “4 ways” tab). Hue shift, vibrance, contrast and the per-range chroma, saturation and brilliance are its “master” tab; the fall-offs and fulcrums its “masks” tab.</p>
            {advSlider('Hue shift', adv.hueShift, (v) => setAdv('hue shift', { hueShift: Math.round(v) }), { hint: 'Turns every hue', what: 'darktable’s hue shift: turns every colour’s hue by the same angle (in its Yrg space).', left: 'Turns hues one way.', right: 'The other way.', engine: 'darktable color balance rgb: hue shift' }, { min: -180, max: 180, format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}°` })}
            {advSlider('Vibrance', adv.vibrance, (v) => setAdv('vibrance', { vibrance: Math.round(v) }), { hint: 'Boosts pale colours more', what: 'darktable’s global vibrance: more chroma for the less saturated colours. Not Basic’s Vibrance (a separate, simpler control).', left: 'Less.', right: 'More.', engine: 'darktable color balance rgb: global vibrance' })}
            {advSlider('Contrast', adv.contrast, (v) => setAdv('contrast', { contrast: Math.round(v) }), { hint: 'Around the contrast fulcrum', what: 'darktable’s contrast: a power on luminance around the contrast grey fulcrum. Not Basic’s Contrast (the sigmoid).', left: 'Flatter.', right: 'Punchier.', engine: 'darktable color balance rgb: contrast' })}
            {list('chroma', 'Linear chroma', 'darktable’s linear chroma: scales colourfulness at constant luminance, in the range’s mask.')}
            {list('saturation', 'Perceptual saturation', 'darktable’s perceptual saturation (darktable UCS): more or less colourful, keeping perceived brightness.')}
            {list('brilliance', 'Perceptual brilliance', 'darktable’s perceptual brilliance (darktable UCS): brighter or darker, keeping saturation. darktable warns that beyond ±20 % it can create artefacts.')}
            <h4>Masks</h4>
            {advSlider('Shadows fall-off', adv.shadowsFalloff ?? fromBlending, (v) => setAdv('shadows fall-off', { shadowsFalloff: Math.round(v * 100) / 100 }), { hint: adv.shadowsFalloff === undefined ? 'From Blending' : 'Set here, not from Blending', what: 'darktable’s shadows fall-off: how steeply the shadows mask fades. Follows Blending until set here.', left: 'Softer (wider overlap).', right: 'Steeper.', engine: 'darktable color balance rgb: shadows fall-off' }, { min: 0, max: 3, step: 0.01, def: fromBlending, format: (v) => v.toFixed(2) })}
            {advSlider('Highlights fall-off', adv.highlightsFalloff ?? fromBlending, (v) => setAdv('highlights fall-off', { highlightsFalloff: Math.round(v * 100) / 100 }), { hint: adv.highlightsFalloff === undefined ? 'From Blending' : 'Set here, not from Blending', what: 'darktable’s highlights fall-off: how steeply the highlights mask fades. Follows Blending until set here.', left: 'Softer.', right: 'Steeper.', engine: 'darktable color balance rgb: highlights fall-off' }, { min: 0, max: 3, step: 0.01, def: fromBlending, format: (v) => v.toFixed(2) })}
            {advSlider('White fulcrum', adv.whiteFulcrum, (v) => setAdv('white fulcrum', { whiteFulcrum: Math.round(v * 100) / 100 }), { hint: 'Where the Midtones power pivots at the top', what: 'darktable’s white fulcrum: the luminance the Midtones power keeps fixed at the bright end (and the perceptual steps’ white).', left: 'Lower.', right: 'Higher.', engine: 'darktable color balance rgb: white fulcrum' }, { min: -4, max: 8, step: 0.05, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV` })}
            {advSlider('Contrast fulcrum', adv.contrastFulcrum, (v) => setAdv('contrast fulcrum', { contrastFulcrum: Math.round(v * 100) / 100 }), { hint: 'The grey Contrast pivots on', what: 'darktable’s contrast grey fulcrum: the luminance Advanced Contrast leaves unchanged (18.45 % by default).', left: 'Darker pivot.', right: 'Brighter pivot.', engine: 'darktable color balance rgb: contrast gray fulcrum' }, { min: 1, max: 100, step: 0.05, def: DEFAULT_GRADING_ADVANCED.contrastFulcrum, format: (v) => `${v.toFixed(2)} %` })}
            <p className="small muted">Not offered: darktable’s JzAzBz saturation formula (darktable UCS, its default, is used) and its checkerboard mask previews. Balance is the masks’ middle-grey fulcrum (±2 EV).</p>
            <button className="button small" disabled={disabled || !g.advanced} onClick={() => p.onChange('Colour grading: Advanced reset', set({ advanced: undefined }), true)}>Reset Advanced</button>
          </div>
        )}
      </section>
    </div>
  )
}
