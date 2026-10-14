// Statistics of repeated timings (GPU benchmark, PHASE3.md Part 16): the median says what a run usually costs, the
// minimum what it costs with the least interference from the rest of the machine.

export interface Summary {
  /** Middle value; for an even count, the mean of the two middle values. */
  median: number
  min: number
  max: number
  runs: number
}

/** Median, minimum and maximum of the finite values; null when there are none. */
export function summarize(values: readonly number[]): Summary | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = v.length >> 1
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
  return { median, min: v[0], max: v[v.length - 1], runs: v.length }
}

/** Sum of the pass times whose label passes `match` (all when absent). */
export function sumPasses(passes: readonly { label: string; ms: number }[], match?: (label: string) => boolean): number {
  let t = 0
  for (const p of passes) if (!match || match(p.label)) t += p.ms
  return t
}

/**
 * Whether timestamps look quantized: every non-zero pass time a whole multiple of `step` ms (Chrome rounds
 * timestamp queries to 100 µs unless its WebGPU developer features are on). Needs a few values to say so.
 */
export function looksQuantized(times: readonly number[], step = 0.1): boolean {
  const v = times.filter((t) => t > 0)
  if (v.length < 4) return false
  return v.every((t) => Math.abs(t / step - Math.round(t / step)) < 1e-6)
}
