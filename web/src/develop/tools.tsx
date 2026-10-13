// Shared pieces of the Develop tool stack: group icons and the crop overlays.

import type { ReactNode } from 'react'

export type CropOverlayKind = 'thirds' | 'grid' | 'golden' | 'diagonals'

/** The overlays O cycles through, in order. */
export const CROP_OVERLAYS: { id: CropOverlayKind; label: string }[] = [
  { id: 'thirds', label: 'Thirds' },
  { id: 'grid', label: 'Grid' },
  { id: 'golden', label: 'Golden ratio' },
  { id: 'diagonals', label: 'Diagonals' },
]

/** Icons for the groups, 16 px, drawn with the text colour. */
export const GROUP_ICONS: Record<'crop' | 'basic' | 'detail', ReactNode> = {
  crop: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.6" d="M4 1v10.5h10.5M1 4.5h10.5V15" />
    </svg>
  ),
  basic: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" d="M2 4h12M2 8h12M2 12h12" />
      <circle cx="6" cy="4" r="1.8" fill="currentColor" />
      <circle cx="11" cy="8" r="1.8" fill="currentColor" />
      <circle cx="4.5" cy="12" r="1.8" fill="currentColor" />
    </svg>
  ),
  // A magnifier over a fine grid: detail (sharpening and noise).
  detail: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M10 10l4.5 4.5" />
      <path stroke="currentColor" strokeWidth="1" d="M4.5 4.5h4M4.5 6.5h4M4.5 8.5h4" />
    </svg>
  ),
}

