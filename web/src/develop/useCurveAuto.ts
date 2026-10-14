// Tone Curve Auto in Develop (PHASE3.md Part 21): Auto contrast, Auto colour, their Amount, and the suggestions drawn on
// the photo. The maths is in engine/develop/curve-auto.ts and the history in curveAutoState.ts; this hook measures the
// photo on the GPU and keeps the panel's state. It only writes tone-curve settings.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { autoColour, autoContrast, withAutoColour, withAutoContrast } from '../engine/develop/curve-auto'
import { displayUniforms, type DevelopSettings } from '../engine/develop/settings'
import { CURVE_PRESETS, DEFAULT_TONE_CURVE, normalizeToneCurve, withToneCurve, type ToneCurveSettings } from '../engine/develop/tone-curve'
import type { DevelopEngine } from '../engine/gpu/develop-engine'
import { gpuGate } from '../engine/gpu/gate'
import { amountShown, applyResult, changeAmount, type CurveApplied } from './curveAutoState'
import type { History } from './history'
import { multipliers, type SensorInfo } from './source'

export type AutoKind = 'contrast' | 'colour'

export interface Suggestion {
  id: string
  name: string
  /** The curve it applies (computed for the settings shown). */
  curve: ToneCurveSettings | undefined
  image: ImageData | null
}

export interface CurveAutoProps {
  disabled: boolean
  busy: AutoKind | null
  message: string | null
  /** The Amount of the result just applied, while it is the step shown. */
  amount: { value: number; label: string } | null
  onAuto: (kind: AutoKind) => void
  onAmount: (amount: number) => void
  suggestions: { open: boolean; busy: boolean; items: Suggestion[]; applied: string | null }
  onSuggestions: (open: boolean) => void
  onSuggestion: (id: string) => void
  onHover: (id: string | null) => void
}

interface Options {
  engine: () => DevelopEngine | null
  info: SensorInfo | null
  history: History | null
  settings: DevelopSettings
  ready: boolean
  photoId: number
  setHistory: Dispatch<SetStateAction<History | null>>
  markDirty: () => void
  /** Runs GPU work on the photo's real settings (an eye may be showing another white balance). */
  onRealStage: <T>(work: () => Promise<T>) => Promise<T>
  /** Shows a curve on the photo while a suggestion is hovered (null ends it). */
  preview: (tc: ToneCurveSettings | undefined | null) => void
}

