import { isSliderKey, isTextEntry } from '../lib/keys'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getCatalog } from '../catalog/client'
import { forgetThumbUrl, loadThumb, saveThumb, thumbUrl } from '../catalog/thumbs'
import type { PhotoDetail } from '../catalog/types'
import { multipliersToTemperature } from '../engine/color/temperature'
import { AUTO_SLIDERS, BUILT_IN_TARGETS, metricsFromStats, solveAuto, statsFromPixels, targetFromMetrics, type AutoKey, type AutoTarget } from '../engine/develop/auto'
import { defaultsFor, displayUniforms, type DevelopSettings } from '../engine/develop/settings'
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
import { loadIntoEngine, multipliers, renderThumbnail, stageOptions, type SensorInfo } from './source'
import { sidecars } from '../sidecar/sync'
import { canRedo, canUndo, current, jump, loadHistory, record, redo, savedForm, undo, type History } from './history'
import { batch, rerunAuto } from './batch'
import { applyPaste, changedKeys, rememberedChoice, settingsClipboard, type Clipboard, type PasteKey } from './paste'
import { PasteDialog } from './PasteDialog'

interface Props {
  ids: number[]
  id: number
  /** Photos selected in the Library along with this one: Sync and Auto Sync apply to them. */
  selected: number[]
  onNavigate: (id: number) => void
  onEdited: () => void
  onExport: (ids: number[]) => void
}

type Status = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string }

let decoder: RawDecoder | null = null

const sameStage = (a: RawStageOptions | null, b: RawStageOptions) =>
  !!a && a.highlightMode === b.highlightMode && a.highlightClip === b.highlightClip && a.demosaic === b.demosaic &&
  a.wb.every((v, i) => Math.abs(v - b.wb[i]) < 1e-6)

/** Auto's options (owner's decision: tunable strength and a choice of sliders). */
interface AutoOptionsState {
  strength: number
  sliders: AutoKey[]
}
const DEFAULT_AUTO_OPTIONS: AutoOptionsState = { strength: 1, sliders: AUTO_SLIDERS.map((x) => x.key) }

type PasteMode = { mode: 'copy' | 'sync' | 'paste'; clip: Clipboard }

