// The Library grid's lines: rows of cells and, when photos are sorted by capture time, a heading line for each date
// (owner's feedback 2026-10-19). A collapsed stack is one cell, so it shows once, under the date of the photo shown.

/** A capture time (camera clock written as UTC, seconds) → "YYYY-MM-DD", or '' when unknown. */
export function dayOf(capturedAt: number): string {
  if (!(capturedAt > 0)) return ''
  const d = new Date(capturedAt * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export type GridLine =
  | { kind: 'head'; day: string; count: number }
  /** Cells `start` to `end` (exclusive) of the rows. */
  | { kind: 'cells'; start: number; end: number }

/** Lines of `cols` cells; with `byDay`, a heading before each date's photos (dates in the order the rows come). */
export function gridLines(rows: { capturedAt: number }[], cols: number, byDay: boolean): GridLine[] {
  const lines: GridLine[] = []
  const n = Math.max(1, cols)
  let i = 0
  while (i < rows.length) {
    let end = rows.length
    if (byDay) {
      const day = dayOf(rows[i].capturedAt)
      end = i + 1
      while (end < rows.length && dayOf(rows[end].capturedAt) === day) end++
      lines.push({ kind: 'head', day, count: end - i })
    }
    for (let s = i; s < end; s += n) lines.push({ kind: 'cells', start: s, end: Math.min(end, s + n) })
    i = end
  }
  return lines
}

/** The line holding cell `index` (-1 if none). */
export function lineOf(lines: GridLine[], index: number): number {
  return lines.findIndex((l) => l.kind === 'cells' && index >= l.start && index < l.end)
}

/**
 * The cell above (dir −1) or below (+1) cell `index`: the same column of the previous or next line of cells
 * (skipping headings), or that line's last cell when it is shorter. Stays put at the top and bottom.
 */
export function verticalNeighbour(lines: GridLine[], index: number, dir: -1 | 1): number {
  const at = lineOf(lines, index)
  if (at < 0) return index
  const here = lines[at] as Extract<GridLine, { kind: 'cells' }>
  for (let k = at + dir; k >= 0 && k < lines.length; k += dir) {
    const l = lines[k]
    if (l.kind === 'cells') return Math.min(l.end - 1, l.start + (index - here.start))
  }
  return index
}

/** A date heading's text, e.g. "Sunday, 19 October 2026". */
export function dayHeading(day: string, locale?: string): string {
  if (!day) return 'No capture date'
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/** The short date on a card, e.g. "19 Oct 2026" (the camera's clock). */
export function cardDate(capturedAt: number, locale?: string): string {
  if (!(capturedAt > 0)) return ''
  return new Date(capturedAt * 1000).toLocaleDateString(locale, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
}
