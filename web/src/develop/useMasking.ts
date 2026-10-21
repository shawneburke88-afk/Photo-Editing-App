// Masking in Develop (docs/PHASE3.md Part 23): the state of the masking tool on the photo and what each action does to
// the photo's masks, one history step each (a slider drag merges into one step, as Develop's other sliders; a brush
// stroke or a handle drag is one step of its own). DevelopView renders the panel (MasksPanel) and the on-photo overlay
// (MaskOverlay) from this.

import { useCallback, useRef, useState } from 'react'
import type { Vec3 } from '../engine/color/matrix'
import type { DevelopSettings } from '../engine/develop/settings'
import { lstar, oklab, REC2020_Y } from '../engine/develop/mask-math'
import {
  canAdd, capMessage, dabCount, KIND_LABELS, KIND_SHORT, LOCAL_LABELS, MAX_DABS, MAX_SAMPLES, newComponentId, newMask, newMaskId, refuseReason, withMasksList,
  type BrushShape, type ColourShape, type KnownShape, type LinearShape, type LocalKey, type LocalMask, type LuminanceShape, type MaskComponent, type MaskOp, type RadialShape, type ShapeKind,
} from '../engine/develop/masks'
import { useStoredJson } from '../lib/useStoredJson'
import { DEFAULT_MASK_BRUSH, DEFAULT_OVERLAY, MASK_BRUSH_SIZE, OVERLAY_COLOURS, type MaskBrush, type OverlayPrefs } from './maskUi'
import type { StrokeInput } from './MaskOverlay'

/** A new component being drawn: a new mask (op undefined), or a part of the selected mask. */
export interface Creating {
  kind: ShapeKind
  op?: MaskOp
}

interface Options {
  /** The photo's settings now, and Develop's change (label, settings, keepAuto, separate). */
  settings: () => DevelopSettings
  change: (label: string, next: DevelopSettings, keepAuto?: boolean, separate?: boolean) => void
  /** The sensor's size in pixels. */
  sensor: () => [number, number]
  /** What the range masks measure at a point of the photo shown (displayed-image uv): linear Rec.2020. */
  sample: (uv: [number, number]) => Promise<Vec3 | null>
  /** Ends the other on-photo tools when masking starts. */
  onStart: () => void
}

