// What the Detail stage does for one photo at one scale: the settings resolved against the photo (its noise
// profile, white balance and size) into the GPU kernels' parameters (engine/gpu/detail-stage.ts). Pure, for tests.

import { denoiseRun, type DenoiseRun } from './denoise'
import { chooseProfile, type NoiseProfileData, type ProfileChoice } from './noiseprofiles'
import { denoiseCurves, noiseOn, sharpenOn, sharpenParams, type DetailSettings } from './settings'

/** What the engine knows about the loaded photo for noise reduction. */
export interface DetailMeta {
  maker: string
  model: string
  iso: number
  kind: 'raw' | 'rgb'
}

/** The interim sharpening at one scale (darktable sharpen.c: sigma and window follow the roi scale). */
export interface SharpenRun {
  sigma2: number
  rad: number
  amount: number
  threshold: number
  /** capture.c's contrast sensitivity. */
  cs: number
}

export interface DetailRun {
  /** Identifies the result, for caching. */
  key: string
  /** 0 = full size; k = the scene at 1/2^k (its mip level k). */
  level: number
  sharpen: SharpenRun | null
  denoise: DenoiseRun | null
  /** Masking preview: only the sharpening mask is computed (in alpha), the picture is left alone. */
  maskOnly: boolean
  /** The profile used (for the Noise Reduction section). */
  profile: ProfileChoice | null
}

/** capture.c CAPTURE_CFACLIP: a photosite above 0.9 × its white-balance coefficient counts as clipped. */
export const CAPTURE_CFACLIP = 0.9

/**
 * The run for a photo at `level` (scale 1/2^level of `full`, the scene's full size). `wb` is the white balance the
 * scene was built with (green = 1; [1, 1, 1] for JPEGs). `profiles` is the downloaded profile data (null when not
 * available: the generic profile is used). Returns null when the Detail group changes nothing.
 */
export function detailRun(d: DetailSettings | undefined | null, meta: DetailMeta, wb: [number, number, number], full: [number, number], level: number, profiles: NoiseProfileData | null, maskPreview = false): DetailRun | null {
  const scale = 2 ** -level
  if (maskPreview && d) {
    const cs = sharpenParams(d.sharpen).mask
    return { key: `mask|${level}|${cs}|${wb.join(',')}`, level, sharpen: { sigma2: 0, rad: 0, amount: 0, threshold: 0, cs }, denoise: null, maskOnly: true, profile: null }
  }
  if (!d || (!sharpenOn(d) && !noiseOn(d))) return null
  let sharpen: SharpenRun | null = null
  if (sharpenOn(d)) {
    const p = sharpenParams(d.sharpen)
    // darktable sharpen.c: rad = ceil(2.5 · radius · scale), at most 12; sigma = radius · scale (lines 258, 282).
    const sigma = p.sigma * scale
    const rad = Math.min(12, Math.ceil(2.5 * sigma))
    if (rad > 0) sharpen = { sigma2: sigma * sigma, rad, amount: p.amount, threshold: p.threshold, cs: p.mask }
  }
  let denoise: DenoiseRun | null = null
  let profile: ProfileChoice | null = null
  if (noiseOn(d)) {
    profile = chooseProfile(profiles, meta)
    denoise = denoiseRun(profile.profile, denoiseCurves(d.noise), wb, scale, full)
  }
  if (!sharpen && !denoise) return null
  const key = JSON.stringify([level, wb, sharpen, denoise])
  return { key, level, sharpen, denoise, maskOnly: false, profile }
}
