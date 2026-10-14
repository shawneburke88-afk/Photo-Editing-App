// The Tone Curve group (PHASE3.md Part 12; owner's decisions 2026-10-13, docs/research/TONE_CURVE.md §3): Regions
// (Lightroom's parametric curve, renamed) and point curves for RGB, Red, Green and Blue on one graph with the histogram
// of the curve's input behind it, Lightroom-style. The maths is in engine/develop/tone-curve.ts.
//
// Point curves: click to add a point (Ctrl-click: on the curve, without moving it), drag to move (Alt: onto the
// diagonal), drag off the graph or double-click to remove. Every point can be focused (Tab, or + and −) and moved
// with the arrow keys (Shift ×10, Alt ×1/10); Delete removes it, Enter adds one after it, Home puts it back on the
// diagonal. Regions: drag on the graph to move the region under the pointer, or use the sliders; the split points
// are the handles under the graph.

import { useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { ImageStats } from '../engine/gpu/develop-engine'
import {
  CURVE_NORMS,
  CURVE_PRESETS,
  curveFunction,
  DEFAULT_TONE_CURVE,
  encode,
  fixSplits,
  isLinear,
  LINEAR,
  MAX_POINTS,
  MIN_DX,
  normalizePoints,
  presetOf,
  REGION_NAMES,
  regionAt,
  regionPoints,
  regionsAreZero,
  type CurveChannel,
  type CurveNorm,
  type CurvePoint,
  type RegionKey,
  type ToneCurveSettings,
} from '../engine/develop/tone-curve'
import { CURVE_GUIDE, HELP } from './help'
import { Slider } from './Slider'
import { withKey } from '../settings/shortcuts'
import { SectionEyeRow } from './SectionEye'

export type CurveMode = 'regions' | 'point'
export interface CurveView {
  mode: CurveMode
  channel: CurveChannel
}

interface Props {
  /** The curve shown (a drag in progress included); undefined = untouched. */
  curve: ToneCurveSettings | undefined
  view: CurveView
  onView: (v: CurveView) => void
  disabled: boolean
  showHint: boolean
  /** Histogram of the curve's input for the graph shown (sRGB-encoded, as the main histogram's axis). */
  histogram: ImageStats | null
  /** The targeted adjustment tool is on. */
  tat: boolean
  onTat: () => void
  /** The tone under the pointer on the photo (targeted adjustment tool), on the shown graph's input axis. */
  hover: number | null
  /** Records a change; `separate`: its own history step even right after one of the same name (a drag's end). */
  onChange: (label: string, tc: ToneCurveSettings | undefined, separate?: boolean) => void
  /** Shows a curve while dragging (undefined: no curve); null ends the preview. */
  onDraft: (tc: ToneCurveSettings | undefined | null) => void
  /** Clipping shown on the photo while a drag pushes the curve to black or white. */
  onDragClip: (on: boolean) => void
  clipWhileDragging: boolean
  onClipWhileDragging: (on: boolean) => void
  /** The Auto row (PHASE3.md Part 21), under the presets. */
  auto?: ReactNode
}

const VIEWS: { id: string; label: string; view: CurveView; title: string; colour?: string }[] = [
  { id: 'regions', label: 'Regions', view: { mode: 'regions', channel: 'rgb' }, title: 'Regions: Highlights, Lights, Darks and Shadows sliders with movable split points (Lightroom’s parametric curve)' },
  { id: 'rgb', label: 'RGB', view: { mode: 'point', channel: 'rgb' }, title: 'Point curve for brightness (RGB)' },
  { id: 'red', label: 'R', view: { mode: 'point', channel: 'red' }, title: 'Red channel point curve', colour: '#e5675f' },
  { id: 'green', label: 'G', view: { mode: 'point', channel: 'green' }, title: 'Green channel point curve', colour: '#5fbf77' },
  { id: 'blue', label: 'B', view: { mode: 'point', channel: 'blue' }, title: 'Blue channel point curve', colour: '#6f8ff0' },
]
const CHANNEL_NAMES: Record<CurveChannel, string> = { rgb: 'RGB', red: 'Red', green: 'Green', blue: 'Blue' }
const CHANNEL_COLOURS: Record<CurveChannel, string> = { rgb: '#e6e6e6', red: '#e5675f', green: '#5fbf77', blue: '#6f8ff0' }
// darktable data/themes/darktable.css: graph_red / graph_green / graph_blue (as the main histogram).
const HIST_COLOURS = ['rgb(237, 30, 20)', 'rgb(28, 235, 26)', 'rgb(14, 14, 233)']

const SIZE = 256
/** How far outside the graph a dragged point is removed (px). */
const REMOVE_OUTSIDE = 24
const MID_GREY = encode(0.18)
const pct = (v: number) => `${(v * 100).toFixed(1)} %`
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round4 = (v: number) => Math.round(v * 10000) / 10000 + 0

function path(f: (x: number) => number, n = 128): string {
  let d = ''
  for (let i = 0; i <= n; i++) {
    const x = i / n
    d += `${i ? 'L' : 'M'}${(x * SIZE).toFixed(2)},${((1 - f(x)) * SIZE).toFixed(2)}`
  }
  return d
}

/** Runs of the curve stuck at pure white (or black) away from the ends, for the red (blue) clipping marks. */
function clipRuns(f: (x: number) => number, white: boolean): string {
  let d = ''
  let on = false
  const n = 128
  for (let i = 1; i < n; i++) {
    const x = i / n
    const y = f(x)
    const hit = white ? y >= 0.999 : y <= 0.001
    if (hit) {
      d += `${on ? 'L' : 'M'}${(x * SIZE).toFixed(2)},${((1 - y) * SIZE).toFixed(2)}`
      on = true
    } else {
      on = false
    }
  }
  return d
}

function histogramPaths(h: ImageStats | null, channel: CurveChannel): { d: string; colour: string }[] {
  if (!h || !h.pixels) return []
  const chans = channel === 'rgb' ? [h.red, h.green, h.blue] : [channel === 'red' ? h.red : channel === 'green' ? h.green : h.blue]
  let max = 1
  // Logarithmic, scaled to the tallest bin except the first and last (as the main histogram excludes bin 0).
  for (const c of chans) for (let i = 1; i < 255; i++) max = Math.max(max, c[i])
  const top = Math.log1p(max)
  return chans.map((c, k) => {
    let d = `M0,${SIZE}`
    for (let i = 0; i < 256; i++) d += `L${((i + 0.5) / 256) * SIZE},${(SIZE - (Math.min(1, Math.log1p(c[i]) / top) * SIZE * 0.92)).toFixed(2)}`
    d += `L${SIZE},${SIZE}Z`
    return { d, colour: channel === 'rgb' ? HIST_COLOURS[k] : HIST_COLOURS[['red', 'green', 'blue'].indexOf(channel)] }
  })
}

type Drag =
  | { kind: 'point'; index: number; start: ToneCurveSettings; added: boolean; outside: boolean; at: CurvePoint }
  | { kind: 'region'; key: RegionKey; start: ToneCurveSettings; y0: number; h: number }
  | { kind: 'split'; index: number; start: ToneCurveSettings; w: number; left: number }

export function ToneCurvePanel(p: Props) {
  const { view, disabled } = p
  const cur = p.curve ?? DEFAULT_TONE_CURVE
  const channel = view.mode === 'regions' ? 'rgb' : view.channel
  const pts = view.mode === 'point' ? cur[channel] : null
  const svg = useRef<SVGSVGElement>(null)
  const [selected, setSelected] = useState<{ channel: CurveChannel; index: number } | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [pointer, setPointer] = useState<[number, number] | null>(null)
  const [bandFor, setBandFor] = useState<RegionKey | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [announce, setAnnounce] = useState('')
  const live = useId()
  const sel = selected && selected.channel === channel && pts && selected.index < pts.length ? selected.index : null

  // What the graph draws: the point curve of the channel, or the Regions curve.
  const regionFn = useMemo(() => curveFunction(regionPoints(cur.regions)), [cur.regions])
  const shownFn = useMemo(() => (view.mode === 'regions' ? regionFn : curveFunction(cur[channel])), [view.mode, regionFn, cur, channel])
  const pointFn = useMemo(() => curveFunction(cur.rgb), [cur.rgb])
  const combined = channel === 'rgb' && !isLinear(cur.rgb) && !regionsAreZero(cur.regions)
  const ghostFn = useMemo(() => {
    if (!drag) return null
    const s = drag.start
    return view.mode === 'regions' ? curveFunction(regionPoints(s.regions)) : curveFunction(s[channel])
  }, [drag, view.mode, channel])
  const hist = useMemo(() => histogramPaths(p.histogram, channel), [p.histogram, channel])
  // In Regions the graph's input is the RGB point curve's output.
  const hoverX = p.hover === null ? null : view.mode === 'regions' ? pointFn(p.hover) : p.hover

  const setCurve = (patch: Partial<ToneCurveSettings>): ToneCurveSettings => ({ ...cur, ...patch })
  // The last curve shown while dragging (the props may not have caught up when the pointer is released).
  const lastDraft = useRef<ToneCurveSettings | null>(null)
  const draft = (tc: ToneCurveSettings) => {
    lastDraft.current = tc
    p.onDraft(tc)
  }
  const endDraft = (): ToneCurveSettings => {
    const final = lastDraft.current ?? p.curve ?? DEFAULT_TONE_CURVE
    lastDraft.current = null
    p.onDraft(null)
    return final
  }
  const commit = (label: string, tc: ToneCurveSettings | undefined, separate = false) => p.onChange(label, tc, separate)

  // ---- coordinates
  function toCurve(e: { clientX: number; clientY: number }): { x: number; y: number; out: number } {
    const r = svg.current!.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = 1 - (e.clientY - r.top) / r.height
    const out = Math.max(r.left - e.clientX, e.clientX - r.right, r.top - e.clientY, e.clientY - r.bottom, 0)
    return { x, y, out }
  }

  /** Points with one moved to (x, y), kept between its neighbours (the ends stay first and last). */
  function moved(list: readonly CurvePoint[], i: number, x: number, y: number): CurvePoint[] {
    const lo = i > 0 ? list[i - 1][0] + MIN_DX : 0
    const hi = i < list.length - 1 ? list[i + 1][0] - MIN_DX : 1
    const next = list.map((q) => [q[0], q[1]] as CurvePoint)
    next[i] = [round4(clamp(x, lo, hi)), round4(clamp(y, 0, 1))]
    return next
  }

  const describe = (list: readonly CurvePoint[], i: number) => `${CHANNEL_NAMES[channel]} point ${i + 1} of ${list.length}: input ${pct(list[i][0])}, output ${pct(list[i][1])}`

  function nearClip(list: readonly CurvePoint[], i: number) {
    const [x, y] = list[i]
    return y >= 0.97 || y <= 0.03 || i === 0 || i === list.length - 1 || x <= 0.03 || x >= 0.97
  }

  // ---- pointer
  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (disabled || e.button !== 0) return
    const { x, y } = toCurve(e)
    if (view.mode === 'regions') {
      const key = regionAt(clamp(x, 0, 0.9999), cur.regions.splits)
      const d: Drag = { kind: 'region', key, start: cur, y0: e.clientY, h: svg.current!.getBoundingClientRect().height }
      start(e, d)
      setBandFor(key)
      return
    }
    const list = pts!
    // A point near the pointer (within 8 px) is picked; otherwise one is added.
    const r = svg.current!.getBoundingClientRect()
    let best = -1
    let bestD = 8
    list.forEach((q, i) => {
      const dd = Math.hypot((q[0] - x) * r.width, (q[1] - y) * r.height)
      if (dd < bestD) {
        bestD = dd
        best = i
      }
    })
    if (best >= 0) {
      setSelected({ channel, index: best })
      start(e, { kind: 'point', index: best, start: cur, added: false, outside: false, at: list[best] })
      return
    }
    if (list.length >= MAX_POINTS) {
      setAnnounce(`A curve can have at most ${MAX_POINTS} points.`)
      return
    }
    const cx = clamp(x, 0, 1)
    if (list.some((q) => Math.abs(q[0] - cx) < MIN_DX)) return
    // Ctrl-click (⌘ on a Mac) adds a point on the curve without moving it (darktable, GIMP).
    const onCurve = e.ctrlKey || e.metaKey
    const at: CurvePoint = [round4(cx), round4(onCurve ? shownFn(cx) : clamp(y, 0, 1))]
    const next = normalizePoints([...list, at]) ?? list
    const index = next.findIndex((q) => q[0] === at[0])
    const tc = setCurve({ [channel]: next })
    setSelected({ channel, index })
    if (onCurve) {
      commit('Tone curve: add point', tc, true)
      setAnnounce(describe(next, index))
      return
    }
    draft(tc)
    start(e, { kind: 'point', index, start: cur, added: true, outside: false, at })
  }

  function start(e: ReactPointerEvent<Element>, d: Drag) {
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    e.preventDefault()
    dragRef.current = d
    setDrag(d)
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const c = toCurve(e)
    setPointer(c.out > 0 ? null : [clamp(c.x, 0, 1), clamp(c.y, 0, 1)])
    const d = dragRef.current
    if (!d) return
    if (d.kind === 'region') {
      const v = Math.round(clamp(d.start.regions[d.key] - ((e.clientY - d.y0) / d.h) * 200, -100, 100))
      draft({ ...d.start, regions: { ...d.start.regions, [d.key]: v } })
      p.onDragClip(true)
      return
    }
    if (d.kind !== 'point') return
    const base = d.start[channel]
    const list = d.added ? (normalizePoints([...base, d.at]) ?? base) : base
    const end = d.index === 0 || d.index === list.length - 1
    const outside = !end && c.out > REMOVE_OUTSIDE
    // Alt snaps the point onto the diagonal (its neutral place; Resolve's Option key).
    const y = e.altKey ? c.x : c.y
    let next = moved(list, d.index, c.x, y)
    if (outside) next = next.filter((_, i) => i !== d.index)
    const nd: Drag = { ...d, outside }
    dragRef.current = nd
    setDrag(nd)
    draft({ ...d.start, [channel]: next })
    p.onDragClip(!outside && nearClip(next, d.index))
  }

  function onPointerUp(e: ReactPointerEvent<SVGSVGElement>) {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    setDrag(null)
    p.onDragClip(false)
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
    const final = endDraft()
    if (d.kind === 'region') {
      setBandFor(null)
      if (final.regions[d.key] !== d.start.regions[d.key]) commit(`Tone curve: ${REGION_NAMES[d.key]}`, final, true)
      return
    }
    if (d.kind !== 'point') return
    if (d.outside) {
      setSelected(null)
      commit('Tone curve: remove point', final, true)
      setAnnounce(`Point removed from the ${CHANNEL_NAMES[channel]} curve.`)
      return
    }
    const list = final[channel]
    if (JSON.stringify(list) !== JSON.stringify(d.start[channel])) {
      commit(d.added ? 'Tone curve: add point' : 'Tone curve: move point', final, true)
      setAnnounce(describe(list, Math.min(d.index, list.length - 1)))
    }
  }

  function onDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (disabled || view.mode !== 'point') return
    const { x, y } = toCurve(e)
    const r = svg.current!.getBoundingClientRect()
    const list = pts!
    const i = list.findIndex((q) => Math.hypot((q[0] - x) * r.width, (q[1] - y) * r.height) < 8)
    if (i < 0) return
    removePoint(i)
  }

  function removePoint(i: number) {
    const list = pts!
    if (i === 0 || i === list.length - 1) {
      // The ends can't be removed: they go back to black and white.
      const next = moved(list, i, i === 0 ? 0 : 1, i === 0 ? 0 : 1)
      commit('Tone curve: reset end point', setCurve({ [channel]: next }), true)
      return
    }
    const next = list.filter((_, k) => k !== i)
    setSelected({ channel, index: i - 1 })
    commit('Tone curve: remove point', setCurve({ [channel]: next }), true)
    setAnnounce(`Point removed. ${describe(next, i - 1)}`)
  }

  // ---- keyboard on a point
  function onPointKey(e: ReactKeyboardEvent<SVGCircleElement>, i: number) {
    if (disabled || !pts) return
    const list = pts
    const step = e.shiftKey ? 0.05 : e.altKey ? 0.0005 : 0.005
    const focusPoint = (k: number) => {
      setSelected({ channel, index: k })
      requestAnimationFrame(() => svg.current?.querySelector<SVGCircleElement>(`[data-point="${k}"]`)?.focus())
    }
    let next: CurvePoint[] | null = null
    let label = 'Tone curve: point'
    switch (e.key) {
      case 'ArrowUp':
        next = moved(list, i, list[i][0], list[i][1] + step)
        break
      case 'ArrowDown':
        next = moved(list, i, list[i][0], list[i][1] - step)
        break
      case 'ArrowRight':
        next = moved(list, i, list[i][0] + step, list[i][1])
        break
      case 'ArrowLeft':
        next = moved(list, i, list[i][0] - step, list[i][1])
        break
      case 'Home':
        next = moved(list, i, list[i][0], list[i][0])
        label = 'Tone curve: point to the diagonal'
        break
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        e.stopPropagation()
        removePoint(i)
        if (i > 0 && i < list.length - 1) focusPoint(i - 1)
        return
      case 'Enter':
      case 'Insert': {
        e.preventDefault()
        e.stopPropagation()
        if (list.length >= MAX_POINTS || i === list.length - 1) return
        const x = round4((list[i][0] + list[i + 1][0]) / 2)
        if (x - list[i][0] < MIN_DX) return
        const added = normalizePoints([...list, [x, round4(shownFn(x))]]) ?? list
        commit('Tone curve: add point', setCurve({ [channel]: added }), true)
        focusPoint(i + 1)
        setAnnounce(describe(added, i + 1))
        return
      }
      case '+':
      case '=':
        e.preventDefault()
        e.stopPropagation()
        focusPoint(Math.min(list.length - 1, i + 1))
        return
      case '-':
        e.preventDefault()
        e.stopPropagation()
        focusPoint(Math.max(0, i - 1))
        return
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
    if (next && JSON.stringify(next) !== JSON.stringify(list)) {
      commit(label, setCurve({ [channel]: next }))
      setAnnounce(describe(next, i))
    }
  }

  // ---- splits under the graph
  function onSplitDown(e: ReactPointerEvent<HTMLDivElement>, index: number) {
    if (disabled) return
    const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    start(e, { kind: 'split', index, start: cur, w: r.width, left: r.left })
  }
  function onSplitMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d || d.kind !== 'split') return
    const v = clamp(((e.clientX - d.left) / d.w) * 100, 0, 100)
    const splits = [...d.start.regions.splits]
    splits[d.index] = Math.round(v)
    draft({ ...d.start, regions: { ...d.start.regions, splits: fixSplits(splits, d.index) } })
  }
  function onSplitUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d || d.kind !== 'split') return
    dragRef.current = null
    setDrag(null)
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
    const final = endDraft()
    if (JSON.stringify(final.regions.splits) !== JSON.stringify(d.start.regions.splits)) commit('Tone curve: split point', final, true)
  }
  function onSplitKey(e: ReactKeyboardEvent<HTMLDivElement>, index: number) {
    if (disabled) return
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
    const home = e.key === 'Home'
    if (!dir && !home) return
    e.preventDefault()
    e.stopPropagation()
    const splits = [...cur.regions.splits]
    splits[index] = home ? DEFAULT_TONE_CURVE.regions.splits[index] : splits[index] + dir * (e.shiftKey ? 5 : 1)
    commit('Tone curve: split point', setCurve({ regions: { ...cur.regions, splits: fixSplits(splits, index) } }))
  }

  // ---- numbers for the selected point
  function setNumber(axis: 0 | 1, text: string) {
    if (sel === null || !pts) return
    const v = Number(text)
    if (!Number.isFinite(v)) return
    const q = pts[sel]
    const next = moved(pts, sel, axis === 0 ? v / 100 : q[0], axis === 1 ? v / 100 : q[1])
    commit('Tone curve: point', setCurve({ [channel]: next }))
  }

  const presetId = pts ? presetOf(pts) : null
  const readout = (() => {
    const d = drag
    if (d?.kind === 'point' && pts && !d.outside) {
      const q = pts[Math.min(d.index, pts.length - 1)]
      return `Input ${pct(q[0])} · Output ${pct(q[1])}`
    }
    if (pointer) return `Input ${pct(pointer[0])} · Output ${pct(shownFn(pointer[0]))}`
    if (hoverX !== null) return `Photo: ${pct(hoverX)} → ${pct(shownFn(hoverX))}`
    if (sel !== null && pts) return `Point ${sel + 1}: input ${pct(pts[sel][0])} · output ${pct(pts[sel][1])}`
    return view.mode === 'regions' ? 'Drag on the graph to move a region' : 'Click to add a point · drag to move · drag off or double-click to remove'
  })()

  const band = (key: RegionKey | null) => {
    if (!key) return null
    const lo = curveFunction(regionPoints({ ...cur.regions, [key]: -100 }))
    const hi = curveFunction(regionPoints({ ...cur.regions, [key]: 100 }))
    let d = ''
    for (let i = 0; i <= 64; i++) d += `${i ? 'L' : 'M'}${((i / 64) * SIZE).toFixed(1)},${((1 - hi(i / 64)) * SIZE).toFixed(1)}`
    for (let i = 64; i >= 0; i--) d += `L${((i / 64) * SIZE).toFixed(1)},${((1 - lo(i / 64)) * SIZE).toFixed(1)}`
    return <path d={`${d}Z`} className="curve-band" />
  }

  const regionSlider = (key: RegionKey, helpKey: string) => (
    <div onMouseEnter={() => setBandFor(key)} onMouseLeave={() => setBandFor((k) => (drag?.kind === 'region' ? k : null))} onFocus={() => setBandFor(key)} onBlur={() => setBandFor(null)}>
      <Slider
        label={REGION_NAMES[key]}
        help={HELP[helpKey]}
        showHint={p.showHint}
        value={cur.regions[key]}
        min={-100}
        max={100}
        step={1}
        defaultValue={0}
        format={(v) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`)}
        disabled={disabled}
        onChange={(v) => commit(`Tone curve: ${REGION_NAMES[key]}`, setCurve({ regions: { ...cur.regions, [key]: v } }))}
      />
    </div>
  )

  const viewId = view.mode === 'regions' ? 'regions' : view.channel

  return (
    <div className="dpanel curve-panel">
      <section>
        {p.showHint && (
          <p className="small muted curve-guide" title={`${CURVE_GUIDE.what}\n\n${CURVE_GUIDE.order}\n\n${CURVE_GUIDE.pitfalls}`}>
            {CURVE_GUIDE.hint}. <span className="curve-guide-order">Basic first; the curve last.</span>
          </p>
        )}
        <div className="curve-bar">
          <div className="seg curve-views" role="tablist" aria-label="Curve">
            {VIEWS.map((v) => {
              const edited = v.id === 'regions' ? !regionsAreZero(cur.regions) : !isLinear(cur[v.view.channel])
              return (
                <button
                  key={v.id}
                  role="tab"
                  aria-selected={viewId === v.id}
                  className={viewId === v.id ? 'on' : ''}
                  title={v.title}
                  disabled={disabled}
                  onClick={() => p.onView(v.view)}
                >
                  {v.colour && <span className="curve-dot" style={{ background: v.colour }} aria-hidden="true" />}
                  {v.label}
                  {edited && <span className="curve-edited" aria-label="(changed)">•</span>}
                </button>
              )
            })}
          </div>
          <button
            className={`button small curve-tat ${p.tat ? 'on' : ''}`}
            aria-pressed={p.tat}
            disabled={disabled}
            onClick={p.onTat}
            aria-label="Targeted adjustment"
            title={withKey(`Targeted adjustment: drag up or down on the photo to brighten or darken the tones under the pointer (${view.mode === 'regions' ? 'moves their region' : 'adds a point'}); ↑ ↓ while hovering nudge them; Esc ends`, 'develop.curveTarget')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="8" cy="8" r="1.6" fill="currentColor" />
              <path stroke="currentColor" strokeWidth="1.4" d="M8 0.5v3M8 12.5v3M0.5 8h3M12.5 8h3" />
            </svg>
          </button>
        </div>
        <SectionEyeRow ids={['curve.regions', 'curve.rgb', 'curve.red', 'curve.green', 'curve.blue']} label="Tone curve section eyes" />
        <div className={`curve-graph ${view.mode}`}>
          <svg
            ref={svg}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            preserveAspectRatio="none"
            role="group"
            aria-label={view.mode === 'regions' ? 'Regions curve: drag up or down on a region' : `${CHANNEL_NAMES[channel]} point curve`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setPointer(null)}
            onDoubleClick={onDoubleClick}
            data-disabled={disabled || undefined}
          >
            <rect width={SIZE} height={SIZE} className="curve-bg" />
            {hist.map((h, i) => (
              <path key={i} d={h.d} fill={h.colour} className="curve-hist" />
            ))}
            {[1, 2, 3].map((i) => (
              <g key={i} className="curve-grid">
                <line x1={(i * SIZE) / 4} y1={0} x2={(i * SIZE) / 4} y2={SIZE} />
                <line x1={0} y1={(i * SIZE) / 4} x2={SIZE} y2={(i * SIZE) / 4} />
              </g>
            ))}
            {view.mode === 'regions' &&
              cur.regions.splits.map((s, i) => <line key={i} className="curve-split-line" x1={(s / 100) * SIZE} x2={(s / 100) * SIZE} y1={0} y2={SIZE} />)}
            <line className="curve-mid" x1={MID_GREY * SIZE} x2={MID_GREY * SIZE} y1={SIZE - 7} y2={SIZE}>
              <title>Middle grey (18 %)</title>
            </line>
            <line className="curve-base" x1={0} y1={SIZE} x2={SIZE} y2={0} />
            {view.mode === 'regions' && band(bandFor)}
            {channel === 'rgb' &&
              (['red', 'green', 'blue'] as const)
                .filter((c) => !isLinear(cur[c]))
                .map((c) => <path key={c} d={path(curveFunction(cur[c]), 64)} className="curve-overlay" stroke={CHANNEL_COLOURS[c]} />)}
            {combined && <path d={path((x) => (view.mode === 'regions' ? regionFn(x) : regionFn(pointFn(x))), 96)} className="curve-combined" />}
            {ghostFn && <path d={path(ghostFn, 96)} className="curve-ghost" />}
            <path d={path(shownFn)} className="curve-line" stroke={CHANNEL_COLOURS[channel]} />
            <path d={clipRuns(shownFn, true)} className="curve-clip white" />
            <path d={clipRuns(shownFn, false)} className="curve-clip black" />
            {hoverX !== null && (
              <g className="curve-hover">
                <line x1={hoverX * SIZE} x2={hoverX * SIZE} y1={0} y2={SIZE} />
                <circle cx={hoverX * SIZE} cy={(1 - shownFn(hoverX)) * SIZE} r={4.5} />
              </g>
            )}
            {pts &&
              pts.map((q, i) => {
                const hidden = drag?.kind === 'point' && drag.outside && i === drag.index
                return (
                  <circle
                    key={`${i}-${pts.length}`}
                    data-point={i}
                    cx={q[0] * SIZE}
                    cy={(1 - q[1]) * SIZE}
                    r={i === sel ? 5 : 4}
                    className={`curve-point ${i === sel ? 'on' : ''} ${hidden ? 'removing' : ''}`}
                    tabIndex={disabled ? -1 : 0}
                    role="slider"
                    aria-label={`${CHANNEL_NAMES[channel]} point ${i + 1} of ${pts.length}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(q[1] * 1000) / 10}
                    aria-valuetext={`input ${pct(q[0])}, output ${pct(q[1])}`}
                    onFocus={() => setSelected({ channel, index: i })}
                    onKeyDown={(e) => onPointKey(e, i)}
                  />
                )
              })}
          </svg>
          {view.mode === 'regions' && (
            <div className="curve-splits" onPointerMove={onSplitMove} onPointerUp={onSplitUp} onPointerCancel={onSplitUp}>
              {cur.regions.splits.map((s, i) => (
                <div
                  key={i}
                  className="curve-split"
                  style={{ left: `${s}%` }}
                  role="slider"
                  tabIndex={disabled ? -1 : 0}
                  aria-label={['Split between Shadows and Darks', 'Split between Darks and Lights', 'Split between Lights and Highlights'][i]}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={s}
                  title={`${['Shadows | Darks', 'Darks | Lights', 'Lights | Highlights'][i]} split: ${s} % · drag or use the arrow keys · Home resets · double-click resets`}
                  onPointerDown={(e) => onSplitDown(e, i)}
                  onKeyDown={(e) => onSplitKey(e, i)}
                  onDoubleClick={() => {
                    const splits = [...cur.regions.splits]
                    splits[i] = DEFAULT_TONE_CURVE.regions.splits[i]
                    commit('Tone curve: split point', setCurve({ regions: { ...cur.regions, splits: fixSplits(splits, i) } }))
                  }}
                />
              ))}
            </div>
          )}
        </div>
        <p className="curve-readout small muted" aria-hidden="true">{readout}</p>
        <div className="visually-hidden" id={live} aria-live="polite">{announce}</div>

        {view.mode === 'regions' ? (
          <div className="curve-regions">
            {regionSlider('highlights', 'curveHighlights')}
            {regionSlider('lights', 'curveLights')}
            {regionSlider('darks', 'curveDarks')}
            {regionSlider('shadows', 'curveShadows')}
          </div>
        ) : (
          <div className="curve-point-tools">
            <label className="curve-preset">
              <span className="small muted">Curve</span>
              <select
                value={presetId ?? 'custom'}
                disabled={disabled}
                aria-label={`${CHANNEL_NAMES[channel]} curve preset`}
                onChange={(e) => {
                  const pr = CURVE_PRESETS.find((x) => x.id === e.target.value)
                  if (pr) {
                    setSelected(null)
                    commit(`Tone curve: ${pr.name}`, setCurve({ [channel]: pr.points }), true)
                  }
                }}
              >
                {CURVE_PRESETS.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
                {!presetId && <option value="custom">Custom</option>}
              </select>
            </label>
            <div className="curve-numbers" aria-label="Selected point">
              <label>
                <span className="small muted">Input</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  disabled={disabled || sel === null}
                  value={sel !== null && pts ? Math.round(pts[sel][0] * 1000) / 10 : ''}
                  onChange={(e) => setNumber(0, e.target.value)}
                />
              </label>
              <label>
                <span className="small muted">Output</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  disabled={disabled || sel === null}
                  value={sel !== null && pts ? Math.round(pts[sel][1] * 1000) / 10 : ''}
                  onChange={(e) => setNumber(1, e.target.value)}
                />
              </label>
            </div>
          </div>
        )}
        {p.auto}

        <Slider
          label="Refine Saturation"
          help={HELP.curveRefineSaturation}
          showHint={p.showHint}
          value={cur.saturation}
          min={0}
          max={100}
          step={1}
          defaultValue={100}
          format={(v) => `${Math.round(v)} %`}
          disabled={disabled}
          onChange={(v) => commit('Tone curve: Refine Saturation', setCurve({ saturation: v }))}
        />
        <div className="curve-foot">
          <button className="button small" disabled={disabled || !p.curve} onClick={() => { setSelected(null); commit('Reset tone curve', undefined, true) }} title="Reset the whole tone curve: Regions, the RGB, Red, Green and Blue curves, Refine Saturation and the brightness measure">
            Reset
          </button>
          {view.mode === 'point' && (
            <button
              className="button small"
              disabled={disabled || isLinear(cur[channel])}
              onClick={() => { setSelected(null); commit(`Tone curve: reset ${CHANNEL_NAMES[channel]}`, setCurve({ [channel]: LINEAR }), true) }}
              title={`Make the ${CHANNEL_NAMES[channel]} curve a straight line again`}
            >
              Reset {CHANNEL_NAMES[channel]}
            </button>
          )}
          <button className="adv-toggle curve-adv" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
            {advanced ? '▾' : '▸'} Advanced
          </button>
        </div>
        {advanced && (
          <div className="curve-advanced">
            <label className="curve-norm">
              <span className="small">Brightness measured as</span>
              <select
                value={cur.norm}
                disabled={disabled}
                onChange={(e) => commit('Tone curve: brightness measure', setCurve({ norm: e.target.value as CurveNorm }), true)}
                title={CURVE_NORMS.map((n) => `${n.label}: ${n.help}`).join('\n')}
              >
                {CURVE_NORMS.map((n) => (
                  <option key={n.id} value={n.id} title={n.help}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="small muted">{CURVE_NORMS.find((n) => n.id === cur.norm)?.help} How the RGB curve and Regions read a pixel’s brightness (darktable’s “preserve colors”).</p>
            <label className="check small">
              <input type="checkbox" checked={p.clipWhileDragging} onChange={(e) => p.onClipWhileDragging(e.target.checked)} />
              Show clipping on the photo while dragging the curve
            </label>
          </div>
        )}
      </section>
    </div>
  )
}
