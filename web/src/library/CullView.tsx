// Full-screen culling: one photo, Compare (a Select and a Candidate side by side) or Survey (the selected
// photos tiled), with keys that always act on the photo shown or the active pane/tile, so a stray mouse
// pointer or an old selection can't receive the rating (a darktable complaint: its keys act on the hovered
// image by default, `plugins/lighttable/act_on`). Previews come from the camera's embedded JPEG; 100 %
// renders the RAW itself, as Export does, so focus can be judged on real pixels.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { getCatalog } from '../catalog/client'
import type { PhotoDetail, PhotoRow } from '../catalog/types'
import { RATE_NEXT, stepStars } from '../settings/actions'
import { hintLine, keyText, rangeText, useKeymapVersion, useShortcuts, withKey } from '../settings/shortcuts'
import { makeSelect, startCompare, stepCandidate, swapCompare, type CompareState } from './compare'
import { CullPane, type ZoomCenter } from './CullPane'
import { captureText, COLOR_NAMES, exposureText } from './format'
import { BitmapCache, FullRenderer, loadFullPreview, type Preview } from './preview'
import { Stars } from './Stars'
import { activeAfterDrop, guessAspect, surveyGrid } from './survey'
import { SurveyTile } from './SurveyTile'
import { Thumb } from './Thumb'
import { CullBadges } from './CullBadges'
import { focusPoint, NOT_ANALYSED } from './cull-badges'

/** The analysis in words, for the info line (I). */
function measuresText(row: PhotoRow): string {
  const c = row.cull
  if (!c) return row.analysisState === 'pending' ? 'Not analysed yet' : row.analysisState === 'failed' ? 'Couldn’t be analysed (no usable preview)' : ''
  const parts: string[] = []
  if (c.rel !== null) parts.push(`detail ${c.rel.toFixed(2)}× usual for the camera`)
  if (c.group) parts.push(c.group.best ? `sharpest of ${c.group.size}` : `${c.group.rank} of ${c.group.size} by sharpness`)
  if (c.focus) parts.push(`Z: ${c.focus.from === 'af' ? 'camera AF point' : c.focus.from === 'subjectarea' ? 'EXIF subject area' : 'sharpest area'}`)
  return parts.join(' · ')
}

export type CullField = 'rating' | 'flag' | 'color'
export type CullLayout = 'one' | 'compare' | 'survey'

interface Props {
  /** The photos to cull, in grid order (a snapshot, so rejecting one doesn't make it vanish mid-cull). For Survey, the selected photos. */
  rows: PhotoRow[]
  startId: number
  /** How the view opens: one photo (F), Compare with `startId` as the Select (C), or Survey (N). */
  layout?: CullLayout
  /** Compare: the first Candidate. */
  candidateId?: number
  onApply: (ids: number[], field: CullField, value: number) => void
  /** Back to the grid, focused on `id`; from Survey, `selection` is the photos still in the survey. */
  onExit: (id: number, selection?: number[]) => void
  /** B: Quick Collection in/out; resolves true when added. */
  onToggleQuick: (id: number) => Promise<boolean>
  onDevelop: (id: number, ids: number[]) => void
}

const ADVANCE_KEY = 'cull:advance'
const FILMSTRIP_SPAN = 20
const SURVEY_GAP = 8
const SURVEY_PAD = 8

function loadAdvance(): boolean {
  try {
    return localStorage.getItem(ADVANCE_KEY) !== 'off'
  } catch {
    return true
  }
}

/** Longest side of the Survey previews: smaller when many photos share the screen, to keep memory down. */
function surveyEdge(n: number): number {
  return n <= 6 ? 2048 : n <= 16 ? 1280 : n <= 40 ? 768 : 512
}

/** Width / height of a preview as shown (upright). */
function previewAspect(p: Preview): number {
  const sideways = p.rotate === 90 || p.rotate === 270
  return sideways ? p.bmp.height / p.bmp.width : p.bmp.width / p.bmp.height
}

