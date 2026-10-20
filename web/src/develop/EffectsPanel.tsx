// The Effects group (PHASE3.md Part 25): Post-crop Vignette, Grain and Glow, each a section with its own eye (Part 21) and
// Reset; darktable's own settings under Advanced. Texture, Clarity and Dehaze live in Basic → Presence (USABILITY.md row 2;
// owner's decision T6). The maths and its sources: engine/develop/effects.ts.

import { openSections, useOpen } from './panelState'
import {
  DEFAULT_GLOW,
  DEFAULT_GRAIN,
  DEFAULT_VIGNETTE,
  GLOW_STYLES,
  VIGNETTE_STYLES,
  withGrain,
  type EffectsSettings,
  type GlowSettings,
  type GlowStyle,
  type GrainSettings,
  type VignetteSettings,
  type VignetteStyle,
} from '../engine/develop/effects'
import { HELP } from './help'
import { Slider } from './Slider'
import { SectionEye } from './SectionEye'

interface Props {
  effects: EffectsSettings | undefined
  disabled: boolean
  showHint: boolean
  onChange: (label: string, fx: EffectsSettings) => void
}

const int = (v: number) => String(Math.round(v))
const signed = (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`)

export function EffectsPanel({ effects, disabled, showHint, onChange }: Props) {
  const fx = effects ?? {}
  const v = fx.vignette ?? DEFAULT_VIGNETTE
  const g = fx.grain ?? DEFAULT_GRAIN
  const gl = fx.glow ?? DEFAULT_GLOW
  const [vigAdv, setVigAdv] = useOpen(openSections, 'effects.vignetteAdvanced')
  const [grainAdv, setGrainAdv] = useOpen(openSections, 'effects.grainAdvanced')
  const guide = (key: string) => ({ help: HELP[key], showHint })
  const setV = (label: string, patch: Partial<VignetteSettings>) => onChange(`Vignette: ${label}`, { ...fx, vignette: { ...v, ...patch } })
  // Grain that starts gets its own seed (a new pattern per photo; a virtual copy gets another).
  const setG = (label: string, patch: Partial<GrainSettings>) => onChange(`Grain: ${label}`, withGrain(fx, patch))
  const setGl = (label: string, patch: Partial<GlowSettings>) => onChange(`Glow: ${label}`, { ...fx, glow: { ...gl, ...patch } })
  const reset = (label: string, key: 'vignette' | 'grain' | 'glow') => {
    const next = { ...fx }
    delete next[key]
    onChange(label, next)
  }
  const vigOff = disabled || v.amount === 0
  const highlightsOff = vigOff || v.amount >= 0 || v.style === 'paint'

  return (
    <div className="dpanel effects-panel">
      <section>
        <div className="dpanel-head">
          <h3>Post-Crop Vignetting</h3>
          <SectionEye id="effects.vignette" />
          <button className="button small" disabled={disabled || !fx.vignette} onClick={() => reset('Reset vignette', 'vignette')} title="The vignette off, its sliders back to their defaults">
            Reset
          </button>
        </div>
        <label className="adv-row">
          Style
          <select value={v.style} disabled={disabled} onChange={(e) => setV('Style', { style: e.target.value as VignetteStyle })} aria-label="Vignette style"
            title="Highlight Priority darkens in scene light before the tone mapper, so bright areas roll off gently; Color Priority keeps colours as they are; Paint Overlay blends towards black or white.">
            {VIGNETTE_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <Slider label="Amount" value={v.amount} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={disabled} {...guide('vignetteAmount')} onChange={(x) => setV('Amount', { amount: x })} />
        <Slider label="Midpoint" value={v.midpoint} min={0} max={100} step={1} defaultValue={50} format={int} disabled={vigOff} {...guide('vignetteMidpoint')} onChange={(x) => setV('Midpoint', { midpoint: x })} />
        <Slider label="Roundness" value={v.roundness} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={vigOff} {...guide('vignetteRoundness')} onChange={(x) => setV('Roundness', { roundness: x })} />
        <Slider label="Feather" value={v.feather} min={0} max={100} step={1} defaultValue={50} format={int} disabled={vigOff} {...guide('vignetteFeather')} onChange={(x) => setV('Feather', { feather: x })} />
        <Slider label="Highlights" value={v.highlights} min={0} max={100} step={1} defaultValue={0} format={int} disabled={highlightsOff} {...guide('vignetteHighlights')} onChange={(x) => setV('Highlights', { highlights: x })} />
        <button className="adv-toggle" aria-expanded={vigAdv} onClick={() => setVigAdv((a) => !a)}>
          {vigAdv ? '▾' : '▸'} Advanced
        </button>
        {vigAdv && (
          <div className="adv-body">
            <Slider label="Horizontal centre" value={v.centerX} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={vigOff} {...guide('vignetteCenter')} onChange={(x) => setV('Horizontal centre', { centerX: x })} />
            <Slider label="Vertical centre" value={v.centerY} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={vigOff} {...guide('vignetteCenter')} onChange={(x) => setV('Vertical centre', { centerY: x })} />
            <Slider label="Shape" value={v.shape} min={0.1} max={5} step={0.05} defaultValue={1} format={(x) => x.toFixed(2)} disabled={vigOff} {...guide('vignetteShape')} onChange={(x) => setV('Shape', { shape: Math.round(x * 100) / 100 })} />
          </div>
        )}
      </section>

      <section>
        <div className="dpanel-head">
          <h3>Grain</h3>
          <SectionEye id="effects.grain" />
          <button className="button small" disabled={disabled || !fx.grain} onClick={() => reset('Reset grain', 'grain')} title="Grain off, its sliders back to their defaults">
            Reset
          </button>
        </div>
        <Slider label="Amount" value={g.amount} min={0} max={100} step={1} defaultValue={0} format={int} disabled={disabled} {...guide('grainAmount')} onChange={(x) => setG('Amount', { amount: x })} />
        <Slider label="Size" value={g.size} min={0} max={100} step={1} defaultValue={25} format={int} disabled={disabled || g.amount === 0} {...guide('grainSize')} onChange={(x) => setG('Size', { size: x })} />
        <Slider label="Roughness" value={g.roughness} min={0} max={100} step={1} defaultValue={50} format={int} disabled={disabled || g.amount === 0} {...guide('grainRoughness')} onChange={(x) => setG('Roughness', { roughness: x })} />
        <button className="adv-toggle" aria-expanded={grainAdv} onClick={() => setGrainAdv((a) => !a)}>
          {grainAdv ? '▾' : '▸'} Advanced
        </button>
        {grainAdv && (
          <div className="adv-body">
            <label className="check small" title={HELP.grainColour.what}>
              <input type="checkbox" checked={g.colour} disabled={disabled || g.amount === 0} onChange={(e) => setG('Colour grain', { colour: e.target.checked })} /> Colour grain (instead of monochrome)
            </label>
            <Slider label="Mid-tones bias" value={g.midtonesBias} min={0} max={100} step={1} defaultValue={100} format={int} disabled={disabled || g.amount === 0} {...guide('grainMidtones')} onChange={(x) => setG('Mid-tones bias', { midtonesBias: x })} />
          </div>
        )}
      </section>

      <section>
        <div className="dpanel-head">
          <h3>Glow</h3>
          <SectionEye id="effects.glow" />
          <button className="button small" disabled={disabled || !fx.glow} onClick={() => reset('Reset glow', 'glow')} title="Glow off, its sliders back to their defaults">
            Reset
          </button>
        </div>
        <label className="adv-row">
          Style
          <select value={gl.style} disabled={disabled} onChange={(e) => setGl('Style', { style: e.target.value as GlowStyle })} aria-label="Glow style"
            title="Bloom: a soft, even glow on the highlights. Diffusion: a hazy, film-like softening across the frame. Halation: a coloured halo around bright edges and lights.">
            {GLOW_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <Slider label="Glow" value={gl.amount} min={0} max={100} step={1} defaultValue={0} format={int} disabled={disabled} {...guide('glowAmount')} onChange={(x) => setGl('Amount', { amount: x })} />
        <Slider label="Range" value={gl.range} min={0} max={100} step={1} defaultValue={50} format={int} disabled={disabled} {...guide('glowRange')} onChange={(x) => setGl('Range', { range: x })} />
        <Slider label="Spread" value={gl.spread} min={0} max={100} step={1} defaultValue={50} format={int} disabled={disabled} {...guide('glowSpread')} onChange={(x) => setGl('Spread', { spread: x })} />
        <Slider label="Warmth" value={gl.warmth} min={-100} max={100} step={1} defaultValue={0} format={signed} disabled={disabled} {...guide('glowWarmth')} onChange={(x) => setGl('Warmth', { warmth: x })} />
      </section>
    </div>
  )
}
