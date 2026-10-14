// The Colour Grading group's view (remembered in this browser): 3-Way or one wheel, large.

import type { WheelKey } from '../engine/develop/colour-grading'

export type GradingView = '3way' | WheelKey
export const DEFAULT_GRADING_VIEW: { view: GradingView } = { view: '3way' }
