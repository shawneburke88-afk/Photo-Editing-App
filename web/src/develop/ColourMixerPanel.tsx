// The Colour group (PHASE3.md Part 15; owner's decisions 2026-10-13): Lightroom's Color Mixer with its two tabs.
//  - Mixer: 8 bands (Lightroom's names) × Hue, Saturation and Luminance, shown as Hue · Saturation · Luminance · All (8 or
//    24 sliders) or Colour (one band's three sliders, picked from 8 swatches); slider tracks painted with the band's
//    colours. A targeted adjustment tool (drag on the photo), a readout of the bands under the pointer, Alt-drag on a slider
//    (or Visualize) to see a band's colours with the rest grey, and darktable's colour equalizer settings under Advanced.
//  - Point Color: pick colours on the photo (up to 8), each with Hue/Saturation/Luminance Shift, Variance and Range.
// The maths is in engine/develop/colour-mixer.ts.

import { useEffect, useRef, useState } from 'react'
import { openSections, useOpen } from './panelState'
import {
  BAND_NAMES,
  bandCss,
  bandsActive,
  CHANNEL_NAMES,
  cssOfHsb,
  DEFAULT_ADVANCED,
  DEFAULT_COLOUR_MIXER,
  DEFAULT_POINT_RANGES,
  HUE_DEGREES,
  MAX_POINTS,
  MIXER_CHANNELS,
  POINT_LUM_LOG2B,
  withPoints,
  type ColourMixerSettings,
  type MixerAdvanced,
  type MixerChannel,
  type PointColour,
} from '../engine/develop/colour-mixer'
import { HELP, MIXER_GUIDE } from './help'
import { Slider } from './Slider'
import { withKey } from '../settings/shortcuts'
import type { MixerUi, MixerView } from './mixerUi'
import { SectionEyeRow } from './SectionEye'


interface Props {
  /** The mixer shown (a drag in progress included); undefined = untouched. */
  mixer: ColourMixerSettings | undefined
  ui: MixerUi
  onUi: (ui: MixerUi) => void
  disabled: boolean
  showHint: boolean
  /** The targeted adjustment tool's channel when it is on. */
  tat: MixerChannel | null
  onTat: (channel: MixerChannel | null) => void
  /** The bands under the pointer (targeted adjustment tool), with their weights. */
  hover: { weights: number[]; grey: boolean } | null
  onChange: (label: string, m: ColourMixerSettings | undefined, separate?: boolean) => void
  /** The Visualize view: 1–8 a band, 9–16 a point, 0 off. */
  onVisualize: (v: number) => void
  picking: boolean
  onPick: () => void
  selectedPoint: number | null
  onSelectPoint: (i: number | null) => void
}

const VIEWS: { id: MixerView; label: string; title: string }[] = [
  { id: 'hue', label: 'Hue', title: 'The eight bands’ Hue sliders' },
  { id: 'saturation', label: 'Saturation', title: 'The eight bands’ Saturation sliders' },
  { id: 'luminance', label: 'Luminance', title: 'The eight bands’ Luminance sliders' },
  { id: 'all', label: 'All', title: 'All 24 sliders' },
  { id: 'colour', label: 'Colour', title: 'One band’s Hue, Saturation and Luminance: pick the band from the swatches' },
]

