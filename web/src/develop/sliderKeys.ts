// Keyboard steps for the develop sliders.

/**
 * How far one arrow key moves a slider: 1/200 of its range, rounded to its step and never less than one
 * step; Shift+arrow moves ten times as far. (LightBench's choice: some steps are far finer than a useful nudge.)
 */
export function nudge(min: number, max: number, step: number, big: boolean): number {
  const small = Math.max(step, Math.round((max - min) / 200 / step) * step)
  return big ? small * 10 : small
}

/** `v` within [min, max], on the slider's step grid (without floating-point dust). */
export function snap(v: number, min: number, max: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1)
  const on = min + Math.round((v - min) / step) * step
  return Number(Math.min(max, Math.max(min, on)).toFixed(decimals))
}
