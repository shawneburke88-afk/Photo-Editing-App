// What the diagnostics log may say about a photo and an edit: a number for the photo (per session), its camera model,
// kind and pixel size, and which settings changed to what. Never a file name, a folder, a path or pixels.

/** Numbers photos in the order they are first seen this session (1, 2, …). */
export class PhotoNumbers {
  private ids = new Map<unknown, number>()
  number(id: unknown): number {
    let n = this.ids.get(id)
    if (n === undefined) {
      n = this.ids.size + 1
      this.ids.set(id, n)
    }
    return n
  }
}

export function photoSummary(n: number, p: { make?: string; model?: string; raw: boolean; width?: number; height?: number }): Record<string, unknown> {
  const make = (p.make ?? '').trim()
  const model = (p.model ?? '').trim()
  return {
    photo: n,
    camera: model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`.trim(),
    kind: p.raw ? 'RAW' : 'JPEG',
    size: p.width && p.height ? `${p.width}x${p.height}` : '',
  }
}

/**
 * The settings that differ between two edits, as paths and new values ("detail.noise.luminance": 30), at most `max`
 * of them. Lists (spots, masks, curve points) are given by their length only.
 */
export function settingsChange(prev: unknown, next: unknown, max = 12): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let n = 0
  const walk = (a: unknown, b: unknown, path: string, depth: number) => {
    if (n >= max || a === b) return
    if (Array.isArray(b) || Array.isArray(a)) {
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        out[path] = Array.isArray(b) ? `[${b.length}]` : summary(b)
        n++
      }
      return
    }
    if (b && typeof b === 'object' && a && typeof a === 'object' && depth < 4) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)])
      for (const k of keys) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k, depth + 1)
      return
    }
    out[path || '.'] = summary(b)
    n++
  }
  walk(prev, next, '', 0)
  return out
}

function summary(v: unknown): unknown {
  if (v === undefined) return null
  if (typeof v === 'number') return Math.round(v * 1000) / 1000
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 40)}…` : v
  if (v && typeof v === 'object') return Array.isArray(v) ? `[${v.length}]` : '{…}'
  return v
}