const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`
const DEG = Math.PI / 180

/** The painted track of a band's slider (darktable draws its sliders' gradients the same way). */
function track(ch: MixerChannel, band: number, placement: number): string {
  const c = (o: { hueShift?: number; sat?: number; bright?: number }) => bandCss(band, { placement, ...o })
  if (ch === 'hue') return `linear-gradient(to right, ${c({ hueShift: -HUE_DEGREES, sat: 0.2 })}, ${c({ sat: 0.2 })}, ${c({ hueShift: HUE_DEGREES, sat: 0.2 })})`
  if (ch === 'saturation') return `linear-gradient(to right, ${c({ sat: 0 })}, ${c({ sat: 0.12 })}, ${c({ sat: 0.26 })})`
  return `linear-gradient(to right, ${c({ sat: 0.12, bright: 0.25 })}, ${c({ sat: 0.12, bright: 0.6 })}, ${c({ sat: 0.12, bright: 1 })})`
}

/** A point's swatch: the picked colour, and the colour it is changed to. */
function pointColours(p: PointColour): [string, string] {
  const h = p.hue * DEG
  // Near the picked brightness, kept readable on the panel (before the sigmoid, so only roughly as on the photo).
  const b = Math.min(0.95, Math.max(0.3, p.brightness * 1.2))
  const before = cssOfHsb(h, p.saturation, b)
  const after = cssOfHsb(h + (p.hueShift / 100) * HUE_DEGREES * DEG, p.saturation * (1 + p.satShift / 100), b * 2 ** ((p.lumShift / 100) * POINT_LUM_LOG2B))
  return [before, after]
}

export function ColourMixerPanel(p: Props) {
  const { ui, disabled } = p
  const m = p.mixer ?? DEFAULT_COLOUR_MIXER
  const adv = m.advanced ?? DEFAULT_ADVANCED
  const [advanced, setAdvanced] = useOpen(openSections, 'colour.advanced')
  const [ranges, setRanges] = useState(false)
  // Visualize: Alt held while dragging a band slider (Lightroom), or the checkbox for the band last moved.
  const [visualize, setVisualize] = useState(false)
  const [visualizeRange, setVisualizeRange] = useState(false)
  const [lastBand, setLastBand] = useState(0)
  const [dragBand, setDragBand] = useState<number | null>(null)
  const [alt, setAlt] = useState(false)
  const draggedWithAlt = useRef(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === 'Alt' && setAlt(true)
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return
      setAlt(false)
      // Releasing Alt after an Alt-drag mustn't move the focus to the browser's menu (Windows).
      if (draggedWithAlt.current) e.preventDefault()
      draggedWithAlt.current = false
    }
    const blur = () => setAlt(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  useEffect(() => {
    if (dragBand === null) return
    const end = () => setDragBand(null)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragBand])
  const points = m.points ?? []
  const shownBand = ui.view === 'colour' ? ui.band : lastBand
  const sel = p.selectedPoint !== null && p.selectedPoint < points.length ? p.selectedPoint : null
  const vis = disabled
    ? 0
    : ui.tab === 'point'
      ? visualizeRange && sel !== null
        ? 9 + sel
        : 0
      : dragBand !== null && alt
        ? 1 + dragBand
        : visualize
          ? 1 + shownBand
          : 0
  useEffect(() => {
    if (dragBand !== null && alt) draggedWithAlt.current = true
  }, [dragBand, alt])
  const { onVisualize } = p
  useEffect(() => onVisualize(vis), [vis, onVisualize])
  useEffect(() => () => onVisualize(0), [onVisualize])

  const setBand = (ch: MixerChannel, i: number, v: number) => {
    setLastBand(i)
    const next = { ...m, [ch]: m[ch].map((x, k) => (k === i ? Math.round(v) : x)) }
    p.onChange(`Colour mixer: ${BAND_NAMES[i]} ${CHANNEL_NAMES[ch]}`, next)
  }
  const setAdv = (label: string, patch: Partial<MixerAdvanced>) => p.onChange(`Colour mixer: ${label}`, { ...m, advanced: { ...adv, ...patch } }, true)
  const setPoint = (i: number, label: string, patch: Partial<PointColour>) => p.onChange(`Point Color ${i + 1}: ${label}`, withPoints(m, points.map((q, k) => (k === i ? { ...q, ...patch } : q))))
  const hot = (i: number) => (p.hover && !p.hover.grey ? p.hover.weights[i] : 0)

  const bandSlider = (ch: MixerChannel, i: number, label: string = BAND_NAMES[i]) => (
    <div
      key={`${ch}${i}`}
      className={`mixer-band ${hot(i) > 0.02 ? 'hot' : ''}`}
      style={hot(i) > 0.02 ? { ['--hot' as string]: String(hot(i)) } : undefined}
      onPointerDownCapture={(e) => {
        setLastBand(i)
        setDragBand(i)
        if (e.altKey) setAlt(true)
      }}
      onFocusCapture={() => setLastBand(i)}
    >
      <Slider
        label={label}
        value={m[ch][i]}
        min={-100}
        max={100}
        step={1}
        defaultValue={0}
        format={signed}
        track={track(ch, i, adv.placement)}
        disabled={disabled}
        help={ch === 'hue' ? HELP.mixerHue : ch === 'saturation' ? HELP.mixerSaturation : HELP.mixerLuminance}
        showHint={p.showHint && ui.view === 'colour'}
        onChange={(v) => setBand(ch, i, v)}
      />
    </div>
  )

  const channelTarget = ui.view === 'hue' || ui.view === 'saturation' || ui.view === 'luminance' ? ui.view : null
  const tatChannel = channelTarget ?? p.tat ?? 'saturation'
  const hoverLine = (() => {
    if (!p.hover) return p.tat ? 'Point at a colour on the photo.' : ''
    if (p.hover.grey) return 'Under the pointer: grey (the mixer leaves it alone)'
    const parts = p.hover.weights.map((w, i) => [w, i] as const).filter(([w]) => w > 0.02).sort((a, b) => b[0] - a[0])
    return `Under the pointer: ${parts.map(([w, i]) => `${BAND_NAMES[i]} ${Math.round(w * 100)} %`).join(', ')}`
  })()

  const mixerTab = (
    <>
      <div className="seg curve-views mixer-views" role="tablist" aria-label="Colour mixer view">
          {VIEWS.map((v) => {
            const edited = v.id === 'all' || v.id === 'colour' ? false : m[v.id].some((x) => x !== 0)
            return (
              <button key={v.id} role="tab" aria-selected={ui.view === v.id} className={ui.view === v.id ? 'on' : ''} title={v.title} disabled={disabled} onClick={() => p.onUi({ ...ui, view: v.id })}>
                {v.label}
                {edited && <span className="curve-edited" aria-label="(changed)">•</span>}
              </button>
            )
          })}
      </div>
      <div className="mixer-tools">
        <button
          className={`button small curve-tat mixer-tat ${p.tat ? 'on' : ''}`}
          aria-pressed={!!p.tat}
          disabled={disabled}
          onClick={() => p.onTat(p.tat ? null : tatChannel)}
          aria-label="Targeted adjustment"
          title={withKey(`Targeted adjustment (${CHANNEL_NAMES[tatChannel]}): drag up or down on a colour in the photo to change the bands it belongs to; ↑ ↓ while hovering nudge them; Esc ends. Ctrl+Alt+Shift+H, S or L pick the channel.`, tatChannel === 'hue' ? 'develop.mixerTargetHue' : tatChannel === 'saturation' ? 'develop.mixerTargetSat' : 'develop.mixerTargetLum')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="8" cy="8" r="1.6" fill="currentColor" />
            <path stroke="currentColor" strokeWidth="1.4" d="M8 0.5v3M8 12.5v3M0.5 8h3M12.5 8h3" />
          </svg>
        </button>
        <p className="small muted mixer-readout" aria-live="polite">{hoverLine || 'Drag on the photo with the target to change the colours under the pointer.'}</p>
      </div>
      {channelTarget && MIXER_CHANNELS.includes(channelTarget) && BAND_NAMES.map((_, i) => bandSlider(channelTarget, i))}
      {ui.view === 'all' &&
        MIXER_CHANNELS.map((ch) => (
          <div key={ch} className="mixer-all">
            <h4>{CHANNEL_NAMES[ch]}</h4>
            {BAND_NAMES.map((_, i) => bandSlider(ch, i))}
          </div>
        ))}
      {ui.view === 'colour' && (
        <>
          <div className="mixer-swatches" role="radiogroup" aria-label="Band">
            {BAND_NAMES.map((n, i) => (
              <button
                key={n}
                role="radio"
                aria-checked={ui.band === i}
                className={`mixer-swatch ${ui.band === i ? 'on' : ''} ${hot(i) > 0.02 ? 'hot' : ''}`}
                style={{ background: bandCss(i, { placement: adv.placement, sat: 0.18 }) }}
                title={`${n}${m.hue[i] || m.saturation[i] || m.luminance[i] ? `: Hue ${signed(m.hue[i])}, Saturation ${signed(m.saturation[i])}, Luminance ${signed(m.luminance[i])}` : ''}`}
                aria-label={n}
                disabled={disabled}
                onClick={() => {
                  setLastBand(i)
                  p.onUi({ ...ui, band: i })
                }}
              >
                {(m.hue[i] || m.saturation[i] || m.luminance[i]) ? <span className="mixer-swatch-dot" aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
          {MIXER_CHANNELS.map((ch) => bandSlider(ch, ui.band, `${BAND_NAMES[ui.band]} ${CHANNEL_NAMES[ch]}`))}
        </>
      )}
      <div className="curve-foot">
        <button className="button small" disabled={disabled || !bandsActive(m)} onClick={() => p.onChange('Reset colour mixer', withPoints({ ...DEFAULT_COLOUR_MIXER, ...(m.advanced ? { advanced: m.advanced } : {}) }, m.points), true)} title="All 24 sliders back to 0 (Point Color and the Advanced settings stay)">
          Reset
        </button>
        {channelTarget && (
          <button className="button small" disabled={disabled || m[channelTarget].every((v) => v === 0)} onClick={() => p.onChange(`Reset colour mixer ${CHANNEL_NAMES[channelTarget]}`, { ...m, [channelTarget]: DEFAULT_COLOUR_MIXER[channelTarget] }, true)} title={`The eight ${CHANNEL_NAMES[channelTarget]} sliders back to 0`}>
            Reset {CHANNEL_NAMES[channelTarget]}
          </button>
        )}
        <button className="adv-toggle curve-adv" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
          {advanced ? '▾' : '▸'} Advanced
        </button>
      </div>
      <label className="detail-check" title="Shows the colours of the band you last moved (or picked in the Colour view), the rest grey. Holding Alt (Option on a Mac) while dragging a slider does the same.">
        <input type="checkbox" checked={visualize} disabled={disabled} onChange={(e) => setVisualize(e.target.checked)} /> Visualize {BAND_NAMES[shownBand]} <span className="muted">(or Alt-drag a slider)</span>
      </label>
      {advanced && (
        <div className="curve-advanced mixer-advanced">
          <label className="check small" title="On by default: the corrections are smoothed within each area of similar colour, with an edge guard for brightness, so noisy or textured colours change evenly and edges don’t get halos. Off: every pixel is changed by its own hue only (faster).">
            <input type="checkbox" checked={adv.guided} disabled={disabled} onChange={(e) => setAdv('guided filter', { guided: e.target.checked })} /> Use guided filter
          </label>
          <Slider label="Saturation threshold" value={adv.threshold * 100} min={0} max={30} step={0.1} defaultValue={DEFAULT_ADVANCED.threshold * 100} format={(v) => `${v.toFixed(1)} %`} disabled={disabled || !adv.guided}
            help={{ hint: 'Below it, colours count as grey', what: 'How saturated a colour must be before the bands change it fully (with the guided filter). The default 10 % puts the turning point at 6 % saturation.', left: 'Paler colours are changed too.', right: 'Only stronger colours are changed.', engine: 'darktable colour equalizer: saturation threshold' }}
            showHint={p.showHint} onChange={(v) => setAdv('saturation threshold', { threshold: v / 100 })} />
          <Slider label="Threshold contrast" value={adv.contrast * 100} min={-100} max={100} step={1} defaultValue={0} format={(v) => `${Math.round(v)} %`} disabled={disabled || !adv.guided}
            help={{ hint: 'How sharp the threshold is', what: 'How suddenly the change fades in around the threshold.', left: 'A softer fade.', right: 'A sharper cut-off.', engine: 'darktable colour equalizer: contrast' }}
            showHint={p.showHint} onChange={(v) => setAdv('threshold contrast', { contrast: v / 100 })} />
          <Slider label="White level" value={adv.whiteLevel} min={-2} max={2} step={0.05} defaultValue={DEFAULT_ADVANCED.whiteLevel} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV`} disabled={disabled}
            help={{ hint: 'Where the colour space’s white sits', what: 'The brightness the perceptual colour space treats as white. It changes how lightness and saturation are measured, and so how strongly bright colours are changed.', left: 'Brighter colours count as white sooner.', right: 'More headroom above white.', engine: 'darktable colour equalizer: white level (+1 EV by default)' }}
            showHint={p.showHint} onChange={(v) => setAdv('white level', { whiteLevel: v })} />
          <Slider label="Band placement" value={adv.placement} min={-23} max={23} step={0.5} defaultValue={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`} disabled={disabled}
            help={{ hint: 'Turns all eight bands', what: 'Turns the centre of every band by the same angle of hue, e.g. to catch a sky that sits between Aqua and Blue.', left: 'Every band towards the one before it.', right: 'Every band towards the one after it.', engine: 'darktable colour equalizer: node placement' }}
            showHint={p.showHint} onChange={(v) => setAdv('band placement', { placement: v })} />
          <button className="button small" disabled={disabled || !m.advanced} onClick={() => p.onChange('Colour mixer: Advanced reset', { ...m, advanced: undefined }, true)}>Reset Advanced</button>
        </div>
      )}
    </>
  )

  const selPoint = sel !== null ? points[sel] : null
  const pointTab = (
    <>
      <div className="point-bar">
        <button
          className={`button small point-pick ${p.picking ? 'on' : ''}`}
          aria-pressed={p.picking}
          disabled={disabled || (points.length >= MAX_POINTS && !p.picking)}
          onClick={p.onPick}
          title={points.length >= MAX_POINTS ? `At most ${MAX_POINTS} colours` : withKey('Pick a colour: click it on the photo (Esc cancels)', 'develop.pointColorPick')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="1.4" d="M10.5 2.5l3 3-1.6 1.6-3-3zM9 5.5l-6.2 6.2-.8 2.3 2.3-.8L10.5 7" />
          </svg>
          {p.picking ? 'Click the photo…' : 'Pick'}
        </button>
        <div className="point-swatches" role="radiogroup" aria-label="Picked colours">
          {points.map((q, i) => {
            const [a, b] = pointColours(q)
            return (
              <button
                key={i}
                role="radio"
                aria-checked={sel === i}
                className={`point-swatch ${sel === i ? 'on' : ''}`}
                style={{ background: `linear-gradient(to right, ${a} 50%, ${b} 50%)` }}
                title={`Colour ${i + 1}: picked colour (left) and what it becomes (right)`}
                aria-label={`Colour ${i + 1}`}
                disabled={disabled}
                onClick={() => p.onSelectPoint(i)}
              />
            )
          })}
        </div>
      </div>
      {!points.length && <p className="small muted">Pick a colour on the photo, then shift it and the colours like it (up to {MAX_POINTS}). Later colours act on what earlier ones changed.</p>}
      {selPoint && sel !== null && (
        <>
          <Slider label="Hue Shift" value={selPoint.hueShift} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={disabled} help={HELP.pointHueShift} showHint={p.showHint} onChange={(v) => setPoint(sel, 'Hue Shift', { hueShift: Math.round(v) })} />
          <Slider label="Saturation Shift" value={selPoint.satShift} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={disabled} help={HELP.pointSatShift} showHint={p.showHint} onChange={(v) => setPoint(sel, 'Saturation Shift', { satShift: Math.round(v) })} />
          <Slider label="Luminance Shift" value={selPoint.lumShift} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={disabled} help={HELP.pointLumShift} showHint={p.showHint} onChange={(v) => setPoint(sel, 'Luminance Shift', { lumShift: Math.round(v) })} />
          <Slider label="Variance" value={selPoint.variance} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={disabled} help={HELP.pointVariance} showHint={p.showHint} onChange={(v) => setPoint(sel, 'Variance', { variance: Math.round(v) })} />
          <Slider label="Range" value={selPoint.range} min={0} max={100} step={1} defaultValue={DEFAULT_POINT_RANGES.range} format={(v) => String(Math.round(v))} disabled={disabled} help={HELP.pointRange} showHint={p.showHint} onChange={(v) => setPoint(sel, 'Range', { range: Math.round(v) })} />
          <button className="adv-toggle point-ranges" aria-expanded={ranges} onClick={() => setRanges((r) => !r)}>
            {ranges ? '▾' : '▸'} Hue, saturation and luminance ranges
          </button>
          {ranges && (
            <>
              <Slider label="Hue Range" value={selPoint.hueRange} min={0} max={100} step={1} defaultValue={DEFAULT_POINT_RANGES.hueRange} format={(v) => String(Math.round(v))} disabled={disabled} help={HELP.pointHueRange} showHint={p.showHint} onChange={(v) => setPoint(sel, 'Hue Range', { hueRange: Math.round(v) })} />
              <Slider label="Saturation Range" value={selPoint.satRange} min={0} max={100} step={1} defaultValue={DEFAULT_POINT_RANGES.satRange} format={(v) => String(Math.round(v))} disabled={disabled} help={HELP.pointSatRange} showHint={p.showHint} onChange={(v) => setPoint(sel, 'Saturation Range', { satRange: Math.round(v) })} />
              <Slider label="Luminance Range" value={selPoint.lumRange} min={0} max={100} step={1} defaultValue={DEFAULT_POINT_RANGES.lumRange} format={(v) => String(Math.round(v))} disabled={disabled} help={HELP.pointLumRange} showHint={p.showHint} onChange={(v) => setPoint(sel, 'Luminance Range', { lumRange: Math.round(v) })} />
            </>
          )}
          <label className="detail-check" title="Shows the colours this point changes; the rest of the photo turns grey.">
            <input type="checkbox" checked={visualizeRange} disabled={disabled} onChange={(e) => setVisualizeRange(e.target.checked)} /> Visualize range
          </label>
          <div className="curve-foot">
            <button className="button small" disabled={disabled || (selPoint.hueShift === 0 && selPoint.satShift === 0 && selPoint.lumShift === 0 && selPoint.variance === 0)} onClick={() => p.onChange(`Point Color ${sel + 1}: reset`, withPoints(m, points.map((q, k) => (k === sel ? { ...q, hueShift: 0, satShift: 0, lumShift: 0, variance: 0, ...DEFAULT_POINT_RANGES } : q))), true)}>
              Reset colour
            </button>
            <button
              className="button small"
              disabled={disabled}
              onClick={() => {
                p.onChange(`Point Color: remove colour ${sel + 1}`, withPoints(m, points.filter((_, k) => k !== sel)), true)
                p.onSelectPoint(points.length > 1 ? Math.max(0, sel - 1) : null)
              }}
              title="Remove this picked colour"
            >
              Remove
            </button>
            <button className="button small" disabled={disabled || !points.length} onClick={() => { p.onChange('Reset Point Color', withPoints(m, undefined), true); p.onSelectPoint(null) }} title="Remove every picked colour">
              Remove all
            </button>
          </div>
        </>
      )}
    </>
  )

  return (
    <div className="dpanel mixer-panel">
      <section>
        {p.showHint && (
          <p className="small muted curve-guide" title={`${MIXER_GUIDE.what}\n\n${MIXER_GUIDE.order}\n\n${MIXER_GUIDE.pitfalls}`}>
            {MIXER_GUIDE.hint}. <span className="curve-guide-order">Basic first; then single colours.</span>
          </p>
        )}
        <div className="seg mixer-tabs" role="tablist" aria-label="Colour">
          <button role="tab" aria-selected={ui.tab === 'mixer'} className={ui.tab === 'mixer' ? 'on' : ''} disabled={disabled} onClick={() => p.onUi({ ...ui, tab: 'mixer' })}>
            Mixer{bandsActive(m) && <span className="curve-edited" aria-label="(changed)">•</span>}
          </button>
          <button role="tab" aria-selected={ui.tab === 'point'} className={ui.tab === 'point' ? 'on' : ''} disabled={disabled} onClick={() => p.onUi({ ...ui, tab: 'point' })}>
            Point Color{points.length > 0 && <span className="curve-edited" aria-label="(changed)">•</span>}
          </button>
        </div>
        <SectionEyeRow ids={['colour.mixer', 'colour.points']} label="Colour Mixer section eyes" />
        {ui.tab === 'mixer' ? mixerTab : pointTab}
      </section>
    </div>
  )
}
