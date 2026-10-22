import { keyText, useKeymapVersion, useShortcuts, withKey } from '../settings/shortcuts'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getCatalog } from '../catalog/client'
import { forgetThumbUrl, holdThumbUrl, loadThumb, saveThumb } from '../catalog/thumbs'
import type { PhotoDetail } from '../catalog/types'
import { AUTO_SLIDERS, BUILT_IN_TARGETS, metricsFromStats, solveAuto, statsFromPixels, targetFromMetrics, type AutoKey, type AutoTarget } from '../engine/develop/auto'
import { defaultsFor, displayUniforms, normalizeSettings, type DevelopSettings } from '../engine/develop/settings'
import { DEFAULT_GEOMETRY, flip, isIdentityGeometry, resetCrop, rotate90, sameGeometry, setAngle, setAspect, setLocked, swapAspect, type GeometrySettings } from '../engine/develop/geometry'
import { CURRENT_PROCESS, PROCESS_VERSIONS, processStatus } from '../engine/develop/process'
import { DevelopEngine, GpuWorkError, type ImageStats, type RawStageOptions, type ViewState } from '../engine/gpu/develop-engine'
import { GpuRecovery, type GpuTrouble } from './gpuRecovery'
import { gpuGate } from '../engine/gpu/gate'
import type { RetouchProgress } from '../engine/gpu/retouch-stage'
import { newSeed, newSpotId, simplifyStroke, STROKE_EPSILON, type Spot, type SpotMode } from '../engine/develop/spots'
import { RemoveOverlay } from './RemoveOverlay'
import { RemovePanel } from './RemovePanel'
import { DEFAULT_BRUSH, SIZE_RANGE, type BrushSettings } from './removeBrush'
import { RawDecoder } from '../engine/raw/decoder'
import type { DecodeResult } from '../engine/raw/types'
import { displayToSensorAt, sensorToDisplayAt, type ShownMap } from '../engine/develop/shown-map'
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
import { DetailPanel } from './DetailPanel'
import { detailOn, withDetail } from '../engine/detail/settings'
import type { ProfileChoice } from '../engine/detail/noiseprofiles'
import type { RadiusChoice } from '../engine/detail/capture'
import { loadNoiseProfiles, noiseProfilesState, subscribeNoiseProfiles } from '../engine/detail/noise-db'
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
import { applyPaste, changedKeys, NOT_AUTO_SYNCED, rememberedChoice, settingsClipboard, type Clipboard, type PasteKey } from './paste'
import { PasteDialog } from './PasteDialog'
import { PresetPanel } from './PresetPanel'
import { blendSettings, presetClip, type Preset, type PresetData } from './presets'
import { loadPresets, presetsChanged } from './presetStore'
import { CurveTatLayer } from './CurveTatLayer'
import { ToneCurvePanel, type CurveView } from './ToneCurvePanel'
import { withToneCurve, type ToneCurveSettings } from '../engine/develop/tone-curve'
import { ColourMixerPanel } from './ColourMixerPanel'
import { ColourGradingPanel } from './ColourGradingPanel'
import { DEFAULT_GRADING_VIEW, type GradingView } from './gradingUi'
import { boostedGrading, withColourGrading, type ColourGradingSettings } from '../engine/develop/colour-grading'
import { DEFAULT_MIXER_UI, type MixerUi } from './mixerUi'
import { MixerTatLayer, PointPickLayer } from './MixerTatLayer'
import { CHANNEL_NAMES, BAND_NAMES, MAX_POINTS, newPoint, withColourMixer, withPoints, type ColourMixerSettings, type MixerChannel } from '../engine/develop/colour-mixer'
import { applyEyes, eyeShown, hiddenNames, NO_GROUP_EYES, wbHidden, type SectionGroup, type SectionId } from './sectionEyes'
import { EffectsPanel } from './EffectsPanel'
import { effectsGroupOn, withEffects } from '../engine/develop/effects'
import { SectionEyeContext, type SectionEyes } from './sectionEyeContext'
import { CurveAuto } from './CurveAuto'
import { useCurveAuto } from './useCurveAuto'
import { useProof } from './useProof'
import { ProofBar } from './ProofBar'
import { currentDisplaySpace, displaySpaceNote } from '../engine/gpu/display-space'
import { INTENT_LABELS } from '../engine/proof/settings'
import { SnapshotPanel } from './SnapshotPanel'
import { ContextMenu } from './ContextMenu'
import { menuPoint } from './menuPoint'
import { cleanName, makeSnapshot, sortSnapshots, uniqueName, type Snapshot } from './snapshots'
import { snapshotsChanged } from './snapshotStore'
import { useMasking } from './useMasking'
import { renderSize, useDepth } from './useDepth'
import { useObjectSelect } from './useObjectSelect'
import { useAiRemove } from './useAiRemove'
import { ModelDialog } from '../ai/ModelDialog'
import { MaskOverlay } from './MaskOverlay'
import { diagnostics } from '../diagnostics/recorder'
import { PhotoNumbers, photoSummary, settingsChange } from '../diagnostics/anon'
import { adapterName, looksIntegrated } from '../diagnostics/pcinfo'
import { MasksPanel } from './MasksPanel'
import { MASK_BRUSH_SIZE, OVERLAY_COLOURS } from './maskUi'
import { presetMasks, withMasksList, type LocalMask } from '../engine/develop/masks'
import { hasAcrSidecar } from '../sidecar/acr'
import type { MaskOverlayDraw } from '../engine/develop/indicators'
import { useZoom } from './useZoom'
import { ZoomControl } from './ZoomControl'
import { panCenter } from './zoom'

interface Props {
  ids: number[]
  id: number
  /** Photos selected in the Library along with this one: Sync and Auto Sync apply to them. */
  selected: number[]
  /** Opens another photo; `ids` replaces the filmstrip's list (a proof copy joins it next to its original). */
  onNavigate: (id: number, ids?: number[]) => void
  onEdited: () => void
  onExport: (ids: number[]) => void
  /** Back to the Library (G). */
  onLibrary: () => void
}

type Status = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string }

let decoder: RawDecoder | null = null
/** Photos as the diagnostics log names them: a number per session (diagnostics/anon.ts). */
const photoNumbers = new PhotoNumbers()
/** Adapters whose "integrated graphics" notice was dismissed (remembered in this browser). */
const ADAPTER_NOTICE_KEY = 'lightbench.adapterNoticeDismissed'

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
  colour: boolean
  grading: boolean
  detail: boolean
  masks: boolean
  effects: boolean
}

/** Settings without their spots (the field left out, as in edits that never had any). */
function withoutSpots(s: DevelopSettings): DevelopSettings {
  const { spots: _gone, ...rest } = s
  void _gone
  return rest
}

/** Settings with a new spot list (left out when empty). */
const withSpots = (s: DevelopSettings, spots: Spot[]): DevelopSettings => (spots.length ? { ...s, spots } : withoutSpots(s))

