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
export const GROUP_ICONS: Record<'crop' | 'remove' | 'basic' | 'curve' | 'colour' | 'detail', ReactNode> = {
  crop: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.6" d="M4 1v10.5h10.5M1 4.5h10.5V15" />
    </svg>
  ),
  // A spot (solid) and its source (dashed), joined.
  remove: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="10.5" cy="5.5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="5" cy="11" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.6" />
      <path stroke="currentColor" strokeWidth="1.3" d="M7.3 8.7 8 8" />
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
  curve: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" d="M1.5 14.5h13M1.5 14.5v-13" />
      <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" d="M2 14C6 13.5 6.5 9 8 8s2.5-5.5 6-6" />
    </svg>
  ),
  // A colour wheel in three parts: the Colour Mixer.
  colour: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path stroke="currentColor" strokeWidth="1.3" d="M8 8V1.7M8 8l5.45 3.15M8 8l-5.45 3.15" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" />
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