const OP_WORD: Record<MaskOp, string> = { add: 'add', subtract: 'subtract', intersect: 'intersect' }
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function useMasking(o: Options) {
  const [active, setActive] = useState(false)
  const [sel, setSel] = useState<{ mask: string | null; comp: string | null }>({ mask: null, comp: null })
  const [creating, setCreating] = useState<Creating | null>(null)
  const [picking, setPicking] = useState<'colour' | 'luminance' | null>(null)
  /** The masks shown while a stroke is painted or a handle dragged (one history step when it ends). */
  const [draft, setDraft] = useState<LocalMask[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  /** Per-mask eyes: a view only, never saved (as the section eyes, Part 21). */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const [overlayStored, setOverlay] = useStoredJson<OverlayPrefs>('lightbench.masks.overlay', DEFAULT_OVERLAY)
  const overlay: OverlayPrefs = { ...DEFAULT_OVERLAY, ...overlayStored }
  const [brushStored, setBrush] = useStoredJson<MaskBrush>('lightbench.masks.brush', DEFAULT_MASK_BRUSH)
  const brush: MaskBrush = { ...DEFAULT_MASK_BRUSH, ...brushStored }
  const [pins, setPins] = useStoredJson<{ on: boolean }>('lightbench.masks.pins', { on: true })
  const opts = useRef(o)
  opts.current = o

  const masks = (): LocalMask[] => opts.current.settings().masks ?? []
  const commit = (label: string, next: LocalMask[], separate = true) => {
    setMessage(null)
    opts.current.change(label, withMasksList(opts.current.settings(), next), false, separate)
  }
  const updateMask = (id: string, label: string, fn: (m: LocalMask) => LocalMask, separate = true) => {
    const list = masks()
    if (!list.some((m) => m.id === id)) return
    commit(label, list.map((m) => (m.id === id ? fn(m) : m)), separate)
  }

  const start = useCallback(() => {
    opts.current.onStart()
    setActive(true)
  }, [])
  const end = useCallback(() => {
    setActive(false)
    setCreating(null)
    setPicking(null)
    setDraft(null)
  }, [])

  /** Clears the tool's state for another photo. */
  const resetForPhoto = useCallback(() => {
    setSel({ mask: null, comp: null })
    setCreating(null)
    setPicking(null)
    setDraft(null)
    setMessage(null)
    setHidden(new Set())
  }, [])

  function select(mask: string | null, comp?: string | null) {
    const m = masks().find((x) => x.id === mask)
    setSel({ mask, comp: comp ?? m?.components[0]?.id ?? null })
    setCreating(null)
    setPicking(null)
  }

  /** New mask of a kind (K, M, Shift+M, Shift+J, Shift+Q): drawn or picked on the photo next. */
  function newOf(kind: ShapeKind) {
    const cap = capMessage(masks(), { addMask: true })
    if (cap) return setMessage(cap)
    if (!active) start()
    setMessage(null)
    if (kind === 'luminance') {
      // A luminance range starts on the brighter half; a click on the photo then centres it on that tone.
      const m = newMask(masks(), { kind: 'luminance', range: [40, 60, 100, 100] })
      commit(`New mask: ${m.name}`, [...masks(), m])
      setSel({ mask: m.id, comp: m.components[0].id })
      setCreating(null)
      setPicking('luminance')
      return
    }
    setCreating({ kind })
    setPicking(null)
    setSel((s) => ({ ...s, comp: null }))
  }

  /** Add, Subtract or Intersect a component with the selected mask (shapes only with shapes, ranges with ranges). */
  function addPart(kind: ShapeKind, op: MaskOp) {
    const m = masks().find((x) => x.id === sel.mask)
    if (!m) return
    const why = refuseReason(m, kind) ?? capMessage(masks(), { maskId: m.id, addComponent: true })
    if (why) return setMessage(why)
    if (!active) start()
    setMessage(null)
    if (kind === 'luminance') {
      const c: MaskComponent = { id: newComponentId(), op, invert: false, shape: { kind: 'luminance', range: [40, 60, 100, 100] } }
      updateMask(m.id, `${m.name}: ${OP_WORD[op]} ${KIND_LABELS[kind]}`, (x) => ({ ...x, components: [...x.components, c] }))
      setSel({ mask: m.id, comp: c.id })
      setPicking('luminance')
      return
    }
    setCreating({ kind, op })
    setPicking(null)
  }

  /** A component made on the photo (a gradient drawn, a colour picked, a first brush stroke). */
  function place(shape: KnownShape) {
    const c = creating
    if (!c) return
    if (c.op) {
      const m = masks().find((x) => x.id === sel.mask)
      if (!m || !canAdd(m, shape.kind)) return
      const comp: MaskComponent = { id: newComponentId(), op: c.op, invert: false, shape }
      updateMask(m.id, `${m.name}: ${OP_WORD[c.op]} ${KIND_LABELS[shape.kind]}`, (x) => ({ ...x, components: [...x.components, comp] }))
      setSel({ mask: m.id, comp: comp.id })
    } else {
      const m = newMask(masks(), shape)
      commit(`New mask: ${m.name}`, [...masks(), m])
      setSel({ mask: m.id, comp: m.components[0].id })
    }
    setCreating(null)
    // A colour range keeps its picker: Shift-click adds samples, a click replaces them (Done or Esc ends it).
    if (shape.kind === 'colour') setPicking('colour')
  }

  function onCreate(shape: LinearShape | RadialShape) {
    if (creating?.kind !== shape.kind) return
    place(shape)
  }

  /** A brush stroke: live (the mask shown while painting) or final (one history step). */
  function onStroke(s: StrokeInput, final: boolean) {
    const [sw, sh] = opts.current.sensor()
    const stroke = {
      size: Math.round((clamp(brush.size, MASK_BRUSH_SIZE[0], MASK_BRUSH_SIZE[1]) / Math.min(sw, sh)) * 1e6) / 1e6,
      feather: brush.feather,
      flow: brush.flow,
      density: brush.density,
      erase: s.erase,
      dabs: s.dabs.map((v) => Math.round(v * 1e5) / 1e5),
      ...(s.pressure && brush.pressure !== 'off' ? { pressure: s.pressure.map((v) => Math.round(v * 100) / 100), pressureTo: brush.pressure } : {}),
    }
    const n = s.dabs.length / 2
    const list = masks()
    let next: LocalMask[]
    let label: string
    let target: { mask: string; comp: string }
    if (creating?.kind === 'brush') {
      if (s.erase && !creating.op) {
        // Nothing to erase on a new mask.
        if (final) setDraft(null)
        return
      }
      if (creating.op) {
        const m = list.find((x) => x.id === sel.mask)
        if (!m) return
        const cap = capMessage(list, { maskId: m.id, addDabs: n })
        if (cap) {
          setDraft(null)
          return final ? setMessage(cap) : undefined
        }
        const comp: MaskComponent = { id: draftComp.current ?? newComponentId(), op: creating.op, invert: false, shape: { kind: 'brush', strokes: [stroke] } }
        draftComp.current = comp.id
        next = list.map((x) => (x.id === m.id ? { ...x, components: [...x.components, comp] } : x))
        label = `${m.name}: ${OP_WORD[creating.op]} Brush`
        target = { mask: m.id, comp: comp.id }
      } else {
        if (n > MAX_DABS) {
          setDraft(null)
          return final ? setMessage(`A mask can hold at most ${MAX_DABS.toLocaleString('en')} brush dabs; this stroke would make ${n.toLocaleString('en')}. Use a larger brush.`) : undefined
        }
        const m = { ...newMask(list, { kind: 'brush', strokes: [stroke] }), id: draftMask.current ?? newMaskId() }
        draftMask.current = m.id
        next = [...list, m]
        label = `New mask: ${m.name}`
        target = { mask: m.id, comp: m.components[0].id }
      }
    } else {
      const m = list.find((x) => x.id === sel.mask)
      const c = m?.components.find((x) => x.id === sel.comp)
      if (!m || !c || c.shape.kind !== 'brush') return
      const cap = capMessage(list, { maskId: m.id, addDabs: n })
      if (cap) {
        setDraft(null)
        return final ? setMessage(cap) : undefined
      }
      const shape: BrushShape = { kind: 'brush', strokes: [...(c.shape as BrushShape).strokes, stroke] }
      next = list.map((x) => (x.id === m.id ? { ...x, components: x.components.map((y) => (y.id === c.id ? { ...y, shape } : y)) } : x))
      label = `${m.name}: ${s.erase ? 'erase' : 'brush stroke'}`
      target = { mask: m.id, comp: c.id }
    }
    if (!final) {
      setDraft(next)
      return
    }
    setDraft(null)
    draftMask.current = null
    draftComp.current = null
    commit(label, next)
    setSel(target)
    setCreating(null)
  }
  const draftMask = useRef<string | null>(null)
  const draftComp = useRef<string | null>(null)

  /** A gradient's handle dragged: shown while dragging, one history step when let go. */
  function onShape(compId: string, shape: LinearShape | RadialShape, final: boolean) {
    const list = masks()
    const m = list.find((x) => x.components.some((c) => c.id === compId))
    if (!m) return
    const next = list.map((x) => (x.id === m.id ? { ...x, components: x.components.map((c) => (c.id === compId ? { ...c, shape } : c)) } : x))
    if (!final) return setDraft(next)
    setDraft(null)
    commit(`${m.name}: move ${KIND_LABELS[shape.kind]}`, next)
  }

  /** A click for a range mask: a colour sample (Shift adds one), or the tone a luminance range centres on. */
  async function onPick(uv: [number, number], add: boolean) {
    const c = await opts.current.sample(uv)
    if (!c) return
    if (picking === 'luminance' || creating?.kind === 'luminance') {
      const L = lstar(REC2020_Y[0] * c[0] + REC2020_Y[1] * c[1] + REC2020_Y[2] * c[2])
      const range: LuminanceShape['range'] = [clamp(Math.round(L - 25), 0, 100), clamp(Math.round(L - 8), 0, 100), clamp(Math.round(L + 8), 0, 100), clamp(Math.round(L + 25), 0, 100)]
      const m = masks().find((x) => x.id === sel.mask)
      const comp = m?.components.find((x) => x.id === sel.comp)
      if (m && comp?.shape.kind === 'luminance') changeShape(comp.id, { kind: 'luminance', range }, `${m.name}: luminance range`)
      setPicking(null)
      return
    }
    const lab = oklab(c).map((v) => Math.round(v * 1e5) / 1e5) as [number, number, number]
    if (creating?.kind === 'colour') {
      place({ kind: 'colour', samples: [lab], refine: 50 })
      return
    }
    const m = masks().find((x) => x.id === sel.mask)
    const comp = m?.components.find((x) => x.id === sel.comp)
    if (!m || comp?.shape.kind !== 'colour') return
    const cur = comp.shape as ColourShape
    if (add && cur.samples.length >= MAX_SAMPLES) return setMessage(`A colour range takes up to ${MAX_SAMPLES} samples.`)
    changeShape(comp.id, { ...cur, samples: add ? [...cur.samples, lab] : [lab] }, `${m.name}: colour sample`)
  }

  function changeShape(compId: string, shape: KnownShape, label: string, separate = true) {
    const list = masks()
    const m = list.find((x) => x.components.some((c) => c.id === compId))
    if (!m) return
    commit(label, list.map((x) => (x.id === m.id ? { ...x, components: x.components.map((c) => (c.id === compId ? { ...c, shape } : c)) } : x)), separate)
  }

  const selected = (): LocalMask | null => masks().find((x) => x.id === sel.mask) ?? null

  return {
    active, start, end, resetForPhoto,
    sel, select, creating, setCreating, picking, setPicking, draft, message, setMessage,
    hidden,
    toggleHidden: (id: string) => setHidden((h) => {
      const n = new Set(h)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    }),
    overlay, setOverlay,
    nextOverlayColour: () => setOverlay({ ...overlay, on: true, colour: (overlay.colour + 1) % OVERLAY_COLOURS.length }),
    nextOverlayMode: () => setOverlay({ ...overlay, on: true, mode: (overlay.mode % 6) + 1 }),
    brush, setBrush,
    pins: pins.on, setPins: (on: boolean) => setPins({ on }),
    newOf, addPart, onCreate, onStroke, onShape, onPick,
    /** N: a new mask of the selected component's kind (Lightroom per Julieanne Kost's blog, a secondary source). */
    newSame: () => {
      const c = selected()?.components.find((x) => x.id === sel.comp)
      const k = c?.shape.kind
      if (k && k in KIND_SHORT) newOf(k as ShapeKind)
    },
    setAdjust: (key: LocalKey, value: number) => {
      const m = selected()
      if (!m) return
      updateMask(m.id, `${m.name}: ${LOCAL_LABELS[key]}`, (x) => {
        const adjust = { ...x.adjust }
        if (value === 0) delete adjust[key]
        else adjust[key] = value
        return { ...x, adjust }
      }, false)
    },
    resetAdjust: () => {
      const m = selected()
      if (m && Object.keys(m.adjust).length) updateMask(m.id, `${m.name}: reset sliders`, (x) => ({ ...x, adjust: {} }))
    },
    setMaskValue: (key: 'amount' | 'feather' | 'refine', value: number) => {
      const m = selected()
      if (!m) return
      updateMask(m.id, `${m.name}: ${key[0].toUpperCase()}${key.slice(1)}`, (x) => ({ ...x, [key]: value }), false)
    },
    invertMask: () => {
      const m = selected()
      if (m) updateMask(m.id, `${m.name}: invert`, (x) => ({ ...x, invert: !x.invert }))
    },
    rename: (id: string, name: string) => {
      const n = name.trim().slice(0, 80)
      const m = masks().find((x) => x.id === id)
      if (m && n && n !== m.name) updateMask(id, `Rename mask ${m.name} to ${n}`, (x) => ({ ...x, name: n }))
    },
    duplicate: () => {
      const m = selected()
      if (!m) return
      const cap = capMessage(masks(), { addMask: true })
      if (cap) return setMessage(cap)
      const copy: LocalMask = { ...JSON.parse(JSON.stringify(m)) as LocalMask, id: newMaskId(), name: `${m.name} copy` }
      copy.components = copy.components.map((c) => ({ ...c, id: newComponentId() }))
      commit(`Duplicate mask ${m.name}`, [...masks(), copy])
      setSel({ mask: copy.id, comp: copy.components[0]?.id ?? null })
    },
    deleteMask: (id?: string) => {
      const m = masks().find((x) => x.id === (id ?? sel.mask))
      if (!m) return
      commit(`Delete mask ${m.name}`, masks().filter((x) => x.id !== m.id))
      setSel({ mask: null, comp: null })
    },
    /** Delete: the selected component, or the whole mask when it is the last one. */
    deleteSelected: () => {
      const m = selected()
      if (!m) return
      const c = m.components.find((x) => x.id === sel.comp)
      if (!c || m.components.length === 1) {
        commit(`Delete mask ${m.name}`, masks().filter((x) => x.id !== m.id))
        setSel({ mask: null, comp: null })
        return
      }
      const rest = m.components.filter((x) => x.id !== c.id)
      // The first part is the base the others combine with: it is always added.
      rest[0] = { ...rest[0], op: 'add' }
      updateMask(m.id, `${m.name}: delete ${KIND_LABELS[c.shape.kind as ShapeKind] ?? 'part'}`, (x) => ({ ...x, components: rest }))
      setSel({ mask: m.id, comp: rest[0].id })
    },
    setComponent: (compId: string, patch: Partial<Pick<MaskComponent, 'op' | 'invert'>>) => {
      const m = selected()
      if (!m) return
      const word = patch.invert !== undefined ? 'invert part' : `make part ${patch.op}`
      updateMask(m.id, `${m.name}: ${word}`, (x) => ({ ...x, components: x.components.map((c) => (c.id === compId ? { ...c, ...patch } : c)) }))
    },
    changeShape: (compId: string, shape: KnownShape, label: string) => changeShape(compId, shape, label, false),
    dabsLeft: () => {
      const m = selected()
      return m ? MAX_DABS - dabCount(m) : MAX_DABS
    },
  }
}

export type Masking = ReturnType<typeof useMasking>
export type { RadialShape }
