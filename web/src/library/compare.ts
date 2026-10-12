// Compare (Lightroom-style): the Select stays on the left, the Candidate on the right steps through the
// other photos. Positions are indexes into the culling list, which is fixed while the view is open.

export interface CompareState {
  select: number
  candidate: number
}

/** Starts Compare with `select` and the photo after it (or before it, at the end of the list). */
export function startCompare(select: number, n: number, candidate?: number): CompareState | null {
  if (n < 2 || select < 0 || select >= n) return null
  if (candidate !== undefined && candidate >= 0 && candidate < n && candidate !== select) return { select, candidate }
  return { select, candidate: select + 1 < n ? select + 1 : select - 1 }
}

/** Moves the Candidate by `delta`, stepping over the Select; it stays put at either end of the list. */
export function stepCandidate(s: CompareState, delta: number, n: number): CompareState {
  if (n < 2 || delta === 0) return s
  const dir = Math.sign(delta)
  let i = Math.min(n - 1, Math.max(0, s.candidate + delta))
  if (i === s.select) i = i + dir >= 0 && i + dir < n ? i + dir : i - dir
  // Never moves against the direction asked (the Select was the last photo that way).
  return Math.sign(i - s.candidate) === dir ? { ...s, candidate: i } : s
}

/** Swap: the Candidate becomes the Select and the other way round. */
export function swapCompare(s: CompareState): CompareState {
  return { select: s.candidate, candidate: s.select }
}

/** Make Select (the Candidate wins): it becomes the Select and the photo after it becomes the Candidate. */
export function makeSelect(s: CompareState, n: number): CompareState {
  return startCompare(s.candidate, n) ?? s
}

/**
 * The Candidate when Compare opens from the grid: the next selected photo after the focused one (wrapping
 * round) when several are selected, otherwise the photo after it. Returns an index into `ids`.
 */
export function gridCandidate(ids: number[], focus: number, selected: ReadonlySet<number>): number | undefined {
  const at = ids.indexOf(focus)
  if (at < 0 || ids.length < 2) return undefined
  for (let k = 1; k < ids.length; k++) {
    const i = (at + k) % ids.length
    if (selected.has(ids[i])) return i
  }
  return startCompare(at, ids.length)?.candidate
}
