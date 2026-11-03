// The Lens Blur group (docs/PHASE3.md Part 32): Apply, then Blur amount, the focus (a click on the photo or the Focus
// distance slider: one distance, never a range), Blur in front, Highlight boost, Keep noise, Keep sharp (one of the
// photo's masks, laid over after the blur), the optional AI fill behind near edges and the depth view. The maths:
// engine/develop/lens-blur.ts.

import { depthFromDistance, focusDistance, type LensBlurSettings } from '../engine/develop/lens-blur'
import type { LocalMask } from '../engine/develop/masks'
import { HELP, LENS_BLUR_TIPS as TIP } from './help'
import { Slider } from './Slider'

interface Props {
  lb: LensBlurSettings | undefined
  masks: LocalMask[] | undefined
  disabled: boolean
  showHint: boolean
  /** Picking the focus on the photo. */
  picking: boolean
  onPick: (on: boolean) => void
  depthView: boolean
  onDepthView: (on: boolean) => void
  /** Turning Lens Blur on (computes the depth the first time). */
  onApply: () => void
  onChange: (label: string, lb: LensBlurSettings | undefined) => void
  /** What the depth model or the AI fill is doing, and why they can't. */
  status: string | null
  error: string | null
  fill: { busy: { text: string; fraction?: number } | null; error: string | null; onMake: () => void; onCancel: () => void }
}

const int = (v: number) => String(Math.round(v))
const pct = (v: number) => `${Math.round(v)} %`

export function LensBlurPanel({ lb, masks, disabled, showHint, picking, onPick, depthView, onDepthView, onApply, onChange, status, error, fill }: Props) {
  const guide = (key: string) => ({ help: HELP[key], showHint })
  const set = (label: string, patch: Partial<LensBlurSettings>) => lb && onChange(`Lens Blur: ${label}`, { ...lb, ...patch })
  const off = disabled || !lb || !lb.on
  const keepId = lb?.keepSharp?.maskId ?? ''
  const keepGone = !!keepId && !masks?.some((m) => m.id === keepId)
  return (
    <div className="dpanel lens-blur-panel">
      <section>
        <div className="dpanel-head">
          <h3>Lens Blur</h3>
          {lb && (
            <button className="button small" disabled={disabled || !!fill.busy} onClick={() => onChange('Reset Lens Blur', undefined)} title={TIP.reset}>
              Reset
            </button>
          )}
        </div>
        {!lb ? (
          <button className="button small touch" disabled={disabled || !!status} onClick={onApply} title={TIP.apply}>
            Apply Lens Blur
          </button>
        ) : (
          <>
            <label className="check small" title={TIP.on}>
              <input type="checkbox" checked={lb.on} disabled={disabled} onChange={(e) => set(e.target.checked ? 'on' : 'off', { on: e.target.checked })} /> Apply
            </label>
            {!lb.depth && <p className="small crop-note" role="status">This photo has no depth yet: <button className="linklike" disabled={disabled || !!status} onClick={onApply}>Compute it</button>.</p>}
            <Slider label="Blur amount" value={lb.amount} min={0} max={100} step={1} defaultValue={50} format={int} disabled={off} {...guide('lensBlurAmount')} onChange={(x) => set('Blur amount', { amount: x })} />
            <div className="adv-row">
              <button className={`button small touch ${picking ? 'on' : ''}`} disabled={off || !lb.depth} onClick={() => onPick(!picking)} title={TIP.pick} aria-pressed={picking}>
                Pick focus…
              </button>
            </div>
            {picking && <p className="small crop-note" role="status">Click on the photo where it should be sharp. <button className="linklike" onClick={() => onPick(false)} title="Stop picking the focus (Esc)">Done</button></p>}
            <Slider label="Focus distance" value={focusDistance(lb.focus.depth)} min={0} max={100} step={0.5} defaultValue={focusDistance(lb.focus.depth)} format={(v) => v.toFixed(1)} disabled={off} {...guide('lensBlurFocus')} onChange={(x) => set('Focus distance', { focus: { ...lb.focus, depth: Math.round(depthFromDistance(x) * 100) / 100 } })} />
            <Slider label="Blur in front" value={lb.front} min={0} max={100} step={1} defaultValue={100} format={pct} disabled={off} {...guide('lensBlurFront')} onChange={(x) => set('Blur in front', { front: x })} />
            <Slider label="Highlight boost" value={lb.boost} min={0} max={100} step={1} defaultValue={0} format={int} disabled={off} {...guide('lensBlurBoost')} onChange={(x) => set('Highlight boost', { boost: x })} />
            <label className="check small" title={TIP.noise}>
              <input type="checkbox" checked={lb.noise.keep} disabled={off} onChange={(e) => set('Keep noise', { noise: { ...lb.noise, keep: e.target.checked } })} /> Keep noise
            </label>
            <label className="adv-row" title={TIP.keepSharp}>
              Keep sharp
              <select value={keepGone ? '' : keepId} disabled={off} aria-label="Keep sharp" onChange={(e) => set('Keep sharp', { keepSharp: e.target.value ? { maskId: e.target.value } : undefined })}>
                <option value="">None</option>
                {(masks ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="check small" title={TIP.aiFill}>
              <input type="checkbox" checked={lb.aiFill} disabled={off || !!fill.busy} onChange={(e) => (e.target.checked && !lb.plate ? fill.onMake() : set('AI fill', { aiFill: e.target.checked }))} /> Fill behind edges (AI)
            </label>
            {fill.busy ? (
              <div className="small" role="status">
                {fill.busy.text}
                {fill.busy.fraction !== undefined && <progress max={1} value={fill.busy.fraction} />}{' '}
                <button className="linklike" onClick={fill.onCancel} title="Stop the AI fill (nothing is changed)">Cancel</button>
              </div>
            ) : lb.aiFill && lb.plate ? (
              <button className="linklike small" disabled={off} onClick={fill.onMake} title={TIP.aiFillAgain}>Draw the fill again</button>
            ) : null}
            {fill.error && <p className="small crop-note" role="alert">{fill.error}</p>}
            <label className="check small" title={TIP.depth}>
              <input type="checkbox" checked={depthView} disabled={off || !lb.depth} onChange={(e) => onDepthView(e.target.checked)} /> Show depth
            </label>
          </>
        )}
        {status && <p className="small crop-note" role="status">{status}</p>}
        {error && <p className="small crop-note" role="alert">{error}</p>}
      </section>
    </div>
  )
}
