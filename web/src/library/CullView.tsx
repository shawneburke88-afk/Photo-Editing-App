// Full-screen culling: one photo (or two side by side) with keys that always act on the photo shown, so a
// stray mouse pointer or an old selection can't receive the rating (a darktable complaint: its keys act on
// the hovered image by default, `plugins/lighttable/act_on`). Previews come from the camera's embedded JPEG;
// 100 % renders the RAW itself, as Export does, so focus can be judged on real pixels.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { getCatalog } from '../catalog/client'
import type { PhotoDetail, PhotoRow } from '../catalog/types'
import { isSliderKey, isTextEntry } from '../lib/keys'
import { CullPane, type ZoomCenter } from './CullPane'
import { captureText, COLOR_NAMES, exposureText } from './format'
import { BitmapCache, FullRenderer, loadFullPreview, type Preview } from './preview'
import { Stars } from './Stars'
import { Thumb } from './Thumb'

export type CullField = 'rating' | 'flag' | 'color'

interface Props {
  /** The photos to cull, in grid order (a snapshot, so rejecting one doesn't make it vanish mid-cull). */
  rows: PhotoRow[]
  startId: number
  onApply: (ids: number[], field: CullField, value: number) => void
  onExit: (id: number) => void
  onDevelop: (id: number, ids: number[]) => void
}

const ADVANCE_KEY = 'cull:advance'
const FILMSTRIP_SPAN = 20

