// Import timings (owner's decision 1 of 2026-10-20, docs/PHASE3.md "Import speed"): how long each step of an import
// took, per photo and in total, for the Diagnostics log (diagnostics/recorder.ts) and the short line in the Import
// window's finished state. Steps of photos copied at the same time overlap, so a step's share is of the summed step
// time (the work done), and the wall-clock time is kept separately.

/** The steps of importing one photo, in the order they happen. */
export const STEPS = ['read', 'hash', 'write', 'verify', 'backup', 'sidecar', 'catalog', 'thumbnail', 'stacking'] as const
export type Step = (typeof STEPS)[number]
export type StepTimes = Partial<Record<Step, number>>

/** Groups shown in the summary line ("copying 71 %"): what a person would call the work. */
export const GROUPS: { label: string; steps: Step[] }[] = [
  { label: 'copying', steps: ['read', 'hash', 'write'] },
  { label: 'verifying', steps: ['verify'] },
  { label: 'backup', steps: ['backup'] },
  { label: 'sidecars', steps: ['sidecar'] },
  { label: 'library', steps: ['catalog'] },
  { label: 'thumbnails', steps: ['thumbnail'] },
  { label: 'stacking', steps: ['stacking'] },
]

/** Adds the time `fn` takes to `t[step]`. */
export async function timed<T>(t: StepTimes | undefined, step: Step, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    if (t) t[step] = (t[step] ?? 0) + (performance.now() - start)
  }
}

export interface TimingTotals {
  photos: number
  bytes: number
  wallMs: number
  /** MB (10^6 bytes) copied per second of wall-clock time. */
  mbPerS: number
  /** Summed ms per step (rounded). */
  steps: Record<Step, number>
  /** Each step's percentage of the summed step time (rounded). */
  shares: Record<Step, number>
}

/** Collects the step times of the photos of one import. */
export class ImportTiming {
  readonly steps = Object.fromEntries(STEPS.map((s) => [s, 0])) as Record<Step, number>
  photos = 0
  bytes = 0

  add(t: StepTimes, bytes: number) {
    this.photos++
    this.bytes += bytes
    for (const s of STEPS) this.steps[s] += t[s] ?? 0
  }

  totals(wallMs: number): TimingTotals {
    const sum = STEPS.reduce((n, s) => n + this.steps[s], 0)
    const round = (x: number) => Math.round(x)
    return {
      photos: this.photos,
      bytes: this.bytes,
      wallMs: round(wallMs),
      mbPerS: wallMs > 0 ? Math.round((this.bytes / 1e6 / (wallMs / 1000)) * 10) / 10 : 0,
      steps: Object.fromEntries(STEPS.map((s) => [s, round(this.steps[s])])) as Record<Step, number>,
      shares: Object.fromEntries(STEPS.map((s) => [s, sum > 0 ? round((this.steps[s] / sum) * 100) : 0])) as Record<Step, number>,
    }
  }
}

/** Per-photo step times for the log: whole milliseconds, steps that took no time left out. */
export function roundTimes(t: StepTimes): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of STEPS) if (t[s] !== undefined) out[s] = Math.round(t[s]!)
  return out
}

const count = (n: number) => n.toLocaleString('en-US')

/** "38 GB", "5.2 GB", "740 MB" (powers of 1000, as disks are sold). */
export function sizeText(bytes: number): string {
  if (bytes >= 1e9) return `${bytes >= 1e10 ? Math.round(bytes / 1e9) : Math.round(bytes / 1e8) / 10} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / 1e3))} KB`
}

/** "6 min 12 s", "45 s", "1 h 3 min", "0.4 s". */
export function durationText(ms: number): string {
  const s = ms / 1000
  if (s < 10) return `${Math.round(s * 10) / 10} s`
  const whole = Math.round(s)
  if (whole < 60) return `${whole} s`
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  if (h) return `${h} h ${m} min`
  return `${m} min ${whole % 60} s`
}

/**
 * The finished state's line: "1,500 photos, 38 GB in 6 min 12 s · copying 71 % · thumbnails 18 %", with the two
 * largest groups of the work (only those of at least 5 %).
 */
export function summaryLine(t: TimingTotals): string {
  const head = `${count(t.photos)} ${t.photos === 1 ? 'photo' : 'photos'}, ${sizeText(t.bytes)} in ${durationText(t.wallMs)}`
  const groups = GROUPS.map((g) => ({ label: g.label, share: g.steps.reduce((n, s) => n + t.shares[s], 0) }))
    .filter((g) => g.share >= 5)
    .sort((a, b) => b.share - a.share)
    .slice(0, 2)
  return [head, ...groups.map((g) => `${g.label} ${g.share} %`)].join(' · ')
}
