import { useKeymapVersion, useShortcuts, withKey } from '../settings/shortcuts'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getCatalog } from '../catalog/client'
import { forgetThumbUrl, loadThumb, saveThumb, thumbUrl } from '../catalog/thumbs'
import type { PhotoDetail } from '../catalog/types'
import { AUTO_SLIDERS, BUILT_IN_TARGETS, metricsFromStats, solveAuto, statsFromPixels, targetFromMetrics, type AutoKey, type AutoTarget } from '../engine/develop/auto'
import { defaultsFor, displayUniforms, type DevelopSettings } from '../engine/develop/settings'
import { DEFAULT_GEOMETRY, flip, isIdentityGeometry, rotate90, sameGeometry, setAngle, setAspect, setLocked, swapAspect, type GeometrySettings } from '../engine/develop/geometry'
import { CURRENT_PROCESS, PROCESS_VERSIONS, processStatus } from '../engine/develop/process'
import { DevelopEngine, type ImageStats, type RawStageOptions, type ViewState } from '../engine/gpu/develop-engine'
import { gpuGate } from '../engine/gpu/gate'
import type { RetouchProgress } from '../engine/gpu/retouch-stage'
import { newSeed, newSpotId, simplifyStroke, STROKE_EPSILON, type Spot, type SpotMode } from '../engine/develop/spots'
import { RemoveOverlay } from './RemoveOverlay'
import { RemovePanel } from './RemovePanel'
import { DEFAULT_BRUSH, SIZE_RANGE, type BrushSettings } from './removeBrush'
import { RawDecoder } from '../engine/raw/decoder'
import type { DecodeResult } from '../engine/raw/types'
import { Thumb } from '../library/Thumb'
import { openPhotoFile } from '../platform/roots'
import { useStoredJson } from '../lib/useStoredJson'
import { useStoredNumber } from '../lib/useStoredNumber'
import { DEFAULT_CLIP, DEFAULT_RAW_CLIP, type Indicators } from '../engine/develop/indicators'
import { exposureText } from '../library/format'
import { BasicPanel } from './BasicPanel'
import { CropPanel, type GeometryEdit } from './CropPanel'
import { CropOverlay } from './CropOverlay'
import { LensPanel } from './LensPanel'
import { LEGACY_LENS, lensWarpKey, type LensStatus } from '../engine/lens/correction'
import { lensfunState, loadLensfun, subscribeLensfun } from '../engine/lens/lens-db'
import { GuidedOverlay } from './GuidedOverlay'
import { TransformPanel, type TransformSlider } from './TransformPanel'
import { autoStraightenGeometry, describeCorrection, detectLines, focalFor, frameMaps, guidedGeometry, ownFocal, rerunUpright, uprightGeometry, wantsUprightRerun, withTransform } from './uprightRun'
import { DEFAULT_TRANSFORM, guideIsVertical, guidesToSensor, sensorToGuide, type Detection, type Guide, type UprightMode } from '../engine/develop/upright'
import { ToolStack, type GroupId } from './ToolStack'
import { CROP_OVERLAYS, GROUP_ICONS, type CropOverlayKind } from './tools'
import { Histogram } from './Histogram'
import { ResizeHandle } from './ResizeHandle'
import { WbLoupe } from './WbLoupe'
import { loadIntoEngine, multipliers, renderThumbnail, stageOptions, temperatureOf, type SensorInfo } from './source'
import { sidecars } from '../sidecar/sync'
import { checkPhoto } from '../sidecar/watch'
import { canRedo, canUndo, current, jump, loadHistory, record, redo, replaceCurrent, savedForm, undo, type History } from './history'
import { batch, rerunAuto } from './batch'
import { applyPaste, changedKeys, rememberedChoice, settingsClipboard, type Clipboard, type PasteKey } from './paste'
import { PasteDialog } from './PasteDialog'
import { PresetPanel } from './PresetPanel'
import { blendSettings, presetClip, type Preset, type PresetData } from './presets'
import { loadPresets, presetsChanged } from './presetStore'
import { CurveTatLayer } from './CurveTatLayer'
import { ToneCurvePanel, type CurveView } from './ToneCurvePanel'
import { withToneCurve, type ToneCurveSettings } from '../engine/develop/tone-curve'

