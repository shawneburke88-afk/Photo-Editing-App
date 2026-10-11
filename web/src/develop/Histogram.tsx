import { useEffect, useRef, useState } from 'react'
import {
  CLIP_MODE_LABELS,
  DEFAULT_CLIP,
  DEFAULT_RAW_CLIP,
  RAW_MODE_LABELS,
  SCHEME_LABELS,
  type ClipMode,
  type ClipSettings,
  type RawClipColour,
  type RawClipMode,
  type RawClipSettings,
} from '../engine/develop/indicators'
import type { ImageStats } from '../engine/gpu/develop-engine'
import { Slider } from './Slider'

interface Props {
  stats: ImageStats | null
  info: string
  /** Display clipping overlay on the photo (J / O). */
  overlay: boolean
  onToggleOverlay: () => void
  /** Sensor clipping overlay (Shift+O). */
  rawOverlay: boolean
  onToggleRawOverlay: () => void
  clip: ClipSettings
  onClip: (c: ClipSettings) => void
  rawClip: RawClipSettings
  onRawClip: (c: RawClipSettings) => void
  /** Logarithmic count axis (darktable's default) or linear. */
  log: boolean
  onLog: (log: boolean) => void
}

/** Fraction of pixels above which a clipping triangle lights up. */
const CLIP_WARN = 0.0005

// darktable data/themes/darktable.css: graph_red / graph_green / graph_blue.
const CHANNEL_COLOURS = ['rgb(237, 30, 20)', 'rgb(28, 235, 26)', 'rgb(14, 14, 233)']

/**
 * RGB histogram drawn as darktable draws it (src/libs/scopes/histogram.c): 256 bins per channel,
 * each channel filled and added together, the sum painted at 50 % opacity; the count axis is
 * logarithmic by default, scaled to the tallest bin excluding bin 0, with 10 px headroom.
 * The clipping triangles are LightBench's addition (Lightroom-style).
 */
