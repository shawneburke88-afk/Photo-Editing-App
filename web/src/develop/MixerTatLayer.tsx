// The Colour group's tools on the photo (PHASE3.md Part 15):
//  - MixerTatLayer: the mixer's targeted adjustment tool (mixerTat.ts has the rules). Hovering shows, in the panel, the
//    bands of the colour under the pointer and their weights; dragging up or down changes those bands (one history step
//    per drag), with Alt held the photo shows the main band's colours and greys the rest (Lightroom's Alt-drag); ↑ / ↓
//    while hovering nudge them (Shift: bigger steps); Esc or Enter end the tool.
//  - PointPickLayer: Point Color's picker. Clicking a colour on the photo adds a sample of it (as it reaches Point Color:
//    after the mixer's bands); Esc cancels.
// Both use the keyboard context "Develop: colour mixer tool" (`mixer`, settings/actions.ts).

import { useEffect, useRef } from 'react'
import { useShortcuts } from '../settings/shortcuts'
import { bandsAt, DEFAULT_COLOUR_MIXER, type ColourMixerSettings, type MixerChannel } from '../engine/develop/colour-mixer'
import { mainBand, tatDrag, tatLabel, tatStep } from './mixerTat'

interface TatProps {
  /** The photo's mixer (not a preview). */
  mixer: ColourMixerSettings | undefined
  channel: MixerChannel
  /** Keys work (no dialog open…). */
  enabled: boolean
  /** Displayed-image uv under the pointer, or null outside the photo. */
  uvAt: (e: { clientX: number; clientY: number }) => [number, number] | null
  /** The mixer's input there: linear Rec.2020 before the bands (engine `sampleMixer`). */
  sample: (uv: [number, number]) => Promise<readonly number[] | null>
  onHover: (h: { weights: number[]; grey: boolean } | null) => void
  onDraft: (m: ColourMixerSettings | undefined | null) => void
  onChange: (label: string, m: ColourMixerSettings | undefined, separate?: boolean) => void
  /** Alt-drag: show a band's colours (1–8), 0 off. */
  onVisualize: (v: number) => void
  onExit: () => void
}

export function MixerTatLayer(p: TatProps) {
  const props = useRef(p)
  useEffect(() => {
    props.current = p
  })
  const hover = useRef<{ uv: [number, number]; weights: number[]; grey: boolean } | null>(null)
  const want = useRef<[number, number] | null>(null)
  const busy = useRef(false)
  const drag = useRef<{ weights: number[]; start: ColourMixerSettings; y0: number; last: ColourMixerSettings | null } | null>(null)
  const pressed = useRef(false)

  const bandsUnder = async (uv: [number, number]) => {
    const c = await props.current.sample(uv)
    return c ? bandsAt(c, props.current.mixer) : null
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
          const b = await bandsUnder(uv).catch(() => null)
          if (!b) continue
          hover.current = { uv, weights: b.weights, grey: b.grey }
          props.current.onHover({ weights: b.weights, grey: b.grey })
        }
      } finally {
        busy.current = false
      }
    })()
  }

  useEffect(() => () => {
    props.current.onHover(null)
    props.current.onVisualize(0)
  }, [])

  const step = (up: boolean, big: boolean) => {
    const h = hover.current
    if (!h || h.grey) return false
    // Presses on the same colour merge into one history step (same name within 1.5 s).
    props.current.onChange(tatLabel(props.current.channel, h.weights), tatStep(props.current.mixer ?? DEFAULT_COLOUR_MIXER, props.current.channel, h.weights, up, big))
    return true
  }

  useShortcuts(['mixer'], p.enabled, (cmd) => {
    switch (cmd) {
      case 'mixer.done':
        props.current.onExit()
        break
      case 'mixer.up':
        return step(true, false)
      case 'mixer.down':
        return step(false, false)
      case 'mixer.upBig':
        return step(true, true)
      case 'mixer.downBig':
        return step(false, true)
      default:
        return false
    }
  })

  return (
    <div
      className="curve-tat-layer mixer-tat-layer"
      onPointerMove={(e) => {
        e.stopPropagation()
        const d = drag.current
        if (d) {
          const next = tatDrag(d.start, props.current.channel, d.weights, e.clientY - d.y0, e.shiftKey)
          d.last = next
          props.current.onDraft(next)
          props.current.onVisualize(e.altKey ? mainBand(d.weights) + 1 : 0)
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
        const b = h && Math.abs(h.uv[0] - uv[0]) < 0.004 && Math.abs(h.uv[1] - uv[1]) < 0.004 ? h : await bandsUnder(uv)
        // Released before the colour was known, or a grey (no band): nothing to drag.
        if (!b || b.grey || !pressed.current) return
        drag.current = { weights: b.weights, start: props.current.mixer ?? DEFAULT_COLOUR_MIXER, y0, last: null }
        if (e.altKey) props.current.onVisualize(mainBand(b.weights) + 1)
      }}
      onPointerUp={(e) => {
        e.stopPropagation()
        pressed.current = false
        const d = drag.current
        drag.current = null
        ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
        props.current.onVisualize(0)
        if (!d) return
        props.current.onDraft(null)
        if (d.last && JSON.stringify(d.last) !== JSON.stringify(d.start)) props.current.onChange(tatLabel(props.current.channel, d.weights), d.last, true)
      }}
      onPointerLeave={() => {
        if (drag.current) return
        hover.current = null
        props.current.onHover(null)
      }}
    />
  )
}

interface PickProps {
  enabled: boolean
  uvAt: (e: { clientX: number; clientY: number }) => [number, number] | null
  /** The colour as it reaches Point Color there: linear Rec.2020 after the mixer's bands (engine `sampleMixer`). */
  sample: (uv: [number, number]) => Promise<readonly number[] | null>
  onPick: (c: readonly number[]) => void
  onExit: () => void
}

export function PointPickLayer(p: PickProps) {
  const props = useRef(p)
  useEffect(() => {
    props.current = p
  })
  useShortcuts(['mixer'], p.enabled, (cmd) => {
    if (cmd !== 'mixer.done') return false
    props.current.onExit()
  })
  return (
    <div
      className="curve-tat-layer point-pick-layer"
      onPointerDown={async (e) => {
        e.stopPropagation()
        if (e.button !== 0) return
        const uv = props.current.uvAt(e)
        if (!uv) return
        const c = await props.current.sample(uv).catch(() => null)
        if (c) props.current.onPick(c)
      }}
    />
  )
}
