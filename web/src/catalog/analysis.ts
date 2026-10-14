// Culling helpers (docs/PHASE3.md Part 18): turns each photo's stored analysis (engine/analysis/analyze.ts) into what
// the Library shows: "possibly soft", "shake", "clipped", "duplicate of…", the best photo of a stack or of a group of
// look-alikes, and suggested rejects with their reasons. Pure functions, used by the catalog worker (sorting and
// filtering) and the page.
//
// What the numbers can say (owner's decision, 2026-10-13):
// - Sharpness ranks frames of one stack or burst well (same camera, settings and scene).
// - Across a library it only says "possibly soft", against other photos from the same camera at a similar ISO.
// - Thresholds below are starting points chosen on synthetic blur and a few test files [estimate], not tuned on a
//   labelled set of the owner's photos.
// Nothing here changes a photo: suggestions are shown apart from flags and need the owner's Apply.

import type { ImageAnalysis } from '../engine/analysis/analyze'
import { hamming } from '../engine/analysis/hash'
import type { CaptureExtras } from '../engine/meta/capture'

/** One photo's stored analysis (the catalog's photo_analysis row). */
export type PhotoAnalysis = ImageAnalysis & {
  algo: number
  subSecMs: number | null
  sequence: number | null
  sequenceFrom: CaptureExtras['sequenceFrom']
}

/** What the Library shows about a photo; null fields don't apply. Reasons are plain sentences for tooltips. */
export interface CullInfo {
  /** Sharpness relative to other photos from the same camera at a similar ISO (1 = their median); null: too few. */
  rel: number | null
  /** Possibly soft (library-relative, or very soft on any scale). */
  soft: string | null
  /** Possible camera shake or motion blur. */
  shake: string | null
  /** Highlights or shadows clipped in the camera preview. */
  clipped: string | null
  /** Very dark or very bright overall. */
  exposure: string | null
  /** Badly exposed enough to suggest a reject (an option, off by default). */
  exposureBad: string | null
  /** Looks like another photo shown (an unstacked look-alike, not the best of them). */
  dupOf: { id: number; name: string; reason: string } | null
  /** Its stack or group of look-alikes: size, this photo's rank by sharpness and exposure (1 = best), the best's id. */
  group: { kind: 'stack' | 'similar'; size: number; rank: number; bestId: number; best: boolean; reason: string } | null
  /** Clearly less sharp than the best of its stack or group. */
  softInGroup: string | null
  /** Where Z zooms to in culling: the camera's focus point, else the sharpest area (normalised, upright). */
  focus: { u: number; v: number; from: 'af' | 'subjectarea' | 'peak' } | null
}

// ---- thresholds [estimate]

/** Fewer photos than this from one camera and ISO band: no library-relative verdict. */
export const PEER_MIN = 8
/** Acuity below this share of the peers' median: possibly soft. */
export const SOFT_REL = 0.6
/**
 * Acuity below this on its own: possibly soft whatever the peers. Acuity depends on how much the preview is scaled down
 * (a sharp Sony 1616 px preview measured 0.42, a sharp D700 one 0.92), so this only catches very soft frames.
 */
export const SOFT_ABS = 0.22
/** Agreement of the textured tiles on one smear direction: possible shake (sharp test files measured up to 0.23, synthetic shake 0.44–0.60). */
export const SHAKE_MOTION = 0.3
/** Less than this share of the best photo's sharpness in its group: clearly softer. */
export const GROUP_SOFT = 0.6
/** Clipping (share of pixels) for the badge, and for suggesting a reject. */
export const CLIP_BADGE = 0.02
export const SHADOW_BADGE = 0.05
export const CLIP_BAD = 0.15

/** Look-alike strictness 1 (loose) … 5 (strict): the most bits that may differ (mean of dHash and pHash distances). */
export const STRICTNESS_BITS = [0, 18, 14, 10, 6, 3] as const
export const DEFAULT_STRICTNESS = 3
/** Look-alikes are looked for among photos taken at most this far apart (seconds) when no gap is given. */
export const SIMILAR_WINDOW = 30

const pct = (x: number) => `${Math.round(x * 100)} %`

/** ISO bands of one stop: 100, 200, 400… (0 when unknown). */
export function isoBand(iso: number): number {
  return iso > 0 ? Math.round(Math.log2(iso / 100)) : -99
}

export const peerKey = (camera: string, iso: number) => `${camera.trim().toLowerCase()}|${isoBand(iso)}`

