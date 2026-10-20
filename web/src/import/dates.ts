// The Import window's date list: photos per capture date, how many of them are ticked, and choosing several dates
// (click, Ctrl/Cmd-click, Shift-click, as in a file list).

export interface DateCount {
  /** "YYYY-MM-DD" (camera clock). */
  day: string
  total: number
  /** Photos of that date ticked for import. */
  selected: number
}

/** Photos per date, newest date first. */
export function dateCounts(items: { day: string | null; selected: boolean }[]): DateCount[] {
  const m = new Map<string, DateCount>()
  for (const it of items) {
    if (it.day === null) continue
    let c = m.get(it.day)
    if (!c) m.set(it.day, (c = { day: it.day, total: 0, selected: 0 }))
    c.total++
    if (it.selected) c.selected++
  }
  return [...m.values()].sort((a, b) => b.day.localeCompare(a.day))
}

/**
 * The dates shown after a click on `day` in `order` (the list as shown). A plain click shows that date only (or all
 * dates again if it was the only one shown); Ctrl/Cmd adds or removes it; Shift shows the range from `anchor` (the
 * last date clicked without Shift) to it. An empty set means all dates.
 */
export function clickDate(
  shown: ReadonlySet<string>,
  order: string[],
  day: string,
  mods: { toggle: boolean; range: boolean },
  anchor: string | null,
): Set<string> {
  if (mods.range && anchor !== null && order.includes(anchor) && order.includes(day)) {
    const a = order.indexOf(anchor)
    const b = order.indexOf(day)
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1)
    return new Set(mods.toggle ? [...shown, ...range] : range)
  }
  if (mods.toggle) {
    const next = new Set(shown)
    if (next.has(day)) next.delete(day)
    else next.add(day)
    return next
  }
  return shown.size === 1 && shown.has(day) ? new Set() : new Set([day])
}
