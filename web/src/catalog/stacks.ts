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
