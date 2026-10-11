// darktable "sigmoid" display transform parameters.
//
// Translated from darktable's src/iop/sigmoid.c commit_params() (darktable developers,
// GPL-3.0-or-later). Computes the generalised log-logistic curve so that:
//   f(0) = display black target, f(middle grey) = middle grey, f(∞) = display white target,
// with the slope at middle grey set by `contrast` and independent of `skew`.

export const MIDDLE_GREY = 0.1845

export interface SigmoidParams {
  /** darktable "contrast" (middle_grey_contrast), default 1.5. */
  contrast: number
  /** darktable "skew" (contrast_skewness), −1…1, default 0. */
  skew: number
  /** darktable "target white" in %, default 100. */
  whiteTarget: number
  /** darktable "target black" in %, default 0.0152. */
  blackTarget: number
}

export const SIGMOID_DEFAULTS: SigmoidParams = { contrast: 1.5, skew: 0, whiteTarget: 100, blackTarget: 0.0152 }

export interface SigmoidCurve {
  whiteTarget: number
  blackTarget: number
  paperExp: number
  filmFog: number
  filmPower: number
  paperPower: number
}

export function loglogistic(value: number, magnitude: number, paperExp: number, filmFog: number, filmPower: number, paperPower: number): number {
  const film = (filmFog + Math.max(value, 0)) ** filmPower
  const paper = magnitude * (film / (paperExp + film)) ** paperPower
  return Number.isNaN(paper) ? magnitude : paper
}

export function sigmoidCurve(p: SigmoidParams): SigmoidCurve {
  const delta = 1e-6
  const refFilmPower = p.contrast
  const refPaperExp = MIDDLE_GREY ** refFilmPower * (1 / MIDDLE_GREY - 1)
  const refSlope =
    (loglogistic(MIDDLE_GREY + delta, 1, refPaperExp, 0, refFilmPower, 1) -
      loglogistic(MIDDLE_GREY - delta, 1, refPaperExp, 0, refFilmPower, 1)) / 2 / delta

  const paperPower = 5 ** -p.skew

  const tempWhite = 0.01 * p.whiteTarget
  const tempWhiteGrey = (tempWhite / MIDDLE_GREY) ** (1 / paperPower) - 1
  const tempPaperExp = MIDDLE_GREY * tempWhiteGrey
  const tempSlope =
    (loglogistic(MIDDLE_GREY + delta, tempWhite, tempPaperExp, 0, 1, paperPower) -
      loglogistic(MIDDLE_GREY - delta, tempWhite, tempPaperExp, 0, 1, paperPower)) / 2 / delta

  const filmPower = refSlope / tempSlope
  const whiteTarget = 0.01 * p.whiteTarget
  const blackTarget = 0.01 * p.blackTarget
  const whiteGrey = (whiteTarget / MIDDLE_GREY) ** (1 / paperPower) - 1
  const whiteBlack = (blackTarget / whiteTarget) ** (-1 / paperPower) - 1
  const filmFog =
    (MIDDLE_GREY * whiteGrey ** (1 / filmPower)) / (whiteBlack ** (1 / filmPower) - whiteGrey ** (1 / filmPower))
  const paperExp = (filmFog + MIDDLE_GREY) ** filmPower * whiteGrey
  return { whiteTarget, blackTarget, paperExp, filmFog, filmPower, paperPower }
}
