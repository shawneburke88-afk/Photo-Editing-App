import { isSliderKey, isTextEntry } from '../lib/keys'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCatalog } from '../catalog/client'
import { forgetThumbUrl, loadThumb, saveThumb, thumbUrl } from '../catalog/thumbs'
import type { PhotoDetail } from '../catalog/types'
import type { Mat3, Vec3 } from '../engine/color/matrix'
import { multipliersToTemperature, temperatureToMultipliers } from '../engine/color/temperature'
import { BUILT_IN_TARGETS, metricsFromStats, solveAuto, statsFromPixels, targetFromMetrics, type AutoTarget } from '../engine/develop/auto'
import { DEFAULT_SETTINGS, displayUniforms, normalizeSettings, type DevelopSettings } from '../engine/develop/settings'
import { DevelopEngine, type ImageStats, type RawStageOptions, type ViewState } from '../engine/gpu/develop-engine'
import { RawDecoder } from '../engine/raw/decoder'
import { Thumb } from '../library/Thumb'
import { openPhotoFile } from '../platform/roots'
import { useStoredJson } from '../lib/useStoredJson'
import { useStoredNumber } from '../lib/useStoredNumber'
import { DEFAULT_CLIP, DEFAULT_RAW_CLIP, type Indicators } from '../engine/develop/indicators'
import { exposureText } from '../library/format'
import { BasicPanel } from './BasicPanel'
import { Histogram } from './Histogram'
import { ResizeHandle } from './ResizeHandle'
import { WbLoupe } from './WbLoupe'
import { canRedo, canUndo, current, jump, record, redo, startHistory, undo, type History } from './history'

interface Props {
  ids: number[]
  id: number
  onNavigate: (id: number) => void
  onEdited: () => void
}

interface SensorInfo {
  asShotWb: Vec3
  xyzToCam: Mat3
  asShot: { temperature: number; tint: number }
}

type Status = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string }

let decoder: RawDecoder | null = null

function multipliers(s: DevelopSettings, info: SensorInfo): Vec3 {
  return s.whiteBalance.mode === 'as-shot'
    ? info.asShotWb
    : temperatureToMultipliers(s.whiteBalance.temperature, s.whiteBalance.tint, info.xyzToCam)
}

function stageOptions(s: DevelopSettings, info: SensorInfo): RawStageOptions {
  return {
    wb: multipliers(s, info),
    highlightMode: s.advanced.highlightReconstruction ? 'opposed' : 'clip',
    highlightClip: s.advanced.highlightClip,
    demosaic: s.advanced.demosaic,
  }
}

const sameStage = (a: RawStageOptions | null, b: RawStageOptions) =>
  !!a && a.highlightMode === b.highlightMode && a.highlightClip === b.highlightClip && a.demosaic === b.demosaic &&
  a.wb.every((v, i) => Math.abs(v - b.wb[i]) < 1e-6)

/** Saved form of the history (timestamps are not stored). */
interface SavedHistory {
  steps: { label: string; settings: DevelopSettings }[]
  index: number
}

