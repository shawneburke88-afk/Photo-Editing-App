/** Where a context menu opens for a `contextmenu` event: the pointer, or below the element when the keyboard opened it. */
export function menuPoint(e: React.MouseEvent): { x: number; y: number } {
  if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY }
  const r = (e.currentTarget as Element).getBoundingClientRect()
  return { x: r.left + 8, y: r.bottom }
}
