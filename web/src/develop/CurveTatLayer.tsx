// The Tone Curve's targeted adjustment tool on the photo (curveTat.ts has the rules). While it is on, this layer
// covers the photo: hovering shows the tone under the pointer on the curve's graph, dragging up or down changes it
// (one history step per drag), ↑ / ↓ while hovering nudge it (Shift: bigger steps), Esc or Enter ends the tool. The
// keys live in their own keyboard context, "Develop: tone curve target" (settings/actions.ts).

import { useEffect, useRef } from 'react'
import { useShortcuts } from '../settings/shortcuts'
import { DEFAULT_TONE_CURVE, toneOf, type ToneCurveSettings } from '../engine/develop/tone-curve'
import { tatDrag, tatLabel, tatStep, tatTarget, type TatTarget } from './curveTat'
import type { CurveView } from './ToneCurvePanel'

interface Props {
  /** The photo's curve (not a preview). */
  curve: ToneCurveSettings | undefined
  view: CurveView
  /** Keys work (no dialog open, not cropping…). */
  enabled: boolean
  /** Displayed-image uv under the pointer, or null outside the photo. */
  uvAt: (e: { clientX: number; clientY: number }) => [number, number] | null
  /** The curve's input there: linear Rec.2020 before the curve (engine `sampleBeforeCurve`). */
  sample: (uv: [number, number]) => Promise<readonly number[] | null>
  onHover: (tone: number | null) => void
  onDraft: (tc: ToneCurveSettings | undefined | null) => void
  onChange: (label: string, tc: ToneCurveSettings | undefined, separate?: boolean) => void
  onDragClip: (on: boolean) => void
  onExit: () => void
}

export function CurveTatLayer(p: Props) {
  const props = useRef(p)
  useEffect(() => {
    props.current = p
  })
  /** The tone under the pointer (on the shown graph's channel), and where it was measured. */
  const hover = useRef<{ uv: [number, number]; tone: number } | null>(null)
  const want = useRef<[number, number] | null>(null)
  const busy = useRef(false)
  const drag = useRef<{ target: TatTarget; y0: number; last: ToneCurveSettings | null } | null>(null)
  /** The button is down (the tone under it may still be being measured). */
  const pressed = useRef(false)

  const toneAt = async (uv: [number, number]): Promise<number | null> => {
    const c = await props.current.sample(uv)
    if (!c) return null
    const v = props.current.view
    return toneOf(c, props.current.curve ?? DEFAULT_TONE_CURVE, v.mode === 'regions' ? 'rgb' : v.channel)
  }

  // One measurement at a time; the newest pointer position wins.
  const measure = () => {
    if (busy.current) return
    busy.current = true
    void (async () => {
      try {
        while (want.current) {
          const uv = want.current
          want.current = null
          const tone = await toneAt(uv).catch(() => null)
          if (tone === null) continue
          hover.current = { uv, tone }
          // In Regions the marker sits on the Regions curve's input (the panel maps it).
          props.current.onHover(tone)
        }
      } finally {
        busy.current = false
      }
    })()
  }

  useEffect(() => () => props.current.onHover(null), [])

  const step = (up: boolean, big: boolean) => {
    const h = hover.current
    if (!h) return false
    const cur = props.current.curve ?? DEFAULT_TONE_CURVE
    const t = tatTarget(cur, props.current.view, h.tone)
    // Arrow presses on the same tones merge into one history step (same name within 1.5 s).
    props.current.onChange(tatLabel(t), tatStep(t, up, big))
    return true
  }

  useShortcuts(['curve'], p.enabled, (cmd) => {
    switch (cmd) {
      case 'curve.done':
        props.current.onExit()
        break
      case 'curve.up':
        return step(true, false)
      case 'curve.down':
        return step(false, false)
      case 'curve.upBig':
        return step(true, true)
      case 'curve.downBig':
        return step(false, true)
      default:
        return false
    }
  })

  return (
    <div
      className="curve-tat-layer"
      onPointerMove={(e) => {
        e.stopPropagation()
        const d = drag.current
        if (d) {
          const next = tatDrag(d.target, e.clientY - d.y0, e.shiftKey)
          d.last = next
          props.current.onDraft(next)
          props.current.onDragClip(true)
          return
        }
        const uv = props.current.uvAt(e)
        if (!uv) {
          hover.current = null
          props.current.onHover(null)
          return
        }
        want.current = uv
        measure()
      }}
      onPointerDown={async (e) => {
        e.stopPropagation()
        if (e.button !== 0) return
        const uv = props.current.uvAt(e)
        if (!uv) return
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        pressed.current = true
        const y0 = e.clientY
        const h = hover.current
        const tone = h && Math.abs(h.uv[0] - uv[0]) < 0.004 && Math.abs(h.uv[1] - uv[1]) < 0.004 ? h.tone : await toneAt(uv)
        // Released before the tone was known: nothing to drag.
        if (tone === null || !pressed.current) return
        const cur = props.current.curve ?? DEFAULT_TONE_CURVE
        const target = tatTarget(cur, props.current.view, tone)
        const first = target.kind === 'point' ? { ...cur, [target.channel]: target.base } : cur
        drag.current = { target, y0, last: null }
        props.current.onDraft(first)
      }}
      onPointerUp={(e) => {
        e.stopPropagation()
        pressed.current = false
        const d = drag.current
        drag.current = null
        ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
        if (!d) return
        props.current.onDragClip(false)
        props.current.onDraft(null)
        if (d.last && JSON.stringify(d.last) !== JSON.stringify(d.target.start)) props.current.onChange(tatLabel(d.target), d.last, true)
      }}
      onPointerLeave={() => {
        if (drag.current) return
        hover.current = null
        props.current.onHover(null)
      }}
    />
  )
}