export function DevelopView({ ids, id, onNavigate, onEdited }: Props) {
  const catalog = getCatalog()
  const stageRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<DevelopEngine | null>(null)
  const [engineError, setEngineError] = useState('')
  const [photo, setPhoto] = useState<PhotoDetail | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [info, setInfo] = useState<SensorInfo | null>(null)
  const [history, setHistory] = useState<History | null>(null)
  const [view, setView] = useState<ViewState>({ zoom: 'fit', center: [0.5, 0.5] })
  const [before, setBefore] = useState(false)
  const [placeholder, setPlaceholder] = useState<string | null>(null)
  const [timing, setTiming] = useState<{ stage?: number; frame?: number }>({})
  const [stats, setStats] = useState<ImageStats | null>(null)
  const [overlay, setOverlay] = useState(false)
  const [rawOverlay, setRawOverlay] = useState(false)
  const [clipSettings, setClipSettings] = useStoredJson('lightbench.develop.clipping', DEFAULT_CLIP)
  const [rawClipSettings, setRawClipSettings] = useStoredJson('lightbench.develop.rawClipping', DEFAULT_RAW_CLIP)
  const [histLog, setHistLog] = useStoredNumber('lightbench.develop.histogramLog', 1)
  const [autoBusy, setAutoBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [wbPick, setWbPick] = useState(false)
  const [loupe, setLoupe] = useState<{ x: number; y: number; image: ImageData } | null>(null)
  const [savedTargets, setSavedTargets] = useState<AutoTarget[]>([])
  const [refTarget, setRefTarget] = useState<AutoTarget | null>(null)
  const [targetId, setTargetIdState] = useState(() => {
    try {
      return localStorage.getItem('lightbench.autoTarget') ?? 'natural'
    } catch {
      return 'natural'
    }
  })
  const setTargetId = (v: string) => {
    setTargetIdState(v)
    try {
      localStorage.setItem('lightbench.autoTarget', v)
    } catch {
      // not remembered this time
    }
  }
  const [leftW, setLeftW] = useStoredNumber('lightbench.develop.left', 240)
  const [rightW, setRightW] = useStoredNumber('lightbench.develop.right', 300)
  const [histH, setHistH] = useStoredNumber('lightbench.develop.histogram', 170)
  const builtStage = useRef<RawStageOptions | null>(null)
  const dirty = useRef(false)
  const loadToken = useRef(0)
  /** A save waiting for its debounce timer, and the save currently running. */
  const pendingSave = useRef<(() => Promise<void>) | null>(null)
  const saving = useRef<Promise<void> | null>(null)

  const settings = history ? current(history) : DEFAULT_SETTINGS

  // ---- engine lifetime
  useEffect(() => {
    let alive = true
    const forced = new URLSearchParams(location.search).get('gpu')
    DevelopEngine.create(forced === 'readback' || forced === 'canvas' ? forced : 'auto').then(
      (e) => {
        if (!alive) return e.destroy()
        engineRef.current = e
        stageRef.current?.prepend(e.canvas)
        setEngineError('')
      },
      (e: Error) => setEngineError(`Graphics acceleration is not available: ${e.message}`),
    )
    return () => {
      alive = false
      const e = engineRef.current
      engineRef.current = null
      // Let a final save (flushed by the cleanup below) finish rendering its thumbnail first.
      setTimeout(() => void (saving.current ?? Promise.resolve()).catch(() => {}).finally(() => e?.destroy()), 0)
    }
  }, [])

  // ---- saved Auto targets
  useEffect(() => {
    void catalog.listTargets().then((rows) =>
      setSavedTargets(
        rows.flatMap((r) => {
          try {
            return [{ ...(JSON.parse(r.target) as AutoTarget), id: `saved:${r.id}`, name: r.name, builtIn: false }]
          } catch {
            return []
          }
        }),
      ),
    )
  }, [catalog])

  // ---- load a photo
  useEffect(() => {
    const token = ++loadToken.current
    const stale = () => token !== loadToken.current
    setStatus({ kind: 'loading' })
    setHistory(null)
    setInfo(null)
    setView({ zoom: 'fit', center: [0.5, 0.5] })
    builtStage.current = null
    dirty.current = false
    void thumbUrl(id).then((u) => !stale() && setPlaceholder(u))
    ;(async () => {
      const d = await catalog.getPhoto(id)
      if (stale() || !d) return
      setPhoto(d)
      if (/^jpe?g$/i.test(d.fileType)) {
        throw new Error('Editing JPEG files arrives in the next update. RAW files can be edited now.')
      }
      const file = await openPhotoFile(d.rootId, d.folderPath, d.fileName)
      if (!file) throw new Error('This photo’s folder isn’t connected. Go to the Library and click “Reconnect”.')
      decoder ??= new RawDecoder()
      const r = await decoder.decode(file, true)
      if (stale()) return
      if (!r.sensor) throw new Error(r.sensorUnsupported ?? 'This RAW file can’t be developed yet.')
      for (let t = 0; !engineRef.current && t < 100; t++) await new Promise((res) => setTimeout(res, 50))
      const engine = engineRef.current
      if (!engine) throw new Error('Graphics acceleration is not available.')
      engine.loadSensor(r.sensor, r.info.flip)
      const xyzToCam = r.sensor.xyzToCam as Mat3
      const sensorInfo: SensorInfo = { asShotWb: r.sensor.wb, xyzToCam, asShot: multipliersToTemperature(r.sensor.wb, xyzToCam) }

      const saved = await catalog.getEdit(id)
      let h = startHistory(DEFAULT_SETTINGS)
      if (saved) {
        try {
          const sh = JSON.parse(saved.history) as SavedHistory
          const steps = sh.steps.map((st) => ({ label: st.label, settings: normalizeSettings(st.settings), at: 0 }))
          h = steps.length ? { steps, index: Math.min(sh.index, steps.length - 1) } : startHistory(normalizeSettings(JSON.parse(saved.settings)))
        } catch {
          h = startHistory(normalizeSettings(JSON.parse(saved.settings)))
        }
      }
      const opts = stageOptions(current(h), sensorInfo)
      const ms = await engine.process(opts)
      if (stale()) return
      builtStage.current = opts
      setTiming({ stage: ms })
      setInfo(sensorInfo)
      setHistory(h)
      setStatus({ kind: 'ready' })
    })().catch((e: Error) => !stale() && setStatus({ kind: 'error', message: e.message }))
  }, [catalog, id])

  // ---- re-run the raw stage when white balance / highlights / demosaic change (debounced)
  useEffect(() => {
    if (status.kind !== 'ready' || !info || !history) return
    const opts = stageOptions(settings, info)
    if (sameStage(builtStage.current, opts)) return
    const t = setTimeout(() => {
      const engine = engineRef.current
      if (!engine) return
      engine.process(opts).then(
        (ms) => {
          builtStage.current = opts
          setTiming((x) => ({ ...x, stage: ms }))
          requestRender()
        },
        (e: Error) => engineRef.current === engine && setStatus({ kind: 'error', message: e.message }),
      )
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, info, status.kind])

  // ---- drawing (coalesced so dragging never queues up frames)
  const indicators: Indicators = useMemo(
    () => ({ clip: clipSettings, showClip: overlay, raw: rawClipSettings, showRaw: rawOverlay }),
    [clipSettings, overlay, rawClipSettings, rawOverlay],
  )
  const latest = useRef({ settings, info, view, before, indicators })
  latest.current = { settings, info, view, before, indicators }

  // Histogram: measured on a small rendering shortly after each redraw (throttled).
  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleStats = useCallback(() => {
    if (statsTimer.current !== null) return
    statsTimer.current = setTimeout(async () => {
      statsTimer.current = null
      const engine = engineRef.current
      const { settings: s, info: inf, before: b, indicators: ind } = latest.current
      if (!engine || !inf) return
      const shown = b ? DEFAULT_SETTINGS : s
      try {
        setStats(await engine.renderStats(displayUniforms(shown), b ? inf.asShotWb : multipliers(shown, inf), 256, ind))
      } catch {
        // e.g. engine closed while measuring
      }
    }, 120)
  }, [])
  const rendering = useRef(false)
  const pending = useRef(false)
  const requestRender = useCallback(() => {
    pending.current = true
    if (rendering.current) return
    rendering.current = true
    void (async () => {
      while (pending.current) {
        pending.current = false
        const engine = engineRef.current
        const { settings: s, info: inf, view: v, before: b, indicators: o } = latest.current
        if (!engine || !inf) break
        const shown = b ? DEFAULT_SETTINGS : s
        try {
          const ms = await engine.render(displayUniforms(shown), b ? inf.asShotWb : multipliers(shown, inf), v, o)
          setTiming((x) => ({ ...x, frame: ms }))
          scheduleStats()
        } catch (e) {
          setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
        }
      }
      rendering.current = false
    })()
  }, [scheduleStats])

  useEffect(() => {
    if (status.kind === 'ready') requestRender()
  }, [status.kind, settings, view, before, indicators, requestRender])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => requestRender())
    ro.observe(el)
    return () => ro.disconnect()
  }, [requestRender])

  // ---- saving (debounced): settings + history to the catalog, and a fresh thumbnail.
  // A save still waiting when the photo changes or Develop closes is run immediately, so no edit is lost.
  useEffect(() => {
    if (!history || !info || !dirty.current) return
    const photoId = id
    const engine = engineRef.current
    const run = async () => {
      const s = current(history)
      const saved: SavedHistory = { steps: history.steps.map(({ label, settings: st }) => ({ label, settings: st })), index: history.index }
      await catalog.saveEdit(photoId, JSON.stringify(s), JSON.stringify(saved))
      try {
        if (engine) {
          const img = await engine.renderImage(displayUniforms(s), multipliers(s, info), 512)
          const c = new OffscreenCanvas(img.width, img.height)
          c.getContext('2d')!.putImageData(img, 0, 0)
          const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
          await saveThumb(photoId, new Uint8Array(await blob.arrayBuffer()))
          forgetThumbUrl(photoId)
        }
      } catch {
        // The settings are saved; only the thumbnail refresh failed (e.g. the GPU was reset).
      }
      onEdited()
    }
    pendingSave.current = run
    const t = setTimeout(() => {
      pendingSave.current = null
      saving.current = run()
    }, 800)
    return () => clearTimeout(t)
  }, [catalog, history, info, id, onEdited])

  useEffect(
    () => () => {
      const run = pendingSave.current
      pendingSave.current = null
      if (run) saving.current = run()
    },
    [id],
  )

  const change = useCallback((label: string, next: DevelopSettings) => {
    dirty.current = true
    setHistory((h) => (h ? record(h, label, next) : h))
  }, [])

  const reset = () => change('Reset', DEFAULT_SETTINGS)

  // ---- Auto
  const targets = useMemo(() => [...BUILT_IN_TARGETS, ...(refTarget ? [refTarget] : []), ...savedTargets], [refTarget, savedTargets])

  const runAuto = useCallback(
    async (target: AutoTarget) => {
      const engine = engineRef.current
      if (!engine || !info || !history) return
      setAutoBusy(true)
      try {
        // Like Lightroom's Auto, this leaves white balance alone (owner's decision, 2026-10-11).
        const start = current(history)
        const r = await solveAuto(start, target, async (s) =>
          metricsFromStats(await engine.renderStats(displayUniforms(s), multipliers(s, info), 256)),
        )
        change(`Auto: ${target.name}`, r.settings)
      } catch (e) {
        if (engineRef.current === engine) setStatus({ kind: 'error', message: `Auto failed: ${e instanceof Error ? e.message : e}` })
      } finally {
        setAutoBusy(false)
      }
    },
    [info, history, change],
  )

  /** Uses another photo's look (its current thumbnail rendering) as the Auto target. */
  async function matchReference(refId: number) {
    setPicking(false)
    const blob = await loadThumb(refId)
    if (!blob) return
    const bmp = await createImageBitmap(blob)
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d')!
    ctx.drawImage(bmp, 0, 0)
    bmp.close()
    const m = metricsFromStats(statsFromPixels(ctx.getImageData(0, 0, c.width, c.height).data))
    const ref = await catalog.getPhoto(refId)
    const t = targetFromMetrics(`ref:${refId}`, `Match ${ref?.fileName ?? 'reference'}`, m)
    setRefTarget(t)
    setTargetId(t.id)
    await runAuto(t)
  }

  async function saveCurrentAsTarget() {
    const engine = engineRef.current
    if (!engine || !info) return
    const name = window.prompt('Name for this target look (e.g. "My landscapes"):', '')?.trim()
    if (!name) return
    const m = metricsFromStats(await engine.renderStats(displayUniforms(settings), multipliers(settings, info), 256))
    const t = targetFromMetrics('', name, m)
    const dbId = await catalog.saveTarget(name, JSON.stringify(t))
    const saved = { ...t, id: `saved:${dbId}`, builtIn: false }
    setSavedTargets((ts) => [...ts, saved].sort((a, b) => a.name.localeCompare(b.name)))
    setTargetId(saved.id)
  }

  async function deleteTarget(tid: string) {
    if (tid.startsWith('ref:')) {
      setRefTarget(null)
      setTargetId('natural')
      return
    }
    const t = savedTargets.find((x) => x.id === tid)
    if (!t || !window.confirm(`Delete the target "${t.name}"?`)) return
    await catalog.deleteTarget(Number(tid.slice('saved:'.length)))
    setSavedTargets((ts) => ts.filter((x) => x.id !== tid))
    setTargetId('natural')
  }

  const selectedTarget = targets.find((t) => t.id === targetId) ?? BUILT_IN_TARGETS[0]
  const infoLine = photo ? exposureText(photo) : ''

  // ---- keyboard
  const index = ids.indexOf(id)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntry(e.target) || isSliderKey(e)) return
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) {
        e.preventDefault()
        dirty.current = true
        setHistory((h) => (h ? (k === 'y' || e.shiftKey ? redo(h) : undo(h)) : h))
      } else if (k === '\\') {
        setBefore((b) => !b)
      } else if (k === 'o' && e.shiftKey) {
        // darktable: Shift+O toggles the raw (sensor) clipping indicator.
        setRawOverlay((o) => !o)
      } else if (k === 'j' || k === 'o') {
        // J as in Lightroom, O as in darktable.
        setOverlay((o) => !o)
      } else if (k === 'z') {
        setView((v) => ({ zoom: v.zoom === 'fit' ? 1 : 'fit', center: v.center }))
      } else if (k === 'arrowright' && index < ids.length - 1) {
        onNavigate(ids[index + 1])
      } else if (k === 'arrowleft' && index > 0) {
        onNavigate(ids[index - 1])
      } else if (k === 'w' && !e.ctrlKey && !e.metaKey) {
        // Lightroom: W selects the white balance picker.
        setWbPick((p) => !p)
        setLoupe(null)
      } else if (k === 'escape') {
        setPicking(false)
        setWbPick(false)
        setLoupe(null)
        setView((v) => ({ ...v, zoom: 'fit' }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ids, index, onNavigate])

  // ---- click to zoom, drag to pan
  const drag = useRef<{ x: number; y: number; center: [number, number]; moved: boolean } | null>(null)
  function canvasPoint(e: React.PointerEvent) {
    const engine = engineRef.current
    if (!engine) return null
    const r = engine.canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const l = engine.layout(view, engine.canvas.width, engine.canvas.height)
    return { l, px: (e.clientX - r.left) * dpr, py: (e.clientY - r.top) * dpr }
  }
  /** Pointer position as displayed-image uv, or null outside the photo. */
  function imageUv(e: React.PointerEvent): [number, number] | null {
    const p = canvasPoint(e)
    if (!p) return null
    const u = (p.px - p.l.x) / p.l.w
    const v = (p.py - p.l.y) / p.l.h
    return u >= 0 && u < 1 && v >= 0 && v < 1 ? [u, v] : null
  }

  // ---- white balance picker (darktable temperature.c spot picker + a Lightroom-style loupe)
  const LOUPE_PIXELS = 15
  const LOUPE_ZOOM = 10
  const loupeBusy = useRef(false)
  const loupeNext = useRef<{ uv: [number, number]; x: number; y: number } | null>(null)
  const updateLoupe = useCallback(() => {
    if (loupeBusy.current) return
    loupeBusy.current = true
    void (async () => {
      while (loupeNext.current) {
        const { uv, x, y } = loupeNext.current
        loupeNext.current = null
        const engine = engineRef.current
        const { settings: s, info: inf } = latest.current
        if (!engine || !inf) break
        try {
          const image = await engine.renderLoupe(displayUniforms(s), multipliers(s, inf), uv[0], uv[1], LOUPE_PIXELS)
          setLoupe({ x, y, image })
        } catch {
          break
        }
      }
      loupeBusy.current = false
    })()
  }, [])

  async function pickWhiteBalance(uv: [number, number]) {
    const engine = engineRef.current
    if (!engine || !info) return
    setWbPick(false)
    setLoupe(null)
    const working = await engine.sampleScene(uv[0], uv[1], 2)
    const { temperature, tint } = multipliersToTemperature(engine.neutralMultipliers(working), info.xyzToCam)
    change('White balance: picker', { ...settings, whiteBalance: { mode: 'custom', temperature, tint } })
  }

  function onPointerDown(e: React.PointerEvent) {
    if (status.kind !== 'ready' || wbPick) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, center: view.center, moved: false }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (wbPick) {
      const uv = imageUv(e)
      const r = stageRef.current?.getBoundingClientRect()
      if (!uv || !r) {
        setLoupe(null)
        return
      }
      loupeNext.current = { uv, x: e.clientX - r.left, y: e.clientY - r.top }
      updateLoupe()
      return
    }
    const d = drag.current
    if (!d || view.zoom === 'fit') return
    const p = canvasPoint(e)
    if (!p) return
    const dpr = window.devicePixelRatio || 1
    const dx = ((e.clientX - d.x) * dpr) / p.l.w
    const dy = ((e.clientY - d.y) * dpr) / p.l.h
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true
    setView({ zoom: view.zoom, center: [Math.min(1, Math.max(0, d.center[0] - dx)), Math.min(1, Math.max(0, d.center[1] - dy))] })
  }
  function onPointerUp(e: React.PointerEvent) {
    if (wbPick) {
      const uv = imageUv(e)
      if (uv) void pickWhiteBalance(uv)
      return
    }
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    const p = canvasPoint(e)
    if (!p) return
    if (view.zoom === 'fit') {
      const u = (p.px - p.l.x) / p.l.w
      const v = (p.py - p.l.y) / p.l.h
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) setView({ zoom: 1, center: [u, v] })
    } else {
      setView({ zoom: 'fit', center: view.center })
    }
  }

  const strip = useMemo(() => ids.slice(Math.max(0, index - 40), index + 41), [ids, index])

  return (
    <div className="develop" style={{ '--left-w': `${leftW}px`, '--right-w': `${rightW}px` } as React.CSSProperties}>
      <aside className="dleft">
        <section className="dhisto" style={{ height: histH }}>
          <Histogram
            stats={stats}
            info={infoLine}
            overlay={overlay}
            onToggleOverlay={() => setOverlay((o) => !o)}
            rawOverlay={rawOverlay}
            onToggleRawOverlay={() => setRawOverlay((o) => !o)}
            clip={clipSettings}
            onClip={setClipSettings}
            rawClip={rawClipSettings}
            onRawClip={setRawClipSettings}
            log={histLog === 1}
            onLog={(l) => setHistLog(l ? 1 : 2)}
          />
        </section>
        <ResizeHandle axis="y" value={histH} min={90} max={480} onChange={setHistH} label="Resize histogram" />
        <h3 className="panel-title">History</h3>
        <ol className="history" reversed>
          {history &&
            [...history.steps.keys()].reverse().map((i) => (
              <li key={i}>
                <button
                  className={i === history.index ? 'on' : i > history.index ? 'undone' : ''}
                  onClick={() => {
                    dirty.current = true
                    setHistory((h) => (h ? jump(h, i) : h))
                  }}
                >
                  {history.steps[i].label}
                </button>
              </li>
            ))}
        </ol>
        <div className="dleft-actions">
          <button className="button small" disabled={!history || !canUndo(history)} onClick={() => { dirty.current = true; setHistory((h) => (h ? undo(h) : h)) }} title="Undo (Ctrl+Z)">Undo</button>
          <button className="button small" disabled={!history || !canRedo(history)} onClick={() => { dirty.current = true; setHistory((h) => (h ? redo(h) : h)) }} title="Redo (Ctrl+Shift+Z)">Redo</button>
          <button className="button small" disabled={status.kind !== 'ready'} onClick={reset}>Reset all</button>
        </div>
        {timing.stage !== undefined && (
          <p className="muted small pad">
            Processing {Math.round(timing.stage)} ms{timing.frame !== undefined ? ` · redraw ${timing.frame.toFixed(1)} ms` : ''}
          </p>
        )}
      </aside>

      <ResizeHandle axis="x" value={leftW} min={170} max={480} onChange={setLeftW} label="Resize left panel" />
      <section className="dcenter">
        <div className="dtoolbar">
          <span className="dtitle">{photo ? photo.fileName : ''}</span>
          <button className={`button small ${before ? 'on' : ''}`} onClick={() => setBefore(!before)} disabled={status.kind !== 'ready'} title="Before / after (\)">
            {before ? 'Showing before' : 'Before / after'}
          </button>
          <button className="button small" onClick={() => setView((v) => ({ zoom: v.zoom === 'fit' ? 1 : 'fit', center: v.center }))} disabled={status.kind !== 'ready'} title="Zoom (Z)">
            {view.zoom === 'fit' ? 'Fit' : '100 %'}
          </button>
        </div>
        <div
          className={`dstage ${view.zoom === 'fit' ? 'fit' : 'zoomed'} ${wbPick ? 'wb-picking' : ''}`}
          ref={stageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setLoupe(null)}
        >
          {status.kind !== 'ready' && placeholder && <img className="dplaceholder" src={placeholder} alt="" />}
          {status.kind === 'loading' && <div className="dmessage">Developing…</div>}
          {status.kind === 'error' && <div className="dmessage error">{status.message}</div>}
          {engineError && <div className="dmessage error">{engineError}</div>}
          {before && <div className="dbadge">Before</div>}
          {(overlay || rawOverlay) && (
            <div className="dbadge right">
              {[overlay && 'Clipping shown (J)', rawOverlay && 'Sensor clipping shown (Shift+O)'].filter(Boolean).join(' · ')}
            </div>
          )}
          {wbPick && <div className="dbadge pick">Click something that should be neutral grey or white · Esc to cancel</div>}
          {wbPick && loupe && <WbLoupe x={loupe.x} y={loupe.y} image={loupe.image} zoom={LOUPE_ZOOM} />}
          {picking && <div className="dbadge pick">Click a photo in the filmstrip to match its look · Esc to cancel</div>}
        </div>
        <div className="filmstrip" role="listbox" aria-label="Filmstrip">
          {strip.map((pid) => (
            <button
              key={pid}
              className={`fs-cell ${pid === id ? 'on' : ''} ${picking ? 'picking' : ''}`}
              onClick={() => (picking ? void matchReference(pid) : onNavigate(pid))}
              aria-selected={pid === id}
              title={picking ? 'Use this photo as the reference look' : undefined}
            >
              <Thumb id={pid} />
            </button>
          ))}
        </div>
      </section>

      <ResizeHandle axis="x" value={rightW} min={240} max={520} direction={-1} onChange={setRightW} label="Resize right panel" />
      <aside className="dright">
        <BasicPanel
          settings={settings}
          asShot={info?.asShot ?? null}
          onChange={change}
          disabled={status.kind !== 'ready'}
          pickingWb={wbPick}
          onPickWb={() => {
            setWbPick((p) => !p)
            setLoupe(null)
          }}
          auto={{
            targets,
            selected: selectedTarget.id,
            busy: autoBusy,
            picking,
            onSelect: setTargetId,
            onAuto: () => void runAuto(selectedTarget),
            onPickReference: () => setPicking((p) => !p),
            onSaveTarget: () => void saveCurrentAsTarget(),
            onDeleteTarget: (tid) => void deleteTarget(tid),
          }}
        />
      </aside>
    </div>
  )
}