interface Props {
  ids: number[]
  id: number
  /** Photos selected in the Library along with this one: Sync and Auto Sync apply to them. */
  selected: number[]
  onNavigate: (id: number) => void
  onEdited: () => void
  onExport: (ids: number[]) => void
  /** Back to the Library (G). */
  onLibrary: () => void
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

type PasteMode = { mode: 'copy' | 'sync' | 'paste' | 'preset'; clip: Clipboard }

/** The Basic group's settings at their defaults (its on/off eye): white balance, tone and presence. */
function withoutBasic(s: DevelopSettings, d: DevelopSettings): DevelopSettings {
  const { whiteBalance, exposure, contrast, highlights, shadows, whites, blacks, vibrance, saturation } = d
  return { ...s, whiteBalance, exposure, contrast, highlights, shadows, whites, blacks, vibrance, saturation }
}

/** What a crop session changed, as the history step's name. */
function cropLabel(before: GeometrySettings, after: GeometrySettings): string {
  const same = (k: keyof GeometrySettings) => JSON.stringify(before[k]) === JSON.stringify(after[k])
  if (!same('angle') && same('crop') && same('turns') && same('mirror')) return 'Straighten'
  return 'Crop'
}

/** True when a crop session changed nothing worth a history step. */
const sameCropSession = (a: GeometrySettings, b: GeometrySettings) =>
  sameGeometry(a, b) && a.aspect === b.aspect && a.locked === b.locked && a.custom[0] === b.custom[0] && a.custom[1] === b.custom[1]

interface Bypass {
  crop: boolean
  remove: boolean
  basic: boolean
  curve: boolean
}

/** Settings without their spots (the field left out, as in edits that never had any). */
function withoutSpots(s: DevelopSettings): DevelopSettings {
  const { spots: _gone, ...rest } = s
  void _gone
  return rest
}

/** Settings with a new spot list (left out when empty). */
const withSpots = (s: DevelopSettings, spots: Spot[]): DevelopSettings => (spots.length ? { ...s, spots } : withoutSpots(s))

/** The preset just applied: its Amount can be changed until the photo is changed another way. */
interface AppliedPreset {
  preset: Preset
  before: DevelopSettings
  after: DevelopSettings
  amount: number
  /** The settings now shown, as set by the preset (when they change otherwise, the Amount goes away). */
  result: DevelopSettings
}

export function DevelopView({ ids, id, selected: initialSelection, onNavigate, onEdited, onExport, onLibrary }: Props) {
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
  /** The crop being edited on the photo (R), or null. Applied with Enter, dropped with Esc. */
  const [draft, setDraft] = useState<GeometrySettings | null>(null)
  const draftUndo = useRef<{ back: GeometrySettings[]; ahead: GeometrySettings[] }>({ back: [], ahead: [] })
  const [leveling, setLeveling] = useState(false)
  const [cropOverlay, setCropOverlay] = useStoredJson<{ kind: CropOverlayKind }>('lightbench.crop.overlay', { kind: 'thirds' })
  /** Where the straightened photo sits on the stage while cropping (CSS pixels). */
  const [frameBox, setFrameBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const cropDragging = useRef(false)
  /** The angle slider works from the crop before it started moving, so moving it back gives the crop back. */
  const angleBase = useRef<{ from: GeometrySettings; last: GeometrySettings } | null>(null)
  /** Guided Upright: drawing lines on the photo (Shift+T), and the line selected for Delete. */
  const [guiding, setGuiding] = useState(false)
  const [selectedGuide, setSelectedGuide] = useState<number | null>(null)
  /** Upright and Auto straighten: busy, and what they said last. */
  const [uprightBusy, setUprightBusy] = useState(false)
  const [uprightMsg, setUprightMsg] = useState<{ text: string; warn: boolean } | null>(null)
  const [straightenBusy, setStraightenBusy] = useState(false)
  const [straightenMsg, setStraightenMsg] = useState<string | null>(null)
  /**
   * The lines found on the photo shown (detected once per photo and lens correction, on the photo after its lens
   * correction and before its perspective).
   */
  const detection = useRef<{ id: number; lens: string; job: Promise<Detection> } | null>(null)
  /** Groups switched off with their eye (a view only). */
  const [bypass, setBypass] = useState<Bypass>({ crop: false, remove: false, basic: false, curve: false })
  /**
   * The Tone Curve (PHASE3.md Part 12): the graph shown, its targeted adjustment tool and the tone under the pointer,
   * the curve shown while a drag is in progress (one history step when it ends), clipping shown during a drag, and the
   * histogram of the curve's input behind the graph.
   */
  const [curveView, setCurveView] = useStoredJson<CurveView>('lightbench.curve.view', { mode: 'point', channel: 'rgb' })
  const [curveTarget, setCurveTarget] = useState(false)
  const [curveHover, setCurveHover] = useState<number | null>(null)
  const [curveDraft, setCurveDraft] = useState<{ tc: ToneCurveSettings | undefined } | null>(null)
  const [curveDragClip, setCurveDragClip] = useState(false)
  const [clipWhileDragging, setClipWhileDragging] = useStoredNumber('lightbench.curve.dragClip', 1)
  const [curveHist, setCurveHist] = useState<ImageStats | null>(null)
  /** The Remove brush on the photo (Q), its settings, the selected spot and whether all pins show. */
  const [removing, setRemoving] = useState(false)
  const [brushStored, setBrush] = useStoredJson<BrushSettings>('lightbench.remove.brush', DEFAULT_BRUSH)
  const brush: BrushSettings = { ...DEFAULT_BRUSH, ...brushStored }
  const [selectedSpot, setSelectedSpot] = useState<string | null>(null)
  const [showAllSpots, setShowAllSpots] = useStoredJson<{ on: boolean }>('lightbench.remove.showAll', { on: true })
  const [retouch, setRetouch] = useState<RetouchProgress>({ busy: false })
  const [placing, setPlacing] = useState(false)
  const [spotError, setSpotError] = useState<string | null>(null)
  /** Where the photo sits on the stage (CSS pixels) after the last drawing, while the Remove brush is on. */
  const [shownBox, setShownBox] = useState<{ x: number; y: number; w: number; h: number; n: number } | null>(null)
  /** Counts engines made ready (a new one after a lost device), so effects that use the engine run again. */
  const [engineReady, setEngineReady] = useState(0)
  /** Bumped when the GPU device was lost: the engine is made again (PHASE3.md, Part 14). */
  const [engineGen, setEngineGen] = useState(0)
  /** A short notice after the engine was made again. */
  const [gpuNotice, setGpuNotice] = useState<string | null>(null)
  /** The photo decoded last, kept to upload it again to a new engine after a lost device. */
  const decodedRef = useRef<{ id: number; decoded: DecodeResult } | null>(null)
  const [reveal, setReveal] = useState<{ id: GroupId; n: number } | null>(null)
  // Sublabels next to each slider: 1 = shown, 2 = hidden (tooltips are always available on hover).
  const [hintsPref, setHintsPref] = useStoredNumber('lightbench.develop.hints', 1)
  const [presets, setPresets] = useState<Preset[]>([])
  const [hoverPreset, setHoverPreset] = useState<Preset | null>(null)
  const [applied, setApplied] = useState<AppliedPreset | null>(null)
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
  // The Lensfun database's state (downloaded on first use), so the Lens section and the photo update when it arrives.
  const lensDb = useSyncExternalStore(subscribeLensfun, lensfunState)
  const settings = history ? current(history) : defaults
  /** Hover preview of a preset (its Auto, if any, runs only when it is applied). */
  const hover = useMemo(
    () => (hoverPreset && info ? applyPaste(settings, { ...presetClip(hoverPreset), rerunAuto: false }, info.kind, engineRef.current?.imageSize) : null),
    [hoverPreset, info, settings],
  )
  const draftRef = useRef(draft)
  draftRef.current = draft
  const historyRef = useRef(history)
  historyRef.current = history
  const infoRef = useRef(info)
  infoRef.current = info
  /** The geometry shown in the Crop group: the crop being edited, else the photo's. */
  const geometry = draft ?? settings.geometry
  const frameOf = (g: GeometrySettings) => (engineRef.current && info ? engineRef.current.geometry(g, true).frame : null)
  /**
   * After a failed GPU call: true when it failed because the engine's device was lost (reported a moment after the
   * call fails, so this waits briefly). The engine is then made again and draws again, so there is no error to show.
   */
  const lostMeanwhile = async (engine: DevelopEngine | null) => {
    if (!engine) return false
    if (engine.isLost) return true
    await new Promise((r) => setTimeout(r, 250))
    return engine.isLost || engineRef.current !== engine
  }

  // ---- engine lifetime (made again when its GPU device is lost: a driver reset, or the browser took it back)
  useEffect(() => {
    let alive = true
    let stopLost = () => {}
    // 'auto': the display mode tested once when the page started (engine/gpu/present.ts); ?gpu= still decides.
    DevelopEngine.create('auto').then(
      async (e) => {
        if (!alive) return e.destroy()
        // After a lost device, the photo shown is uploaded to the new engine and developed with its current settings
        // (unsaved changes included) before anything uses the engine; a photo still loading is loaded again.
        let restored: RawStageOptions | null = null
        if (engineGen) {
          const d = decodedRef.current
          const inf = infoRef.current
          const h = historyRef.current
          if (d && d.id === id && inf && h) {
            try {
              loadIntoEngine(e, d.decoded)
              const opts = stageOptions(current(h), inf)
              await gpuGate.foreground(() => e.process(opts))
              restored = opts
            } catch {
              // Loaded again from the file below.
            }
          }
          if (!alive) return e.destroy()
        }
        engineRef.current = e
        stageRef.current?.prepend(e.canvas)
        stopLost = e.onLost(() => {
          if (!alive) return
          setGpuNotice('The graphics card was reset, so Develop restarted it. Your edit is safe.')
          setEngineGen((g) => g + 1)
        })
        setEngineError('')
        setEngineReady((n) => n + 1)
        if (engineGen) {
          if (restored) {
            builtStage.current = restored
            setStatus({ kind: 'ready' })
            requestRender()
          } else {
            setReloads((n) => n + 1)
          }
        }
      },
      (e: Error) => setEngineError(`Graphics acceleration is not available: ${e.message}`),
    )
    return () => {
      alive = false
      stopLost()
      const e = engineRef.current
      engineRef.current = null
      if (e?.isLost) e.canvas.remove()
      // Let a final save (flushed by the cleanup below) finish rendering its thumbnail first.
      setTimeout(() => void (saving.current ?? Promise.resolve()).catch(() => {}).finally(() => {
        e?.canvas.remove()
        e?.destroy()
      }), 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineGen])

  useEffect(() => {
    if (!gpuNotice) return
    const t = setTimeout(() => setGpuNotice(null), 8000)
    return () => clearTimeout(t)
  }, [gpuNotice])

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
    setDraft(null)
    setLeveling(false)
    setGuiding(false)
    setSelectedGuide(null)
    setUprightMsg(null)
    setStraightenMsg(null)
    setCurveTarget(false)
    setCurveDraft(null)
    setCurveHover(null)
    setSelectedSpot(null)
    setSpotError(null)
    detection.current = null
    angleBase.current = null
    builtStage.current = null
    dirty.current = false
    void thumbUrl(id).then((u) => !stale() && setPlaceholder(u))
    let used: DevelopEngine | null = null
    ;(async () => {
      const d = await catalog.getPhoto(id)
      if (stale() || !d) return
      setPhoto(d)
      void checkPhoto(id)
      const file = await openPhotoFile(d.rootId, d.folderPath, d.fileName)
      if (!file) throw new Error('This photo’s folder isn’t connected. Go to the Library and click “Reconnect”.')
      decoder ??= new RawDecoder()
      const r = await decoder.decode(file, true)
      if (stale()) return
      decodedRef.current = { id, decoded: r }
      for (let t = 0; !engineRef.current && t < 100; t++) await new Promise((res) => setTimeout(res, 50))
      const engine = engineRef.current
      if (!engine) throw new Error('Graphics acceleration is not available.')
      used = engine
      const sensorInfo = loadIntoEngine(engine, r)
      const kind = sensorInfo.kind

      const h = loadHistory(await catalog.getEdit(id), kind)
      const opts = stageOptions(current(h), sensorInfo)
      const ms = await gpuGate.foreground(() => engine.process(opts))
      if (stale()) return
      builtStage.current = opts
      setTiming({ stage: ms })
      setInfo(sensorInfo)
      setHistory(h)
      setStatus({ kind: 'ready' })
    })().catch(async (e: Error) => {
      // A lost device: the new engine loads the photo again (engine lifetime, above).
      if (await lostMeanwhile(used)) return
      if (!stale()) setStatus({ kind: 'error', message: e.message })
    })
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
      gpuGate.foreground(() => engine.process(opts)).then(
        (ms) => {
          builtStage.current = opts
          setTiming((x) => ({ ...x, stage: ms }))
          requestRender()
        },
        async (e: Error) => {
          if (engineRef.current === engine && !(await lostMeanwhile(engine))) setStatus({ kind: 'error', message: e.message })
        },
      )
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, info, status.kind])

  // ---- drawing (coalesced so dragging never queues up frames)
  const indicators: Indicators = useMemo(
    // While a drag pushes the tone curve towards black or white, clipping shows on the photo (TONE_CURVE.md §2.5).
    () => ({ clip: clipSettings, showClip: overlay || (curveDragClip && clipWhileDragging === 1), raw: rawClipSettings, showRaw: rawOverlay }),
    [clipSettings, overlay, rawClipSettings, rawOverlay, curveDragClip, clipWhileDragging],
  )
  const latest = useRef({ settings, info, view, before, indicators, hover, draft, bypass, guiding, curveDraft, curveView, removing })
  latest.current = { settings, info, view, before, indicators, hover, draft, bypass, guiding, curveDraft, curveView, removing }
  /** The settings drawn: Before shows the defaults; a preset hovered, the crop being edited and switched-off groups apply on top. */
  const shownOf = (x: typeof latest.current, inf: SensorInfo): DevelopSettings => {
    // Before is the photo as shot: the defaults without lens corrections.
    if (x.before) return { ...defaultsFor(inf.kind), lens: LEGACY_LENS }
    let s = x.hover ?? x.settings
    if (x.curveDraft && !x.hover) s = withToneCurve(s, x.curveDraft.tc)
    if (x.bypass.basic) s = withoutBasic(s, defaultsFor(inf.kind))
    if (x.bypass.curve) s = withToneCurve(s, undefined)
    if (x.bypass.remove) s = withoutSpots(s)
    if (x.draft) return { ...s, geometry: x.draft }
    return x.bypass.crop ? { ...s, geometry: DEFAULT_GEOMETRY, lens: LEGACY_LENS } : s
  }

  // Histogram: measured on a small rendering of the (cropped) result shortly after each redraw (throttled, one at
  // a time). While a crop handle is being dragged it waits for the end of the drag.
  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statsBusy = useRef(false)
  const statsAgain = useRef(false)
  const scheduleStats = useCallback(() => {
    if (statsTimer.current !== null || cropDragging.current) return
    if (statsBusy.current) {
      statsAgain.current = true
      return
    }
    statsTimer.current = setTimeout(async () => {
      statsTimer.current = null
      const engine = engineRef.current
      const x = latest.current
      const inf = x.info
      if (!engine || !inf) return
      const shown = shownOf(x, inf)
      statsBusy.current = true
      try {
        const wb = x.before ? inf.asShotWb : multipliers(shown, inf)
        setStats(await gpuGate.foreground(() => engine.renderStats(displayUniforms(shown), wb, 256, x.indicators)))
        // The Tone Curve's graph shows its input: before the curve, or after the RGB curve for the channel curves.
        const v = x.curveView
        setCurveHist(await gpuGate.foreground(() => engine.renderCurveInput(displayUniforms(shown), wb, v.mode === 'point' && v.channel !== 'rgb', 256)))
      } catch {
        // e.g. engine closed while measuring
      } finally {
        statsBusy.current = false
        if (statsAgain.current) {
          statsAgain.current = false
          scheduleStats()
        }
      }
    }, 120)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const rendering = useRef(false)
  const pending = useRef(false)
  const requestRender = useCallback(() => {
    pending.current = true
    if (rendering.current) return
    rendering.current = true
    const endHold = gpuGate.hold()
    void (async () => {
      while (pending.current) {
        pending.current = false
        const engine = engineRef.current
        const x = latest.current
        const inf = x.info
        if (!engine || !inf) break
        const shown = shownOf(x, inf)
        // While cropping (or drawing Guided Upright lines), the whole straightened photo is shown.
        const v: ViewState = (x.draft || x.guiding) && !x.before ? { zoom: 'fit', center: [0.5, 0.5], frame: true } : x.view
        try {
          const ms = await engine.render(displayUniforms(shown), x.before ? inf.asShotWb : multipliers(shown, inf), v, x.indicators)
          setTiming((t) => ({ ...t, frame: ms }))
          if (v.frame) {
            const dpr = window.devicePixelRatio || 1
            const l = engine.layout(v, engine.canvas.width, engine.canvas.height)
            const box = { x: l.x / dpr, y: l.y / dpr, w: l.w / dpr, h: l.h / dpr }
            setFrameBox((b) => (b && Math.abs(b.x - box.x) + Math.abs(b.y - box.y) + Math.abs(b.w - box.w) + Math.abs(b.h - box.h) < 0.01 ? b : box))
          }
          if (x.removing) {
            // The Remove overlay maps through what was just drawn.
            const dpr = window.devicePixelRatio || 1
            const l = engine.layout(v, engine.canvas.width, engine.canvas.height)
            setShownBox((b) => ({ x: l.x / dpr, y: l.y / dpr, w: l.w / dpr, h: l.h / dpr, n: (b?.n ?? 0) + 1 }))
          }
          scheduleStats()
        } catch (e) {
          // A lost device: a new engine draws again (the engine lifetime effect).
          if (!(await lostMeanwhile(engine))) setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
        }
      }
      rendering.current = false
      endHold()
    })()
  }, [scheduleStats])

  useEffect(() => {
    if (status.kind === 'ready') requestRender()
  }, [status.kind, settings, view, before, indicators, hover, draft, bypass, guiding, removing, requestRender, lensDb, curveDraft])
  // Another curve graph shown: its histogram is measured again.
  useEffect(() => {
    if (status.kind === 'ready') scheduleStats()
  }, [status.kind, curveView.mode, curveView.channel, scheduleStats])

  // Spots being worked on: show the progress, and draw again when the retouched photo is ready.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    return engine.onRetouch((p) => {
      setRetouch(p)
      if (!p.busy) requestRender()
    })
  }, [engineReady, requestRender])

