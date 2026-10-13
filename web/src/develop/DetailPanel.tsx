// The Detail group (Phase 3, Part 13): Lightroom's Detail panel — Sharpening (Amount, Radius, Detail, Masking) on
// darktable's capture sharpening, and Noise Reduction (Luminance with Detail and Contrast, Color with Detail and
// Smoothness) on darktable's denoise (profiled) (engine/detail/settings.ts). Holding Alt (Option on a Mac) while dragging Masking shows the mask, as in
// Lightroom; "Show mask" does the same without a key (some Linux desktops take Alt-drag for moving windows).

import { useEffect, useRef, useState } from 'react'
import { DEFAULT_DETAIL, HIGH_ISO, type DetailSettings, type NoiseSettings, type SharpenSettings } from '../engine/detail/settings'
import type { RadiusChoice } from '../engine/detail/capture'
import type { NoiseProfileData, ProfileChoice } from '../engine/detail/noiseprofiles'
import type { SourceKind } from '../engine/develop/settings'
import { HELP } from './help'
import { Slider } from './Slider'

interface Props {
  detail: DetailSettings | undefined
  kind: SourceKind
  /** This photo's defaults (`defaultsFor`: a RAW's sharpening depends on its ISO; none for JPEGs). */
  defaults: DetailSettings | undefined
  disabled: boolean
  showHint: boolean
  /** The profile the last render used (null before noise reduction ran). */
  profile: ProfileChoice | null
  /** The radius the last capture sharpening used (null before it ran). */
  radius: RadiusChoice | null
  /** darktable's noise profiles: loaded, being downloaded, failed, or not asked for yet. */
  db: NoiseProfileData | 'loading' | 'failed' | null
  onLoadDb: () => void
  /** The view is zoomed out (fit): sharpening is judged at 100 %. */
  zoomedOut: boolean
  onChange: (label: string, detail: DetailSettings) => void
  /** Masking preview on or off (Alt-drag on Masking, or Show mask). */
  onMaskPreview: (on: boolean) => void
}

const int = (v: number) => String(Math.round(v))

function profileLine(p: ProfileChoice | null, kind: SourceKind, db: Props['db']): { text: string; warn?: boolean } {
  if (kind === 'rgb') return { text: 'JPEG: darktable’s generic noise profile (the camera’s profiles describe its RAW files).' }
  if (db === 'loading') return { text: 'Getting the noise profiles (darktable’s, once)…' }
  if (db === 'failed') return { text: 'The noise profiles couldn’t be downloaded; darktable’s generic profile is used for now.', warn: true }
  if (!p) return { text: 'Uses darktable’s noise profile for the camera and ISO.' }
  if (p.kind === 'found') return { text: `Noise profile: ${p.camera}, ISO ${p.iso} (darktable).` }
  if (p.kind === 'interpolated') return { text: `Noise profile: ${p.camera}, ISO ${p.iso}, between darktable’s profiled ISOs.` }
  switch (p.reason) {
    case 'camera':
      return { text: 'This camera isn’t in darktable’s noise profiles: its generic profile is used (it may need more or less strength).', warn: true }
    case 'iso':
      return { text: `ISO ${p.iso} is outside the ${p.camera} profiles (ISO ${p.range?.[0]}–${p.range?.[1]}): darktable’s generic profile is used, as darktable does.`, warn: true }
    default:
      return { text: 'darktable’s generic noise profile is used.' }
  }
}

function radiusLine(r: RadiusChoice | null): string {
  if (!r) return 'Measured from the photo when it is first sharpened.'
  switch (r.from) {
    case 'measured':
      return `Measured from the photo: ${r.sigma.toFixed(2)} px (darktable’s method, from the raw data).`
    case 'diffraction':
      return `Estimated from the aperture (f/${r.fNumber}) and pixel size: ${r.sigma.toFixed(2)} px. It couldn’t be measured from this photo.`
    case 'default':
      return `darktable’s default, ${r.sigma.toFixed(2)} px: it couldn’t be measured from this photo.`
    default:
      return ''
  }
}