export function CullView({ rows, startId, layout: openAs = 'one', candidateId, onApply, onExit, onDevelop, onToggleQuick }: Props) {
  const catalog = getCatalog()
  /** Opened as Survey: Esc goes back to it from one photo or Compare, and leaving keeps the survey as the selection. */
  const survey = openAs === 'survey'
  const startIndex = Math.max(0, rows.findIndex((r) => r.id === startId))
  const [items, setItems] = useState(rows)
  const [index, setIndex] = useState(startIndex)
  const [layout, setLayout] = useState<CullLayout>(openAs === 'compare' && rows.length < 2 ? 'one' : openAs)
  const [cmp, setCmp] = useState<CompareState>(
    () =>
      startCompare(startIndex, rows.length, candidateId === undefined ? undefined : rows.findIndex((r) => r.id === candidateId)) ?? {
        select: startIndex,
        candidate: startIndex,
      },
  )
  /** Compare: the pane that receives the keys (0 Select, 1 Candidate). */
  const [active, setActive] = useState<0 | 1>(0)
  /** Survey: the active tile. */
  const [tile, setTile] = useState(startIndex)
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
  // Survey tiles: every surveyed photo at once, scaled down.
  const tiles = useMemo(
    () =>
      new BitmapCache<Preview>(Math.max(8, rows.length), async (id) => {
        const d = await getDetail(id)
        if (!d) throw new Error('This photo is no longer in the library.')
        return loadFullPreview(d, surveyEdge(rows.length))
      }),
    [getDetail, rows.length],
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
    tiles.open()
    fulls.open()
    renderer.open()
    return () => {
      previews.dispose()
      tiles.dispose()
      fulls.dispose()
      renderer.dispose()
    }
  }, [previews, tiles, fulls, renderer])

  const n = items.length
  const shown = layout === 'compare' ? [items[cmp.select], items[cmp.candidate]].filter(Boolean) : layout === 'one' ? [items[index]].filter(Boolean) : []
  const target = layout === 'survey' ? items[tile] : shown[Math.min(active, shown.length - 1)]

  // Load what is on screen first, then prefetch the neighbours.
  useEffect(() => {
    const request = (cache: BitmapCache<{ bmp: ImageBitmap }>, id: number, kind: 'preview' | 'full' | 'tile') =>
      cache.get(id).then(
        () => bump(),
        (e: Error) => {
          if (e.message === 'cancelled') return
          notes.current.set(`${kind}:${id}`, e.message)
          bump()
        },
      )
    if (layout === 'survey') {
      wanted.current = new Set()
      for (const r of items) void request(tiles, r.id, 'tile')
      return
    }
    const ids = shown.map((r) => r.id)
    // The photos the arrow keys go to next: after the photo (1-up) or the Candidate (Compare).
    const after =
      layout === 'compare'
        ? [stepCandidate(cmp, 1, n), stepCandidate(stepCandidate(cmp, 1, n), 1, n), stepCandidate(cmp, -1, n)].map((s) => s.candidate)
        : [index + 1, index + 2, index - 1]
    const ahead = after.map((i) => items[i]?.id).filter((x): x is number => x !== undefined && !ids.includes(x))
    const next = ids.includes(items[after[0]]?.id) ? undefined : items[after[0]]?.id
    wanted.current = new Set(next === undefined ? ids : [...ids, next])
    void (async () => {
      for (const id of ids) void request(previews, id, 'preview')
      if (zoom) for (const id of ids) await request(fulls, id, 'full')
      for (const id of ahead) void previews.get(id).catch(() => {})
      // While zoomed, the next photo will also be wanted at 100 %.
      if (zoom && next !== undefined) void fulls.get(next).then(bump, () => {})
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, layout, cmp.select, cmp.candidate, zoom !== null, n, previews, tiles, fulls])

  useEffect(() => {
    let live = true
    if (target) void getDetail(target.id).then((d) => live && setShownDetail(d))
    return () => {
      live = false
    }
  }, [target, getDetail])

  // Survey: the stage's size, for tiling.
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [layout])
  const grid = surveyGrid(
    items.map((r) => {
      const p = tiles.peek(r.id)
      return p ? previewAspect(p) : guessAspect(r.orientation)
    }),
    stage.w - 2 * SURVEY_PAD,
    stage.h - 2 * SURVEY_PAD,
    SURVEY_GAP,
  )

  const move = useCallback(
    (delta: number) => {
      setIndex((i) => Math.min(Math.max(0, items.length - 1), Math.max(0, i + delta)))
    },
    [items.length],
  )

  /** ←/→: the next photo (1-up) or the next Candidate (Compare). */
  function step(delta: number) {
    if (layout === 'compare') setCmp((s) => stepCandidate(s, delta, n))
    else move(delta)
  }

  const apply = useCallback(
    (field: CullField, value: number, auto: boolean) => {
      if (!target) return
      setItems((list) => list.map((r) => (r.id === target.id ? { ...r, [field]: value } : r)))
      onApply([target.id], field, value)
      if (!auto) return
      // Compare: a key on the Candidate moves the Candidate on; the Select stays put.
      if (layout === 'one') move(1)
      else if (layout === 'compare' && active === 1) setCmp((s) => stepCandidate(s, 1, n))
    },
    [target, onApply, move, layout, active, n],
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

  /** One photo: photo `i`. */
  function showOne(i: number) {
    setIndex(i)
    setLayout('one')
    setActive(0)
  }

  /** C (or the 1-up button): from Compare, the photo in the active pane; from Survey, the active tile. */
  function toOne() {
    if (layout === 'compare') showOne(active ? cmp.candidate : cmp.select)
    else if (layout === 'survey') showOne(tile)
  }

  /** Compare with photo `i` as the Select and the photo after it as the Candidate. */
  function showCompare(i: number) {
    const s = startCompare(i, n)
    if (!s) return
    setCmp(s)
    setLayout('compare')
    setActive(0)
  }

  function showSurvey() {
    if (target) setTile(items.indexOf(target))
    setLayout('survey')
    setZoom(null)
  }

  function swap() {
    setCmp(swapCompare)
  }

  function promote() {
    setCmp((s) => makeSelect(s, n))
  }

  /** Survey ✕: out of the survey (never out of the library or a collection). */
  function drop(i: number) {
    if (n <= 1) return
    setItems((list) => list.filter((_, j) => j !== i))
    setTile((t) => activeAfterDrop(t, i, n))
  }

  function exit() {
    onExit(target?.id ?? startId, survey ? items.map((r) => r.id) : undefined)
  }

  // Keys (see settings/actions.ts): flags, stars, labels and B go to the photo on screen, the active pane
  // or the active tile.
  useShortcuts(['cull', layout === 'one' ? 'cull-one' : layout], true, (id, e) => {
    const auto = layout !== 'survey' && (advance || !!e?.getModifierState('CapsLock'))
    const moveTile = (d: number) => setTile((t) => Math.min(n - 1, Math.max(0, t + d)))
    switch (id) {
      case 'photo.rate0': case 'photo.rate1': case 'photo.rate2': case 'photo.rate3': case 'photo.rate4': case 'photo.rate5':
        apply('rating', Number(id.slice(-1)), auto)
        break
      case 'photo.rateUp': case 'photo.rateDown':
        if (!target) return false
        apply('rating', stepStars(target.rating, id === 'photo.rateUp' ? 1 : -1), auto)
        break
      // Shift+0–5: rate, then always move on once, whether Auto-advance is on or off (so never twice). Compare moves
      // the Candidate on (as Auto-advance does); Survey, where Auto-advance is off, moves to the next tile.
      case 'photo.rateNext0': case 'photo.rateNext1': case 'photo.rateNext2': case 'photo.rateNext3': case 'photo.rateNext4': case 'photo.rateNext5':
        apply('rating', Number(id.slice(-1)), layout !== 'survey')
        if (layout === 'survey') moveTile(1)
        break
      case 'photo.label1': case 'photo.label2': case 'photo.label3': case 'photo.label4':
        apply('color', Number(id.slice(-1)), auto)
        break
      case 'photo.pick': apply('flag', 1, auto); break
      case 'photo.reject': apply('flag', -1, auto); break
      case 'photo.unflag': apply('flag', 0, auto); break
      case 'photo.quick': {
        if (!target) return false
        const tid = target.id
        void onToggleQuick(tid).then((added) => setItems((list) => list.map((r) => (r.id === tid ? { ...r, quick: added } : r))))
        break
      }
      case 'cull.info': setShowInfo((s) => !s); break
      case 'photo.develop':
        if (!target) return false
        onDevelop(target.id, items.map((r) => r.id))
        break
      // Survey
      case 'survey.next': moveTile(1); break
      case 'survey.prev': moveTile(-1); break
      case 'survey.down': moveTile(grid.cols); break
      case 'survey.up': moveTile(-grid.cols); break
      case 'survey.first': moveTile(-n); break
      case 'survey.last': moveTile(n); break
      case 'survey.one': showOne(tile); break
      case 'survey.drop': drop(tile); break
      case 'survey.close': exit(); break
      // One photo and Compare
      case 'one.next': case 'compare.next': step(1); break
      case 'one.prev': case 'compare.prev': step(-1); break
      case 'one.first': case 'compare.first': step(-n); break
      case 'one.last': case 'compare.last': step(n); break
      // Lightroom's Compare keys: ↑ Make Select, ↓ Swap.
      case 'compare.makeSelect': promote(); break
      case 'compare.swap': swap(); break
      case 'compare.switch': setActive((a) => (a ? 0 : 1)); break
      // Z: 100 % at the measured focus point (a click zooms where it is clicked).
      case 'cull.zoom': setZoom((z) => (z ? null : focusPoint(target))); break
      case 'cull.compare':
        if (layout === 'compare') toOne()
        else showCompare(layout === 'survey' ? tile : index)
        break
      case 'cull.advance': toggleAdvance(); break
      case 'cull.back':
        if (survey) showSurvey()
        else exit()
        break
      case 'cull.survey':
        if (!survey) return false
        showSurvey()
        break
      case 'cull.close': exit(); break
      default:
        return false
    }
  })
  useKeymapVersion()

  if (!target) return null
  const d = shownDetail?.id === target.id ? shownDetail : null
  const focusAt = layout === 'compare' ? cmp.candidate : index
  const lo = Math.max(0, focusAt - FILMSTRIP_SPAN)
  const strip = items.slice(lo, focusAt + FILMSTRIP_SPAN + 1)
  const flagKeys: [string, string][] = [
    [keyText('photo.pick'), 'pick'],
    [keyText('photo.reject'), 'reject'],
    [keyText('photo.unflag'), 'unflag'],
    [rangeText(['photo.rate0', 'photo.rate1', 'photo.rate2', 'photo.rate3', 'photo.rate4', 'photo.rate5']), 'stars'],
    [[keyText('photo.rateDown'), keyText('photo.rateUp')].filter(Boolean).join(' '), '± star'],
    [rangeText(RATE_NEXT), 'stars and next'],
    [rangeText(['photo.label1', 'photo.label2', 'photo.label3', 'photo.label4']), 'labels'],
    [keyText('photo.quick'), 'Quick Collection'],
  ]
  const escKeys: [string, string][] = survey
    ? [[keyText('cull.back'), 'survey'], [keyText('cull.close'), 'grid']]
    : [[keyText('cull.back') || keyText('cull.close'), 'close']]
  const moveKeys = (next: string, prev: string) => [keyText(prev), keyText(next)].filter(Boolean).join('/')
  const hints =
    layout === 'survey'
      ? hintLine('', [
            ...flagKeys,
          [keyText('survey.next') === '→' && keyText('survey.prev') === '←' ? 'arrows or Tab' : moveKeys('survey.next', 'survey.prev'), 'move'],
          [[keyText('survey.one'), 'click'].filter(Boolean).join(' or ') + ':', '1-up'],
          [[keyText('survey.drop'), '✕'].filter(Boolean).join(' or '), 'drop from survey'],
          [keyText('cull.compare'), 'compare'],
          [keyText('cull.info'), 'info'],
          [keyText('photo.develop'), 'develop'],
          [keyText('survey.close'), 'grid'],
        ])
      : layout === 'compare'
        ? hintLine('', [
            ...flagKeys,
            [moveKeys('compare.next', 'compare.prev'), 'next Candidate'],
            [keyText('compare.makeSelect'), 'Make Select'],
            [keyText('compare.swap'), 'Swap'],
            [keyText('compare.switch'), 'switch photo'],
            [keyText('cull.zoom'), '100 % at the focus point'],
            ['click:', '100 % there'],
            [keyText('cull.compare'), '1-up'],
            [keyText('cull.advance'), 'auto-advance'],
            [keyText('cull.info'), 'info'],
            [keyText('photo.develop'), 'develop'],
            ...escKeys,
          ])
        : hintLine('', [
            ...flagKeys,
            [moveKeys('one.next', 'one.prev'), 'move'],
            [keyText('cull.zoom'), '100 % at the focus point'],
            ['click:', '100 % there'],
            [keyText('cull.compare'), 'compare'],
            [keyText('cull.advance'), 'auto-advance'],
            [keyText('cull.info'), 'info'],
            [keyText('photo.develop'), 'develop'],
            ...escKeys,
          ])

  return (
    <div className="cull" role="dialog" aria-label={layout === 'survey' ? 'Survey view' : layout === 'compare' ? 'Compare view' : 'Culling view'}>
      <header className="cull-top">
        {showInfo ? (
          <div className="cull-info">
            <strong>{target.fileName}</strong>
            <Stars value={target.rating} size="small" />
            {target.flag === 1 && <span className="flag-text pick">⚑ Picked</span>}
            {target.flag === -1 && <span className="flag-text reject">✕ Rejected</span>}
            {target.quick && <span className="muted" title={withKey('In the Quick Collection', 'photo.quick')}>● Quick</span>}
            {target.color > 0 && <span className="label-text"><span className={`label label-${target.color}`} /> {COLOR_NAMES[target.color]}</span>}
            <CullBadges row={target} />
            {measuresText(target) && <span className="muted cull-measures" title={target.cull ? 'Culling helpers: measured on the camera preview' : NOT_ANALYSED}>{measuresText(target)}</span>}
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
          <span className="muted small">
            {layout === 'survey'
              ? `${n} photos`
              : layout === 'compare'
                ? `Select ${cmp.select + 1} · Candidate ${cmp.candidate + 1} of ${n}`
                : `${index + 1} of ${n}`}
          </span>
          {layout === 'compare' && (
            <>
              <button className="button small" onClick={swap} title={withKey('Swap the Select and the Candidate', 'compare.swap')}>⇄ Swap</button>
              <button className="button small" onClick={promote} title={withKey('The Candidate wins: it becomes the Select and the next photo becomes the Candidate', 'compare.makeSelect')}>Make Select</button>
            </>
          )}
          <div className="seg" role="group" aria-label="Layout">
            <button className={layout === 'one' ? 'on' : ''} onClick={toOne} title={withKey('One photo', 'cull.compare')}>
              1-up
            </button>
            <button className={layout === 'compare' ? 'on' : ''} disabled={n < 2} onClick={() => layout !== 'compare' && showCompare(layout === 'survey' ? tile : index)} title={withKey('Compare: the Select stays on the left, the Candidate on the right changes', 'cull.compare')}>
              Compare
            </button>
            {survey && (
              <button className={layout === 'survey' ? 'on' : ''} onClick={() => layout !== 'survey' && showSurvey()} title={withKey('Survey: the selected photos side by side', 'cull.survey')}>
                Survey
              </button>
            )}
          </div>
          {layout !== 'survey' && (
            <label className="check small" title={`${withKey('Move to the next photo (in Compare, the next Candidate) after a flag, star or label key', 'cull.advance')}. Caps Lock also does this.`}>
              <input type="checkbox" checked={advance} onChange={toggleAdvance} />
              Auto-advance
            </label>
          )}
          <button className="button small" onClick={exit} title={withKey('Back to the grid', survey ? 'cull.close' : 'cull.back')}>✕ Close</button>
        </div>
      </header>

      {layout === 'survey' ? (
        <div className="survey-stage" ref={stageRef} style={{ padding: SURVEY_PAD, gap: SURVEY_GAP }}>
          {stage.w > 0 &&
            items.map((row, i) => (
              <SurveyTile
                key={row.id}
                row={row}
                preview={tiles.peek(row.id) ?? null}
                note={notes.current.get(`tile:${row.id}`) ?? ''}
                width={Math.floor(grid.tileW)}
                height={Math.floor(grid.tileH)}
                active={i === tile}
                onOpen={() => showOne(i)}
                onDrop={n > 1 ? () => drop(i) : undefined}
              />
            ))}
        </div>
      ) : (
        <div className={`cull-stage ${layout === 'compare' ? 'two' : ''}`}>
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
              twoUp={layout === 'compare'}
              label={layout === 'compare' ? (i === 0 ? 'Select' : 'Candidate') : undefined}
              onActivate={() => setActive(i as 0 | 1)}
              onToggleZoom={(at) => setZoom((z) => (z ? null : at))}
              onPan={setZoom}
            />
          ))}
        </div>
      )}

      <p className="cull-hints muted small">
        {hints}
      </p>

      {layout !== 'survey' && (
        <nav className="cull-strip" aria-label="Filmstrip">
          {strip.map((r, i) => {
            const at = lo + i
            const on = layout === 'compare' ? at === cmp.select || at === cmp.candidate : at === index
            return (
              <button
                key={r.id}
                className={`strip-cell ${on ? 'on' : ''} ${r.flag === -1 ? 'rejected' : ''}`}
                onClick={() => {
                  // Compare: a filmstrip click picks the Candidate.
                  if (layout === 'compare') {
                    if (at !== cmp.select) setCmp((s) => ({ ...s, candidate: at }))
                  } else setIndex(at)
                }}
                title={layout === 'compare' && at === cmp.select ? `${r.fileName} (Select)` : r.fileName}
              >
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
      )}
    </div>
  )
}
