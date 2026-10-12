import { useState } from 'react'
import { HIGHEST_TEMPERATURE, LOWEST_TEMPERATURE } from '../engine/color/temperature'
import { sliderFromTint, tintFromSlider, type DevelopSettings, type SourceKind } from '../engine/develop/settings'
import type { SensorLayout } from '../engine/raw/types'
import { AutoControls, type AutoProps } from './AutoControls'
import { HELP } from './help'
import { Slider } from './Slider'

interface Props {
  settings: DevelopSettings
  /** As-shot white balance expressed as temperature/tint (null for non-RAW files). */
  asShot: { temperature: number; tint: number } | null
  onChange: (label: string, next: DevelopSettings) => void
  disabled: boolean
  /** RAW or display-referred (JPEG): JPEGs have no highlight reconstruction or demosaic. */
  kind: SourceKind
  /** RAW photos: the sensor layout, which decides the demosaic methods offered. */
  layout?: SensorLayout
  /** Default settings for this kind of photo (double-click reset values). */
  defaults: DevelopSettings
  auto: AutoProps
  /** White balance picker (W) is active. */
  pickingWb: boolean
  onPickWb: () => void
  /** Hints next to each slider's name (shared with the other groups of the tool stack). */
  hints: boolean
  onHints: (on: boolean) => void
}