function loadAdvance(): boolean {
  try {
    return localStorage.getItem(ADVANCE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function CullView({ rows, startId, onApply, onExit, onDevelop }: Props) {
  const catalog = getCatalog()
  const [items, setItems] = useState(rows)
  const [index, setIndex] = useState(() => Math.max(0, rows.findIndex((r) => r.id === startId)))
  const [twoUp, setTwoUp] = useState(false)
  const [active, setActive] = useState<0 | 1>(0)
  const [zoom, setZoom] = useState<ZoomCenter | null>(null)
  const [advance, setAdvance] = useState(loadAdvance)
  const [showInfo, setShowInfo] = useState(true)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const notes = useRef(new Map<string, string>())

  // Photo details, previews and 100 % renders, kept for the photos around the current one.
  const details = useRef(new Map<number, Promise<PhotoDetail | null>>())
  const [shownDetail, setShownDetail] = useState<PhotoDetail | null>(null)
  const getDetail = useCallback(
    (id: number) => {
      let p = details.current.get(id)
      if (!p) {
        p = catalog.getPhoto(id)
        details.current.set(id, p)
      }
      return p
    },
    [catalog],
  )
  const previews = useMemo(
    () =>
      new BitmapCache<Preview>(8, async (id) => {
        const d = await getDetail(id)
        if (!d) throw new Error('This photo is no longer in the library.')
        return loadFullPreview(d)
      }),
    [getDetail],
  )
  const renderer = useMemo(() => new FullRenderer(), [])
  /** Photos whose 100 % render is still wanted: those on screen and the next one. */
  const wanted = useRef(new Set<number>())
  const fulls = useMemo(
    () =>
      new BitmapCache<{ bmp: ImageBitmap }>(3, async (id) => {
        const d = await getDetail(id)
        if (!d) throw new Error('This photo is no longer in the library.')
        return { bmp: await renderer.render(d, () => wanted.current.has(id)) }
      }),
    [getDetail, renderer],
  )
  useEffect(() => {
    previews.open()
    fulls.open()
    renderer.open()
    return () => {
      previews.dispose()
      fulls.dispose()
      renderer.dispose()
    }
  }, [previews, fulls, renderer])

  const shown = twoUp ? [items[index], items[index + 1]].filter(Boolean) : [items[index]].filter(Boolean)
  const target = shown[Math.min(active, shown.length - 1)]

  // Load what is on screen first, then prefetch the neighbours.
  useEffect(() => {
    const request = (cache: BitmapCache<{ bmp: ImageBitmap }>, id: number, kind: 'preview' | 'full') =>
      cache.get(id).then(
        () => bump(),
        (e: Error) => {
          if (e.message === 'cancelled') return
          notes.current.set(`${kind}:${id}`, e.message)
          bump()
        },
      )
    const ids = shown.map((r) => r.id)
    const next = items[index + shown.length]?.id
    wanted.current = new Set(next === undefined ? ids : [...ids, next])
    void (async () => {
      for (const id of ids) void request(previews, id, 'preview')
      if (zoom) for (const id of ids) await request(fulls, id, 'full')
      const ahead = [index + shown.length, index + shown.length + 1, index - 1].map((i) => items[i]?.id).filter((x): x is number => x !== undefined)
      for (const id of ahead) void previews.get(id).catch(() => {})
      // While zoomed, the next photo will also be wanted at 100 %.
      if (zoom && next !== undefined) void fulls.get(next).then(bump, () => {})
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, twoUp, zoom !== null, items.length, previews, fulls])

  useEffect(() => {
    let live = true
    if (target) void getDetail(target.id).then((d) => live && setShownDetail(d))
    return () => {
      live = false
    }
  }, [target, getDetail])

  const move = useCallback(
    (delta: number) => {
      setIndex((i) => Math.min(Math.max(0, items.length - 1), Math.max(0, i + delta)))
    },
    [items.length],
  )

  const apply = useCallback(
    (field: CullField, value: number, auto: boolean) => {
      if (!target) return
      setItems((list) => list.map((r) => (r.id === target.id ? { ...r, [field]: value } : r)))
      onApply([target.id], field, value)
      if (auto) move(1)
    },
    [target, onApply, move],
  )

  function toggleAdvance() {
    setAdvance((on) => {
      try {
        localStorage.setItem(ADVANCE_KEY, on ? 'off' : 'on')
      } catch {
        // Not remembered; still applies now.
      }
      return !on
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntry(e.target) || isSliderKey(e) || e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      const auto = advance || e.getModifierState('CapsLock')
      if (k === 'arrowright' || k === 'arrowdown' || k === ' ') move(1)
      else if (k === 'arrowleft' || k === 'arrowup') move(-1)
      else if (k === 'home') move(-items.length)
      else if (k === 'end') move(items.length)
      else if (k >= '0' && k <= '5') apply('rating', Number(k), auto)
      else if (k >= '6' && k <= '9') apply('color', Number(k) - 5, auto)
      else if (k === 'p') apply('flag', 1, auto)
      else if (k === 'x') apply('flag', -1, auto)
      else if (k === 'u') apply('flag', 0, auto)
      else if (k === 'z') setZoom((z) => (z ? null : { u: 0.5, v: 0.5 }))
      else if (k === 'c') {
        setTwoUp((t) => !t)
        setActive(0)
      } else if (k === 'tab' && twoUp) setActive((a) => (a ? 0 : 1))
      else if (k === 'a') toggleAdvance()
      else if (k === 'i') setShowInfo((s) => !s)
      else if (k === 'd' && target) onDevelop(target.id, items.map((r) => r.id))
      else if (k === 'escape' || k === 'g' || k === 'e' || k === 'f') onExit(target?.id ?? startId)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!target) return null
  const d = shownDetail?.id === target.id ? shownDetail : null
  const lo = Math.max(0, index - FILMSTRIP_SPAN)
  const strip = items.slice(lo, index + FILMSTRIP_SPAN + 1)

  return (
    <div className="cull" role="dialog" aria-label="Culling view">
      <header className="cull-top">
        {showInfo ? (
          <div className="cull-info">
            <strong>{target.fileName}</strong>
            <Stars value={target.rating} size="small" />
            {target.flag === 1 && <span className="flag-text pick">⚑ Picked</span>}
            {target.flag === -1 && <span className="flag-text reject">✕ Rejected</span>}
            {target.color > 0 && <span className="label-text"><span className={`label label-${target.color}`} /> {COLOR_NAMES[target.color]}</span>}
            {d && (
              <span className="muted">
                {[exposureText(d) === 'Not recorded' ? '' : exposureText(d), d.lens, d.capturedAt ? captureText(d.capturedAt) : ''].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        ) : (
          <span />
        )}
        <div className="cull-controls">
          <span className="muted small">{index + 1 + active} of {items.length}</span>
          <button className={`button small ${twoUp ? 'on' : ''}`} onClick={() => { setTwoUp(!twoUp); setActive(0) }} title="Show the next photo beside this one (C)">
            {twoUp ? '2-up' : '1-up'}
          </button>
          <label className="check small" title="Move to the next photo after a flag, star or label key (A). Caps Lock also does this.">
            <input type="checkbox" checked={advance} onChange={toggleAdvance} />
            Auto-advance
          </label>
          <button className="button small" onClick={() => onExit(target.id)} title="Back to the grid (Esc)">✕ Close</button>
        </div>
      </header>

      <div className={`cull-stage ${twoUp ? 'two' : ''}`}>
        {shown.map((row, i) => (
          <CullPane
            key={row.id}
            row={row}
            preview={previews.peek(row.id) ?? null}
            full={zoom ? (fulls.peek(row.id)?.bmp ?? null) : null}
            zoom={zoom}
            zoomNote={notes.current.get(`full:${row.id}`) ?? 'Rendering at 100 %… (a few seconds)'}
            previewNote={notes.current.get(`preview:${row.id}`) ?? ''}
            active={i === active}
            twoUp={twoUp}
            onActivate={() => setActive(i as 0 | 1)}
            onToggleZoom={(at) => setZoom((z) => (z ? null : at))}
            onPan={setZoom}
          />
        ))}
      </div>

      <p className="cull-hints muted small">
        P pick · X reject · U unflag · 0–5 stars · 6–9 labels · ←/→ move · Z or click: 100 % · C 1-up/2-up{twoUp ? ' · Tab switch photo' : ''} · A auto-advance · I info · D develop · Esc close
      </p>

      <nav className="cull-strip" aria-label="Filmstrip">
        {strip.map((r, i) => {
          const at = lo + i
          const on = at >= index && at < index + shown.length
          return (
            <button key={r.id} className={`strip-cell ${on ? 'on' : ''} ${r.flag === -1 ? 'rejected' : ''}`} onClick={() => { setIndex(at); setActive(0) }} title={r.fileName}>
              <Thumb id={r.id} alt="" />
              <span className="strip-tags">
                {r.flag === 1 && <span className="flag pick">⚑</span>}
                {r.flag === -1 && <span className="flag reject">✕</span>}
                {r.rating > 0 && <span className="strip-stars">{'★'.repeat(r.rating)}</span>}
                {r.color > 0 && <span className={`label label-${r.color}`} />}
              </span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
