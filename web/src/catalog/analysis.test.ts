// Culling helpers' logic (docs/PHASE3.md Part 18): burst order, look-alike groups and their strictness, ranking by
// sharpness and exposure, library-relative "possibly soft", and which photos are suggested as rejects.
import { describe, expect, it } from 'vitest'
import {
  assess, burstCompare, DEFAULT_SUGGEST, exposureFactor, fileCounter, isoBand, PEER_MIN, peerStats, rankGroup, similarGroups,
  STRICTNESS_BITS, suggestReasons, type AssessItem, type PhotoAnalysis,
} from './analysis'

function analysis(p: Partial<PhotoAnalysis> = {}): PhotoAnalysis {
  return {
    algo: 1, srcW: 3000, srcH: 2000, w: 1536, h: 1024, sharpPeak: 50, sharpSubject: 50, acuity: 0.9, noiseFloor: 5, motion: 0.1,
    motionSubject: 0.1, motionAngle: 0, textured: 0.8, subjectFrom: 'peak', subjectBox: null, focusU: 0.4, focusV: 0.6,
    clipHi: 0, clipLo: 0, median: 0.4, p005: 0.02, p995: 0.95, dhash: 'f8f9f9f8dcc4fcf8', phash: 'a1b2c3d4e5f60718',
    subSecMs: null, sequence: null, sequenceFrom: '', ...p,
  }
}

let nextId = 1
function item(p: Partial<AssessItem> & { a?: PhotoAnalysis | null } = {}): AssessItem {
  const id = p.id ?? nextId++
  return { id, fileName: `IMG_${String(id).padStart(4, '0')}.JPG`, capturedAt: 1_700_000_000, version: 0, folderId: 1, camera: 'Cam', iso: 200, stackId: null, a: analysis(), ...p }
}

/** Flips the first `n` bits of a hex hash. */
function flip(hex: string, n: number): string {
  const bits = [...hex].flatMap((c) => parseInt(c, 16).toString(2).padStart(4, '0').split('').map(Number))
  for (let i = 0; i < n; i++) bits[i] ^= 1
  let out = ''
  for (let i = 0; i < 64; i += 4) out += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16)
  return out
}

describe('burst order', () => {
  const k = (id: number, fileName: string, capturedAt: number, subSecMs: number | null = null, sequence: number | null = null) => ({ id, fileName, capturedAt, subSecMs, sequence })

  it('orders frames of one second by sub-second time, whatever their names', () => {
    const frames = [k(1, 'B_0001.JPG', 5, 250), k(2, 'B_0002.JPG', 5, 550), k(3, 'B_0003.JPG', 5, 100), k(4, 'B_0004.JPG', 4, 900)]
    expect([...frames].sort(burstCompare).map((f) => f.id)).toEqual([4, 3, 1, 2])
  })

  it('then by the camera’s frame counter, then the file number, then the name', () => {
    // Shutter count wins over a file counter that rolled over (DSC_9999 → DSC_0001).
    expect([k(1, 'DSC_0001.NEF', 9, null, 10001), k(2, 'DSC_9999.NEF', 9, null, 10000)].sort(burstCompare).map((f) => f.id)).toEqual([2, 1])
    expect([k(1, 'IMG_10.JPG', 9), k(2, 'IMG_9.JPG', 9)].sort(burstCompare).map((f) => f.id)).toEqual([2, 1])
    expect([k(1, 'b.jpg', 9), k(2, 'a.jpg', 9)].sort(burstCompare).map((f) => f.id)).toEqual([2, 1])
    // Sub-second times are used only when both frames have one.
    expect([k(1, 'X_2.JPG', 9, 100), k(2, 'X_1.JPG', 9, null)].sort(burstCompare).map((f) => f.id)).toEqual([2, 1])
    expect(fileCounter('DSC_0123.NEF')).toBe(123)
    expect(fileCounter('photo.jpg')).toBeNull()
  })
})