function isoRange(iso: number): string {
  if (!(iso > 0)) return 'unknown ISO'
  const b = isoBand(iso)
  const lo = Math.round(100 * 2 ** (b - 0.5))
  const hi = Math.round(100 * 2 ** (b + 0.5))
  return `ISO ${lo}–${hi}`
}

export interface PeerStats {
  n: number
  acuity: number
}

function median(v: number[]): number {
  if (!v.length) return 0
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Median acuity per camera and ISO band. */
export function peerStats(rows: { camera: string; iso: number; acuity: number }[]): Map<string, PeerStats> {
  const by = new Map<string, number[]>()
  for (const r of rows) {
    if (!(r.acuity >= 0)) continue
    const k = peerKey(r.camera, r.iso)
    const list = by.get(k)
    if (list) list.push(r.acuity)
    else by.set(k, [r.acuity])
  }
  return new Map([...by].map(([k, v]) => [k, { n: v.length, acuity: median(v) }]))
}

// ---- burst order

export interface BurstKey {
  id: number
  fileName: string
  capturedAt: number
  subSecMs?: number | null
  sequence?: number | null
}

/** The trailing number of a file name ("DSC_0123.NEF" → 123), or null. */
export function fileCounter(name: string): number | null {
  const m = /(\d+)(?:\.[^.]*)?$/.exec(name)
  return m ? Number(m[1]) : null
}

/**
 * Orders frames by capture time, then within a second by the camera's sub-second time, then by its frame counter
 * (sequence number, shutter count or shot order), then by the file name's number, then the name.
 */
export function burstCompare(a: BurstKey, b: BurstKey): number {
  if (a.capturedAt !== b.capturedAt) return a.capturedAt - b.capturedAt
  if (a.subSecMs != null && b.subSecMs != null && a.subSecMs !== b.subSecMs) return a.subSecMs - b.subSecMs
  if (a.sequence != null && b.sequence != null && a.sequence !== b.sequence) return a.sequence - b.sequence
  const ca = fileCounter(a.fileName)
  const cb = fileCounter(b.fileName)
  if (ca !== null && cb !== null && ca !== cb) return ca - cb
  return a.fileName.localeCompare(b.fileName) || a.id - b.id
}

/** Seconds between two frames, with sub-second times when both have them. */
export function secondsApart(a: BurstKey, b: BurstKey): number {
  const t = (k: BurstKey) => k.capturedAt + (k.subSecMs ?? 0) / 1000
  return Math.abs(t(b) - t(a))
}

// ---- look-alikes

export interface SimilarItem extends BurstKey {
  dhash: string | null
  phash: string | null
}

/** Mean of the dHash and pHash distances (bits, 0–64). */
export const lookDistance = (a: Pick<SimilarItem, 'dhash' | 'phash'>, b: Pick<SimilarItem, 'dhash' | 'phash'>) => (hamming(a.dhash, b.dhash) + hamming(a.phash, b.phash)) / 2

/**
 * Groups of look-alike photos: in burst order, each photo is compared with the photos after it taken at most
 * `windowSeconds` later, and linked when at most `maxBits` differ; linked photos form a group (union-find). Photos
 * without hashes or capture time are left out. Returns groups of two or more ids, each in burst order.
 */
export function similarGroups(items: SimilarItem[], maxBits: number, windowSeconds: number): number[][] {
  const list = items.filter((i) => i.capturedAt > 0 && i.dhash && i.phash).sort(burstCompare)
  const parent = list.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length && secondsApart(list[i], list[j]) <= windowSeconds; j++) {
      if (lookDistance(list[i], list[j]) <= maxBits) parent[find(j)] = find(i)
    }
  }
  const groups = new Map<number, number[]>()
  list.forEach((item, i) => {
    const r = find(i)
    const g = groups.get(r)
    if (g) g.push(item.id)
    else groups.set(r, [item.id])
  })
  return [...groups.values()].filter((g) => g.length > 1)
}

// ---- ranking

export interface RankItem {
  id: number
  sharpSubject: number
  clipHi: number
  clipLo: number
  median: number
}

/** Exposure's weight in the ranking: 1 when fine, lower for clipping and very dark or bright frames. */
export function exposureFactor(a: Pick<RankItem, 'clipHi' | 'clipLo' | 'median'>): number {
  let f = 1 - Math.min(0.5, 2 * Math.max(0, a.clipHi - 0.01)) - Math.min(0.3, Math.max(0, a.clipLo - 0.05))
  if (a.median < 0.08 || a.median > 0.92) f -= 0.2
  return Math.max(0.1, f)
}

