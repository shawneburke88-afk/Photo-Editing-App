// Survey (Lightroom-style): the selected photos tiled at the largest size that fits the screen.

/** Width / height of a photo shown upright, guessed from its orientation until its preview is loaded. */
export function guessAspect(orientation: number): number {
  // LibRaw codes 5 and 6 are quarter turns: a 3:2 sensor shown upright is 2:3.
  return orientation === 5 || orientation === 6 ? 2 / 3 : 3 / 2
}

export interface SurveyGrid {
  cols: number
  rows: number
  /** Size of each tile in CSS pixels. */
  tileW: number
  tileH: number
}

/**
 * Picks the number of columns that shows the photos largest: every column count is tried and the one with
 * the most image area (each photo fitted inside its equal-sized tile) wins; on a tie, fewer columns.
 */
export function surveyGrid(aspects: number[], width: number, height: number, gap: number): SurveyGrid {
  const n = aspects.length
  let best: SurveyGrid = { cols: 1, rows: Math.max(1, n), tileW: 0, tileH: 0 }
  let bestArea = -1
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.max(1, Math.ceil(n / cols))
    const tileW = Math.max(0, (width - gap * (cols - 1)) / cols)
    const tileH = Math.max(0, (height - gap * (rows - 1)) / rows)
    let area = 0
    for (const a of aspects) {
      const w = Math.min(tileW, tileH * a)
      area += w * (w / a)
    }
    if (area > bestArea + 1e-6) {
      bestArea = area
      best = { cols, rows, tileW, tileH }
    }
  }
  return best
}

/** The active tile after dropping tile `removed` from a survey of `n` tiles (keeps the same photo active when it stays). */
export function activeAfterDrop(active: number, removed: number, n: number): number {
  if (removed < active) return active - 1
  return Math.max(0, Math.min(active, n - 2))
}