const LABELS: Record<AutoKind, string> = { contrast: 'Tone Curve: Auto contrast', colour: 'Tone Curve: Auto colour' }
const THUMB = 120
const pct = (v: number) => `${(v * 100).toFixed(1)} %`
const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(1)} %`

export function useCurveAuto(o: Options): CurveAutoProps {
  const [busy, setBusy] = useState<AutoKind | null>(null)
  // Each kept with the photo it belongs to: nothing is carried over to another photo.
  const [note, setNote] = useState<{ photo: number; text: string } | null>(null)
  const [appliedFor, setApplied] = useState<CurveApplied & { photo: number } | null>(null)
  const [open, setOpen] = useState(false)
  const [drawn, setItems] = useState<{ photo: number; items: Suggestion[] }>({ photo: -1, items: [] })
  const [suggestBusy, setSuggestBusy] = useState(false)
  const opts = useRef(o)
  useLayoutEffect(() => {
    opts.current = o
  })
  const applied = appliedFor && appliedFor.photo === o.photoId ? appliedFor : null
  const message = note && note.photo === o.photoId ? note.text : null
  const items = useMemo(() => (drawn.photo === o.photoId ? drawn.items : []), [drawn, o.photoId])
  const setMessage = (text: string) => setNote({ photo: opts.current.photoId, text })

  /** The two Auto curves for these settings, measured on the GPU (the curve's input histograms). */
  const compute = useCallback(async (kind: AutoKind, s: DevelopSettings): Promise<{ curve: ToneCurveSettings | undefined; note: string } | null> => {
    const { engine: getEngine, info, onRealStage } = opts.current
    const engine = getEngine()
    if (!engine || !info) return null
    const u = displayUniforms(s)
    const wb = multipliers(s, info)
    if (kind === 'contrast') {
      const h = await onRealStage(() => gpuGate.foreground(() => engine.renderCurveInput(u, wb, false, 256)))
      const r = autoContrast(h.luma, s.toneCurve)
      const curve = withAutoContrast(s.toneCurve, r)
      const note = r.reason === 'contrasty'
        ? 'This photo’s tones are already spread widely: Auto contrast gives a straight RGB curve.'
        : r.reason === 'narrow' || r.reason === 'empty'
          ? 'Too few distinct tones to shape: Auto contrast gives a straight RGB curve.'
          : `S-curve around ${pct(r.pivot)}, slope ${r.slope.toFixed(2)} there${r.kept < 1 ? `, ${Math.round(r.kept * 100)} % of it so nothing more clips than before` : ''}; tones below ${pct(r.ends[0])} and above ${pct(r.ends[1])} kept clear of black and white.`
      return { curve, note }
    }
    const h = await onRealStage(() => gpuGate.foreground(() => engine.renderCurveInput(u, wb, true, 256)))
    const r = autoColour(h.red, h.green, h.blue)
    const curve = withAutoColour(s.toneCurve, r)
    const mid = r.anchors.map((a) => a.dy[1] ?? 0)
    const note = mid.every((d) => d === 0) && r.anchors.every((a) => a.dy.every((d) => d === 0))
      ? 'No colour cast found: the Red, Green and Blue curves are straight.'
      : `Midtones: Red ${signedPct(mid[0])}, Green ${signedPct(mid[1])}, Blue ${signedPct(mid[2])} (shadows and highlights half-way).`
    return { curve, note }
  }, [])

  const apply = useCallback((label: string, kind: string, curve: ToneCurveSettings | undefined, note: string) => {
    const { history, setHistory, markDirty } = opts.current
    if (!history) return
    const r = applyResult(history, label, kind, curve)
    if (!r) {
      setMessage(`${note} The curve is already that: nothing to change.`)
      return
    }
    markDirty()
    setHistory(r.history)
    setApplied({ ...r.applied, photo: opts.current.photoId })
    setMessage(note)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onAuto = useCallback(
    async (kind: AutoKind) => {
      const { ready, settings } = opts.current
      if (!ready || busy) return
      setBusy(kind)
      try {
        const r = await compute(kind, settings)
        // Applied only if the photo hasn't changed meanwhile.
        if (r && opts.current.settings === settings) apply(LABELS[kind], kind, r.curve, `${kind === 'contrast' ? 'Auto contrast' : 'Auto colour'}: ${r.note}`)
      } catch (e) {
        setMessage(`Auto failed: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setBusy(null)
      }
    },
    [busy, compute, apply],
  )

  const onAmount = useCallback(
    (amount: number) => {
      const { history, setHistory, markDirty, settings } = opts.current
      if (!history || !amountShown(applied, settings)) return
      const r = changeAmount(history, applied, Math.min(1, Math.max(0, amount)))
      markDirty()
      setHistory(r.history)
      setApplied({ ...r.applied, photo: opts.current.photoId })
    },
    [applied],
  )

  // ---- suggestions: the presets and both Auto results, drawn on this photo (renderImage, the thumbnails' path)
  const runToken = useRef(0)
  useEffect(() => {
    if (!open || !o.ready || !o.info) return
    const token = ++runToken.current
    const s = o.settings
    const t = setTimeout(async () => {
      const { engine: getEngine, info, onRealStage } = opts.current
      const engine = getEngine()
      if (!engine || !info) return
      setSuggestBusy(true)
      try {
        const base = s.toneCurve ?? DEFAULT_TONE_CURVE
        const list: Suggestion[] = CURVE_PRESETS.map((p) => ({ id: p.id, name: p.name, curve: normalizeToneCurve({ ...base, rgb: p.points }), image: null }))
        for (const kind of ['contrast', 'colour'] as const) {
          const r = await compute(kind, s)
          if (token !== runToken.current) return
          list.push({ id: kind, name: kind === 'contrast' ? 'Auto contrast' : 'Auto colour', curve: r?.curve, image: null })
        }
        const photo = opts.current.photoId
        setItems({ photo, items: list.map((x) => ({ ...x })) })
        const wb = multipliers(s, info)
        for (let i = 0; i < list.length; i++) {
          const curve = list[i].curve
          const img = await onRealStage(() => gpuGate.foreground(() => engine.renderImage(displayUniforms(withToneCurve(s, curve)), wb, THUMB)))
          if (token !== runToken.current) return
          list[i] = { ...list[i], image: img }
          setItems({ photo, items: list.map((x) => ({ ...x })) })
        }
      } catch {
        // e.g. the engine was replaced meanwhile; the next change draws them again.
      } finally {
        if (token === runToken.current) setSuggestBusy(false)
      }
    }, 400)
    return () => clearTimeout(t)
    // Drawn again when the photo's settings change while they are shown.
  }, [open, o.ready, o.info, o.settings, compute])

  const onSuggestion = useCallback(
    (id: string) => {
      const it = items.find((x) => x.id === id)
      if (!it) return
      opts.current.preview(null)
      const kind = id === 'contrast' || id === 'colour' ? (id as AutoKind) : null
      if (kind) {
        void onAuto(kind)
        return
      }
      apply(`Tone Curve: ${it.name}`, id, it.curve, `${it.name} on the RGB curve.`)
    },
    [items, onAuto, apply],
  )

  const onHover = useCallback(
    (id: string | null) => {
      const it = id ? items.find((x) => x.id === id) : null
      opts.current.preview(it ? (it.curve ?? undefined) : null)
    },
    [items],
  )

  const shownAmount = amountShown(applied, o.settings) ? applied : null
  return {
    disabled: !o.ready,
    busy,
    message,
    amount: shownAmount ? { value: shownAmount.amount, label: shownAmount.label } : null,
    onAuto: (k) => void onAuto(k),
    onAmount,
    suggestions: { open, busy: suggestBusy, items, applied: shownAmount ? shownAmount.kind : null },
    onSuggestions: (v) => {
      setOpen(v)
      if (!v) opts.current.preview(null)
    },
    onSuggestion,
    onHover,
  }
}