/** Best first: by sharpness on the subject (frames of one scene), weighted by exposure. Ties keep the given order. */
export function rankGroup<T extends RankItem>(members: T[]): { item: T; score: number; ofBest: number }[] {
  const scored = members.map((item, i) => ({ item, i, score: item.sharpSubject * exposureFactor(item) }))
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  const best = scored[0]?.score || 1
  return scored.map(({ item, score }) => ({ item, score, ofBest: best > 0 ? score / best : 1 }))
}

// ---- assessing photos

export interface AssessItem extends BurstKey {
  /** The original's id for virtual copies (they share its analysis and are not ranked themselves). */
  version: number
  folderId: number
  camera: string
  iso: number
  stackId: number | null
  a: PhotoAnalysis | null
}

/** A photo's burst order key, with the sub-second time and frame counter from its analysis when not given. */
const burstKey = (i: AssessItem): BurstKey => ({ ...i, subSecMs: i.subSecMs ?? i.a?.subSecMs ?? null, sequence: i.sequence ?? i.a?.sequence ?? null })

/** The stem of a file name, to treat RAW+JPEG twins as one shot. */
const stem = (name: string) => name.replace(/\.[^.]*$/, '').toLowerCase()

export interface AssessOptions {
  strictness?: number
  windowSeconds?: number
}

/**
 * What the Library shows for each photo. `items` are the photos shown plus the other members of their stacks;
 * `peers` comes from the whole library (peerStats). Virtual copies share their original's measures but aren't
 * ranked or matched as look-alikes.
 */
export function assess(items: AssessItem[], peers: Map<string, PeerStats>, opts: AssessOptions = {}): Map<number, CullInfo> {
  const out = new Map<number, CullInfo>()
  for (const it of items) {
    const a = it.a
    if (!a) continue
    const peer = peers.get(peerKey(it.camera, it.iso))
    const rel = peer && peer.n >= PEER_MIN && peer.acuity > 0 ? a.acuity / peer.acuity : null
    const cam = it.camera || 'this camera'
    let soft: string | null = null
    if (rel !== null && rel < SOFT_REL) {
      soft = `Possibly soft: ${pct(rel)} of the usual fine detail for ${cam} at ${isoRange(it.iso)} (compared with ${peer!.n} photos). Measured on the camera preview; check at 100 %.`
    } else if (a.acuity < SOFT_ABS && a.textured > 0.2) {
      soft = `Possibly soft: very little fine detail anywhere in the frame${rel === null ? ` (too few photos from ${cam} at ${isoRange(it.iso)} to compare with)` : ''}. Measured on the camera preview; check at 100 %.`
    }
    const shake =
      a.motion >= SHAKE_MOTION && a.textured > 0.2
        ? `Possible camera shake or motion blur: detail is smeared in one direction (about ${a.motionAngle}° from horizontal) across ${pct(a.motion)} of the textured areas.`
        : null
    const clips: string[] = []
    if (a.clipHi >= CLIP_BADGE) clips.push(`highlights in ${pct(a.clipHi)} of the frame`)
    if (a.clipLo >= SHADOW_BADGE) clips.push(`shadows in ${pct(a.clipLo)}`)
    const clipped = clips.length ? `Clipped in the camera preview: ${clips.join(', ')}.${it.fileName && !/\.jpe?g$/i.test(it.fileName) ? ' The RAW may hold more.' : ''}` : null
    const exposure = a.median < 0.12 && a.p995 < 0.6 ? `Very dark: half the frame is below ${pct(a.median)} brightness.` : a.median > 0.85 ? `Very bright: half the frame is above ${pct(a.median)} brightness.` : null
    const exposureBad =
      a.clipHi >= CLIP_BAD ? `Badly clipped highlights (${pct(a.clipHi)} of the frame).` : a.median < 0.06 ? 'Almost black.' : a.median > 0.95 ? 'Almost white.' : null
    out.set(it.id, {
      rel: rel === null ? null : Math.round(rel * 1000) / 1000,
      soft,
      shake,
      clipped,
      exposure,
      exposureBad,
      dupOf: null,
      group: null,
      softInGroup: null,
      focus: { u: a.focusU, v: a.focusV, from: a.subjectFrom },
    })
  }

  // Groups: stacks, then look-alikes among the unstacked originals. RAW+JPEG twins count once (the RAW).
  const originals = items.filter((i) => i.a && i.version === 0)
  const twinsOf = new Map<string, AssessItem[]>()
  for (const it of originals) {
    const k = `${it.folderId}|${stem(it.fileName)}|${it.capturedAt}`
    twinsOf.set(k, [...(twinsOf.get(k) ?? []), it])
  }
  const shot = (it: AssessItem) => twinsOf.get(`${it.folderId}|${stem(it.fileName)}|${it.capturedAt}`)!
  const isTwinShadow = (it: AssessItem) => {
    const t = shot(it)
    return t.length > 1 && t[0] !== it && /\.jpe?g$/i.test(it.fileName)
  }
  const byId = new Map(items.map((i) => [i.id, i]))
  const markGroup = (kind: 'stack' | 'similar', ids: number[]) => {
    const members = ids.map((id) => byId.get(id)!).filter((m) => m.a && m.version === 0 && !isTwinShadow(m))
    if (members.length < 2) return
    const ranked = rankGroup(members.map((m) => ({ ...m.a!, id: m.id })))
    const best = byId.get(ranked[0].item.id)!
    const where = kind === 'stack' ? 'this stack' : 'these similar shots'
    ranked.forEach((r, i) => {
      const info = out.get(r.item.id)
      if (!info) return
      info.group = {
        kind,
        size: members.length,
        rank: i + 1,
        bestId: best.id,
        best: i === 0,
        reason: i === 0 ? `Sharpest of the ${members.length} in ${where} (judged on the subject, weighted by exposure).` : `${ordinal(i + 1)} sharpest of the ${members.length} in ${where}; ${best.fileName} is the sharpest.`,
      }
      if (i > 0 && r.ofBest < GROUP_SOFT) info.softInGroup = `${pct(1 - r.ofBest)} less sharp than ${best.fileName}, the sharpest of the ${members.length} in ${where}.`
      if (kind === 'similar' && i > 0) {
        const d = lookDistance(byId.get(r.item.id)!.a!, best.a!)
        const apart = secondsApart(burstKey(byId.get(r.item.id)!), burstKey(best))
        info.dupOf = { id: best.id, name: best.fileName, reason: `Looks like ${best.fileName}, taken ${apart < 10 ? apart.toFixed(1) : Math.round(apart)} s apart (${Math.round(d)} of 64 bits differ); that one is sharper.` }
      }
    })
  }
  const stacks = new Map<number, number[]>()
  for (const it of originals) if (it.stackId !== null) stacks.set(it.stackId, [...(stacks.get(it.stackId) ?? []), it.id])
  for (const ids of stacks.values()) markGroup('stack', ids)
  const loose = originals.filter((i) => i.stackId === null && !isTwinShadow(i))
  const bits = STRICTNESS_BITS[Math.min(5, Math.max(1, Math.round(opts.strictness ?? DEFAULT_STRICTNESS)))]
  for (const g of similarGroups(loose.map((i) => ({ ...burstKey(i), dhash: i.a!.dhash, phash: i.a!.phash })), bits, opts.windowSeconds ?? SIMILAR_WINDOW)) markGroup('similar', g)

  // Virtual copies show their original's measures (not its group).
  for (const it of items) {
    if (it.version === 0 || !it.a || !out.has(it.id)) continue
    const info = out.get(it.id)!
    out.set(it.id, { ...info, dupOf: null, group: null, softInGroup: null })
  }
  return out
}