export function DevelopView({ ids, id, selected: initialSelection, onNavigate, onEdited, onExport }: Props) {
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
  const [autoOptions, setAutoOptions] = useStoredJson('lightbench.auto.options', DEFAULT_AUTO_OPTIONS)
  /** Filmstrip selection (starts as the Library's): Sync goes from this photo to the others. */
  const [selection, setSelection] = useState(() => new Set(initialSelection.includes(id) ? initialSelection : [id]))
  const [autoSync, setAutoSync] = useState(false)
  const [pasting, setPasting] = useState<PasteMode | null>(null)
  const [reloads, setReloads] = useState(0)
  const hasClip = useSyncExternalStore(settingsClipboard.subscribe, () => !!settingsClipboard.get())
  const [leftW, setLeftW] = useStoredNumber('lightbench.develop.left', 240)
  const [rightW, setRightW] = useStoredNumber('lightbench.develop.right', 300)
  const [histH, setHistH] = useStoredNumber('lightbench.develop.histogram', 170)
  const builtStage = useRef<RawStageOptions | null>(null)
  const dirty = useRef(false)
  const loadToken = useRef(0)
  /** A save waiting for its debounce timer, and the save currently running. */
  const pendingSave = useRef<(() => Promise<void>) | null>(null)
  const saving = useRef<Promise<void> | null>(null)

  const defaults = defaultsFor(info?.kind ?? 'raw')
  const settings = history ? current(history) : defaults

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
      const file = await openPhotoFile(d.rootId, d.folderPath, d.fileName)
      if (!file) throw new Error('This photo’s folder isn’t connected. Go to the Library and click “Reconnect”.')
      decoder ??= new RawDecoder()
      const r = await decoder.decode(file, true)
      if (stale()) return
      for (let t = 0; !engineRef.current && t < 100; t++) await new Promise((res) => setTimeout(res, 50))
      const engine = engineRef.current
      if (!engine) throw new Error('Graphics acceleration is not available.')
      const sensorInfo = loadIntoEngine(engine, r)
      const kind = sensorInfo.kind

      const h = loadHistory(await catalog.getEdit(id), kind)
      const opts = stageOptions(current(h), sensorInfo)
      const ms = await engine.process(opts)
      if (stale()) return
      builtStage.current = opts
      setTiming({ stage: ms })
      setInfo(sensorInfo)
      setHistory(h)
      setStatus({ kind: 'ready' })
    })().catch((e: Error) => !stale() && setStatus({ kind: 'error', message: e.message }))
  }, [catalog, id, reloads])

  // A Paste or Sync running in the background just changed the photo shown: show its new settings, unless
  // there are unsaved changes here (then this photo's next save keeps them).
  useEffect(
    () =>
      batch.onUpdated((pid) => {
        if (pid === id && !pendingSave.current) setReloads((r) => r + 1)
      }),
    [id],
  )

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
      const shown = b ? defaultsFor(inf.kind) : s
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
        const shown = b ? defaultsFor(inf.kind) : s
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
      await catalog.saveEdit(photoId, JSON.stringify(s), JSON.stringify(savedForm(history)))
      sidecars.schedule([photoId])
      try {
        if (engine) {
          await saveThumb(photoId, await renderThumbnail(engine, s, info))
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

  /**
   * Records a change. Moving one of the sliders Auto set, by hand, ends the photo's Auto record (so a later Paste
   * copies the numbers instead of re-running Auto); `keepAuto` is for changes Auto and Paste make themselves.
   */
  const change = useCallback((label: string, next: DevelopSettings, keepAuto = false) => {
    dirty.current = true
    setHistory((h) => {
      if (!h) return h
      const prev = current(h)
      const a = next.auto
      const s = a && !keepAuto && a.sliders.some((k) => next[k] !== prev[k]) ? { ...next, auto: null } : next
      return record(h, label, s)
    })
  }, [])

  const reset = () => change('Reset', defaults)

  // ---- Auto
  const targets = useMemo(() => [...BUILT_IN_TARGETS, ...(refTarget ? [refTarget] : []), ...savedTargets], [refTarget, savedTargets])

  const runAuto = useCallback(
    async (target: AutoTarget, options: AutoOptionsState = autoOptions) => {
      const engine = engineRef.current
      if (!engine || !info || !history) return
      setAutoBusy(true)
      try {
        // Like Lightroom's Auto, this leaves white balance alone (owner's decision, 2026-10-11).
        const start = current(history)
        const r = await solveAuto(
          start,
          target,
          async (s) => metricsFromStats(await engine.renderStats(displayUniforms(s), multipliers(s, info), 256)),
          12,
          options,
        )
        change(`Auto: ${target.name}`, r.settings, true)
      } catch (e) {
        if (engineRef.current === engine) setStatus({ kind: 'error', message: `Auto failed: ${e instanceof Error ? e.message : e}` })
      } finally {
        setAutoBusy(false)
      }
    },
    [info, history, change, autoOptions],
  )

  // Changing Auto's strength or sliders re-runs it on a photo whose tone came from Auto (after a short pause).
  const lastOptions = useRef(autoOptions)
  const runAutoRef = useRef(runAuto)
  runAutoRef.current = runAuto
  const autoRecord = settings.auto ?? null
  const autoRecordRef = useRef(autoRecord)
  autoRecordRef.current = autoRecord
  useEffect(() => {
    if (lastOptions.current === autoOptions) return
    lastOptions.current = autoOptions
    const t = setTimeout(() => {
      const a = autoRecordRef.current
      if (a) void runAutoRef.current(a.target, autoOptions)
    }, 350)
    return () => clearTimeout(t)
  }, [autoOptions])

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

  // ---- copy / paste / sync (Lightroom: Ctrl+Shift+C, Ctrl+Shift+V, Sync…, Auto Sync)
  const others = useMemo(() => ids.filter((x) => x !== id && selection.has(x)), [ids, id, selection])
  const clipFor = useCallback(
    (keys: PasteKey[], rerun: boolean): Clipboard | null =>
      info && photo ? { settings, keys, rerunAuto: rerun, sourceKind: info.kind, sourceName: photo.fileName } : null,
    [info, photo, settings],
  )
  const openCopy = (mode: 'copy' | 'sync') => {
    const { keys, rerunAuto: rerun } = rememberedChoice()
    const clip = clipFor(keys, rerun)
    if (clip && status.kind === 'ready' && (mode === 'copy' || others.length)) setPasting({ mode, clip })
  }
  const openPaste = () => {
    const clip = settingsClipboard.get()
    if (clip && status.kind === 'ready') setPasting({ mode: 'paste', clip })
  }

  /** Pastes onto the photo shown (in Develop, Paste goes to this photo only; Sync covers the others). */
  async function pasteHere(clip: Clipboard) {
    const engine = engineRef.current
    if (!engine || !info) return
    let next = applyPaste(settings, clip, info.kind)
    if (clip.rerunAuto && clip.settings.auto) {
      setAutoBusy(true)
      try {
        next = await rerunAuto(engine, { ...next, auto: clip.settings.auto }, info)
        builtStage.current = stageOptions(next, info)
      } catch (e) {
        setStatus({ kind: 'error', message: `Auto failed: ${e instanceof Error ? e.message : e}` })
        return
      } finally {
        setAutoBusy(false)
      }
    }
    change('Paste settings', next, true)
  }

  function confirmPaste(clip: Clipboard) {
    const mode = pasting?.mode
    setPasting(null)
    if (mode === 'copy') settingsClipboard.set(clip)
    else if (mode === 'paste') void pasteHere(clip)
    else if (mode === 'sync') batch.run({ label: 'Sync settings', ids: others, clip })
  }

  // Auto Sync: each change here goes to the other selected photos, a moment after the last one.
  const syncFrom = useRef<{ id: number; settings: DevelopSettings } | null>(null)
  const syncPending = useRef<{ keys: Set<PasteKey>; auto: boolean; job: { clip: Clipboard; to: number[] } | null; timer: ReturnType<typeof setTimeout> | null }>({
    keys: new Set(),
    auto: false,
    job: null,
    timer: null,
  })
  const flushSync = useCallback(() => {
    const p = syncPending.current
    if (p.timer) clearTimeout(p.timer)
    const job = p.job
    Object.assign(p, { keys: new Set(), auto: false, job: null, timer: null })
    if (job && job.to.length) batch.run({ label: 'Auto Sync', ids: job.to, clip: job.clip })
  }, [])
  useEffect(() => {
    const prev = syncFrom.current
    syncFrom.current = history ? { id, settings } : null
    if (!autoSync || !dirty.current || !prev || prev.id !== id || prev.settings === settings) return
    const p = syncPending.current
    changedKeys(prev.settings, settings).forEach((k) => p.keys.add(k))
    if (settings.auto && JSON.stringify(prev.settings.auto) !== JSON.stringify(settings.auto)) p.auto = true
    const clip = clipFor([...p.keys], p.auto)
    if (!clip || (!p.keys.size && !p.auto)) return
    p.job = { clip, to: others }
    if (p.timer) clearTimeout(p.timer)
    p.timer = setTimeout(flushSync, 700)
  }, [autoSync, history, id, settings, clipFor, others, flushSync])
  // Moving to another photo or switching Auto Sync off sends what is still waiting.
  useEffect(() => flushSync, [id, autoSync, flushSync])

  /** Filmstrip and arrow keys: Ctrl+click adds or removes a photo, Shift+click a range; moving within the selection keeps it. */
  function pick(pid: number, e?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    if (e && (e.ctrlKey || e.metaKey)) {
      const next = new Set(selection)
      if (next.has(pid) && pid !== id) next.delete(pid)
      else next.add(pid)
      setSelection(next)
      return
    }
    if (e?.shiftKey) {
      const a = ids.indexOf(id)
      const b = ids.indexOf(pid)
      setSelection(new Set([...selection, ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)]))
      return
    }
    if (!selection.has(pid)) setSelection(new Set([pid]))
    onNavigate(pid)
  }

  // ---- keyboard
  const index = ids.indexOf(id)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntry(e.target) || isSliderKey(e) || pasting) return
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'e') {
        e.preventDefault()
        onExport([id])
      } else if ((e.ctrlKey || e.metaKey) && k === 'c') {
        // Ctrl+C (and Lightroom's Ctrl+Shift+C) always asks which settings to copy.
        e.preventDefault()
        openCopy('copy')
      } else if ((e.ctrlKey || e.metaKey) && k === 'v') {
        e.preventDefault()
        openPaste()
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 's') {
        // Lightroom: Ctrl+Shift+S syncs settings to the selected photos.
        e.preventDefault()
        openCopy('sync')
      } else if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) {
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
        pick(ids[index + 1])
      } else if (k === 'arrowleft' && index > 0) {
        pick(ids[index - 1])
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
  })

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
        <div className="dleft-actions">
          <button className="button small" disabled={status.kind !== 'ready'} onClick={() => openCopy('copy')} title="Choose settings to copy (Ctrl+C)">Copy…</button>
          <button className="button small" disabled={status.kind !== 'ready' || !hasClip} onClick={openPaste} title="Paste settings onto this photo (Ctrl+V)">Paste…</button>
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
          <span className="sync-group">
            <button
              className="button small"
              disabled={status.kind !== 'ready' || !others.length}
              onClick={() => openCopy('sync')}
              title={others.length ? `Apply settings from this photo to the ${others.length} other selected (Ctrl+Shift+S)` : 'Ctrl+click photos in the filmstrip to select them, then sync'}
            >
              Sync…{others.length ? ` (${others.length})` : ''}
            </button>
            <label className="check small" title="Every change here also goes to the other selected photos">
              <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} disabled={!others.length} />
              Auto Sync
            </label>
          </span>
          <button className="button small" onClick={() => onExport([id])} title="Export this photo (Ctrl+Shift+E)">Export…</button>
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
          {autoSync && others.length > 0 && <div className="dbadge sync">Auto Sync: changes also go to {others.length} other {others.length === 1 ? 'photo' : 'photos'}</div>}
        </div>
        <div className="filmstrip" role="listbox" aria-label="Filmstrip">
          {strip.map((pid) => (
            <button
              key={pid}
              className={`fs-cell ${pid === id ? 'on' : ''} ${selection.has(pid) ? 'selected' : ''} ${picking ? 'picking' : ''}`}
              onClick={(e) => (picking ? void matchReference(pid) : pick(pid, e))}
              aria-selected={selection.has(pid)}
              title={picking ? 'Use this photo as the reference look' : 'Click to open · Ctrl+click to select for Sync'}
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
          kind={info?.kind ?? 'raw'}
          defaults={defaults}
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
            strength: autoOptions.strength,
            sliders: autoOptions.sliders,
            onOptions: (o) => setAutoOptions({ ...autoOptions, ...o }),
            record: autoRecord,
          }}
        />
      </aside>
      {pasting && (
        <PasteDialog
          mode={pasting.mode}
          clip={pasting.clip}
          targets={pasting.mode === 'sync' ? { count: others.length } : pasting.mode === 'paste' ? { count: 1, kind: info?.kind ?? 'raw' } : undefined}
          onConfirm={confirmPaste}
          onClose={() => setPasting(null)}
        />
      )}
    </div>
  )
}
