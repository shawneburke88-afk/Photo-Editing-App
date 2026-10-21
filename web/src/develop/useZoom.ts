// Develop's zoom (docs/PHASE3.md, "Zoom levels"): the levels chosen from the toolbar, Z, the zoom keys, a click on the
// fitted photo and Ctrl/⌘ + wheel over the photo, always keeping the point under the pointer in place.
import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { DevelopEngine, ViewState } from '../engine/gpu/develop-engine'
import { useStoredJson } from '../lib/useStoredJson'
import { centerAround, clampCenter, stepZoom, validLevel, type Zoom } from './zoom'

/** A pointer position (client coordinates) to zoom toward; without one, the zoom keeps the canvas centre in place. */
type At = { clientX: number; clientY: number }

/** Wheel movement (pixels) per zoom step: one mouse notch, or a short trackpad pinch. */
const WHEEL_STEP = 60

export function useZoom(opts: { engine: RefObject<DevelopEngine | null>; view: ViewState; setView: Dispatch<SetStateAction<ViewState>>; stage: RefObject<HTMLElement | null>; enabled: boolean }) {
  const { engine: engineRef, view, setView, stage, enabled } = opts
  // The last level chosen (Z and a click on the fitted photo go back to it), remembered in this browser.
  const [stored, setStored] = useStoredJson<{ last: number }>('lightbench.develop.zoom', { last: 1 })
  const last = validLevel(stored.last)
  // The view as last rendered (moved on at once by each change here, so quick wheel steps add up).
  const viewRef = useRef(view)
  useLayoutEffect(() => {
    viewRef.current = view
  }, [view])

  const set = useCallback(
    (z: Zoom, at?: At) => {
      const engine = engineRef.current
      const v = viewRef.current
      if (z !== 'fit') setStored({ last: validLevel(z) })
      if (!engine || z === 'fit') {
        const next: ViewState = { zoom: z, center: v.center }
        viewRef.current = next
        setView(next)
        return
      }
      const cw = engine.canvas.width
      const ch = engine.canvas.height
      const n = engine.layout({ zoom: z, center: v.center }, cw, ch)
      let center: [number, number]
      if (at || v.zoom !== 'fit') {
        const l = engine.layout(v, cw, ch)
        const r = engine.canvas.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        const px = at ? (at.clientX - r.left) * dpr : cw / 2
        const py = at ? (at.clientY - r.top) * dpr : ch / 2
        center = centerAround(px, py, l, n.w, n.h, cw, ch)
      } else {
        // Z from Fit: back where the photo was last looked at.
        center = [clampCenter(v.center[0], n.w, cw), clampCenter(v.center[1], n.h, ch)]
      }
      const next: ViewState = { zoom: z, center }
      viewRef.current = next
      setView(next)
    },
    [engineRef, setStored, setView],
  )

  /** The zoom factor at which the photo fits (1 = 100 %). */
  const fitZoom = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return 1
    return engine.layout({ zoom: 'fit', center: [0.5, 0.5] }, engine.canvas.width, engine.canvas.height).scale / (window.devicePixelRatio || 1)
  }, [engineRef])

  const step = useCallback((dir: 1 | -1, at?: At) => set(stepZoom(viewRef.current.zoom, fitZoom(), dir), at), [set, fitZoom])
  const toggle = useCallback((at?: At) => set(viewRef.current.zoom === 'fit' ? last : 'fit', at), [set, last])

  // Ctrl/⌘ + wheel (and a trackpad pinch, which browsers send as Ctrl + wheel) over the photo zooms toward the pointer
  // instead of zooming the page. A listener of its own: React's wheel listener can't prevent the page zoom.
  const enabledRef = useRef(enabled)
  const stepRef = useRef(step)
  useLayoutEffect(() => {
    enabledRef.current = enabled
    stepRef.current = step
  }, [enabled, step])
  useEffect(() => {
    const el = stage.current
    if (!el) return
    let acc = 0
    let at = 0
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      if (!enabledRef.current) return
      if (e.timeStamp - at > 300) acc = 0
      at = e.timeStamp
      acc += e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1)
      if (Math.abs(acc) < WHEEL_STEP) return
      const dir = acc < 0 ? 1 : -1
      acc = 0
      stepRef.current(dir, e)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [stage])

  return { last, set, step, toggle }
}
