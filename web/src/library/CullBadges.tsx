import type { CullInfo } from '../catalog/analysis'
import { badgesFor, useCullPrefs } from './cull-badges'

/**
 * The culling helpers' badges for one photo (docs/PHASE3.md Part 18): kept apart from its flag, rating and labels.
 * Each says why in its tooltip (and to screen readers).
 */
export function CullBadges({ row, className = '' }: { row: { flag: number; cull?: CullInfo | null; analysisState?: 'pending' | 'failed' }; className?: string }) {
  const prefs = useCullPrefs()
  const badges = badgesFor(row, prefs)
  if (!badges.length) return null
  return (
    <span className={`cull-badges ${className}`}>
      {badges.map((b) => (
        <span key={b.kind} className={`cull-badge cb-${b.kind}`} title={b.reason} aria-label={b.reason} role="note">
          {b.text}
        </span>
      ))}
    </span>
  )
}