  // A 2D (read-back) canvas is blanked when the browser drops the page's GPU channel: draw again when it comes back.
  useEffect(() => {
    const canvas = engineRef.current?.canvas
    if (!canvas) return
    const redraw = () => requestRender()
    canvas.addEventListener('contextrestored', redraw)
    return () => canvas.removeEventListener('contextrestored', redraw)
  }, [engineReady, requestRender])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => requestRender())
    ro.observe(el)
    return () => ro.disconnect()
  }, [requestRender])

  // ---- saving (debounced): settings + history to the catalog, and a fresh thumbnail.
  // A save still waiting when the photo changes or Develop closes is run immediately, so no edit is lost.
  /** Saves a photo's settings and history, then refreshes its thumbnail and sidecar. */
  const persist = useCallback(
    async (photoId: number, h: History, inf: SensorInfo, engine: DevelopEngine | null) => {
      const s = current(h)
      await catalog.saveEdit(photoId, JSON.stringify(s), JSON.stringify(savedForm(h)))
      sidecars.schedule([photoId])
      try {
        if (engine) {
          await saveThumb(photoId, await renderThumbnail(engine, s, inf))
          forgetThumbUrl(photoId)
        }
      } catch {
        // The settings are saved; only the thumbnail refresh failed (e.g. the GPU was reset).
      }
      onEdited()
    },
    [catalog, onEdited],
  )

  useEffect(() => {
    if (!history || !info || !dirty.current) return
    const photoId = id
    const engine = engineRef.current
    const run = () => persist(photoId, history, info, engine)
    pendingSave.current = run
    const t = setTimeout(() => {
      pendingSave.current = null
      saving.current = run()
    }, 800)
    return () => clearTimeout(t)
  }, [persist, history, info, id])

  useEffect(
    () => () => {
      const run = pendingSave.current
      pendingSave.current = null
      let job = run ? run() : null
      // A crop still being edited is applied when leaving the photo or Develop, as Lightroom does.
      const d = draftRef.current
      const h = historyRef.current
      const inf = infoRef.current
      if (d && h && inf && !sameCropSession(current(h).geometry, d)) {
        const next = record(h, cropLabel(current(h).geometry, d), { ...current(h), geometry: d })
        const engine = engineRef.current
        job = (job ?? Promise.resolve()).then(() => persist(id, next, inf, engine))
      }
      if (job) saving.current = job
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  )

  /**
   * Records a change. Moving one of the sliders Auto set, by hand, ends the photo's Auto record (so a later Paste
   * copies the numbers instead of re-running Auto); `keepAuto` is for changes Auto and Paste make themselves.
   */
  const change = useCallback((label: string, next: DevelopSettings, keepAuto = false, separate = false) => {
    dirty.current = true
    setHistory((h) => {
      if (!h) return h
      const prev = current(h)
      const a = next.auto
      const s = a && !keepAuto && a.sliders.some((k) => next[k] !== prev[k]) ? { ...next, auto: null } : next
      return record(h, label, s, Date.now(), !separate)
    })
  }, [])

  /** A Tone Curve change (`separate`: the end of a drag, one history step of its own). */
  const changeCurve = useCallback(
    (label: string, tc: ToneCurveSettings | undefined, separate = false) => {
      const h = historyRef.current
      if (!h) return
      change(label, withToneCurve(current(h), tc), false, separate)
    },
    [change],
  )
  const toggleCurveTarget = () => {
    if (status.kind !== 'ready') return
    if (draft) endCrop(true)
    setGuiding(false)
    setRemoving(false)
    setSelectedSpot(null)
    setWbPick(false)
    setLoupe(null)
    setPicking(false)
    setBefore(false)
    setCurveTarget((t) => !t)
    setReveal({ id: 'curve', n: Date.now() })
  }
  /** The Tone Curve's input under a point of the photo shown (for its targeted adjustment tool). */
  const sampleCurveInput = useCallback(async (uv: [number, number]) => {
    const engine = engineRef.current
    const x = latest.current
    const inf = x.info
    if (!engine || !inf) return null
    const shown = shownOf(x, inf)
    const l = engine.layout(x.view, engine.canvas.width, engine.canvas.height)
    return engine.sampleBeforeCurve(displayUniforms(shown), multipliers(shown, inf), uv[0], uv[1], l.scale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ---- crop, straighten, rotate and flip
  function startCrop(level = false) {
    if (status.kind !== 'ready' || !info) return
    setGuiding(false)
    setCurveTarget(false)
    setRemoving(false)
    setSelectedSpot(null)
    setWbPick(false)
    setLoupe(null)
    setPicking(false)
    setBefore(false)
    setView((v) => ({ ...v, zoom: 'fit' }))
    if (!draft) {
      setDraft(settings.geometry)
      draftUndo.current = { back: [], ahead: [] }
    }
    setLeveling(level)
    setReveal({ id: 'crop', n: Date.now() })
  }
  function endCrop(apply: boolean) {
    if (apply && draft && !sameCropSession(settings.geometry, draft)) change(cropLabel(settings.geometry, draft), { ...settings, geometry: draft })
    setDraft(null)
    setLeveling(false)
    angleBase.current = null
    // The histogram measures the result again.
    requestRender()
  }
  /** While cropping, every change can be undone (Ctrl+Z) until the crop is applied. */
  function setDraftStep(next: GeometrySettings) {
    if (!draft) return
    draftUndo.current = { back: [...draftUndo.current.back, draft].slice(-100), ahead: [] }
    setDraft(next)
  }
  function draftHistory(dir: 'undo' | 'redo') {
    const u = draftUndo.current
    if (!draft) return
    const from = dir === 'undo' ? u.back : u.ahead
    if (!from.length) return
    const prev = from[from.length - 1]
    draftUndo.current = dir === 'undo' ? { back: u.back.slice(0, -1), ahead: [...u.ahead, draft] } : { back: [...u.back, draft], ahead: u.ahead.slice(0, -1) }
    setDraft(prev)
  }

  function editGeometry(e: GeometryEdit) {
    const base = draft ?? settings.geometry
    const fr = frameOf(base)
    if (!fr || status.kind !== 'ready') return
    let next: GeometrySettings
    let label: string
    // Angle slider moves continue one change (one undo step while cropping).
    const continuing = e.kind === 'angle' && angleBase.current?.last === base
    switch (e.kind) {
      case 'angle': {
        const from = continuing ? angleBase.current!.from : base
        next = setAngle(from, e.angle, fr[0], fr[1])
        angleBase.current = { from, last: next }
        label = 'Straighten'
        break
      }
      case 'aspect':
        next = setAspect(base, e.aspect, fr[0], fr[1], e.custom)
        label = 'Crop aspect'
        break
      case 'lock':
        next = setLocked(base, e.locked, fr[0], fr[1])
        label = e.locked ? 'Lock crop aspect' : 'Unlock crop aspect'
        break
      case 'swap':
        next = swapAspect(base, fr[0], fr[1])
        label = 'Swap crop aspect'
        break
      case 'rotate':
        next = rotate90(base, e.dir)
        label = e.dir === 1 ? 'Rotate right' : 'Rotate left'
        break
      case 'flip':
        next = flip(base, e.axis)
        label = e.axis === 'h' ? 'Flip horizontal' : 'Flip vertical'
        break
      case 'reset':
        next = DEFAULT_GEOMETRY
        label = 'Reset crop'
        break
    }
    if (e.kind !== 'angle') angleBase.current = null
    if (draft) {
      if (continuing) setDraft(next)
      else setDraftStep(next)
    } else if (JSON.stringify(next) !== JSON.stringify(base)) {
      change(label, { ...settings, geometry: next })
    }
  }
  const nextOverlay = () => {
    const i = CROP_OVERLAYS.findIndex((o) => o.id === cropOverlay.kind)
    setCropOverlay({ kind: CROP_OVERLAYS[(i + 1) % CROP_OVERLAYS.length].id })
  }
  const updateProcess = () => change(`Update to process ${CURRENT_PROCESS}`, { ...settings, process: CURRENT_PROCESS })
  // What the Lens section shows: resolved by the engine with the database as it is now (lensDb re-renders this).
  const lensStatus: LensStatus = status.kind === 'ready' && engineRef.current ? engineRef.current.lensNow(settings.lens).status : { state: info?.lens ? 'loading' : 'not-raw', exifLens: '' }

  // ---- Transform and Upright (engine/develop/upright.ts; uprightRun.ts runs it on the photo shown)
  /** The lines of the photo shown, detected once per lens correction (after it, before the perspective). */
  function lines(): Promise<Detection> | null {
    const engine = engineRef.current
    if (!engine) return null
    const lens = lensWarpKey(engine.lensNow(settings.lens).warp)
    if (!detection.current || detection.current.id !== id || detection.current.lens !== lens) {
      const job = detectLines(engine, settings.lens)
      detection.current = { id, lens, job }
      job.catch(() => {
        if (detection.current?.job === job) detection.current = null
      })
    }
    return detection.current.job
  }
  /** Transform changes work on the photo's settings: a crop being edited is applied first. */
  function transformBase(): DevelopSettings {
    if (draft) {
      endCrop(true)
      return draft && !sameCropSession(settings.geometry, draft) ? { ...settings, geometry: draft } : settings
    }
    return settings
  }
  async function applyUpright(mode: UprightMode) {
    const engine = engineRef.current
    if (!engine || !info || status.kind !== 'ready') return
    if (mode === 'guided') {
      startGuided()
      return
    }
    setGuiding(false)
    const base = transformBase()
    let det: Detection | null = null
    if (mode !== 'off') {
      setUprightBusy(true)
      try {
        det = await lines()
      } catch (e) {
        setUprightMsg({ text: `Line detection failed: ${e instanceof Error ? e.message : e}`, warn: true })
        return
      } finally {
        setUprightBusy(false)
      }
    }
    const r = uprightGeometry(engine, base.geometry, mode, det, info)
    if (!r.ok) {
      setUprightMsg({ text: r.message, warn: true })
      return
    }
    setUprightMsg(r.note ? { text: r.note, warn: true } : null)
    const label = mode === 'off' ? 'Upright: Off' : `Upright: ${mode[0].toUpperCase()}${mode.slice(1)}`
    if (!sameGeometry(r.geometry, base.geometry) || r.geometry.transform?.upright !== base.geometry.transform?.upright) change(label, { ...base, geometry: r.geometry })
  }
  function changeTransform(key: TransformSlider, value: number) {
    const engine = engineRef.current
    if (!engine || status.kind !== 'ready') return
    const base = transformBase()
    const t = { ...DEFAULT_TRANSFORM, focal: focalFor(info), ...base.geometry.transform, [key]: value }
    const label = `Transform: ${{ vertical: 'Vertical', horizontal: 'Horizontal', rotate: 'Rotate', aspect: 'Aspect', scale: 'Scale', offsetX: 'X Offset', offsetY: 'Y Offset' }[key]}`
    change(label, { ...base, geometry: withTransform(engine, base.geometry, t, false) })
  }
  function resetTransform() {
    const engine = engineRef.current
    if (!engine || status.kind !== 'ready' || !settings.geometry.transform) return
    setGuiding(false)
    setUprightMsg(null)
    const base = transformBase()
    const { transform: _gone, ...rest } = base.geometry
    void _gone
    change('Reset transform', { ...base, geometry: rest })
  }
  function startGuided() {
    const engine = engineRef.current
    if (!engine || !info || status.kind !== 'ready') return
    const base = transformBase()
    setBefore(false)
    setWbPick(false)
    setLoupe(null)
    setCurveTarget(false)
    setView((v) => ({ ...v, zoom: 'fit' }))
    setRemoving(false)
    setSelectedSpot(null)
    setGuiding(true)
    setSelectedGuide(null)
    setBypass((x) => ({ ...x, crop: false }))
    setReveal({ id: 'crop', n: Date.now() })
    const t = base.geometry.transform
    const guides = t?.upright === 'guided' ? t.guides : []
    const r = guidedGeometry(engine, base.geometry, guides, info)
    setUprightMsg(r.message ? { text: r.message, warn: false } : null)
    if (!sameGeometry(r.geometry, base.geometry) || t?.upright !== 'guided') change('Upright: Guided', { ...base, geometry: r.geometry })
  }
  function setGuides(guides: Guide[]) {
    const engine = engineRef.current
    if (!engine || !info) return
    const r = guidedGeometry(engine, settings.geometry, guides, info)
    setUprightMsg(r.message ? { text: r.message, warn: false } : null)
    const before = settings.geometry.transform?.guides.length ?? 0
    // Separate names, so adding a line and then moving one are separate steps (same-name steps merge for 1.5 s).
    change(guides.length > before ? 'Guided Upright: add line' : guides.length < before ? 'Guided Upright: remove line' : 'Guided Upright: move line', { ...settings, geometry: r.geometry })
  }
  function deleteGuide() {
    const t = settings.geometry.transform
    if (selectedGuide === null || !t) return
    setGuides(t.guides.filter((_, i) => i !== selectedGuide))
    setSelectedGuide(null)
  }
  async function autoStraightenNow() {
    const engine = engineRef.current
    if (!engine || !info || status.kind !== 'ready') return
    setStraightenBusy(true)
    let det: Detection
    try {
      det = await lines()!
    } catch (e) {
      setStraightenMsg(`Line detection failed: ${e instanceof Error ? e.message : e}`)
      return
    } finally {
      setStraightenBusy(false)
    }
    const g = draftRef.current ?? latest.current.settings.geometry
    const r = autoStraightenGeometry(engine, g, det)
    if (!r.ok) {
      setStraightenMsg(r.message)
      return
    }
    setStraightenMsg(null)
    angleBase.current = null
    if (draftRef.current) {
      setDraftStep(r.geometry)
      setLeveling(false)
    } else if (!sameGeometry(r.geometry, g)) change('Auto straighten', { ...latest.current.settings, geometry: r.geometry })
  }

  // ---- Remove, Heal and Clone (PHASE3.md, Part 11): spots in sensor pixels, the brush on the photo
  const spots = settings.spots ?? []
  const spotIndex = selectedSpot ? spots.findIndex((x) => x.id === selectedSpot) : -1
  const sensorSize = (): [number, number] => {
    const l = engineRef.current?.sensorLayout
    return l ? [l.width, l.height] : [1, 1]
  }
  function startRemove() {
    if (status.kind !== 'ready' || !info) return
    if (draft) endCrop(true)
    setGuiding(false)
    setCurveTarget(false)
    setWbPick(false)
    setLoupe(null)
    setPicking(false)
    setBefore(false)
    setBypass((b) => ({ ...b, remove: false }))
    setRemoving(true)
    setReveal({ id: 'remove', n: Date.now() })
  }
  function endRemove() {
    setRemoving(false)
    setSelectedSpot(null)
  }
  /** A spot list change, as one history step. */
  function changeSpots(label: string, next: Spot[]) {
    const s0 = latest.current.settings
    change(label, withSpots(s0, next))
  }
  /** A stroke painted on the photo (sensor pixels): a new spot, with its source picked automatically. */
  async function addSpot(points: [number, number][]) {
    const engine = engineRef.current
    if (!engine || status.kind !== 'ready' || placing) return
    const [sw, sh] = sensorSize()
    const radius = brush.size
    const simple = simplifyStroke(points, STROKE_EPSILON * radius)
    const spot: Spot = {
      id: newSpotId(),
      mode: brush.mode,
      points: simple.map(([x, y]) => [Math.round((x / sw) * 1e6) / 1e6, Math.round((y / sh) * 1e6) / 1e6]),
      size: Math.round((radius / Math.min(sw, sh)) * 1e6) / 1e6,
      feather: brush.feather / 100,
      opacity: brush.opacity / 100,
      offset: [0, 0],
      seed: newSeed(),
    }
    const others = latest.current.settings.spots ?? []
    setPlacing(true)
    setSpotError(null)
    try {
      const [dx, dy] = await engine.pickSpotSource(spot, others)
      spot.offset = [Math.round((dx / sw) * 1e6) / 1e6, Math.round((dy / sh) * 1e6) / 1e6]
    } catch (e) {
      setSpotError(`Couldn’t find a source: ${e instanceof Error ? e.message : e}`)
      return
    } finally {
      setPlacing(false)
    }
    if (engineRef.current !== engine) return
    const now = latest.current.settings.spots ?? []
    const name = { remove: 'Remove', heal: 'Heal', clone: 'Clone' }[spot.mode]
    changeSpots(`${name} spot ${now.length + 1}`, [...now, spot])
    setSelectedSpot(spot.id)
  }
  function moveSource(id: string, [dx, dy]: [number, number]) {
    const [sw, sh] = sensorSize()
    const list = latest.current.settings.spots ?? []
    const i = list.findIndex((x) => x.id === id)
    if (i < 0) return
    const offset: [number, number] = [Math.round((dx / sw) * 1e6) / 1e6, Math.round((dy / sh) * 1e6) / 1e6]
    changeSpots(`Move source of spot ${i + 1}`, list.map((x) => (x.id === id ? { ...x, offset } : x)))
  }
  /** Changes the selected spot (a slider or the mode), or else the brush for new spots. */
  function editSpot(what: 'mode' | 'size' | 'feather' | 'opacity', value: number | SpotMode) {
    const list = latest.current.settings.spots ?? []
    const i = selectedSpot ? list.findIndex((x) => x.id === selectedSpot) : -1
    if (i < 0) {
      if (what === 'mode') setBrush({ ...brush, mode: value as SpotMode })
      else if (what === 'size') setBrush({ ...brush, size: Math.min(SIZE_RANGE[1], Math.max(SIZE_RANGE[0], Math.round(value as number))) })
      else setBrush({ ...brush, [what]: Math.min(100, Math.max(what === 'opacity' ? 1 : 0, Math.round(value as number))) })
      return
    }
    const [sw, sh] = sensorSize()
    const v = value as number
    const patch: Partial<Spot> =
      what === 'mode' ? { mode: value as SpotMode }
        : what === 'size' ? { size: Math.round((Math.min(SIZE_RANGE[1], Math.max(SIZE_RANGE[0], v)) / Math.min(sw, sh)) * 1e6) / 1e6 }
          : { [what]: Math.min(1, Math.max(what === 'opacity' ? 0.01 : 0, v / 100)) }
    const label = what === 'mode' ? `Spot ${i + 1}: ${{ remove: 'Remove', heal: 'Heal', clone: 'Clone' }[value as SpotMode]}` : `Spot ${i + 1}: ${what}`
    changeSpots(label, list.map((x, k) => (k === i ? { ...x, ...patch } : x)))
  }
  function deleteSpot() {
    const list = latest.current.settings.spots ?? []
    const i = selectedSpot ? list.findIndex((x) => x.id === selectedSpot) : -1
    if (i < 0) return
    setSelectedSpot(null)
    changeSpots(`Delete spot ${i + 1}`, list.filter((_, k) => k !== i))
  }
  function clearSpots() {
    if (!spots.length) return
    setSelectedSpot(null)
    changeSpots('Delete all spots', [])
  }
  /** Moves a zoomed-in photo while the brush is on (Space-drag). */
  function panBy(dx: number, dy: number) {
    const engine = engineRef.current
    if (!engine || view.zoom === 'fit') return
    const dpr = window.devicePixelRatio || 1
    const l = engine.layout(view, engine.canvas.width, engine.canvas.height)
    setView((v) => ({ zoom: v.zoom, center: [Math.min(1, Math.max(0, v.center[0] - (dx * dpr) / l.w)), Math.min(1, Math.max(0, v.center[1] - (dy * dpr) / l.h))] }))
  }
  const spotStatus = placing
    ? 'Finding where to take the fill from…'
    : retouch.busy && retouch.spot !== undefined
      ? `Filling spot ${retouch.spot + 1}… ${Math.round((retouch.fraction ?? 0) * 100)} %`
      : retouch.busy
        ? 'Applying spots…'
        : spotError

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
    let next = ownFocal(applyPaste(settings, clip, info.kind, engine.imageSize), info)
    if (clip.keys.includes('upright') && wantsUprightRerun(clip.settings)) {
      setUprightBusy(true)
      try {
        next = await rerunUpright(engine, next, info)
      } catch (e) {
        setUprightMsg({ text: `Upright failed: ${e instanceof Error ? e.message : e}`, warn: true })
      } finally {
        setUprightBusy(false)
      }
    }
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

  function confirmPaste(clip: Clipboard, name: string) {
    const mode = pasting?.mode
    setPasting(null)
    if (mode === 'preset') void savePreset(clip, name)
    else if (mode === 'copy') settingsClipboard.set(clip)
    else if (mode === 'paste') void pasteHere(clip)
    else if (mode === 'sync') batch.run({ label: 'Sync settings', ids: others, clip })
  }

  // ---- presets
  useEffect(() => {
    const load = () => void loadPresets().then(setPresets)
    load()
    return presetsChanged.subscribe(load)
  }, [])

  // The Amount slider stays while the photo shows what the preset set; any other change (or another photo) ends it.
  const amountFor = applied && applied.result === settings ? applied : null

  async function applyPreset(p: Preset) {
    const engine = engineRef.current
    if (!engine || !info || status.kind !== 'ready') return
    setHoverPreset(null)
    const before = settings
    let after = ownFocal(applyPaste(before, presetClip(p), info.kind, engine.imageSize), info)
    if (p.keys.includes('upright') && wantsUprightRerun(p.settings)) after = await rerunUpright(engine, after, info).catch(() => after)
    if (p.rerunAuto && p.settings.auto) {
      setAutoBusy(true)
      try {
        after = await rerunAuto(engine, { ...after, auto: p.settings.auto }, info)
        builtStage.current = stageOptions(after, info)
      } catch (e) {
        setStatus({ kind: 'error', message: `Auto failed: ${e instanceof Error ? e.message : e}` })
        return
      } finally {
        setAutoBusy(false)
      }
    }
    change(`Preset: ${p.name}`, after, true)
    setApplied({ preset: p, before, after, amount: 1, result: after })
  }

  function changeAmount(amount: number) {
    if (!amountFor || !info) return
    const result = blendSettings(amountFor.before, amountFor.after, amount, info.asShot)
    dirty.current = true
    setHistory((h) => (h && current(h) === amountFor.result ? replaceCurrent(h, result) : h))
    setApplied({ ...amountFor, amount, result })
  }

  function openNewPreset() {
    // Pre-tick what differs from the defaults, so a preset holds what was actually changed.
    // Spots belong to one photo: a preset holds them only when ticked by hand.
    const changed = changedKeys(defaults, settings).filter((k) => k !== 'spots')
    const { keys } = rememberedChoice()
    const clip = clipFor(changed.length ? changed : keys, !!settings.auto)
    if (clip && status.kind === 'ready') setPasting({ mode: 'preset', clip })
  }

  async function savePreset(clip: Clipboard, name: string) {
    const data: PresetData = { keys: clip.keys, settings: clip.settings, rerunAuto: clip.rerunAuto && !!clip.settings.auto, sourceKind: clip.sourceKind }
    await catalog.savePreset(name, JSON.stringify(data))
    presetsChanged.emit()
  }

  async function removePreset(p: Preset) {
    if (p.starter || !window.confirm(`Delete the preset “${p.name}”? Photos it was applied to keep their settings.`)) return
    await catalog.deletePreset(Number(p.id.slice('user:'.length)))
    presetsChanged.emit()
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
    // Spots belong to one photo, so Auto Sync doesn't send them (Sync… can, when they are ticked).
    changedKeys(prev.settings, settings).forEach((k) => k !== 'spots' && p.keys.add(k))
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
  useShortcuts(['crop'], !pasting && !!draft, (cmd) => {
    switch (cmd) {
      case 'develop.crop':
      case 'crop.apply': endCrop(true); break
      case 'crop.cancel': endCrop(false); break
      case 'crop.overlay': nextOverlay(); break
      case 'crop.swap': editGeometry({ kind: 'swap' }); break
      case 'crop.lock': editGeometry({ kind: 'lock', locked: !geometry.locked }); break
      case 'crop.reset': editGeometry({ kind: 'reset' }); break
      case 'develop.undo': draftHistory('undo'); break
      case 'develop.redo': draftHistory('redo'); break
      case 'develop.rotateLeft': editGeometry({ kind: 'rotate', dir: -1 }); break
      case 'develop.rotateRight': editGeometry({ kind: 'rotate', dir: 1 }); break
      case 'develop.flipH': editGeometry({ kind: 'flip', axis: 'h' }); break
      case 'develop.flipV': editGeometry({ kind: 'flip', axis: 'v' }); break
      case 'develop.level': setLeveling((l) => !l); break
      case 'develop.autoStraighten': void autoStraightenNow(); break
      default:
        return false
    }
  })
  useShortcuts(['guided'], !pasting && !draft && guiding, (cmd) => {
    switch (cmd) {
      case 'develop.guided':
      case 'guided.done':
        setGuiding(false)
        setSelectedGuide(null)
        break
      case 'guided.delete': deleteGuide(); break
      case 'develop.undo':
      case 'develop.redo':
        dirty.current = true
        setSelectedGuide(null)
        setHistory((h) => (h ? (cmd === 'develop.redo' ? redo(h) : undo(h)) : h))
        break
      default:
        return false
    }
  })
  // While the Tone Curve's targeted adjustment tool is on, Develop listens to 'curve' (CurveTatLayer has its keys).
  useShortcuts(['curve'], !pasting && !draft && !guiding && curveTarget, (cmd) => {
    switch (cmd) {
      case 'develop.curveTarget': setCurveTarget(false); break
      case 'develop.undo':
      case 'develop.redo':
        dirty.current = true
        setHistory((h) => (h ? (cmd === 'develop.redo' ? redo(h) : undo(h)) : h))
        break
      case 'develop.before': setBefore((b) => !b); break
      case 'develop.clipping': setOverlay((o) => !o); break
      case 'develop.zoom': setView((v) => ({ zoom: v.zoom === 'fit' ? 1 : 'fit', center: v.center })); break
      default:
        return false
    }
  })
  useShortcuts(['remove'], !pasting && !draft && !guiding && removing, (cmd) => {
    switch (cmd) {
      case 'develop.remove':
      case 'remove.done': endRemove(); break
      case 'remove.cancel':
        if (selectedSpot) setSelectedSpot(null)
        else endRemove()
        break
      case 'remove.delete': deleteSpot(); break
      case 'remove.sizeUp':
      case 'remove.sizeDown': {
        const cur = spotIndex >= 0 ? spots[spotIndex].size * Math.min(...sensorSize()) : brush.size
        editSpot('size', cmd === 'remove.sizeUp' ? Math.max(cur + 1, cur * 1.15) : Math.min(cur - 1, cur / 1.15))
        break
      }
      case 'remove.featherUp':
      case 'remove.featherDown': {
        const cur = spotIndex >= 0 ? spots[spotIndex].feather * 100 : brush.feather
        editSpot('feather', cur + (cmd === 'remove.featherUp' ? 10 : -10))
        break
      }
      case 'remove.showAll': setShowAllSpots({ on: !showAllSpots.on }); break
      case 'remove.modeRemove': editSpot('mode', 'remove'); break
      case 'remove.modeHeal': editSpot('mode', 'heal'); break
      case 'remove.modeClone': editSpot('mode', 'clone'); break
      case 'remove.clear': clearSpots(); break
      case 'develop.before': setBefore((b) => !b); break
      case 'develop.zoom': setView((v) => ({ zoom: v.zoom === 'fit' ? 1 : 'fit', center: v.center })); break
      case 'develop.undo':
      case 'develop.redo':
        dirty.current = true
        setSelectedSpot(null)
        setHistory((h) => (h ? (cmd === 'develop.redo' ? redo(h) : undo(h)) : h))
        break
      default:
        return false
    }
  })
  useShortcuts(['develop'], !pasting && !draft && !guiding && !curveTarget && !removing, (cmd) => {
    switch (cmd) {
      case 'develop.grid': onLibrary(); break
      case 'develop.curveTarget': toggleCurveTarget(); break
      case 'develop.curveReset': changeCurve('Reset tone curve', undefined, true); break
      case 'develop.remove': startRemove(); break
      case 'remove.clear': clearSpots(); break
      case 'develop.crop': startCrop(); break
      case 'develop.level': startCrop(true); break
      case 'develop.autoStraighten': void autoStraightenNow(); break
      case 'develop.guided': startGuided(); break
      case 'develop.uprightAuto': void applyUpright('auto'); break
      case 'develop.uprightOff': void applyUpright('off'); break
      case 'develop.transformReset': resetTransform(); break
      case 'crop.reset': editGeometry({ kind: 'reset' }); break
      case 'develop.rotateLeft': editGeometry({ kind: 'rotate', dir: -1 }); break
      case 'develop.rotateRight': editGeometry({ kind: 'rotate', dir: 1 }); break
      case 'develop.flipH': editGeometry({ kind: 'flip', axis: 'h' }); break
      case 'develop.flipV': editGeometry({ kind: 'flip', axis: 'v' }); break
      case 'export': onExport([id]); break
      // Copy always asks which settings to copy.
      case 'settings.copy': openCopy('copy'); break
      case 'settings.paste': openPaste(); break
      case 'settings.sync': openCopy('sync'); break
      case 'develop.undo':
      case 'develop.redo':
        dirty.current = true
        setHistory((h) => (h ? (cmd === 'develop.redo' ? redo(h) : undo(h)) : h))
        break
      case 'develop.before': setBefore((b) => !b); break
      // darktable: Shift+O toggles the raw (sensor) clipping indicator.
      case 'develop.sensorClipping': setRawOverlay((o) => !o); break
      // J as in Lightroom, O as in darktable.
      case 'develop.clipping': setOverlay((o) => !o); break
      case 'develop.zoom': setView((v) => ({ zoom: v.zoom === 'fit' ? 1 : 'fit', center: v.center })); break
      case 'develop.next':
        if (index >= ids.length - 1) return false
        pick(ids[index + 1])
        break
      case 'develop.prev':
        if (index <= 0) return false
        pick(ids[index - 1])
        break
      // Lightroom: W selects the white balance picker.
      case 'develop.whiteBalance':
        setWbPick((p) => !p)
        setLoupe(null)
        setCurveTarget(false)
        break
      case 'develop.cancel':
        setPicking(false)
        setWbPick(false)
        setLoupe(null)
        setView((v) => ({ ...v, zoom: 'fit' }))
        break
      default:
        return false
    }
  })
  useKeymapVersion()

  // ---- click to zoom, drag to pan
  const drag = useRef<{ x: number; y: number; center: [number, number]; moved: boolean } | null>(null)
  function canvasPoint(e: { clientX: number; clientY: number }) {
    const engine = engineRef.current
    if (!engine) return null
    const r = engine.canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const l = engine.layout(view, engine.canvas.width, engine.canvas.height)
    return { l, px: (e.clientX - r.left) * dpr, py: (e.clientY - r.top) * dpr }
  }
  /** Pointer position as displayed-image uv, or null outside the photo. */
  function imageUv(e: { clientX: number; clientY: number }): [number, number] | null {
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
    const { temperature, tint } = temperatureOf(engine.neutralMultipliers(working), info)
    change('White balance: picker', { ...settings, whiteBalance: { mode: 'custom', temperature, tint } })
  }

  function onPointerDown(e: React.PointerEvent) {
    // The crop tool and Guided Upright have their own overlays; clicks there don't zoom or pan.
    if (status.kind !== 'ready' || wbPick || draft || guiding || (removing && !before)) return
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
    if (!d || view.zoom === 'fit' || draft) return
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
    if (!d || d.moved || draft || guiding) return
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
        <PresetPanel
          presets={presets}
          applied={amountFor ? { id: amountFor.preset.id, amount: amountFor.amount } : null}
          disabled={status.kind !== 'ready' || autoBusy}
          onHover={setHoverPreset}
          onApply={(p) => void applyPreset(p)}
          onAmount={changeAmount}
          onNew={openNewPreset}
          onDelete={(p) => void removePreset(p)}
        />
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
          <button className="button small" disabled={!history || !canUndo(history)} onClick={() => { dirty.current = true; setHistory((h) => (h ? undo(h) : h)) }} title={withKey('Undo', 'develop.undo')}>Undo</button>
          <button className="button small" disabled={!history || !canRedo(history)} onClick={() => { dirty.current = true; setHistory((h) => (h ? redo(h) : h)) }} title={withKey('Redo', 'develop.redo')}>Redo</button>
          <button className="button small" disabled={status.kind !== 'ready'} onClick={reset}>Reset all</button>
        </div>
        <div className="dleft-actions">
          <button className="button small" disabled={status.kind !== 'ready'} onClick={() => openCopy('copy')} title={withKey('Choose settings to copy', 'settings.copy')}>Copy…</button>
          <button className="button small" disabled={status.kind !== 'ready' || !hasClip} onClick={openPaste} title={withKey('Paste settings onto this photo', 'settings.paste')}>Paste…</button>
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
          <button className={`button small ${draft ? 'on' : ''}`} onClick={() => (draft ? endCrop(true) : startCrop())} disabled={status.kind !== 'ready'} title={withKey(draft ? 'Apply the crop' : 'Crop and straighten', 'develop.crop')}>
            {draft ? 'Done' : 'Crop'}
          </button>
          <button className={`button small ${removing ? 'on' : ''}`} onClick={() => (removing ? endRemove() : startRemove())} disabled={status.kind !== 'ready'} title={withKey(removing ? 'Finish with the Remove brush' : 'Remove, Heal and Clone: paint over what to remove', 'develop.remove')}>
            {removing ? 'Done' : 'Remove'}
          </button>
          <button className={`button small ${before ? 'on' : ''}`} onClick={() => setBefore(!before)} disabled={status.kind !== 'ready' || !!draft} title={withKey('Before / after', 'develop.before')}>
            {before ? 'Showing before' : 'Before / after'}
          </button>
          <button className="button small" onClick={() => setView((v) => ({ zoom: v.zoom === 'fit' ? 1 : 'fit', center: v.center }))} disabled={status.kind !== 'ready'} title={withKey('Zoom', 'develop.zoom')}>
            {view.zoom === 'fit' ? 'Fit' : '100 %'}
          </button>
          <span className="sync-group">
            <button
              className="button small"
              disabled={status.kind !== 'ready' || !others.length}
              onClick={() => openCopy('sync')}
              title={others.length ? withKey(`Apply settings from this photo to the ${others.length} other selected`, 'settings.sync') : 'Ctrl+click photos in the filmstrip to select them, then sync'}
            >
              Sync…{others.length ? ` (${others.length})` : ''}
            </button>
            <label className="check small" title="Every change here also goes to the other selected photos">
              <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} disabled={!others.length} />
              Auto Sync
            </label>
          </span>
          <button className="button small" onClick={() => onExport([id])} title={withKey('Export this photo', 'export')}>Export…</button>
        </div>
        <div
          className={`dstage ${draft ? 'cropping' : guiding ? 'guiding' : removing ? 'removing' : view.zoom === 'fit' ? 'fit' : 'zoomed'} ${wbPick ? 'wb-picking' : ''}`}
          ref={stageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setLoupe(null)}
        >
          {status.kind !== 'ready' && placeholder && <img className="dplaceholder" src={placeholder} alt="" />}
          {curveTarget && !draft && !guiding && !before && status.kind === 'ready' && (
            <CurveTatLayer
              curve={settings.toneCurve}
              view={curveView}
              enabled={!pasting}
              uvAt={imageUv}
              sample={sampleCurveInput}
              onHover={setCurveHover}
              onDraft={(tc) => setCurveDraft(tc === null ? null : { tc })}
              onChange={changeCurve}
              onDragClip={setCurveDragClip}
              onExit={() => setCurveTarget(false)}
            />
          )}
          {status.kind === 'loading' && <div className="dmessage">Developing…</div>}
          {status.kind === 'error' && <div className="dmessage error">{status.message}</div>}
          {engineError && <div className="dmessage error">{engineError}</div>}
          {draft && frameBox && info && status.kind === 'ready' && (
            <CropOverlay
              box={frameBox}
              frame={frameOf(draft) ?? [1, 1]}
              geometry={draft}
              overlay={cropOverlay.kind}
              leveling={leveling}
              onBegin={() => {
                cropDragging.current = true
                angleBase.current = null
                draftUndo.current = { back: [...draftUndo.current.back, draft].slice(-100), ahead: [] }
              }}
              onChange={setDraft}
              onEnd={() => {
                cropDragging.current = false
                scheduleStats()
              }}
              onLevelDone={() => setLeveling(false)}
              onAutoLevel={() => void autoStraightenNow()}
            />
          )}
          {guiding && !draft && !before && frameBox && info && status.kind === 'ready' && engineRef.current && (() => {
            const m = frameMaps(engineRef.current, settings.geometry)
            const guides = settings.geometry.transform?.guides ?? []
            const [fw, fh] = m.frame
            const toView = (x: number, y: number): [number, number] => {
              const f = m.toFrame(x, y)
              return [frameBox.x + (f[0] / fw) * frameBox.w, frameBox.y + (f[1] / fh) * frameBox.h]
            }
            const lines = guidesToSensor(guides, m.orient, m.sensor[0], m.sensor[1]).map(([x1, y1, x2, y2]) => [...toView(x1, y1), ...toView(x2, y2)] as [number, number, number, number])
            const [ow, oh] = m.orient[0] === 0 ? [m.sensor[1], m.sensor[0]] : m.sensor
            return (
              <GuidedOverlay
                box={frameBox}
                lines={lines}
                vertical={guides.map((g) => guideIsVertical(g, ow, oh))}
                guides={guides}
                selected={selectedGuide}
                onSelect={setSelectedGuide}
                fromView={(x, y) => {
                  const [sx, sy] = m.toSensor(((x - frameBox.x) / frameBox.w) * fw, ((y - frameBox.y) / frameBox.h) * fh)
                  return sensorToGuide(sx, sy, m.orient, m.sensor[0], m.sensor[1])
                }}
                onChange={setGuides}
              />
            )
          })()}
          {removing && !draft && !guiding && !before && !bypass.remove && shownBox && info && status.kind === 'ready' && engineRef.current && (() => {
            const engine = engineRef.current
            const b = shownBox
            return (
              <RemoveOverlay
                key={id}
                box={b}
                toView={(x, y) => {
                  const [u, v] = engine.sensorToDisplay(x, y)
                  return [b.x + u * b.w, b.y + v * b.h]
                }}
                fromView={(x, y) => engine.displayToSensor((x - b.x) / b.w, (y - b.y) / b.h)}
                spots={spots}
                sensor={sensorSize()}
                brush={{ radius: brush.size, feather: brush.feather / 100 }}
                selected={selectedSpot}
                showAll={showAllSpots.on}
                progress={retouch.busy && retouch.spot !== undefined ? { spot: retouch.spot, fraction: retouch.fraction ?? 0 } : null}
                onStroke={(pts) => {
                  setSelectedSpot(null)
                  void addSpot(pts)
                }}
                onSelect={setSelectedSpot}
                onMoveSource={moveSource}
                onPan={(dx, dy) => panBy(dx, dy)}
              />
            )
          })()}
          {removing && !draft && !guiding && (
            <div className="dbadge crop-hint">
              {before || bypass.remove ? 'Spots hidden' : 'Paint over what to remove · click a pin to select · drag the dashed outline to change the source'} · [ ] size · Delete removes the spot · Enter finishes
            </div>
          )}
          {guiding && !draft && (
            <div className="dbadge crop-hint">
              Draw 2–4 lines along edges that should be vertical or horizontal · drag the ends to adjust · Delete removes the selected line · Esc finishes
            </div>
          )}
          {draft && (
            <div className="dbadge crop-hint">
              {leveling ? 'Draw along something that should be level or upright · double-click for Auto' : 'Drag corners or edges · drag inside to move · drag outside to turn · Ctrl-drag to level'} · Enter applies · Esc cancels
            </div>
          )}
          {before && <div className="dbadge">Before</div>}
          {!before && hoverPreset && !draft && <div className="dbadge">Preview: {hoverPreset.name}</div>}
          {!before && !draft && (bypass.crop || bypass.remove || bypass.basic || bypass.curve) && (
            <div className="dbadge">Hidden: {[bypass.crop && 'Crop & Lens', bypass.remove && 'Remove', bypass.basic && 'Basic', bypass.curve && 'Tone Curve'].filter(Boolean).join(', ')}</div>
          )}
          {curveTarget && !draft && !guiding && !before && (
            <div className="dbadge pick curve-hint">
              Tone curve: drag up or down on the photo to change those tones · ↑ ↓ nudge · Esc ends
            </div>
          )}
          {(overlay || rawOverlay) && (
            <div className="dbadge right">
              {[overlay && withKey('Clipping shown', 'develop.clipping'), rawOverlay && withKey('Sensor clipping shown', 'develop.sensorClipping')].filter(Boolean).join(' · ')}
            </div>
          )}
          {wbPick && <div className="dbadge pick">Click something that should be neutral grey or white · Esc to cancel</div>}
          {wbPick && loupe && <WbLoupe x={loupe.x} y={loupe.y} image={loupe.image} zoom={LOUPE_ZOOM} />}
          {picking && <div className="dbadge pick">Click a photo in the filmstrip to match its look · Esc to cancel</div>}
          {gpuNotice && <div className="dbadge gpu-notice" role="status">{gpuNotice}</div>}
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
        <ToolStack
          reveal={reveal}
          header={
            status.kind === 'ready' && processStatus(settings.process) === 'older' ? (
              <div className="process-offer">
                <span>This photo was edited with process version {settings.process}.</span>
                <button
                  className="button small"
                  onClick={updateProcess}
                  title={`Render it with LightBench’s current rendering (version ${CURRENT_PROCESS}). The photo may change; the previous step stays in the History, so you can compare and undo.\n\n${PROCESS_VERSIONS.filter((p) => p.version > settings.process).map((p) => `Version ${p.version}: ${p.summary}`).join('\n')}`}
                >
                  Update to current process
                </button>
              </div>
            ) : null
          }
          footer={
            status.kind === 'ready' && (
              <p
                className="process-line muted small"
                title="The version of LightBench’s rendering this edit uses. A later version never changes an edit until you choose to update it."
              >
                Process version {settings.process}
                {processStatus(settings.process) === 'current'
                  ? ' (current)'
                  : processStatus(settings.process) === 'newer'
                    ? ` (from a newer LightBench; shown with version ${CURRENT_PROCESS})`
                    : ''}
              </p>
            )
          }
          groups={[
            {
              id: 'crop',
              label: 'Crop',
              title: 'Crop & Lens',
              icon: GROUP_ICONS.crop,
              bypass: isIdentityGeometry(settings.geometry) && lensStatus.state !== 'applied' && !bypass.crop
                ? undefined
                : { off: bypass.crop, onToggle: () => setBypass((b) => ({ ...b, crop: !b.crop })), title: bypass.crop ? 'Show the crop, lens corrections and transform again' : 'Show the photo without crop, straighten, rotate, flip, lens corrections and transform (nothing is changed)' },
              content: (
                <>
                <CropPanel
                  geometry={geometry}
                  frame={info ? frameOf(geometry) : null}
                  cropSize={info && engineRef.current ? engineRef.current.outputSize(geometry) : null}
                  cropping={!!draft}
                  leveling={leveling}
                  overlay={cropOverlay.kind}
                  disabled={status.kind !== 'ready'}
                  showHint={hintsPref === 1}
                  onToggleCrop={() => (draft ? endCrop(true) : startCrop())}
                  onApply={() => endCrop(true)}
                  onCancel={() => endCrop(false)}
                  onLevel={() => (draft ? setLeveling((l) => !l) : startCrop(true))}
                  onAutoStraighten={() => void autoStraightenNow()}
                  straightening={straightenBusy}
                  straightenMessage={straightenMsg}
                  onOverlay={(kind) => setCropOverlay({ kind })}
                  onEdit={editGeometry}
                />
                <LensPanel
                  lens={settings.lens}
                  status={lensStatus}
                  meta={info?.lens ?? null}
                  db={lensDb}
                  disabled={status.kind !== 'ready'}
                  showHint={hintsPref === 1}
                  onLoadDb={() => void loadLensfun(true)}
                  onChange={(label, lens) => change(label, { ...settings, lens })}
                />
                <TransformPanel
                  transform={settings.geometry.transform}
                  focal={info ? info.focal35 ?? null : null}
                  busy={uprightBusy}
                  message={uprightMsg}
                  summary={engineRef.current && info ? describeCorrection(engineRef.current, settings.geometry) : null}
                  guiding={guiding}
                  disabled={status.kind !== 'ready'}
                  showHint={hintsPref === 1}
                  onMode={(m) => (m === 'guided' && guiding ? setGuiding(false) : void applyUpright(m))}
                  onSlider={changeTransform}
                  onReset={resetTransform}
                />
                </>
              ),
            },
            {
              id: 'remove',
              label: 'Remove',
              title: 'Remove',
              icon: GROUP_ICONS.remove,
              bypass: spots.length || bypass.remove
                ? { off: bypass.remove, onToggle: () => setBypass((b) => ({ ...b, remove: !b.remove })), title: bypass.remove ? 'Show the spots again' : 'Show the photo without its Remove, Heal and Clone spots (nothing is changed)' }
                : undefined,
              content: (
                <RemovePanel
                  active={removing}
                  brush={brush}
                  selected={spotIndex >= 0 ? { spot: spots[spotIndex], number: spotIndex + 1, size: Math.round(spots[spotIndex].size * Math.min(...sensorSize())) } : null}
                  count={spots.length}
                  showAll={showAllSpots.on}
                  status={spotStatus}
                  disabled={status.kind !== 'ready'}
                  showHint={hintsPref === 1}
                  onToggle={() => (removing ? endRemove() : startRemove())}
                  onMode={(m) => editSpot('mode', m)}
                  onSize={(v) => editSpot('size', v)}
                  onFeather={(v) => editSpot('feather', v)}
                  onOpacity={(v) => editSpot('opacity', v)}
                  onShowAll={(on) => setShowAllSpots({ on })}
                  onDelete={deleteSpot}
                  onClear={clearSpots}
                />
              ),
            },
            {
              id: 'basic',
              label: 'Basic',
              title: 'Basic',
              icon: GROUP_ICONS.basic,
              bypass: { off: bypass.basic, onToggle: () => setBypass((b) => ({ ...b, basic: !b.basic })), title: bypass.basic ? 'Show the Basic adjustments again' : 'Show the photo without white balance, tone and presence (nothing is changed)' },
              content: (
        <BasicPanel
          settings={settings}
          asShot={info?.asShot ?? null}
          kind={info?.kind ?? 'raw'}
          layout={info?.layout}
          defaults={defaults}
          onChange={change}
          disabled={status.kind !== 'ready'}
          hints={hintsPref === 1}
          onHints={(on) => setHintsPref(on ? 1 : 2)}
          pickingWb={wbPick}
          onPickWb={() => {
            // The picker works on the cropped photo: a crop being edited is applied first.
            if (draft) endCrop(true)
            setWbPick((p) => !p)
            setLoupe(null)
            setCurveTarget(false)
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
              ),
            },
            {
              id: 'curve',
              label: 'Curve',
              title: 'Tone Curve',
              icon: GROUP_ICONS.curve,
              bypass: settings.toneCurve || bypass.curve
                ? { off: bypass.curve, onToggle: () => setBypass((b) => ({ ...b, curve: !b.curve })), title: bypass.curve ? 'Show the tone curve again' : 'Show the photo without the tone curve (nothing is changed)' }
                : undefined,
              content: (
                <ToneCurvePanel
                  curve={curveDraft ? curveDraft.tc : settings.toneCurve}
                  view={curveView}
                  onView={setCurveView}
                  disabled={status.kind !== 'ready'}
                  showHint={hintsPref === 1}
                  histogram={curveHist}
                  tat={curveTarget}
                  onTat={toggleCurveTarget}
                  hover={curveTarget ? curveHover : null}
                  onChange={changeCurve}
                  onDraft={(tc) => setCurveDraft(tc === null ? null : { tc })}
                  onDragClip={setCurveDragClip}
                  clipWhileDragging={clipWhileDragging === 1}
                  onClipWhileDragging={(on) => setClipWhileDragging(on ? 1 : 2)}
                />
              ),
            },
          ]}
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