describe('look-alike groups and strictness', () => {
  const base = analysis()
  const frame = (id: number, t: number, bits: number, subSecMs: number | null = null) =>
    ({ id, fileName: `F${id}.JPG`, capturedAt: t, subSecMs, sequence: null, dhash: flip(base.dhash, bits), phash: flip(base.phash, bits) })

  it('links photos whose hashes differ by at most the strictness’s bits, within the time window', () => {
    const frames = [frame(1, 100, 0), frame(2, 100, 4), frame(3, 101, 8), frame(4, 102, 12), frame(5, 200, 0)]
    // Distances to frame 1: 4, 8, 12 bits; between neighbours 4 bits each (flips nest), so chains form.
    expect(similarGroups(frames, STRICTNESS_BITS[5], 30)).toEqual([])
    expect(similarGroups(frames, STRICTNESS_BITS[4], 30)).toEqual([[1, 2, 3, 4]])
    expect(similarGroups(frames, STRICTNESS_BITS[3], 30)).toEqual([[1, 2, 3, 4]])
    // Frame 5 looks the same but was taken 100 s later: outside a 30 s window, inside a 120 s one.
    expect(similarGroups(frames, STRICTNESS_BITS[3], 120)).toEqual([[1, 2, 3, 4, 5]])
    // A gap of 0 links only photos of the same instant.
    expect(similarGroups(frames, STRICTNESS_BITS[1], 0)).toEqual([[1, 2]])
  })

  it('keeps different scenes apart and leaves out photos without hashes or time', () => {
    const other = { ...frame(3, 100, 0), dhash: flip(base.dhash, 40), phash: flip(base.phash, 40) }
    expect(similarGroups([frame(1, 100, 0), frame(2, 100, 2), other], STRICTNESS_BITS[1], 30)).toEqual([[1, 2]])
    expect(similarGroups([frame(1, 0, 0), frame(2, 0, 0)], STRICTNESS_BITS[1], 30)).toEqual([])
    expect(similarGroups([frame(1, 5, 0), { ...frame(2, 5, 0), dhash: null }], STRICTNESS_BITS[1], 30)).toEqual([])
  })

  it('returns groups in burst order', () => {
    expect(similarGroups([frame(1, 100, 0, 700), frame(2, 100, 1, 100), frame(3, 100, 2, 400)], STRICTNESS_BITS[3], 30)).toEqual([[2, 3, 1]])
  })
})

describe('ranking', () => {
  it('puts the sharpest first and gives each its share of the best', () => {
    const r = rankGroup([{ id: 1, sharpSubject: 20, clipHi: 0, clipLo: 0, median: 0.4 }, { id: 2, sharpSubject: 60, clipHi: 0, clipLo: 0, median: 0.4 }, { id: 3, sharpSubject: 30, clipHi: 0, clipLo: 0, median: 0.4 }])
    expect(r.map((x) => x.item.id)).toEqual([2, 3, 1])
    expect(r.map((x) => Math.round(x.ofBest * 100))).toEqual([100, 50, 33])
  })

  it('weights exposure: a clipped frame loses to a nearly as sharp clean one', () => {
    expect(exposureFactor({ clipHi: 0, clipLo: 0, median: 0.4 })).toBe(1)
    expect(exposureFactor({ clipHi: 0.2, clipLo: 0, median: 0.6 })).toBeCloseTo(0.62)
    const r = rankGroup([{ id: 1, sharpSubject: 60, clipHi: 0.2, clipLo: 0, median: 0.6 }, { id: 2, sharpSubject: 50, clipHi: 0, clipLo: 0, median: 0.4 }])
    expect(r[0].item.id).toBe(2)
    // Very dark frames lose too.
    expect(exposureFactor({ clipHi: 0, clipLo: 0, median: 0.05 })).toBeCloseTo(0.8)
  })
})