function ordinal(n: number): string {
  return n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`
}

// ---- suggested rejects

export interface SuggestOptions {
  /** Clearly less sharp than the best of its stack or group of look-alikes. */
  softInGroup: boolean
  shake: boolean
  /** Possibly soft against the library (weaker evidence). */
  soft: boolean
  /** Badly exposed. */
  exposure: boolean
}

export const DEFAULT_SUGGEST: SuggestOptions = { softInGroup: true, shake: true, soft: false, exposure: false }

/**
 * Why a photo would be suggested as a reject, or null. Never a picked or already rejected photo, never the best of
 * its group: a suggestion only adds a reject flag when the owner applies it.
 */
export function suggestReasons(row: { flag: number; cull?: CullInfo | null }, opts: SuggestOptions = DEFAULT_SUGGEST): string[] | null {
  const c = row.cull
  if (!c || row.flag !== 0 || c.group?.best) return null
  const reasons = [
    opts.softInGroup && c.softInGroup,
    opts.shake && c.shake,
    opts.soft && c.soft,
    opts.exposure && c.exposureBad,
  ].filter((r): r is string => !!r)
  return reasons.length ? reasons : null
}

/** The relative sharpness used to sort (higher is sharper): against peers when there are enough, else on its own. */
export function sharpnessKey(a: PhotoAnalysis | null, info: CullInfo | undefined, fallbackMedian: number): number | null {
  if (!a) return null
  if (info?.rel != null) return info.rel
  return fallbackMedian > 0 ? a.acuity / fallbackMedian : a.acuity
}