const signed = (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`)
const ev = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV`

const TEMP_TRACK = 'linear-gradient(90deg, #4a7bd1, #ddd 45%, #e8b04a)'
const TINT_TRACK = 'linear-gradient(90deg, #4caf50, #ddd 50%, #c050c0)'

// The temperature slider works in (negated) mireds, −1e6 / K, so it feels even across the range and
// runs from low K (left, blue) to high K (right, yellow) like Lightroom.
const toMired = (k: number) => -1e6 / k
const fromMired = (m: number) => Math.round(-1e6 / m)

export function BasicPanel({ settings: s, asShot, onChange, disabled, kind, layout, defaults, auto, pickingWb, onPickWb, hints, onHints }: Props) {
  const [advanced, setAdvanced] = useState(false)
  const guide = (key: string) => ({ help: HELP[key], showHint: hints })
  const set = (label: string, patch: Partial<DevelopSettings>) => onChange(label, { ...s, ...patch })
  const setAdv = (label: string, patch: Partial<DevelopSettings['advanced']>) =>
    onChange(label, { ...s, advanced: { ...s.advanced, ...patch } })

  const wb = s.whiteBalance
  const shown = wb.mode === 'as-shot' && asShot ? asShot : wb
  const tintSlider = asShot ? sliderFromTint(shown.tint, asShot.tint) : 0
  const setWb = (label: string, temperature: number, tint: number) =>
    set(label, { whiteBalance: { mode: 'custom', temperature, tint } })

  return (
    <div className="dpanel">
      <section>
        <div className="dpanel-head">
          <h3>White balance</h3>
          <label className="hints-toggle" title="Show a short description next to each slider’s name when the panel is wide enough. Hover a slider’s name for full details.">
            <input type="checkbox" checked={hints} onChange={(e) => onHints(e.target.checked)} /> Hints
          </label>
        </div>
        <div className="wb-mode">
          <select
            value={wb.mode}
            disabled={disabled || !asShot}
            onChange={(e) =>
              e.target.value === 'as-shot'
                ? set('White balance: As shot', { whiteBalance: { ...wb, mode: 'as-shot' } })
                : asShot && setWb('White balance: Custom', asShot.temperature, asShot.tint)
            }
            aria-label="White balance preset"
          >
            <option value="as-shot">As shot</option>
            <option value="custom">Custom</option>
          </select>
          <button
            className={`button small wb-pick ${pickingWb ? 'on' : ''}`}
            disabled={disabled || !asShot}
            onClick={onPickWb}
            aria-pressed={pickingWb}
            title="White balance picker (W): click something in the photo that should be neutral grey or white"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.4 1.2a2 2 0 0 0-2.8 0L8.9 2.9 8.2 2.2 7.1 3.3l.7.7-5.6 5.6-.6 2.8L.5 13.5l2 2 1.1-1.1 2.8-.6 5.6-5.6.7.7 1.1-1.1-.7-.7 1.7-1.7a2 2 0 0 0 0-2.8zM5.5 13.2l-2 .4.4-2 5-5 1.6 1.6z"/></svg>
            {pickingWb ? 'Picking…' : 'Pick'}
          </button>
        </div>
        <Slider
          label="Temp"
          {...guide('temp')}
          value={toMired(shown.temperature)}
          min={toMired(LOWEST_TEMPERATURE + 99)}
          max={toMired(HIGHEST_TEMPERATURE / 2)}
          step={0.5}
          defaultValue={asShot ? toMired(asShot.temperature) : toMired(5000)}
          format={(m) => `${fromMired(m)} K`}
          track={TEMP_TRACK}
          disabled={disabled || !asShot}
          onChange={(m) => setWb('Temperature', fromMired(m), shown.tint)}
        />
        <Slider
          label="Tint"
          {...guide('tint')}
          value={tintSlider}
          min={-150}
          max={150}
          step={1}
          defaultValue={0}
          format={signed}
          track={TINT_TRACK}
          disabled={disabled || !asShot}
          onChange={(v) => asShot && setWb('Tint', shown.temperature, tintFromSlider(v, asShot.tint))}
        />
      </section>

      <section>
        <h3>Tone</h3>
        <AutoControls {...auto} busy={auto.busy || disabled} />
        <Slider label="Exposure" {...guide('exposure')} value={s.exposure} min={-5} max={5} step={0.05} defaultValue={0} format={ev} disabled={disabled}
          onChange={(v) => set('Exposure', { exposure: v })} />
        <Slider label="Contrast" {...guide('contrast')} value={s.contrast} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={disabled}
          onChange={(v) => set('Contrast', { contrast: v })} />
        <Slider label="Highlights" {...guide('highlights')} value={s.highlights} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={disabled}
          onChange={(v) => set('Highlights', { highlights: v })} />
        <Slider label="Shadows" {...guide('shadows')} value={s.shadows} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={disabled}
          onChange={(v) => set('Shadows', { shadows: v })} />
        <Slider label="Whites" {...guide('whites')} value={s.whites} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={disabled}
          onChange={(v) => set('Whites', { whites: v })} />
        <Slider label="Blacks" {...guide('blacks')} value={s.blacks} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={disabled}
          onChange={(v) => set('Blacks', { blacks: v })} />
      </section>

      <section>
        <h3>Presence</h3>
        <Slider label="Vibrance" {...guide('vibrance')} value={s.vibrance} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={disabled}
          onChange={(v) => set('Vibrance', { vibrance: v })} />
        <Slider label="Saturation" {...guide('saturation')} value={s.saturation} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={disabled}
          onChange={(v) => set('Saturation', { saturation: v })} />
        <p className="muted small">Texture, Clarity and Dehaze arrive with the local-contrast modules (Phase 3).</p>
      </section>

      <section className="advanced">
        <button className="adv-toggle" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
          {advanced ? '▾' : '▸'} Advanced (darktable modules)
        </button>
        {advanced && (
          <div className="adv-body">
            <p className="muted small">
              The sliders above drive these darktable modules. Change them for finer control; double-click any slider to reset it.
            </p>
            <h4>exposure</h4>
            <Slider label="Base exposure" value={s.advanced.baseExposure} min={-2} max={3} step={0.05}
              defaultValue={defaults.advanced.baseExposure} format={ev} disabled={disabled}
              onChange={(v) => setAdv('Base exposure', { baseExposure: v })} />
            <h4>sigmoid</h4>
            <Slider label="Skew" value={s.advanced.skew} min={-1} max={1} step={0.01}
              defaultValue={defaults.advanced.skew} disabled={disabled}
              onChange={(v) => setAdv('Sigmoid skew', { skew: v })} />
            <Slider label="Target white" value={s.advanced.whiteTarget} min={20} max={200} step={1}
              defaultValue={defaults.advanced.whiteTarget} format={(v) => `${v.toFixed(0)} %`} disabled={disabled}
              onChange={(v) => setAdv('Sigmoid target white', { whiteTarget: v })} />
            <Slider label="Target black" value={s.advanced.blackTarget} min={0} max={2} step={0.0001}
              defaultValue={defaults.advanced.blackTarget} format={(v) => `${v.toFixed(4)} %`} disabled={disabled}
              onChange={(v) => setAdv('Sigmoid target black', { blackTarget: v })} />
            <Slider label="Preserve hue" value={s.advanced.huePreservation} min={0} max={100} step={1}
              defaultValue={defaults.advanced.huePreservation} format={(v) => `${v.toFixed(0)} %`} disabled={disabled}
              onChange={(v) => setAdv('Sigmoid hue preservation', { huePreservation: v })} />
            {kind === 'raw' ? (
              <>
                <h4>highlight reconstruction</h4>
                <label className="adv-row">
                  Method
                  <select value={s.advanced.highlightReconstruction ? 'opposed' : 'clip'} disabled={disabled}
                    onChange={(e) => setAdv('Highlight method', { highlightReconstruction: e.target.value === 'opposed' })}>
                    <option value="opposed">inpaint opposed</option>
                    <option value="clip">clip highlights</option>
                  </select>
                </label>
                <Slider label="Clipping threshold" value={s.advanced.highlightClip} min={0.5} max={1.5} step={0.005}
                  defaultValue={defaults.advanced.highlightClip} format={(v) => v.toFixed(3)} disabled={disabled}
                  onChange={(v) => setAdv('Highlight clipping threshold', { highlightClip: v })} />
                <h4>demosaic</h4>
                {layout === 'linear' ? (
                  <p className="muted small">Linear DNG: the file is already demosaiced (three colours per pixel).</p>
                ) : (
                  <label className="adv-row">
                    Method
                    {/* The stored value names the Bayer method; an X-Trans photo uses darktable's X-Trans counterpart. */}
                    <select value={s.advanced.demosaic} disabled={disabled}
                      onChange={(e) => setAdv('Demosaic', { demosaic: e.target.value as 'rcd' | 'bilinear' })}>
                      <option value="rcd">{layout === 'xtrans' ? 'Markesteijn 1-pass' : 'RCD'}</option>
                      <option value="bilinear">{layout === 'xtrans' ? 'linear (fast preview)' : 'bilinear (fast preview)'}</option>
                    </select>
                  </label>
                )}
              </>
            ) : (
              <p className="muted small">
                JPEG: highlight reconstruction and demosaic only apply to RAW files. LightBench reads the photo through its
                colour profile and undoes the default tone curve, so an unedited JPEG looks exactly as shot.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

