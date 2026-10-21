// Stacks: several photos shown as one in the grid, with one "top" photo, like darktable's groups (the
// representative is `group_id`, src/common/grouping.c) and Lightroom's stacks. RAW+JPEG pairs are stacked
// with the RAW on top, as darktable does at import (src/common/image.c, _image_import_internal).

export interface StackableRow {
  id: number
  stackId: number | null
  stackTop: boolean
  stackExpanded: boolean
}

/**
 * Collapses stacks for display: an expanded stack shows all its photos; a collapsed one shows a single photo,
 * its top photo if the filters let it through, else the first member that did, at the first member's position.
 */
export function collapseStacks<T extends StackableRow>(rows: T[]): T[] {
  const tops = new Map<number, T>()
  for (const r of rows) if (r.stackId !== null && r.stackTop) tops.set(r.stackId, r)
  const shown = new Set<number>()
  const out: T[] = []
  for (const r of rows) {
    if (r.stackId === null || r.stackExpanded) {
      out.push(r)
      continue
    }
    if (shown.has(r.stackId)) continue
    shown.add(r.stackId)
    out.push(tops.get(r.stackId) ?? r)
  }
  return out
}

/**
 * Lightroom's "Auto-stack by capture time": runs of photos taken no more than `gapSeconds` apart. Photos with
 * no capture time, or already in a stack, are left alone. Returns groups of two or more ids, oldest first.
 */
export function burstGroups(photos: { id: number; capturedAt: number; stacked: boolean }[], gapSeconds: number): number[][] {
  const sorted = photos.filter((p) => p.capturedAt > 0 && !p.stacked).sort((a, b) => a.capturedAt - b.capturedAt || a.id - b.id)
  const groups: number[][] = []
  let run: typeof sorted = []
  for (const p of sorted) {
    if (run.length && p.capturedAt - run[run.length - 1].capturedAt > gapSeconds) {
      if (run.length > 1) groups.push(run.map((r) => r.id))
      run = []
    }
    run.push(p)
  }
  if (run.length > 1) groups.push(run.map((r) => r.id))
  return groups
}

/** A photo (or a file on a card) as RAW+JPEG pairing sees it. */
export interface TwinCandidate {
  /** Folder (a card's folder, or the library folder's id). */
  group: string | number
  /** File name now (library) or on the card. */
  name: string
  /** The name it had on the camera's card (renaming on import changes `name`, not this). */
  originalName?: string
  /** Capture time in seconds (camera clock), 0 when unknown. */
  capturedAt: number
}

/** Seconds the capture times of RAW+JPEG twins in different folders may differ by (the camera writes both at once). */
export const TWIN_SECONDS = 2

const stemOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return (dot > 0 ? name.slice(0, dot) : name).toLowerCase()
}
export const isJpegName = (name: string) => ['jpg', 'jpeg'].includes(name.slice(name.lastIndexOf('.') + 1).toLowerCase())

/**
 * RAW+JPEG twins (a camera's RAW+JPEG mode writes one shot as two files with the same name). Pairs a JPEG with a RAW:
 * - in the same folder with the same name, ignoring case (DSC_0001.NEF and dsc_0001.JPG), and the same capture time
 *   when both have one, or
 * - in different folders (cameras that write RAW and JPEG to separate folders or cards, or twins imported at different
 *   times, possibly renamed) with the same name on the card and capture times at most TWIN_SECONDS apart; the
 *   closest time wins, so the camera's file numbers starting again (DSC_0001 every 10,000 shots) don't pair.
 * Each file is used once. Returns [rawIndex, jpegIndex] pairs, in the order of `items`' RAWs.
 */
export function pairTwins(items: TwinCandidate[]): [number, number][] {
  const raws: number[] = []
  const jpegs: number[] = []
  items.forEach((it, i) => (isJpegName(it.name) ? jpegs : raws).push(i))
  const byFolderName = new Map<string, number[]>()
  const byCameraName = new Map<string, number[]>()
  const push = (m: Map<string, number[]>, k: string, i: number) => {
    const list = m.get(k)
    if (list) list.push(i)
    else m.set(k, [i])
  }
  for (const j of jpegs) {
    push(byFolderName, `${items[j].group}/${stemOf(items[j].name)}`, j)
    push(byCameraName, stemOf(items[j].originalName ?? items[j].name), j)
  }
  const used = new Set<number>()
  const pairs: [number, number][] = []
  // Same folder, same name first. Their capture times must agree when both are known: renamed photos of different
  // imports can share a number (2026-10-19_0005.NEF and 2026-10-19_0005.JPG) without being one shot.
  const sameTime = (a: number, b: number) => !(items[a].capturedAt > 0 && items[b].capturedAt > 0) || Math.abs(items[a].capturedAt - items[b].capturedAt) <= TWIN_SECONDS
  for (const r of raws) {
    const j = byFolderName.get(`${items[r].group}/${stemOf(items[r].name)}`)?.find((x) => !used.has(x) && sameTime(r, x))
    if (j === undefined) continue
    used.add(r)
    used.add(j)
    pairs.push([r, j])
  }
  // Elsewhere: same name on the card, taken at the same moment.
  const timed: { r: number; j: number; gap: number }[] = []
  for (const r of raws) {
    if (used.has(r) || !(items[r].capturedAt > 0)) continue
    for (const j of byCameraName.get(stemOf(items[r].originalName ?? items[r].name)) ?? []) {
      if (used.has(j) || !(items[j].capturedAt > 0)) continue
      const gap = Math.abs(items[j].capturedAt - items[r].capturedAt)
      if (gap <= TWIN_SECONDS) timed.push({ r, j, gap })
    }
  }
  timed.sort((a, b) => a.gap - b.gap || a.r - b.r || a.j - b.j)
  for (const { r, j } of timed) {
    if (used.has(r) || used.has(j)) continue
    used.add(r)
    used.add(j)
    pairs.push([r, j])
  }
  return pairs.sort((a, b) => a[0] - b[0])
}