describe('assessing photos', () => {
  it('ranks a stack, marks the best and the clearly softer frames', () => {
    const s = [item({ stackId: 7, a: analysis({ sharpSubject: 30 }) }), item({ stackId: 7, a: analysis({ sharpSubject: 60 }) }), item({ stackId: 7, a: analysis({ sharpSubject: 50 }) })]
    const out = assess(s, new Map())
    expect(out.get(s[1].id)!.group).toMatchObject({ kind: 'stack', rank: 1, best: true, bestId: s[1].id, size: 3 })
    expect(out.get(s[0].id)!.group).toMatchObject({ rank: 3, best: false, bestId: s[1].id })
    expect(out.get(s[0].id)!.softInGroup).toMatch(/50 % less sharp than IMG_\d+\.JPG/)
    expect(out.get(s[2].id)!.softInGroup).toBeNull()
    // Stacked photos aren't "duplicates of" anything.
    expect([...out.values()].every((c) => c.dupOf === null)).toBe(true)
  })

  it('finds unstacked look-alikes: the best is marked, the others are look-alikes of it', () => {
    const t = 1_700_000_100
    const a = [item({ capturedAt: t, a: analysis({ sharpSubject: 40, subSecMs: 100 }) }), item({ capturedAt: t, a: analysis({ sharpSubject: 55, subSecMs: 600 }) }), item({ capturedAt: t + 500, a: analysis({ sharpSubject: 10 }) })]
    const out = assess(a, new Map())
    expect(out.get(a[1].id)!.group).toMatchObject({ kind: 'similar', best: true })
    expect(out.get(a[0].id)!.dupOf).toMatchObject({ id: a[1].id })
    expect(out.get(a[0].id)!.dupOf!.reason).toMatch(/taken 0\.5 s apart/)
    // Taken minutes later: not part of the group.
    expect(out.get(a[2].id)!.group).toBeNull()
  })

  it('treats RAW+JPEG twins as one shot and leaves virtual copies unranked', () => {
    const raw = item({ fileName: 'DSC_0001.NEF', stackId: 3, a: analysis({ sharpSubject: 50 }) })
    const jpg = item({ fileName: 'DSC_0001.JPG', stackId: 3, a: analysis({ sharpSubject: 52 }) })
    const out = assess([raw, jpg], new Map())
    expect(out.get(raw.id)!.group).toBeNull()
    expect(out.get(jpg.id)!.group).toBeNull()
    const copy = item({ fileName: raw.fileName, version: 1, stackId: 9, a: analysis({ sharpSubject: 10 }) })
    const orig = item({ fileName: 'X.NEF', stackId: 9, a: analysis({ sharpSubject: 50 }) })
    const out2 = assess([copy, orig], new Map())
    expect(out2.get(copy.id)!.group).toBeNull()
    expect(out2.get(copy.id)!.focus).toEqual({ u: 0.4, v: 0.6, from: 'peak' })
  })

  it('says "possibly soft" against peers of the same camera and ISO band only when there are enough', () => {
    const many = Array.from({ length: PEER_MIN }, () => ({ camera: 'Cam', iso: 200, acuity: 0.9 }))
    const peers = peerStats([...many, { camera: 'Cam', iso: 3200, acuity: 0.2 }])
    const soft = item({ capturedAt: 1, a: analysis({ acuity: 0.45 }) })
    const fine = item({ capturedAt: 2, a: analysis({ acuity: 0.85 }) })
    const highIso = item({ capturedAt: 3, iso: 3200, a: analysis({ acuity: 0.3 }) })
    const out = assess([soft, fine, highIso], peers)
    expect(out.get(soft.id)!.rel).toBeCloseTo(0.5)
    expect(out.get(soft.id)!.soft).toMatch(/50 % of the usual fine detail for Cam at ISO 141–283 \(compared with 8 photos\)/)
    expect(out.get(fine.id)!.soft).toBeNull()
    // One photo at ISO 3200: no relative verdict, and not soft enough on its own.
    expect(out.get(highIso.id)!.rel).toBeNull()
    expect(out.get(highIso.id)!.soft).toBeNull()
    expect(isoBand(250)).toBe(isoBand(200))
    expect(isoBand(400)).not.toBe(isoBand(200))
  })

  it('flags shake, clipping and very dark frames with their reasons', () => {
    const a = item({ capturedAt: 1, a: analysis({ motion: 0.6, motionAngle: 30 }) })
    const b = item({ capturedAt: 2, fileName: 'X.NEF', a: analysis({ clipHi: 0.2, median: 0.6 }) })
    const c = item({ capturedAt: 3, a: analysis({ median: 0.04, p995: 0.3 }) })
    const out = assess([a, b, c], new Map())
    expect(out.get(a.id)!.shake).toMatch(/about 30° from horizontal/)
    expect(out.get(b.id)!.clipped).toMatch(/highlights in 20 % of the frame\. The RAW may hold more\./)
    expect(out.get(b.id)!.exposureBad).toMatch(/Badly clipped/)
    expect(out.get(c.id)!.exposure).toMatch(/Very dark/)
    expect(out.get(c.id)!.exposureBad).toBe('Almost black.')
  })

  it('gives nothing for photos not analysed yet', () => {
    const a = item({ a: null })
    expect(assess([a], new Map()).has(a.id)).toBe(false)
  })
})

describe('suggested rejects', () => {
  const s = [item({ stackId: 5, a: analysis({ sharpSubject: 20 }) }), item({ stackId: 5, a: analysis({ sharpSubject: 60, motion: 0.5 }) }), item({ stackId: 5, a: analysis({ sharpSubject: 58 }) })]
  const info = assess(s, new Map())
  const row = (i: number, flag = 0) => ({ flag, cull: info.get(s[i].id) })

  it('suggests clearly softer frames and shake, never the best of a group', () => {
    expect(suggestReasons(row(0))![0]).toMatch(/less sharp than/)
    // The best is shaken but stays: it is the best of its stack.
    expect(suggestReasons(row(1))).toBeNull()
    expect(suggestReasons(row(2))).toBeNull()
  })

  it('never suggests picked or already rejected photos, or unanalysed ones', () => {
    expect(suggestReasons(row(0, 1))).toBeNull()
    expect(suggestReasons(row(0, -1))).toBeNull()
    expect(suggestReasons({ flag: 0, cull: null })).toBeNull()
  })

  it('uses only the reasons chosen', () => {
    expect(suggestReasons(row(0), { ...DEFAULT_SUGGEST, softInGroup: false })).toBeNull()
    const shaken = assess([item({ capturedAt: 50, a: analysis({ motion: 0.5 }) })], new Map())
    const r = { flag: 0, cull: [...shaken.values()][0] }
    expect(suggestReasons(r)![0]).toMatch(/shake/)
    expect(suggestReasons(r, { ...DEFAULT_SUGGEST, shake: false })).toBeNull()
  })
})