export function Histogram(p: Props) {
  const { stats, log } = p
  const ref = useRef<HTMLCanvasElement>(null)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#16171a'
      ctx.fillRect(0, 0, w, h)
      // darktable: 4×4 grid
      ctx.strokeStyle = '#2b2e34'
      ctx.lineWidth = 1
      for (let i = 1; i < 4; i++) {
        const x = Math.round((w * i) / 4) + 0.5
        const y = Math.round((h * i) / 4) + 0.5
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }
      if (!stats || !stats.pixels) return
      const channels = [stats.red, stats.green, stats.blue]
      // darktable common/histogram.c: the maximum skips bin 0.
      let max = 1
      for (const c of channels) for (let i = 1; i < 256; i++) max = Math.max(max, c[i])
      const scale = (v: number) => (log ? Math.log1p(v) / Math.log1p(max) : v / max)
      const head = 10 * dpr
      const layer = new OffscreenCanvas(w, h)
      const lc = layer.getContext('2d')!
      lc.globalCompositeOperation = 'lighter'
      channels.forEach((c, ch) => {
        lc.fillStyle = CHANNEL_COLOURS[ch]
        lc.beginPath()
        lc.moveTo(0, h)
        for (let i = 0; i < 256; i++) lc.lineTo((i / 255) * w, h - Math.min(1, scale(c[i])) * (h - head))
        lc.lineTo(w, h)
        lc.closePath()
        lc.fill()
      })
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.5
      ctx.drawImage(layer, 0, 0)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [stats, log])

  const shadowFrac = stats && stats.pixels ? stats.shadowClipped / stats.pixels : 0
  const highFrac = stats && stats.pixels ? stats.highlightClipped / stats.pixels : 0
  const pct = (f: number) => (f >= 0.001 ? `${(f * 100).toFixed(1)} %` : f > 0 ? '< 0.1 %' : 'none')
  const c = p.clip
  const r = p.rawClip

  return (
    <div className="histogram">
      <div className="histo-stage">
        <canvas ref={ref} className="histo-canvas" aria-label="Histogram" role="img" />
        <button
          className={`clip-tri shadow ${shadowFrac > CLIP_WARN ? 'warn' : ''} ${p.overlay ? 'on' : ''}`}
          title={`Shadow clipping: ${pct(shadowFrac)}. Click or press J to show clipped areas.`}
          aria-label="Show shadow clipping"
          aria-pressed={p.overlay}
          onClick={p.onToggleOverlay}
        />
        <button
          className={`clip-tri highlight ${highFrac > CLIP_WARN ? 'warn' : ''} ${p.overlay ? 'on' : ''}`}
          title={`Highlight clipping: ${pct(highFrac)}. Click or press J to show clipped areas.`}
          aria-label="Show highlight clipping"
          aria-pressed={p.overlay}
          onClick={p.onToggleOverlay}
        />
        <button className="histo-menu-btn" title="Histogram and clipping options" aria-label="Histogram and clipping options" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          ⋯
        </button>
      </div>
      <div className="histo-info">{p.info}</div>

      {menu && (
        <div className="histo-menu" role="dialog" aria-label="Histogram and clipping options">
          <div className="histo-menu-head">
            <strong>Histogram</strong>
            <button className="button small" onClick={() => setMenu(false)}>Close</button>
          </div>
          <label className="adv-row">
            Scale
            <select value={log ? 'log' : 'linear'} onChange={(e) => p.onLog(e.target.value === 'log')}>
              <option value="log">Logarithmic</option>
              <option value="linear">Linear</option>
            </select>
          </label>

          <h4>
            <label><input type="checkbox" checked={p.overlay} onChange={p.onToggleOverlay} /> Clipping on the photo (J or O)</label>
          </h4>
          <p className="muted small">Marks areas that are pure white or black on screen, like darktable’s clipping indicator.</p>
          <label className="adv-row">
            Check
            <select value={c.mode} onChange={(e) => p.onClip({ ...c, mode: e.target.value as ClipMode })}>
              {(Object.keys(CLIP_MODE_LABELS) as ClipMode[]).map((m) => <option key={m} value={m}>{CLIP_MODE_LABELS[m]}</option>)}
            </select>
          </label>
          <label className="adv-row">
            Colours
            <select value={c.scheme} onChange={(e) => p.onClip({ ...c, scheme: Number(e.target.value) as 0 | 1 | 2 })}>
              {SCHEME_LABELS.map((l, i) => <option key={l} value={i}>{l}</option>)}
            </select>
          </label>
          <Slider label="Upper threshold" value={c.upperPercent} min={0} max={100} step={0.01} defaultValue={DEFAULT_CLIP.upperPercent}
            format={(v) => `${v.toFixed(2)} %`} onChange={(v) => p.onClip({ ...c, upperPercent: v })} />
          <Slider label="Lower threshold" value={c.lowerEv} min={-32} max={-4} step={0.01} defaultValue={DEFAULT_CLIP.lowerEv}
            format={(v) => `${v.toFixed(2)} EV`} onChange={(v) => p.onClip({ ...c, lowerEv: v })} />

          <h4>
            <label><input type="checkbox" checked={p.rawOverlay} onChange={p.onToggleRawOverlay} /> Sensor clipping (Shift+O)</label>
          </h4>
          <p className="muted small">Marks pixels where the camera sensor itself was saturated. Editing can’t recover detail there.</p>
          <label className="adv-row">
            Show as
            <select value={r.mode} onChange={(e) => p.onRawClip({ ...r, mode: e.target.value as RawClipMode })}>
              {(Object.keys(RAW_MODE_LABELS) as RawClipMode[]).map((m) => <option key={m} value={m}>{RAW_MODE_LABELS[m]}</option>)}
            </select>
          </label>
          {r.mode === 'solid' && (
            <label className="adv-row">
              Colour
              <select value={r.colour} onChange={(e) => p.onRawClip({ ...r, colour: e.target.value as RawClipColour })}>
                <option value="red">Red</option>
                <option value="green">Green</option>
                <option value="blue">Blue</option>
                <option value="black">Black</option>
              </select>
            </label>
          )}
          <Slider label="Threshold" value={r.threshold} min={0} max={2} step={0.01} defaultValue={DEFAULT_RAW_CLIP.threshold}
            format={(v) => v.toFixed(2)} onChange={(v) => p.onRawClip({ ...r, threshold: v })} />

          <button className="button small" onClick={() => { p.onClip(DEFAULT_CLIP); p.onRawClip(DEFAULT_RAW_CLIP); p.onLog(true) }}>
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  )
}