/** A finished drawing's place on the stage (CSS pixels) and its map to the sensor; `n` counts drawings. */
interface ShownBox {
  x: number
  y: number
  w: number
  h: number
  map: ShownMap | null
  n: number
}

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
  /** The thumbnail shown while a photo loads, in a URL Develop holds itself (`holdThumbUrl`), for one load of one photo. */
  const [placeholder, setPlaceholder] = useState<{ key: string; url: string } | null>(null)
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
  const [bypass, setBypass] = useState<Bypass>(NO_GROUP_EYES)
  /** Sections switched off with their eye (a view only; PHASE3.md Part 21). */
  const [sectionsOff, setSectionsOff] = useState<ReadonlySet<SectionId>>(() => new Set())
  /** Bumped after GPU work on the photo's real white balance, so the RAW stage is built for the view again. */
  const [stageGen, setStageGen] = useState(0)
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
  /**
   * The Colour Mixer (PHASE3.md Part 15): its view, its targeted adjustment tool's channel and the bands under the pointer,
   * the mixer shown while a drag is in progress, the Visualize view (1–8 a band, 9–16 a point), Point Color's picker and
   * the selected point.
   */
  const [mixerUiStored, setMixerUi] = useStoredJson<MixerUi>('lightbench.mixer.view', DEFAULT_MIXER_UI)
  const mixerUi: MixerUi = { ...DEFAULT_MIXER_UI, ...mixerUiStored }
  const [mixerTarget, setMixerTarget] = useState<MixerChannel | null>(null)
  const [mixerHover, setMixerHover] = useState<{ weights: number[]; grey: boolean } | null>(null)
  const [mixerDraft, setMixerDraft] = useState<{ m: ColourMixerSettings | undefined } | null>(null)
  const [mixerVis, setMixerVis] = useState(0)
  const [pointPick, setPointPick] = useState(false)
  const [selectedPoint, setSelectedPoint] = useState<number | null>(0)
  /** Colour Grading (PHASE3.md Part 17): its view, the grade shown while a wheel is dragged, and Blending's Alt-drag preview. */
  const [gradingViewStored, setGradingView] = useStoredJson<{ view: GradingView }>('lightbench.grading.view', DEFAULT_GRADING_VIEW)
  const [gradingDraft, setGradingDraft] = useState<{ g: ColourGradingSettings | undefined } | null>(null)
  const [gradingBoost, setGradingBoost] = useState(false)
  /** The Remove brush on the photo (Q), its settings, the selected spot and whether all pins show. */
  const [removing, setRemoving] = useState(false)
  const [brushStored, setBrush] = useStoredJson<BrushSettings>('lightbench.remove.brush', DEFAULT_BRUSH)
  const brush: BrushSettings = { ...DEFAULT_BRUSH, ...brushStored }
  const [selectedSpot, setSelectedSpot] = useState<string | null>(null)
  const [showAllSpots, setShowAllSpots] = useStoredJson<{ on: boolean }>('lightbench.remove.showAll', { on: true })
  const [retouch, setRetouch] = useState<RetouchProgress>({ busy: false })
  /** Soft proofing (PHASE3.md Part 20): a view, remembered in this browser, never part of the edit. */
  const proof = useProof()
  const [proofCopyBusy, setProofCopyBusy] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [spotError, setSpotError] = useState<string | null>(null)
  /** A Lightroom `.acr` sidecar is next to the photo (its masks can't be read; PHASE3.md Part 23). */
  const [acr, setAcr] = useState(false)
  /**
   * Where the photo sits on the stage (CSS pixels) after the last drawing, and how that drawing maps to the sensor,
   * while the Remove brush is on. Box and map come from the same finished drawing, so the pins always match the photo
   * on screen, also while the next drawing is being made (PHASE3.md, Part 14).
   */
  const [shownBox, setShownBox] = useState<ShownBox | null>(null)
  /** The same for the last finished drawing, whatever the tool (shown at once when the Remove brush opens). */
  const lastDraw = useRef<Omit<ShownBox, 'n'> | null>(null)
  /** The selected mask over the photo while masking (Part 23): a view, on Develop's canvas only (set by the masking tool). */
  const [maskOverlayDraw, setMaskOverlayDraw] = useState<MaskOverlayDraw | null>(null)
  /** Counts engines made ready (a new one after a lost device), so effects that use the engine run again. */
  const [engineReady, setEngineReady] = useState(0)
  /** Bumped when the GPU device was lost: the engine is made again (PHASE3.md, Part 14). */
  const [engineGen, setEngineGen] = useState(0)
  /** A short notice after the engine was made again. */
  const [gpuNotice, setGpuNotice] = useState<string | null>(null)
  /** What Develop does when its graphics device fails (gpuRecovery.ts): restarts, at most a few in a short time. */
  const recoveryRef = useRef<GpuRecovery | null>(null)
  recoveryRef.current ??= new GpuRecovery()
  /** The preview stopped after repeated failures (no engine until Try again), and its message. */
  const gpuPaused = useRef(false)
  const [gpuStopped, setGpuStopped] = useState<string | null>(null)
  /** A restart waiting for its delay. */
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The adapter's name when it looks like integrated graphics and its notice wasn't dismissed. */
  const [adapterNotice, setAdapterNotice] = useState<string | null>(null)
  /** The photo decoded last, kept to upload it again to a new engine after a lost device. */
  const decodedRef = useRef<{ id: number; decoded: DecodeResult } | null>(null)
  /** An engine is being made (the photo's load waits for it). */
  const engineCreating = useRef(true)
  /** Sharpening's Masking preview (Alt-drag on Masking, or Show mask): a view only. */
  const [maskPreview, setMaskPreview] = useState(false)
  /** The noise profile and sharpening radius the last render used, for the Detail group. */
  const [noiseProfile, setNoiseProfile] = useState<ProfileChoice | null>(null)
  const [sharpenRadius, setSharpenRadius] = useState<RadiusChoice | null>(null)
  const [reveal, setReveal] = useState<{ id: GroupId; n: number; ifClosed?: boolean } | null>(null)
  // Sublabels next to each slider: 1 = shown, 2 = hidden (tooltips are always available on hover).
  const [hintsPref, setHintsPref] = useStoredNumber('lightbench.develop.hints', 1)
  /**
   * Snapshots (PHASE3.md Part 19): the photo's list, the one hovered (previewed), the one Before / after compares against
   * (until cleared or another photo), the one being renamed, the last change to the list (its Undo lasts until the photo's
   * history changes), and the History step whose menu is open.
   */
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [hoverSnap, setHoverSnap] = useState<Snapshot | null>(null)
  const [beforeSnapId, setBeforeSnapId] = useState<string | null>(null)
  const [renamingSnap, setRenamingSnap] = useState<string | null>(null)
  const renamingRef = useRef<string | null>(null)
  const [snapUndo, setSnapUndo] = useState<{ text: string; list: Snapshot[] | null; history: History | null } | null>(null)
  const [historyMenu, setHistoryMenu] = useState<{ index: number; x: number; y: number } | null>(null)
  const [presets, setPresets] = useState<Preset[]>([])
  const [hoverPreset, setHoverPreset] = useState<Preset | null>(null)
  const [applied, setApplied] = useState<AppliedPreset | null>(null)
  const hasClip = useSyncExternalStore(settingsClipboard.subscribe, () => !!settingsClipboard.get())
  const [leftW, setLeftW] = useStoredNumber('lightbench.develop.left', 240)
  const [rightW, setRightW] = useStoredNumber('lightbench.develop.right', 300)
  const [histH, setHistH] = useStoredNumber('lightbench.develop.histogram', 170)
  const builtStage = useRef<RawStageOptions | null>(null)
  /** The masking tool, for effects declared before it (a new photo resets it). */
  const maskingRef = useRef<{ resetForPhoto: () => void } | null>(null)
  const dirty = useRef(false)
  const loadToken = useRef(0)
  /** A save waiting for its debounce timer, and the save currently running. */
  const pendingSave = useRef<(() => Promise<void>) | null>(null)
  const saving = useRef<Promise<void> | null>(null)

  const defaults = defaultsFor(info?.kind ?? 'raw', info?.iso)
  // The Lensfun database's state (downloaded on first use), so the Lens section and the photo update when it arrives.
  const lensDb = useSyncExternalStore(subscribeLensfun, lensfunState)
  // darktable's noise profiles (downloaded the first time noise reduction is used).
  const noiseDb = useSyncExternalStore(subscribeNoiseProfiles, noiseProfilesState)
  const settings = history ? current(history) : defaults
  /** Hover preview of a snapshot, or of a preset (its Auto, if any, runs only when it is applied). */
  const hover = useMemo(() => {
    if (hoverSnap && info) return normalizeSettings(hoverSnap.settings, info.kind)
    return hoverPreset && info ? applyPaste(settings, { ...presetClip(hoverPreset), rerunAuto: false }, info.kind, engineRef.current?.imageSize) : null
  }, [hoverPreset, hoverSnap, info, settings])
  /** The snapshot set as Before, and its settings (Before / after shows them instead of the defaults). */
  const beforeSnap = beforeSnapId ? snapshots.find((x) => x.id === beforeSnapId) ?? null : null
  const beforeSettings = useMemo(() => (beforeSnap && info ? normalizeSettings(beforeSnap.settings, info.kind) : null), [beforeSnap, info])
  const draftRef = useRef(draft)
  draftRef.current = draft
  const historyRef = useRef(history)
  historyRef.current = history
  const infoRef = useRef(info)
  infoRef.current = info
  /** White balance hidden by an eye: the RAW stage is then built with As Shot, as for a reset photo (sectionEyes.ts). */
  const hideWb = wbHidden(bypass, sectionsOff)
  const hideWbRef = useRef(hideWb)
  hideWbRef.current = hideWb
  /**
   * GPU work on the photo's real settings (its thumbnail, Auto) while an eye hides the white balance: the RAW stage is
   * built for the settings first, and for the view again afterwards (PHASE3.md Part 21). Otherwise the work just runs.
   */
  const onRealStage = useCallback(async <T,>(engine: DevelopEngine, s: DevelopSettings, inf: SensorInfo, work: () => Promise<T>): Promise<T> => {
    const want = stageOptions(s, inf)
    if (!hideWbRef.current || sameStage(builtStage.current, want)) return work()
    await gpuGate.foreground(() => engine.process(want))
    builtStage.current = want
    try {
      return await work()
    } finally {
      setStageGen((g) => g + 1)
    }
  }, [])
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

  /**
   * Develop's graphics device failed: it was lost, an error no scope caught was reported (out of memory, internal,
   * validation), a full-size allocation ran out of memory, or making the new engine failed. Logged to Diagnostics;
   * the engine is made again (gpuRecovery.ts decides when, and when to stop and ask the person).
   */
  const gpuTrouble = (kind: GpuTrouble, detail: string) => {
    const r = recoveryRef.current!
    const d = r.report(kind)
    diagnostics.log('gpu-trouble', { kind, detail: detail.slice(0, 300), action: d.action, restarts: r.recentRestarts })
    if (d.action === 'restart') {
      setGpuNotice(d.message)
      const go = () => {
        restartTimer.current = null
        setEngineGen((g) => g + 1)
      }
      if (restartTimer.current) clearTimeout(restartTimer.current)
      if (d.delayMs) restartTimer.current = setTimeout(go, d.delayMs)
      else go()
    } else if (d.action === 'give-up') {
      // No new engine until Try again; bumping the generation frees the failed one.
      gpuPaused.current = true
      setGpuNotice(null)
      setGpuStopped(d.message)
      setEngineGen((g) => g + 1)
    } else if (d.action === 'notice') {
      setGpuNotice(d.message)
    }
  }
  /** Try again, after the preview stopped. */
  const tryGpuAgain = () => {
    recoveryRef.current!.tryAgain()
    gpuPaused.current = false
    setGpuStopped(null)
    setEngineError('')
    diagnostics.log('engine-recovery', { stage: 'try again' })
    setEngineGen((g) => g + 1)
  }
  useEffect(() => () => {
    if (restartTimer.current) clearTimeout(restartTimer.current)
  }, [])
  /** A failed GPU call on the engine in use: true when it was a failure the recovery handles (no error to show). */
  const recoveredFrom = (e: unknown, engine: DevelopEngine | null): boolean => {
    if (!(e instanceof GpuWorkError) || e.kind === 'validation') return false
    // A lost device is reported by the engine itself (onLost); an old engine's failures are stale.
    if (e.kind !== 'lost' && engine && engineRef.current === engine) gpuTrouble(e.kind, e.detail)
    return true
  }

  // ---- engine lifetime (made again when its GPU device is lost: a driver reset, or the browser took it back)
  useEffect(() => {
    let alive = true
    let stopLost = () => {}
    let stopErrors = () => {}
    // Stopped after repeated failures: no engine until Try again.
    if (gpuPaused.current) {
      engineCreating.current = false
      return
    }
    engineCreating.current = true
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
        engineCreating.current = false
        recoveryRef.current!.ready()
        if (engineGen) diagnostics.log('engine-recovery', { stage: 'new engine', restored: !!restored })
        if (looksIntegrated(e.adapter)) {
          const name = adapterName(e.adapter)
          let dismissed = ''
          try {
            dismissed = localStorage.getItem(ADAPTER_NOTICE_KEY) ?? ''
          } catch {
            // Storage blocked: shown each time.
          }
          if (dismissed !== name) setAdapterNotice(name)
        }
        stageRef.current?.prepend(e.canvas)
        stopLost = e.onLost((message) => {
          if (alive) gpuTrouble('lost', message)
        })
        stopErrors = e.onGpuError((kind, message) => {
          if (alive) gpuTrouble(kind, message)
        })
        // Lost while it was being made or the photo restored (before onLost could tell): start again.
        if (e.isLost) gpuTrouble('lost', 'lost while starting')
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
      (e: Error) => {
        engineCreating.current = false
        // Making a new engine after a failure: tried again a few times (gpuRecovery.ts).
        if (engineGen && recoveryRef.current!.isRestarting) {
          if (alive) gpuTrouble('create-failed', e.message)
          return
        }
        setEngineError(`Graphics acceleration is not available: ${e.message}`)
      },
    )
    return () => {
      alive = false
      stopLost()
      stopErrors()
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
    setMixerTarget(null)
    setMixerDraft(null)
    setMixerHover(null)
    setPointPick(false)
    setSelectedPoint(0)
    setSelectedSpot(null)
    setSpotError(null)
    maskingRef.current?.resetForPhoto()
    setAcr(false)
    detection.current = null
    angleBase.current = null
    builtStage.current = null
    dirty.current = false
    let used: DevelopEngine | null = null
    ;(async () => {
      const d = await catalog.getPhoto(id)
      if (stale() || !d) return
      setPhoto(d)
      void checkPhoto(id)
      void hasAcrSidecar(d.rootId, d.folderPath, d.fileName).then((x) => !stale() && setAcr(x), () => {})
      const file = await openPhotoFile(d.rootId, d.folderPath, d.fileName)
      if (!file) throw new Error('This photo’s folder isn’t connected. Go to the Library and click “Reconnect”.')
      decoder ??= new RawDecoder()
      const r = await decoder.decode(file, true)
      if (stale()) return
      decodedRef.current = { id, decoded: r }
      // The engine can take a while to make (seconds, while background GPU work keeps the GPU busy, or while a new one
      // is made after a lost device): wait as long as it is being made, up to 2 minutes.
      for (let t = 0; !engineRef.current && (engineCreating.current || restartTimer.current || t < 100) && t < 2400 && !stale(); t++) await new Promise((res) => setTimeout(res, 50))
      if (stale()) return
      const engine = engineRef.current
      if (!engine) throw new Error('Graphics acceleration is not available.')
      used = engine
      const sensorInfo = loadIntoEngine(engine, r)
      const kind = sensorInfo.kind

      const h = loadHistory(await catalog.getEdit(id), kind, sensorInfo.iso)
      const opts = stageOptions(current(h), sensorInfo)
      const ms = await gpuGate.foreground(() => engine.process(opts))
      if (stale()) return
      builtStage.current = opts
      setTiming({ stage: ms })
      if (diagnostics.enabled) {
        const px = r.sensor ?? r.rgb
        diagnostics.log('photo', { ...photoSummary(photoNumbers.number(id), { make: r.info.make, model: r.info.model, raw: kind !== 'rgb', width: px?.width, height: px?.height }), rawStageMs: Math.round(ms) })
      }
      setInfo(sensorInfo)
      setHistory(h)
      setStatus({ kind: 'ready' })
    })().catch(async (e: Error) => {
      // A lost device or another GPU failure: the new engine loads the photo again (engine lifetime, above). With the
      // preview stopped, its message says what to do.
      if (recoveredFrom(e, used) || gpuPaused.current) return
      if (await lostMeanwhile(used)) return
      if (!stale()) setStatus({ kind: 'error', message: e.message })
    })
  }, [catalog, id, reloads])

  // ---- the placeholder: the photo's thumbnail while it loads. Its URL is Develop's own, not the thumbnail cache's,
  // which revokes a URL when the thumbnail is replaced (a save) — an <img> given a revoked URL logs ERR_FILE_NOT_FOUND.
  // It is shown only for the load it was read for, so the render that changes photo already drops the old one, and
  // the cleanup revokes it after that render.
  const placeholderKey = `${id}:${reloads}`
  useEffect(() => holdThumbUrl(id, (url) => setPlaceholder(url ? { key: placeholderKey, url } : null)), [id, placeholderKey])
  const placeholderUrl = placeholder?.key === placeholderKey ? placeholder.url : null

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
    // An eye hiding the white balance shows the photo exactly as with As Shot: the stage is built so (PHASE3.md Part 21).
    const opts = stageOptions(hideWb ? { ...settings, whiteBalance: defaultsFor(info.kind, info.iso).whiteBalance } : settings, info)
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
          if (recoveredFrom(e, engine)) return
          if (engineRef.current === engine && !(await lostMeanwhile(engine))) setStatus({ kind: 'error', message: e.message })
        },
      )
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, info, status.kind, hideWb, stageGen])

  // Another photo: every eye on again (groups and sections).
  useEffect(() => {
    setBypass(NO_GROUP_EYES)
    setSectionsOff(new Set())
  }, [id])

  // ---- drawing (coalesced so dragging never queues up frames)
  const indicators: Indicators = useMemo(
    // While a drag pushes the tone curve towards black or white, clipping shows on the photo (TONE_CURVE.md §2.5).
    () => ({ clip: clipSettings, showClip: overlay || (curveDragClip && clipWhileDragging === 1), raw: rawClipSettings, showRaw: rawOverlay, ...(proof.draw ? { proof: proof.draw } : {}), ...(maskOverlayDraw ? { maskOverlay: maskOverlayDraw } : {}) }),
    [clipSettings, overlay, rawClipSettings, rawOverlay, curveDragClip, clipWhileDragging, proof.draw, maskOverlayDraw],
  )
  const maskView = useRef<{ draft: LocalMask[] | null; hidden: ReadonlySet<string>; active: boolean }>({ draft: null, hidden: new Set(), active: false })
  const latest = useRef({ settings, info, view, before, beforeSettings, indicators, hover, draft, bypass, sectionsOff, guiding, curveDraft, curveView, removing, maskPreview, mixerDraft, mixerVis, gradingDraft, gradingBoost, maskView: maskView.current })
  latest.current = { settings, info, view, before, beforeSettings, indicators, hover, draft, bypass, sectionsOff, guiding, curveDraft, curveView, removing, maskPreview, mixerDraft, mixerVis, gradingDraft, gradingBoost, maskView: maskView.current }
  /** The settings drawn: Before shows the defaults (or the snapshot set as Before); a preset or snapshot hovered, the crop being edited and switched-off groups apply on top. */
  const shownOf = (x: typeof latest.current, inf: SensorInfo): DevelopSettings => {
    // Before is the snapshot set as Before, exactly as it was saved (its process version too), …
    if (x.before && x.beforeSettings) return x.beforeSettings
    // … else the photo as shot: the defaults without lens corrections or sharpening.
    if (x.before) return { ...defaultsFor(inf.kind), lens: LEGACY_LENS, detail: undefined }
    let s = x.hover ?? x.settings
    if (x.curveDraft && !x.hover) s = withToneCurve(s, x.curveDraft.tc)
    if (x.mixerDraft && !x.hover) s = withColourMixer(s, x.mixerDraft.m)
    if (x.gradingDraft && !x.hover) s = withColourGrading(s, x.gradingDraft.g)
    if (x.gradingBoost && !x.hover) s = withColourGrading(s, boostedGrading(s.colourGrading))
    // Masks (Part 23): a stroke or a handle drag in progress, and the masks whose own eye is off (a view only).
    if (x.maskView.draft && !x.hover) s = withMasksList(s, x.maskView.draft)
    if (x.maskView.hidden.size && s.masks) s = withMasksList(s, shownMasks(s.masks, x.maskView.hidden))
    // The eyes (PHASE3.md Parts 1 and 21): hidden sections at their defaults, then hidden groups (a group's eye overrides
    // its sections'). While cropping, the crop being edited is shown, without Crop & Lens's eyes.
    const hidden = x.draft ? new Set([...x.sectionsOff].filter((k) => !k.startsWith('crop.'))) : x.sectionsOff
    s = applyEyes(s, x.draft ? { ...x.bypass, crop: false } : x.bypass, hidden, { defaults: defaultsFor(inf.kind, inf.iso), lensApplied: true })
    return x.draft ? { ...s, geometry: x.draft } : s
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
        const wb = x.before && !x.beforeSettings ? inf.asShotWb : multipliers(shown, inf)
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
    // Set on the element directly (no React render per frame): assistive tech, and tests, can tell a frame is coming.
    stageRef.current?.setAttribute('aria-busy', 'true')
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
          const du = displayUniforms(shown)
          // View-only states: Sharpening's mask, the Colour Mixer's Visualize.
          const view = x.before ? du : { ...du, ...(x.maskPreview ? { detailMask: true } : {}), ...(x.mixerVis && !x.bypass.colour ? { mixerVisualize: x.mixerVis } : {}) }
          const ms = await engine.render(view, x.before && !x.beforeSettings ? inf.asShotWb : multipliers(shown, inf), v, x.indicators)
          setTiming((t) => ({ ...t, frame: ms }))
          setNoiseProfile((p) => (p === engine.lastProfile ? p : engine.lastProfile))
          setSharpenRadius((r) => (r === engine.lastRadius ? r : engine.lastRadius))
          if (v.frame) {
            const dpr = window.devicePixelRatio || 1
            const l = engine.layout(v, engine.canvas.width, engine.canvas.height)
            const box = { x: l.x / dpr, y: l.y / dpr, w: l.w / dpr, h: l.h / dpr }
            setFrameBox((b) => (b && Math.abs(b.x - box.x) + Math.abs(b.y - box.y) + Math.abs(b.w - box.w) + Math.abs(b.h - box.h) < 0.01 ? b : box))
          }
          {
            // The Remove overlay maps through what was just drawn: its place and its map, taken together.
            const dpr = window.devicePixelRatio || 1
            const l = engine.layout(v, engine.canvas.width, engine.canvas.height)
            const drawn = { x: l.x / dpr, y: l.y / dpr, w: l.w / dpr, h: l.h / dpr, map: engine.shownSnapshot() }
            lastDraw.current = drawn
            // Whether the brush is on now, not when this drawing started (it may have been opened meanwhile).
            if (latest.current.removing || latest.current.maskView.active) setShownBox((b) => ({ ...drawn, n: (b?.n ?? 0) + 1 }))
          }
          scheduleStats()
        } catch (e) {
          // A lost device: a new engine draws again (the engine lifetime effect).
          if (!(await lostMeanwhile(engine))) setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
        }
      }
      rendering.current = false
      endHold()
      stageRef.current?.setAttribute('aria-busy', 'false')
    })()
  }, [scheduleStats])

  useEffect(() => {
    if (status.kind === 'ready') requestRender()
  }, [status.kind, settings, view, before, beforeSettings, indicators, hover, draft, bypass, sectionsOff, guiding, removing, requestRender, lensDb, curveDraft, maskPreview, noiseDb, mixerDraft, mixerVis, gradingDraft, gradingBoost])
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
          await saveThumb(photoId, await onRealStage(engine, s, inf, () => renderThumbnail(engine, s, inf)))
          forgetThumbUrl(photoId)
        }
      } catch {
        // The settings are saved; only the thumbnail refresh failed (e.g. the GPU was reset).
      }
      onEdited()
    },
    [catalog, onEdited, onRealStage],
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
  /**
   * The AI Depth range (PHASE3.md Part 24): the photo rendered as shot for the depth model (the edit's tones and colours;
   * no crop, angle, perspective, flips, lens correction, masks or effects (Part 25: Texture, Clarity, Dehaze, vignette,
   * grain, Glow); the camera's orientation), and its uv → sensor map.
   */
  const renderAsShot = async (long: (w: number, h: number) => number) => {
    const engine = engineRef.current
    const x = latest.current
    const inf = x.info
    if (!engine || !inf) return null
    const s: DevelopSettings = withMasksList({ ...x.settings, geometry: DEFAULT_GEOMETRY, lens: { ...x.settings.lens, enabled: false }, detail: undefined, effects: undefined }, undefined)
    const g = engine.geometry(DEFAULT_GEOMETRY)
    const img = await gpuGate.foreground(() => engine.renderImage(displayUniforms(s), multipliers(s, inf), long(g.size[0], g.size[1])))
    return { rgba: img.data, width: img.width, height: img.height, uvToSensor: g.uvToSensor, sensor: sensorSize() }
  }
  const depth = useDepth((input) => renderAsShot((w, h) => renderSize(w, h, input)))
  /**
   * Object select (PHASE3.md Part 27): the photo rendered as shot, as for the depth map, with its long side at the
   * encoder's 1.5 × (not larger than the photo).
   */
  const objectSel = useObjectSelect({ renderAsShot: (long) => renderAsShot((w, h) => Math.min(Math.max(w, h), long)), photo: () => (status.kind === 'ready' ? String(id) : null) })
  /** AI Remove (PHASE3.md Part 26): Moebius for the Remove brush's AI mode; the spot being generated. */
  const aiRemove = useAiRemove()
  const [aiPending, setAiPending] = useState<Spot | null>(null)
  /** Masks (PHASE3.md Part 23): the masking tool on the photo and what it does to the photo's masks. */
  const masking = useMasking({
    settings: () => (historyRef.current ? current(historyRef.current) : latest.current.settings),
    change,
    sensor: () => sensorSize(),
    sample: async (uv) => {
      const engine = engineRef.current
      const x = latest.current
      const inf = x.info
      if (!engine || !inf) return null
      const shown = shownOf(x, inf)
      const l = engine.layout(x.view, engine.canvas.width, engine.canvas.height)
      return gpuGate.foreground(() => engine.sampleMaskInput(displayUniforms(shown), multipliers(shown, inf), uv[0], uv[1], l.scale))
    },
    onStart: () => {
      if (draftRef.current) endCrop(true)
      setGuiding(false)
      setCurveTarget(false)
      setMixerTarget(null)
      setPointPick(false)
      setRemoving(false)
      setSelectedSpot(null)
      setWbPick(false)
      setLoupe(null)
      setPicking(false)
      setBefore(false)
      setBypass((b) => ({ ...b, masks: false }))
      const drawn = lastDraw.current
      if (drawn) setShownBox((b) => ({ ...drawn, n: (b?.n ?? 0) + 1 }))
      setReveal({ id: 'masks', n: Date.now() })
    },
    depth: depth.obtain,
    object: objectSel,
    toSensorUv: (uv) => {
      const engine = engineRef.current
      if (!engine) return null
      const [sw, sh] = sensorSize()
      const [x, y] = engine.displayToSensor(uv[0], uv[1])
      return [x / sw, y / sh]
    },
  })
  maskingRef.current = masking
  // The depth-map view (Part 24): the selected mask's depth map, white near, with White on Black, while masking.
  const depthViewOn = masking.active && masking.depthView && !!masking.sel.mask && !masking.hidden.has(masking.sel.mask)
  const ovKey = depthViewOn ? `${masking.sel.mask}|depth` : masking.active && masking.overlay.on && masking.sel.mask && !masking.hidden.has(masking.sel.mask) ? `${masking.sel.mask}|${masking.overlay.mode}|${masking.overlay.colour}|${masking.overlay.opacity}` : ''
  useEffect(() => {
    const o = masking.overlay
    if (depthViewOn && masking.sel.mask) return setMaskOverlayDraw({ id: masking.sel.mask, mode: 6, colour: [1, 1, 1], opacity: 1, depthMap: true })
    setMaskOverlayDraw(ovKey && masking.sel.mask ? { id: masking.sel.mask, mode: o.mode, colour: OVERLAY_COLOURS[o.colour % OVERLAY_COLOURS.length].rgb, opacity: o.opacity / 100 } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ovKey])
  // A stroke or handle drag in progress, or a mask's eye: draw again.
  useEffect(() => {
    if (status.kind === 'ready') requestRender()
  }, [masking.draft, masking.hidden, status.kind, requestRender])
  maskView.current = { draft: masking.draft, hidden: masking.hidden, active: masking.active }
  latest.current.maskView = maskView.current
  /** Tone Curve Auto (PHASE3.md Part 21): Auto contrast, Auto colour, their Amount and the suggestions. */
  const curveAuto = useCurveAuto({
    engine: () => engineRef.current,
    info,
    history,
    settings,
    ready: status.kind === 'ready',
    photoId: id,
    setHistory,
    markDirty: () => {
      dirty.current = true
    },
    onRealStage: (work) => {
      const e = engineRef.current
      const inf = infoRef.current
      const h = historyRef.current
      return e && inf && h ? onRealStage(e, current(h), inf, work) : work()
    },
    preview: (tc) => setCurveDraft(tc === null ? null : { tc }),
  })
  const toggleCurveTarget = () => {
    if (status.kind !== 'ready') return
    if (draft) endCrop(true)
    setMixerTarget(null)
    setPointPick(false)
    setGuiding(false)
    setRemoving(false)
    masking.end()
    setSelectedSpot(null)
    setWbPick(false)
    setLoupe(null)
    setPicking(false)
    setBefore(false)
    setCurveTarget((t) => !t)
    setReveal({ id: 'curve', n: Date.now() })
  }
  /** A Colour Mixer change (`separate`: the end of a drag, one history step of its own). */
  const changeMixer = useCallback(
    (label: string, m: ColourMixerSettings | undefined, separate = false) => {
      const h = historyRef.current
      if (!h) return
      change(label, withColourMixer(current(h), m), false, separate)
    },
    [change],
  )
  /** A Colour Grading change (`separate`: the end of a drag or a reset, one history step of its own). */
  const changeGrading = useCallback(
    (label: string, g: ColourGradingSettings | undefined, separate = false) => {
      const h = historyRef.current
      if (!h) return
      change(label, withColourGrading(current(h), g), false, separate)
    },
    [change],
  )
  const onGradingDraft = useCallback((g: ColourGradingSettings | undefined | null) => setGradingDraft(g === null ? null : { g }), [])
  /** The Colour Mixer's targeted adjustment tool for a channel (null ends it); the other on-photo tools end. */
  const startMixerTarget = (ch: MixerChannel | null) => {
    if (status.kind !== 'ready') return
    if (!ch) {
      setMixerTarget(null)
      return
    }
    if (draft) endCrop(true)
    setGuiding(false)
    setRemoving(false)
    masking.end()
    setSelectedSpot(null)
    setWbPick(false)
    setLoupe(null)
    setPicking(false)
    setBefore(false)
    setCurveTarget(false)
    setPointPick(false)
    setMixerTarget(ch)
    setMixerUi({ ...mixerUi, tab: 'mixer', view: mixerUi.view === 'all' || mixerUi.view === 'colour' ? mixerUi.view : ch })
    setReveal({ id: 'colour', n: Date.now() })
  }
  /** Point Color's picker (click a colour on the photo). */
  const startPointPick = () => {
    if (status.kind !== 'ready') return
    if (pointPick) {
      setPointPick(false)
      return
    }
    if ((settings.colourMixer?.points?.length ?? 0) >= MAX_POINTS) return
    if (draft) endCrop(true)
    setGuiding(false)
    setRemoving(false)
    masking.end()
    setSelectedSpot(null)
    setWbPick(false)
    setLoupe(null)
    setPicking(false)
    setBefore(false)
    setCurveTarget(false)
    setMixerTarget(null)
    setPointPick(true)
    setMixerUi({ ...mixerUi, tab: 'point' })
    setReveal({ id: 'colour', n: Date.now() })
  }
  /** A colour picked on the photo becomes a Point Color sample (selected), and the picker ends. */
  const addPoint = (c: readonly number[]) => {
    const m = latest.current.settings.colourMixer
    const pts = [...(m?.points ?? []), newPoint(c, m?.advanced?.whiteLevel)]
    if (pts.length > MAX_POINTS) return
    changeMixer(`Point Color: pick colour ${pts.length}`, withPoints(m, pts), true)
    setSelectedPoint(pts.length - 1)
    setPointPick(false)
  }
  /**
   * The Colour Mixer's input (`after` false: for its targeted adjustment tool) or the colour as it reaches Point Color
   * (after the bands, without the points: for the picker) under a point of the photo shown.
   */
  const sampleMixerAt = useCallback(async (uv: [number, number], after: boolean) => {
    const engine = engineRef.current
    const x = latest.current
    const inf = x.info
    if (!engine || !inf) return null
    let shown = shownOf(x, inf)
    if (after) shown = withColourMixer(shown, withPoints(shown.colourMixer, undefined))
    const l = engine.layout(x.view, engine.canvas.width, engine.canvas.height)
    // Develop's GPU work: background work waits while it runs (PHASE3.md, Part 14).
    return gpuGate.foreground(() => engine.sampleMixer(displayUniforms(shown), multipliers(shown, inf), uv[0], uv[1], l.scale, after))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        const r = await onRealStage(engine, start, info, () =>
          solveAuto(start, target, async (s) => metricsFromStats(await engine.renderStats(displayUniforms(s), multipliers(s, info), 256)), 12, options),
        )
        change(`Auto: ${target.name}`, r.settings, true)
      } catch (e) {
        if (engineRef.current === engine) setStatus({ kind: 'error', message: `Auto failed: ${e instanceof Error ? e.message : e}` })
      } finally {
        setAutoBusy(false)
      }
    },
    [info, history, change, autoOptions, onRealStage],
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
    setMixerTarget(null)
    setPointPick(false)
    setRemoving(false)
    masking.end()
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
        // Crop, straighten, rotate and flip only: Transform and Upright have their own Reset.
        next = resetCrop(base)
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
  // The section eyes (PHASE3.md Part 21): their state for the groups' panels, and the "Hidden: …" badge's names.
  const sectionCtx = { defaults, lensApplied: lensStatus.state === 'applied' }
  const sectionEyes: SectionEyes = {
    hidden: sectionsOff,
    shown: (k) => eyeShown(k, settings, sectionCtx, sectionsOff),
    groupOff: (g: SectionGroup) => bypass[g],
    toggle: (k) =>
      setSectionsOff((h) => {
        const n = new Set(h)
        if (n.has(k)) n.delete(k)
        else n.add(k)
        return n
      }),
    disabled: status.kind !== 'ready',
  }
  const hiddenBadge = hiddenNames(
    [
      { id: 'crop', name: 'Crop & Lens', off: bypass.crop },
      { id: 'remove', name: 'Remove', off: bypass.remove },
      { id: 'basic', name: 'Basic', off: bypass.basic },
      { id: 'curve', name: 'Tone Curve', off: bypass.curve },
      { id: 'colour', name: 'Colour Mixer', off: bypass.colour },
      { id: 'grading', name: 'Colour Grading', off: bypass.grading },
      { id: 'detail', name: 'Detail', off: bypass.detail && detailOn(settings.detail) },
      { id: 'masks', name: 'Masks', off: bypass.masks && !!settings.masks?.length },
      { id: 'effects', name: 'Effects', off: bypass.effects && effectsGroupOn(settings.effects) },
    ],
    sectionsOff,
  ).concat(bypass.masks ? [] : (settings.masks ?? []).filter((x) => masking.hidden.has(x.id)).map((x) => `mask ${x.name}`))

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
    setMixerTarget(null)
    setPointPick(false)
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
    setMixerTarget(null)
    setPointPick(false)
    setWbPick(false)
    setLoupe(null)
    setPicking(false)
    setBefore(false)
    setBypass((b) => ({ ...b, remove: false }))
    masking.end()
    // The pins map through the drawing on screen now, not one from an earlier time the brush was on.
    const drawn = lastDraw.current
    if (drawn) setShownBox((b) => ({ ...drawn, n: (b?.n ?? 0) + 1 }))
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
    if (spot.mode === 'ai') {
      await generateAiSpot(spot, null)
      return
    }
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
    const name = { remove: 'Remove', heal: 'Heal', clone: 'Clone', ai: 'AI Remove' }[spot.mode]
    changeSpots(`${name} spot ${now.length + 1}`, [...now, spot])
    setSelectedSpot(spot.id)
  }
  /**
   * AI Remove (Part 26): generates `spot`'s patch from the photo with the spots before it, then adds the spot (a new
   * one, `replace` null) or gives an existing one its new patch (Try again, Generate, or a mode change to AI Remove),
   * as one history step. Nothing changes if it is declined, cancelled or fails, or if another photo is opened meanwhile.
   */
  async function generateAiSpot(spot: Spot, replace: { label: string } | null) {
    const engine = engineRef.current
    const size = engine?.sceneSize()
    const photo = latest.current.info
    if (!engine || !size || aiRemove.running()) return
    const list = latest.current.settings.spots ?? []
    const at = replace ? list.findIndex((x) => x.id === spot.id) : list.length
    if (at < 0) return
    const others = list.slice(0, at)
    setSpotError(null)
    setAiPending(replace ? null : spot)
    const fill = await aiRemove.fill(spot, size, (r) => engine.readSceneRegion(r, others)).finally(() => setAiPending(null))
    if (!fill || engineRef.current !== engine || latest.current.info !== photo) return
    const now = latest.current.settings.spots ?? []
    const done: Spot = { ...spot, mode: 'ai', offset: [0, 0], ai: fill }
    if (!replace) {
      changeSpots(`AI Remove spot ${now.length + 1}`, [...now, done])
      setSelectedSpot(done.id)
      return
    }
    if (!now.some((x) => x.id === spot.id)) return
    changeSpots(replace.label, now.map((x) => (x.id === spot.id ? { ...done, feather: x.feather, opacity: x.opacity } : x)))
  }
  /** AI Remove: a new patch for the selected spot (a new seed), or its first one (a pasted spot waits for it). */
  function retryAiSpot() {
    const list = latest.current.settings.spots ?? []
    const i = selectedSpot ? list.findIndex((x) => x.id === selectedSpot) : -1
    if (i < 0 || list[i].mode !== 'ai') return
    void generateAiSpot({ ...list[i], seed: list[i].ai ? newSeed() : list[i].seed }, { label: `Spot ${i + 1}: ${list[i].ai ? 'AI Remove, try again' : 'AI Remove'}` })
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
    const cur = list[i]
    if (what === 'mode' && value === cur.mode) return
    // An AI Remove spot's patch was made for its shape: its size stays (paint a new spot, or delete it).
    if (what === 'size' && cur.mode === 'ai') return
    if (what === 'mode' && value === 'ai') {
      void generateAiSpot({ ...cur, mode: 'ai' }, { label: `Spot ${i + 1}: AI Remove` })
      return
    }
    if (what === 'mode' && cur.mode === 'ai') {
      // Back to a patch-based mode: the generated patch goes, the source is picked again.
      const { ai: _ai, ...plain } = cur
      void _ai
      const next: Spot = { ...plain, mode: value as SpotMode }
      const engine = engineRef.current
      setPlacing(true)
      void (engine ? engine.pickSpotSource(next, list.slice(0, i)) : Promise.resolve([0, 0] as [number, number]))
        .then(([dx, dy]) => {
          next.offset = [Math.round((dx / sw) * 1e6) / 1e6, Math.round((dy / sh) * 1e6) / 1e6]
          const now = latest.current.settings.spots ?? []
          changeSpots(`Spot ${i + 1}: ${{ remove: 'Remove', heal: 'Heal', clone: 'Clone', ai: 'AI Remove' }[value as SpotMode]}`, now.map((x) => (x.id === cur.id ? next : x)))
        })
        .catch((e) => setSpotError(`Couldn’t find a source: ${e instanceof Error ? e.message : e}`))
        .finally(() => setPlacing(false))
      return
    }
    const patch: Partial<Spot> =
      what === 'mode' ? { mode: value as SpotMode }
        : what === 'size' ? { size: Math.round((Math.min(SIZE_RANGE[1], Math.max(SIZE_RANGE[0], v)) / Math.min(sw, sh)) * 1e6) / 1e6 }
          : { [what]: Math.min(1, Math.max(what === 'opacity' ? 0.01 : 0, v / 100)) }
    const label = what === 'mode' ? `Spot ${i + 1}: ${{ remove: 'Remove', heal: 'Heal', clone: 'Clone', ai: 'AI Remove' }[value as SpotMode]}` : `Spot ${i + 1}: ${what}`
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
    setView((v) => ({ zoom: v.zoom, center: panCenter(v.center, dx * dpr, dy * dpr, l, engine.canvas.width, engine.canvas.height) }))
  }
  const spotStatus = aiRemove.busy
    ? aiRemove.busy.text
    : placing
    ? 'Finding where to take the fill from…'
    : retouch.busy && retouch.spot !== undefined
      ? `Filling spot ${retouch.spot + 1}… ${Math.round((retouch.fraction ?? 0) * 100)} %`
      : retouch.busy
        ? 'Applying spots…'
        : spotError ?? aiRemove.error

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
    const changed = changedKeys(defaults, settings).filter((k) => k !== 'spots' && k !== 'masks')
    const { keys } = rememberedChoice()
    const clip = clipFor(changed.length ? changed : keys, !!settings.auto)
    if (clip && status.kind === 'ready') setPasting({ mode: 'preset', clip })
  }

  async function savePreset(clip: Clipboard, name: string) {
    // Presets may hold gradients and range masks, not brush strokes (Part 23; owner's decision 7).
    const data: PresetData = { keys: clip.keys, settings: withMasksList(clip.settings, presetMasks(clip.settings.masks)), rerunAuto: clip.rerunAuto && !!clip.settings.auto, sourceKind: clip.sourceKind }
    await catalog.savePreset(name, JSON.stringify(data))
    presetsChanged.emit()
  }

  async function removePreset(p: Preset) {
    if (p.starter || !window.confirm(`Delete the preset “${p.name}”? Photos it was applied to keep their settings.`)) return
    await catalog.deletePreset(Number(p.id.slice('user:'.length)))
    presetsChanged.emit()
  }

  // ---- snapshots (PHASE3.md Part 19): kept in the catalog and the sidecar, apart from the history
  useEffect(() => {
    let alive = true
    setSnapshots([])
    setHoverSnap(null)
    setBeforeSnapId(null)
    renamingRef.current = null
    setRenamingSnap(null)
    setSnapUndo(null)
    setHistoryMenu(null)
    const load = () =>
      void catalog.listSnapshots(id).then(
        (list) => alive && setSnapshots(list),
        () => {},
      )
    load()
    // Read changes, or snapshots taken in from the sidecar before it is rewritten.
    const off = snapshotsChanged.subscribe((pid) => pid === id && load())
    return () => {
      alive = false
      off()
    }
  }, [catalog, id])

  /** A new list for the photo shown: saved to the catalog, then the sidecar; `undo` offers Undo (the list before). */
  function changeSnapshots(list: Snapshot[], text: string, undo = true) {
    const before = snapshots
    setSnapshots(sortSnapshots(list))
    setSnapUndo({ text, list: undo ? before : null, history: historyRef.current })
    const photoId = id
    void catalog.saveSnapshots(photoId, list).then(() => sidecars.schedule([photoId]))
  }
  /** The last change to the list, while it can still be undone (until the photo's history changes). */
  const snapNotice = snapUndo && snapUndo.history === history ? snapUndo : null
  function undoSnapshots(): boolean {
    if (!snapNotice?.list) return false
    const list = snapNotice.list
    if (beforeSnapId && !list.some((x) => x.id === beforeSnapId)) setBeforeSnapId(null)
    startRename(null)
    setSnapshots(sortSnapshots(list))
    setSnapUndo({ text: 'Undone.', list: null, history: historyRef.current })
    const photoId = id
    void catalog.saveSnapshots(photoId, list).then(() => sidecars.schedule([photoId]))
    return true
  }
  function startRename(sid: string | null) {
    renamingRef.current = sid
    setRenamingSnap(sid)
  }
  /** New snapshot of the photo's settings (or of a History step's), named with the date and time; its name is then edited. */
  function createSnapshot(from?: DevelopSettings, what = 'the current settings') {
    if (status.kind !== 'ready' || !history) return
    const snap = makeSnapshot(from ?? settings, snapshots)
    changeSnapshots([...snapshots, snap], `Saved ${what} as “${snap.name}”.`)
    startRename(snap.id)
  }
  function renameSnapshot(snap: Snapshot, value: string) {
    // Enter, then the field's blur: only once. Esc ended the editing first, so its blur keeps the name.
    if (renamingRef.current !== snap.id) return
    startRename(null)
    const name = uniqueName(cleanName(value) || snap.name, snapshots, snap.id)
    if (name === snap.name) return
    changeSnapshots(snapshots.map((x) => (x.id === snap.id ? { ...x, name } : x)), `Renamed “${snap.name}” to “${name}”.`)
  }
  function updateSnapshot(snap: Snapshot) {
    changeSnapshots(snapshots.map((x) => (x.id === snap.id ? { ...x, settings: JSON.parse(JSON.stringify(settings)) as DevelopSettings } : x)), `Updated “${snap.name}” with the current settings.`)
  }
  function deleteSnapshot(snap: Snapshot) {
    if (beforeSnapId === snap.id) setBeforeSnapId(null)
    setHoverSnap(null)
    changeSnapshots(snapshots.filter((x) => x.id !== snap.id), `Deleted “${snap.name}”.`)
  }
  /** Applies a snapshot as one history step, exactly as saved (an older process version stays: the photo as it was). */
  function applySnapshot(snap: Snapshot) {
    if (status.kind !== 'ready' || !info) return
    if (draft) endCrop(false)
    setHoverSnap(null)
    change(`Snapshot: ${snap.name}`, normalizeSettings(snap.settings, info.kind), true, true)
  }
  /** Undo/redo keys: undo first takes back the last change to the snapshot list, if that came after the last edit. */
  function historyKey(cmd: 'develop.undo' | 'develop.redo') {
    if (cmd === 'develop.undo' && undoSnapshots()) return
    dirty.current = true
    setHistory((h) => (h ? (cmd === 'develop.redo' ? redo(h) : undo(h)) : h))
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
    changedKeys(prev.settings, settings).forEach((k) => !NOT_AUTO_SYNCED.includes(k) && p.keys.add(k))
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
  /** Zoom levels (PHASE3.md, "Zoom levels"): the toolbar menu, Z, the zoom keys, a click on the fitted photo, Ctrl/⌘ + wheel. */
  const zoom = useZoom({ engine: engineRef, view, setView, stage: stageRef, enabled: status.kind === 'ready' && !draft && !guiding })
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
      case 'develop.snapshot':
      case 'develop.snapshotApp': createSnapshot(); break
      case 'develop.undo':
      case 'develop.redo': historyKey(cmd); break
      case 'develop.before': setBefore((b) => !b); break
      case 'develop.clipping': setOverlay((o) => !o); break
      case 'develop.zoom': zoom.toggle(); break
      case 'develop.zoomIn': zoom.step(1); break
      case 'develop.zoomOut': zoom.step(-1); break
      default:
        return false
    }
  })
  // While the Colour Mixer's targeted adjustment tool or Point Color's picker is on, Develop listens to 'mixer'.
  const mixerTool = !!mixerTarget || pointPick
  // Groups start closed (ToolStack): a tool started with its shortcut opens its group, so its controls are in view.
  const toolGroup: GroupId | null = removing ? 'remove' : masking.active ? 'masks' : curveTarget ? 'curve' : mixerTool ? 'colour' : wbPick ? 'basic' : guiding ? 'crop' : null
  useEffect(() => {
    if (toolGroup) setReveal({ id: toolGroup, n: Date.now(), ifClosed: true })
  }, [toolGroup])
  useShortcuts(['mixer'], !pasting && !draft && !guiding && mixerTool, (cmd) => {
    switch (cmd) {
      case 'develop.mixerTargetHue': startMixerTarget(mixerTarget === 'hue' ? null : 'hue'); break
      case 'develop.mixerTargetSat': startMixerTarget(mixerTarget === 'saturation' ? null : 'saturation'); break
      case 'develop.mixerTargetLum': startMixerTarget(mixerTarget === 'luminance' ? null : 'luminance'); break
      case 'develop.mixerTargetOff':
        setMixerTarget(null)
        setPointPick(false)
        break
      case 'develop.pointColorPick': startPointPick(); break
      case 'develop.snapshot':
      case 'develop.snapshotApp': createSnapshot(); break
      case 'develop.undo':
      case 'develop.redo': historyKey(cmd); break
      case 'develop.before': setBefore((b) => !b); break
      case 'develop.clipping': setOverlay((o) => !o); break
      case 'develop.zoom': zoom.toggle(); break
      case 'develop.zoomIn': zoom.step(1); break
      case 'develop.zoomOut': zoom.step(-1); break
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
      case 'remove.modeAi': editSpot('mode', 'ai'); break
      case 'remove.clear': clearSpots(); break
      case 'develop.before': setBefore((b) => !b); break
      case 'develop.zoom': zoom.toggle(); break
      case 'develop.zoomIn': zoom.step(1); break
      case 'develop.zoomOut': zoom.step(-1); break
      case 'develop.snapshot':
      case 'develop.snapshotApp': createSnapshot(); break
      case 'develop.undo':
      case 'develop.redo':
        setSelectedSpot(null)
        historyKey(cmd)
        break
      default:
        return false
    }
  })
  // While masking on the photo, Develop listens to 'mask' (PHASE3.md Part 23).
  const maskNew = (cmd: string) => {
    const kind = ({ 'develop.maskBrush': 'brush', 'develop.maskLinear': 'linear', 'develop.maskRadial': 'radial', 'develop.maskColour': 'colour', 'develop.maskLuminance': 'luminance', 'develop.maskDepth': 'depth', 'develop.maskObject': 'ai' } as const)[cmd as 'develop.maskBrush']
    if (!kind || status.kind !== 'ready') return false
    masking.newOf(kind)
    return true
  }
  useShortcuts(['mask'], !pasting && !draft && !guiding && masking.active, (cmd) => {
    const b = masking.brush
    switch (cmd) {
      case 'develop.masks':
      case 'mask.done': masking.end(); break
      case 'mask.cancel':
        if (masking.creating) masking.setCreating(null)
        else if (masking.picking) masking.setPicking(null)
        else if (masking.sel.mask) masking.select(null)
        else masking.end()
        break
      case 'develop.maskBrush':
      case 'develop.maskLinear':
      case 'develop.maskRadial':
      case 'develop.maskColour':
      case 'develop.maskLuminance':
      case 'develop.maskDepth':
      case 'develop.maskObject': maskNew(cmd); break
      case 'mask.overlay': masking.setOverlay({ ...masking.overlay, on: !masking.overlay.on }); break
      case 'mask.overlayColour': masking.nextOverlayColour(); break
      case 'mask.overlayMode': masking.nextOverlayMode(); break
      case 'mask.pins': masking.setPins(!masking.pins); break
      case 'mask.sizeUp': masking.setBrush({ ...b, size: Math.min(MASK_BRUSH_SIZE[1], Math.max(b.size + 1, Math.round(b.size * 1.15))) }); break
      case 'mask.sizeDown': masking.setBrush({ ...b, size: Math.max(MASK_BRUSH_SIZE[0], Math.min(b.size - 1, Math.round(b.size / 1.15))) }); break
      case 'mask.featherUp': masking.setBrush({ ...b, feather: Math.min(100, b.feather + 10) }); break
      case 'mask.featherDown': masking.setBrush({ ...b, feather: Math.max(0, b.feather - 10) }); break
      case 'mask.erase': masking.setBrush({ ...b, erase: !b.erase }); break
      case 'mask.invert': masking.invertMask(); break
      case 'mask.newSame': masking.newSame(); break
      case 'mask.delete': masking.deleteSelected(); break
      case 'develop.before': setBefore((x) => !x); break
      case 'develop.zoom': zoom.toggle(); break
      case 'develop.zoomIn': zoom.step(1); break
      case 'develop.zoomOut': zoom.step(-1); break
      case 'develop.snapshot':
      case 'develop.snapshotApp': createSnapshot(); break
      case 'develop.undo':
      case 'develop.redo': historyKey(cmd); break
      default:
        return false
    }
  })
  useShortcuts(['develop'], !pasting && !draft && !guiding && !curveTarget && !removing && !mixerTool && !masking.active, (cmd) => {
    switch (cmd) {
      case 'develop.masks': masking.start(); break
      case 'develop.maskBrush':
      case 'develop.maskLinear':
      case 'develop.maskRadial':
      case 'develop.maskColour':
      case 'develop.maskLuminance':
      case 'develop.maskDepth':
      case 'develop.maskObject': maskNew(cmd); break
      case 'develop.grid': onLibrary(); break
      case 'develop.curveTarget': toggleCurveTarget(); break
      case 'develop.curveReset': changeCurve('Reset tone curve', undefined, true); break
      case 'develop.mixerTargetHue': startMixerTarget('hue'); break
      case 'develop.mixerTargetSat': startMixerTarget('saturation'); break
      case 'develop.mixerTargetLum': startMixerTarget('luminance'); break
      case 'develop.pointColorPick': startPointPick(); break
      case 'develop.mixerReset': changeMixer('Reset colour mixer and Point Color', undefined, true); break
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
      case 'develop.snapshot':
      case 'develop.snapshotApp': createSnapshot(); break
      case 'develop.undo':
      case 'develop.redo': historyKey(cmd); break
      case 'develop.before': setBefore((b) => !b); break
      // darktable: Shift+O toggles the raw (sensor) clipping indicator.
      case 'develop.sensorClipping': setRawOverlay((o) => !o); break
      // J as in Lightroom, O as in darktable.
      case 'develop.clipping': setOverlay((o) => !o); break
      // Lightroom Classic: S soft proofing, Shift+S its destination gamut warning (shown with proofing).
      case 'develop.softProof': proof.set({ ...proof.settings, on: !proof.settings.on }); break
      case 'develop.proofGamut': proof.set({ ...proof.settings, on: true, destWarning: !(proof.settings.on && proof.settings.destWarning) }); break
      case 'develop.zoom': zoom.toggle(); break
      case 'develop.zoomIn': zoom.step(1); break
      case 'develop.zoomOut': zoom.step(-1); break
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
        setMixerTarget(null)
        setPointPick(false)
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

  // ---- diagnostics (off by default; Settings → Diagnostics): history steps with what changed, the view's zoom and
  // the tools open. Nothing is computed when it is off.
  const loggedSettings = useRef<{ id: number; s: DevelopSettings } | null>(null)
  useEffect(() => {
    if (!history || !diagnostics.enabled) return
    const step = history.steps[history.index]
    const prev = loggedSettings.current
    loggedSettings.current = { id, s: step.settings }
    if (!prev || prev.id !== id) return
    if (prev.s !== step.settings) diagnostics.log('edit', { step: step.label, index: history.index, changes: settingsChange(prev.s, step.settings) })
  }, [history, id])
  useEffect(() => {
    diagnostics.log('view', { zoom: view.zoom })
  }, [view.zoom])
  useEffect(() => {
    diagnostics.log('tools', { wbPicker: wbPick, crop: !!draft, guided: guiding, remove: removing, masks: masking.active, before })
  }, [wbPick, draft, guiding, removing, masking.active, before])

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
    if (status.kind !== 'ready' || wbPick || draft || guiding || (removing && !before) || (masking.active && !before && !bypass.masks)) return
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
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true
    const c = engineRef.current!.canvas
    setView({ zoom: view.zoom, center: panCenter(d.center, (e.clientX - d.x) * dpr, (e.clientY - d.y) * dpr, p.l, c.width, c.height) })
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
      // To the last chosen level, keeping the clicked point under the pointer.
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) zoom.set(zoom.last, e)
    } else {
      setView({ zoom: 'fit', center: view.center })
    }
  }

  const strip = useMemo(() => ids.slice(Math.max(0, index - 40), index + 41), [ids, index])

  /**
   * Create Proof Copy (Lightroom's): a virtual copy of the photo as edited now, named after the proof profile (Lightroom
   * puts the profile's name in the copy's name), opened next to the original for editing for that output.
   */
  async function createProofCopy() {
    const src = proof.source
    if (!src || !history) return
    setProofCopyBusy(true)
    try {
      // The copy starts from the edit as it is now: a save still waiting is made first.
      const run = pendingSave.current
      pendingSave.current = null
      if (run) await run()
      else if (saving.current) await saving.current.catch(() => {})
      const copy = await catalog.createVirtualCopy(id, `Proof: ${src.label}`)
      const thumb = await loadThumb(id)
      if (thumb) await saveThumb(copy, new Uint8Array(await thumb.arrayBuffer()))
      sidecars.schedule([copy])
      onEdited()
      const at = ids.indexOf(id)
      setSelection(new Set([copy]))
      onNavigate(copy, [...ids.slice(0, at + 1), copy, ...ids.slice(at + 1)])
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    } finally {
      setProofCopyBusy(false)
    }
  }

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
        <SnapshotPanel
          snapshots={snapshots}
          disabled={status.kind !== 'ready' || autoBusy}
          beforeId={beforeSnap?.id ?? null}
          renaming={renamingSnap}
          notice={snapNotice ? { text: snapNotice.text, undo: !!snapNotice.list } : null}
          newKey={keyText('develop.snapshot')}
          onCreate={() => createSnapshot()}
          onApply={applySnapshot}
          onHover={setHoverSnap}
          onRenameStart={startRename}
          onRename={renameSnapshot}
          onUpdate={updateSnapshot}
          onDelete={deleteSnapshot}
          onSetBefore={(snap) => setBeforeSnapId(snap?.id ?? null)}
          onUndo={() => void undoSnapshots()}
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
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (status.kind === 'ready') setHistoryMenu({ index: i, ...menuPoint(e) })
                  }}
                  title="Click to go back to this step · right-click to make a snapshot of it"
                >
                  {history.steps[i].label}
                </button>
              </li>
            ))}
        </ol>
        {historyMenu && history?.steps[historyMenu.index] && (
          <ContextMenu
            x={historyMenu.x}
            y={historyMenu.y}
            label={`History step ${history.steps[historyMenu.index].label}`}
            onClose={() => setHistoryMenu(null)}
            items={[{ label: 'Create snapshot from this step', onSelect: () => createSnapshot(history.steps[historyMenu.index].settings, `the step “${history.steps[historyMenu.index].label}”`) }]}
          />
        )}
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
          <button className={`button small ${masking.active ? 'on' : ''}`} onClick={() => (masking.active ? masking.end() : masking.start())} disabled={status.kind !== 'ready'} title={withKey(masking.active ? 'Finish masking' : 'Masks: local adjustments with brushes, gradients and ranges', 'develop.masks')}>
            {masking.active ? 'Done' : 'Masks'}
          </button>
          <button className={`button small ${before ? 'on' : ''}`} onClick={() => setBefore(!before)} disabled={status.kind !== 'ready' || !!draft} title={withKey(beforeSnap ? `Before / after: compares with the snapshot “${beforeSnap.name}”` : 'Before / after', 'develop.before')}>
            {before ? 'Showing before' : 'Before / after'}
          </button>
          <ZoomControl
            zoom={view.zoom}
            disabled={status.kind !== 'ready' || !!draft || guiding}
            onChange={(z) => zoom.set(z)}
            title={`Zoom. 100 % shows one photo pixel per screen pixel; above it the pixels are enlarged without smoothing, so sharpness and noise show as they are. ${withKey('Fit and back', 'develop.zoom')} · ${withKey('Larger', 'develop.zoomIn')} · ${withKey('Smaller', 'develop.zoomOut')} · Ctrl or ⌘ + wheel over the photo zooms toward the pointer · a click on the fitted photo zooms in there.`}
          />
          <label className="check small" title={withKey('Soft proofing: preview the photo as a printer, paper or colour space will show it. A view only: the edit and exports don’t change.', 'develop.softProof')}>
            <input type="checkbox" checked={proof.settings.on} onChange={(e) => proof.set({ ...proof.settings, on: e.target.checked })} />
            Soft proofing
          </label>
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
        {proof.settings.on && (
          <ProofBar
            proof={proof}
            screen={currentDisplaySpace()}
            screenNote={displaySpaceNote()}
            disabled={status.kind !== 'ready'}
            onProofCopy={() => void createProofCopy()}
            copyBusy={proofCopyBusy}
          />
        )}
        <div
          className={`dstage ${draft ? 'cropping' : guiding ? 'guiding' : removing ? 'removing' : masking.active ? 'masking' : view.zoom === 'fit' ? 'fit' : 'zoomed'} ${wbPick ? 'wb-picking' : ''}`}
          ref={stageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setLoupe(null)}
        >
          {status.kind !== 'ready' && placeholderUrl && <img className="dplaceholder" src={placeholderUrl} alt="" />}
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
          {mixerTarget && !draft && !guiding && !before && status.kind === 'ready' && (
            <MixerTatLayer
              mixer={settings.colourMixer}
              channel={mixerTarget}
              enabled={!pasting}
              uvAt={imageUv}
              sample={(uv) => sampleMixerAt(uv, false)}
              onHover={setMixerHover}
              onDraft={(m) => setMixerDraft(m === null ? null : { m })}
              onChange={changeMixer}
              onVisualize={setMixerVis}
              onExit={() => setMixerTarget(null)}
            />
          )}
          {pointPick && !draft && !guiding && !before && status.kind === 'ready' && (
            <PointPickLayer enabled={!pasting} uvAt={imageUv} sample={(uv) => sampleMixerAt(uv, true)} onPick={addPoint} onExit={() => setPointPick(false)} />
          )}
          {status.kind === 'loading' && !gpuStopped && <div className="dmessage">Developing…</div>}
          {status.kind === 'error' && !gpuStopped && <div className="dmessage error">{status.message}</div>}
          {engineError && !gpuStopped && <div className="dmessage error">{engineError}</div>}
          {gpuStopped && (
            <div className="dmessage error gpu-stopped" role="alert">
              <p>{gpuStopped}</p>
              <button className="button" onClick={tryGpuAgain}>
                Try again
              </button>
            </div>
          )}
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
                  const [u, v] = b.map ? sensorToDisplayAt(b.map, x, y) : engine.sensorToDisplay(x, y)
                  return [b.x + u * b.w, b.y + v * b.h]
                }}
                fromView={(x, y) => {
                  const u = (x - b.x) / b.w
                  const v = (y - b.y) / b.h
                  return b.map ? displayToSensorAt(b.map, u, v) : engine.displayToSensor(u, v)
                }}
                spots={aiPending ? [...spots, aiPending] : spots}
                sensor={sensorSize()}
                brush={{ radius: brush.size, feather: brush.feather / 100 }}
                selected={selectedSpot}
                showAll={showAllSpots.on}
                progress={aiPending && aiRemove.busy ? { spot: spots.length, fraction: aiRemove.busy.fraction ?? 0 } : retouch.busy && retouch.spot !== undefined ? { spot: retouch.spot, fraction: retouch.fraction ?? 0 } : null}
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
          {masking.active && !draft && !guiding && !before && !bypass.masks && shownBox?.map && info && status.kind === 'ready' && (() => {
            const b = shownBox
            const map = b.map!
            const [sw, sh] = map.sensor
            return (
              <MaskOverlay
                key={id}
                box={b}
                toView={(x, y) => {
                  const [u, v] = sensorToDisplayAt(map, x * sw, y * sh)
                  return [b.x + u * b.w, b.y + v * b.h]
                }}
                fromView={(x, y) => {
                  const [px, py] = displayToSensorAt(map, (x - b.x) / b.w, (y - b.y) / b.h)
                  return [px / sw, py / sh]
                }}
                sensor={[sw, sh]}
                masks={shownMasks(masking.draft ?? settings.masks ?? [], masking.hidden)}
                selected={masking.sel.mask}
                selectedComp={masking.sel.comp}
                creating={masking.creating?.kind ?? null}
                picking={masking.picking}
                brush={masking.brush}
                showPins={masking.pins}
                onSelect={(mid, cid) => masking.select(mid, cid)}
                onCreate={masking.onCreate}
                onShape={masking.onShape}
                onStroke={masking.onStroke}
                onPick={(uv, add) => void masking.onPick(uv, add)}
                onPan={(dx, dy) => panBy(dx, dy)}
                object={masking.objectMode ? {
                  mode: masking.objectMode,
                  ready: objectSel.ready && !masking.objectBusy,
                  preview: objectSel.preview,
                  touchPoint: masking.touchPoint,
                  onHover: masking.onObjectHover,
                  onClick: (pt, shift, alt, box) => void masking.onObjectClick(pt, shift, alt, box),
                  onTap: (pt) => {
                    masking.setTouchPoint(pt)
                    masking.onObjectHover(pt)
                  },
                } : null}
              />
            )
          })()}
          {masking.active && !draft && !guiding && (
            <div className="dbadge crop-hint">
              {before || bypass.masks
                ? 'Masks hidden'
                : masking.objectMode
                  ? masking.objectMode === 'refine'
                    ? 'Object select: click selects something new · Shift-click adds · Alt-click removes · drag selects inside a box · Esc ends'
                    : 'Object select: point at something to preview it · click selects it · drag selects inside a box · Esc ends'
                  : 'Masking: K brush · M linear · Shift+M radial · Shift+J colour · Shift+Q luminance · O overlay · Alt-drag erases · Enter finishes'}
            </div>
          )}
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
          {before && <div className="dbadge">{beforeSnap ? `Before: snapshot “${beforeSnap.name}”` : 'Before'}</div>}
          {!before && hoverSnap && !draft && <div className="dbadge">Preview: snapshot “{hoverSnap.name}”</div>}
          {!before && hoverPreset && !hoverSnap && !draft && <div className="dbadge">Preview: {hoverPreset.name}</div>}
          {!before && !draft && hiddenBadge.length > 0 && (
            <div className="dbadge">Hidden: {hiddenBadge.join(', ')}</div>
          )}
          {mixerTarget && !draft && !guiding && !before && (
            <div className="dbadge pick curve-hint">
              Colour mixer ({CHANNEL_NAMES[mixerTarget]}): drag up or down on a colour · ↑ ↓ nudge · Alt shows its colours · Esc ends
            </div>
          )}
          {pointPick && !draft && !guiding && !before && <div className="dbadge pick curve-hint">Point Color: click a colour on the photo · Esc cancels</div>}
          {mixerVis > 0 && !before && !bypass.colour && (
            <div className="dbadge right">{mixerVis <= 8 ? `Showing ${BAND_NAMES[mixerVis - 1]}’s colours; the rest grey` : `Showing Point Color ${mixerVis - 8}’s range; the rest grey`}</div>
          )}
          {curveTarget && !draft && !guiding && !before && (
            <div className="dbadge pick curve-hint">
              Tone curve: drag up or down on the photo to change those tones · ↑ ↓ nudge · Esc ends
            </div>
          )}
          {maskPreview && !before && <div className="dbadge right">Sharpening mask: white is sharpened, black is not</div>}
          {(overlay || rawOverlay) && (
            <div className="dbadge right">
              {[overlay && withKey('Clipping shown', 'develop.clipping'), rawOverlay && withKey('Sensor clipping shown', 'develop.sensorClipping')].filter(Boolean).join(' · ')}
            </div>
          )}
          {wbPick && <div className="dbadge pick">Click something that should be neutral grey or white · Esc to cancel</div>}
          {wbPick && loupe && <WbLoupe x={loupe.x} y={loupe.y} image={loupe.image} zoom={LOUPE_ZOOM} />}
          {picking && <div className="dbadge pick">Click a photo in the filmstrip to match its look · Esc to cancel</div>}
          {gpuNotice && <div className="dbadge gpu-notice" role="status">{gpuNotice}</div>}
          {adapterNotice && (
            <div className="adapter-notice" role="status">
              <span>
                LightBench is running on {adapterNotice}. If this computer has a faster graphics card, set your browser to “High performance” in Windows Settings → System → Display → Graphics, then restart the browser.
              </span>
              <button
                className="button small"
                onClick={() => {
                  try {
                    localStorage.setItem(ADAPTER_NOTICE_KEY, adapterNotice)
                  } catch {
                    // Storage blocked: hidden for this visit.
                  }
                  setAdapterNotice(null)
                }}
              >
                Dismiss
              </button>
            </div>
          )}
          {proof.settings.on && proof.source && (
            <div className="dbadge proof" aria-live="polite">
              {proof.draw ? `Proof preview: ${proof.source.label} · ${INTENT_LABELS[proof.settings.intent]}${proof.settings.simulatePaper ? ' · paper & ink' : ''}` : 'Building the proof…'}
            </div>
          )}
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
        <SectionEyeContext.Provider value={sectionEyes}>
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
                  ai={{ busy: aiRemove.busy, onCancel: aiRemove.cancel, onRetry: retryAiSpot }}
                />
              ),
            },
            {
              id: 'masks',
              label: 'Masks',
              title: 'Masks',
              icon: GROUP_ICONS.masks,
              bypass: settings.masks?.length || bypass.masks
                ? { off: bypass.masks, onToggle: () => setBypass((b) => ({ ...b, masks: !b.masks })), title: bypass.masks ? 'Show the masks again' : 'Show the photo without its masks (nothing is changed)' }
                : undefined,
              content: (
                <MasksPanel
                  masks={masking.draft ?? settings.masks ?? []}
                  m={masking}
                  depth={depth}
                  object={objectSel}
                  disabled={status.kind !== 'ready'}
                  showHint={hintsPref === 1}
                  acr={acr}
                  lightroomNote={settings.masks?.some((x) => x.id.startsWith('lr')) ? 'Some masks were read from Lightroom’s settings in the .xmp (experimental: their look is approximate, and parts that couldn’t be read were left out).' : null}
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
            setMixerTarget(null)
            setPointPick(false)
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
                  auto={<CurveAuto {...curveAuto} />}
                />
              ),
            },
            {
              id: 'colour',
              label: 'Colour',
              title: 'Colour Mixer',
              icon: GROUP_ICONS.colour,
              bypass: settings.colourMixer || bypass.colour
                ? { off: bypass.colour, onToggle: () => setBypass((b) => ({ ...b, colour: !b.colour })), title: bypass.colour ? 'Show the colour mixer and Point Color again' : 'Show the photo without the colour mixer and Point Color (nothing is changed)' }
                : undefined,
              content: (
                <ColourMixerPanel
                  mixer={mixerDraft ? mixerDraft.m : settings.colourMixer}
                  ui={mixerUi}
                  onUi={setMixerUi}
                  disabled={status.kind !== 'ready'}
                  showHint={hintsPref === 1}
                  tat={mixerTarget}
                  onTat={startMixerTarget}
                  hover={mixerTarget ? mixerHover : null}
                  onChange={changeMixer}
                  onVisualize={setMixerVis}
                  picking={pointPick}
                  onPick={startPointPick}
                  selectedPoint={selectedPoint}
                  onSelectPoint={setSelectedPoint}
                />
              ),
            },
            {
              id: 'grading',
              label: 'Grading',
              title: 'Colour Grading',
              icon: GROUP_ICONS.grading,
              bypass: settings.colourGrading || bypass.grading
                ? { off: bypass.grading, onToggle: () => setBypass((b) => ({ ...b, grading: !b.grading })), title: bypass.grading ? 'Show the colour grading again' : 'Show the photo without the colour grading (nothing is changed)' }
                : undefined,
              content: (
                <ColourGradingPanel
                  grading={gradingDraft ? gradingDraft.g : settings.colourGrading}
                  view={gradingViewStored.view}
                  onView={(v) => setGradingView({ view: v })}
                  disabled={status.kind !== 'ready'}
                  showHint={hintsPref === 1}
                  onChange={changeGrading}
                  onDraft={onGradingDraft}
                  onBoost={setGradingBoost}
                />
              ),
            },
            {
              id: 'detail',
              label: 'Detail',
              title: 'Detail',
              icon: GROUP_ICONS.detail,
              bypass: detailOn(settings.detail) || bypass.detail
                ? { off: bypass.detail, onToggle: () => setBypass((b) => ({ ...b, detail: !b.detail })), title: bypass.detail ? 'Show sharpening and noise reduction again' : 'Show the photo without sharpening and noise reduction (nothing is changed)' }
                : undefined,
              content: (
                <DetailPanel
                  detail={settings.detail}
                  kind={info?.kind ?? 'raw'}
                  defaults={defaults.detail}
                  disabled={status.kind !== 'ready'}
                  showHint={hintsPref === 1}
                  profile={noiseProfile}
                  radius={sharpenRadius}
                  db={noiseDb}
                  onLoadDb={() => void loadNoiseProfiles(true).then(() => requestRender())}
                  zoomedOut={view.zoom === 'fit' || (typeof view.zoom === 'number' && view.zoom < 1)}
                  onChange={(label, detail) => change(label, withDetail(settings, detail))}
                  onMaskPreview={setMaskPreview}
                />
              ),
            },
            {
              id: 'effects',
              label: 'Effects',
              title: 'Effects',
              icon: GROUP_ICONS.effects,
              bypass: effectsGroupOn(settings.effects) || bypass.effects
                ? { off: bypass.effects, onToggle: () => setBypass((b) => ({ ...b, effects: !b.effects })), title: bypass.effects ? 'Show the vignette, grain and glow again' : 'Show the photo without its post-crop vignette, grain and glow (nothing is changed)' }
                : undefined,
              content: (
                <EffectsPanel
                  effects={settings.effects}
                  disabled={status.kind !== 'ready'}
                  showHint={hintsPref === 1}
                  onChange={(label, fx) => change(label, withEffects(settings, fx))}
                />
              ),
            },
          ]}
        />
        </SectionEyeContext.Provider>
      </aside>
      {aiRemove.ask && (
        <ModelDialog model={aiRemove.ask.model} files={aiRemove.ask.files} purpose={aiRemove.ask.slow ? 'AI Remove (on this computer it runs on the processor: several minutes per spot)' : 'AI Remove'} onInstalled={(rec) => aiRemove.ask?.done(rec)} onClose={() => aiRemove.ask?.done(null)} />
      )}
      {objectSel.ask && (
        <ModelDialog model={objectSel.ask.model} files={objectSel.ask.files} purpose={objectSel.ask.slow ? 'Object select (on this computer it runs on the processor, without a suitable graphics card: preparing each photo takes longer)' : 'Object select'} onInstalled={(rec) => objectSel.ask?.done(rec)} onClose={() => objectSel.ask?.done(null)} />
      )}
      {depth.ask && (
        <ModelDialog model={depth.ask.model} file={depth.ask.file} purpose="The Depth range mask" onInstalled={(rec) => depth.ask?.done(rec)} onClose={() => depth.ask?.done(null)} />
      )}
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

/** The masks shown: those whose own eye is on (Part 23). */
const shownCache = new WeakMap<LocalMask[], { hidden: ReadonlySet<string>; out: LocalMask[] }>()
function shownMasks(list: LocalMask[], hidden: ReadonlySet<string>): LocalMask[] {
  if (!hidden.size) return list
  const hit = shownCache.get(list)
  if (hit && hit.hidden === hidden) return hit.out
  const out = list.filter((m) => !hidden.has(m.id))
  shownCache.set(list, { hidden, out })
  return out
}