export function DetailPanel({ detail, kind, defaults, disabled, showHint, profile, radius, db, onLoadDb, zoomedOut, onChange, onMaskPreview }: Props) {
  const d = detail ?? DEFAULT_DETAIL
  // The photo's defaults (RAW photos are sharpened by default; JPEGs aren't).
  const base = defaults ?? DEFAULT_DETAIL
  const setS = (label: string, patch: Partial<SharpenSettings>) => onChange(label, { ...d, sharpen: { ...d.sharpen, ...patch } })
  const setN = (label: string, patch: Partial<NoiseSettings>) => onChange(label, { ...d, noise: { ...d.noise, ...patch } })
  const guide = (key: string) => ({ help: HELP[key], showHint })

  // Masking preview: Alt held while the Masking slider is being dragged, or the Show mask box.
  const [dragging, setDragging] = useState(false)
  const [alt, setAlt] = useState(false)
  const [showMask, setShowMask] = useState(false)
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
    if (!dragging) return
    const end = () => setDragging(false)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragging])
  const preview = !disabled && (showMask || (dragging && alt))
  useEffect(() => {
    if (dragging && alt) draggedWithAlt.current = true
  }, [dragging, alt])
  useEffect(() => onMaskPreview(preview), [preview, onMaskPreview])
  useEffect(() => () => onMaskPreview(false), [onMaskPreview])

  const sharpOff = disabled || d.sharpen.amount === 0
  const line = profileLine(profile, kind, db)

  return (
    <div className="dpanel detail-panel">
      <section>
        <div className="dpanel-head">
          <h3>Sharpening</h3>
          <button className="button small" disabled={disabled || JSON.stringify(d.sharpen) === JSON.stringify(base.sharpen)} onClick={() => onChange('Reset Sharpening', { ...d, sharpen: base.sharpen })} title={kind === 'raw' ? `Sharpening back to this RAW photo's default: Amount ${base.sharpen.amount} (40, or 25 above ISO ${HIGH_ISO}), automatic radius, Detail 25, Masking 0` : 'Sharpening back to off (JPEGs are already sharpened by the camera)'}>
            Reset
          </button>
        </div>
        <Slider label="Amount" value={d.sharpen.amount} min={0} max={150} step={1} defaultValue={base.sharpen.amount} format={int} disabled={disabled} {...guide('sharpenAmount')} onChange={(v) => setS('Sharpening: Amount', { amount: v })} />
        <Slider
          label="Radius"
          value={d.sharpen.radiusAuto && radius ? radius.sigma : d.sharpen.radius}
          min={0.25}
          max={1.5}
          step={0.01}
          defaultValue={d.sharpen.radiusAuto && radius ? radius.sigma : DEFAULT_DETAIL.sharpen.radius}
          format={(v) => (d.sharpen.radiusAuto ? `Auto ${v.toFixed(2)}` : v.toFixed(2))}
          disabled={sharpOff}
          {...guide('sharpenRadius')}
          // Moving the slider sets the radius by hand; the Auto radius box goes back to the measured one.
          onChange={(v) => (d.sharpen.radiusAuto && radius && Math.abs(v - radius.sigma) < 1e-9 ? undefined : setS('Sharpening: Radius', { radius: v, radiusAuto: false }))}
        />
        <label className="detail-check" title="Measure the blur radius from the photo itself (darktable's automatic radius)">
          <input type="checkbox" checked={d.sharpen.radiusAuto} disabled={sharpOff} onChange={(e) => setS(e.target.checked ? 'Sharpening: Radius Auto' : 'Sharpening: Radius', { radiusAuto: e.target.checked, radius: radius && e.target.checked === false ? Math.round(radius.sigma * 100) / 100 : d.sharpen.radius })} /> Auto radius
        </label>
        {d.sharpen.radiusAuto && d.sharpen.amount > 0 && <p className="muted small detail-note detail-radius">{radiusLine(radius)}</p>}
        <Slider label="Detail" value={d.sharpen.detail} min={0} max={100} step={1} defaultValue={base.sharpen.detail} format={int} disabled={sharpOff} {...guide('sharpenDetail')} onChange={(v) => setS('Sharpening: Detail', { detail: v })} />
        <div
          className="detail-masking"
          onPointerDownCapture={(e) => {
            setDragging(true)
            if (e.altKey) setAlt(true)
          }}
        >
          <Slider label="Masking" value={d.sharpen.masking} min={0} max={100} step={1} defaultValue={base.sharpen.masking} format={int} disabled={sharpOff} {...guide('sharpenMasking')} onChange={(v) => setS('Sharpening: Masking', { masking: v })} />
        </div>
        <label className="detail-check" title="Shows where sharpening applies (white) and where Masking holds it back (black). Holding Alt (Option on a Mac) while dragging Masking does the same.">
          <input type="checkbox" checked={showMask} disabled={sharpOff} onChange={(e) => setShowMask(e.target.checked)} /> Show mask <span className="muted">(or Alt-drag Masking)</span>
        </label>
        {d.sharpen.amount > 0 && zoomedOut && <p className="muted small detail-note">Zoom to 100 % to judge sharpening: at this size most of it is finer than the screen’s pixels.</p>}
        {kind === 'raw' && d.sharpen.amount === 0 && <p className="muted small detail-note">New RAW photos are sharpened (Amount 40, or 25 above ISO {HIGH_ISO}). Photos edited before sharpening existed start with it off, so they look as they did.</p>}
      </section>
      <section>
        <div className="dpanel-head">
          <h3>Noise reduction</h3>
          <button className="button small" disabled={disabled || JSON.stringify(d.noise) === JSON.stringify(DEFAULT_DETAIL.noise)} onClick={() => onChange('Reset Noise reduction', { ...d, noise: DEFAULT_DETAIL.noise })} title="Noise reduction back to off, with Lightroom's default Detail, Contrast and Smoothness">
            Reset
          </button>
        </div>
        <Slider label="Luminance" value={d.noise.luminance} min={0} max={100} step={1} defaultValue={DEFAULT_DETAIL.noise.luminance} format={int} disabled={disabled} {...guide('noiseLuminance')} onChange={(v) => setN('Noise reduction: Luminance', { luminance: v })} />
        <Slider label="Detail" value={d.noise.luminanceDetail} min={0} max={100} step={1} defaultValue={DEFAULT_DETAIL.noise.luminanceDetail} format={int} disabled={disabled || d.noise.luminance === 0} {...guide('noiseLuminanceDetail')} onChange={(v) => setN('Noise reduction: Luminance Detail', { luminanceDetail: v })} />
        <Slider label="Contrast" value={d.noise.luminanceContrast} min={0} max={100} step={1} defaultValue={DEFAULT_DETAIL.noise.luminanceContrast} format={int} disabled={disabled || d.noise.luminance === 0} {...guide('noiseLuminanceContrast')} onChange={(v) => setN('Noise reduction: Luminance Contrast', { luminanceContrast: v })} />
        <Slider label="Color" value={d.noise.color} min={0} max={100} step={1} defaultValue={DEFAULT_DETAIL.noise.color} format={int} disabled={disabled} {...guide('noiseColor')} onChange={(v) => setN('Noise reduction: Color', { color: v })} />
        <Slider label="Detail" value={d.noise.colorDetail} min={0} max={100} step={1} defaultValue={DEFAULT_DETAIL.noise.colorDetail} format={int} disabled={disabled || d.noise.color === 0} {...guide('noiseColorDetail')} onChange={(v) => setN('Noise reduction: Color Detail', { colorDetail: v })} />
        <Slider label="Smoothness" value={d.noise.colorSmoothness} min={0} max={100} step={1} defaultValue={DEFAULT_DETAIL.noise.colorSmoothness} format={int} disabled={disabled || d.noise.color === 0} {...guide('noiseColorSmoothness')} onChange={(v) => setN('Noise reduction: Color Smoothness', { colorSmoothness: v })} />
        <p className={`small detail-note ${line.warn ? 'warn' : 'muted'}`} aria-live="polite">{line.text}</p>
        {db === 'failed' && kind === 'raw' && (
          <button className="button small" onClick={onLoadDb}>Try again</button>
        )}
      </section>
    </div>
  )
}
