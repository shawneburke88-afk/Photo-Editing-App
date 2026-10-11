import type { PhotoMeta } from '../catalog/types'

const pad = (n: number) => String(n).padStart(2, '0')

/** Camera-local capture time (stored as UTC seconds) → "10 Oct 2026, 08:21". */
export function captureText(seconds: number): string {
  if (!seconds) return 'Unknown'
  const d = new Date(seconds * 1000)
  const month = d.toLocaleString(undefined, { month: 'short', timeZone: 'UTC' })
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

export function exposureText(m: Pick<PhotoMeta, 'shutter' | 'aperture' | 'iso' | 'focalLength'>): string {
  const parts: string[] = []
  if (m.shutter) parts.push(m.shutter >= 0.3 ? `${Number(m.shutter.toFixed(1))} s` : `1/${Math.round(1 / m.shutter)} s`)
  if (m.aperture) parts.push(`f/${Number(m.aperture.toFixed(1))}`)
  if (m.iso) parts.push(`ISO ${m.iso}`)
  if (m.focalLength) parts.push(`${Math.round(m.focalLength)} mm`)
  return parts.join('  ·  ') || 'Not recorded'
}

export const COLOR_NAMES = ['None', 'Red', 'Yellow', 'Green', 'Blue', 'Purple'] as const
