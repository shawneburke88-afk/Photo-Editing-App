// What the Detail stage does for one photo at one scale: the settings resolved against the photo (its noise
// profile, white balance, size and measured radius) into the GPU kernels' parameters (engine/gpu/detail-stage.ts).
// Pure, for tests.

import type { RadiusChoice } from './capture'
import { denoiseRun, type DenoiseRun } from './denoise'
import { chooseProfile, type NoiseProfileData, type ProfileChoice } from './noiseprofiles'
import { autoThreshold, captureParams, denoiseCurves, noiseOn, sharpenOn, sharpenSigma, type DetailSettings } from './settings'

/** What the engine knows about the loaded photo for the Detail stage. */
export interface DetailMeta {
  maker: string
  model: string
  iso: number
  kind: 'raw' | 'rgb'
  /** The raw white level (darktable's raw_white_point; 255 for JPEGs), for the automatic contrast threshold. */
  white?: number
  /** EXIF f-number and crop factor (35 mm focal length / focal length), for the diffraction fallback radius. */
  fNumber?: number
  cropFactor?: number
}

/** Capture sharpening at one scale. */
export interface CaptureRun {
  /** The PSF's sigma at this level (full-size sigma × 2^-level). */
  sigma: number
  /** Iterations (fractional: ⌊n⌋ and ⌈n⌉ are mixed). */
  iterations: number
  /** Detail / 100. */
  halo: number
  /** darktable's contrast sensitivity. */
  threshold: number
}

export interface DetailRun {
  /** Identifies the result, for caching. */
  key: string
  /** 0 = full size; k = the scene at 1/2^k (its mip level k). */
  level: number
  denoise: DenoiseRun | null
  capture: CaptureRun | null
  /** Masking preview: the result is the input with the sharpening mask in alpha. */
  maskOnly: boolean
  /** The profile used (for the Noise Reduction section). */
  profile: ProfileChoice | null
  /** The radius used (for the Sharpening section). */
  radius: RadiusChoice | null
}

/** capture.c CAPTURE_CFACLIP: a photosite above 0.9 × its white-balance coefficient counts as clipped. */
export const CAPTURE_CFACLIP = 0.9

/**
 * The run for a photo at `level` (scale 1/2^level of `full`, the scene's full size). `wb` is the white balance the
 * scene was built with (green = 1; [1, 1, 1] for JPEGs). `profiles` is the downloaded profile data (null when not
 * available: the generic profile is used). `autoRadius` is the photo's automatic radius (measured, or the fallback).
 * Returns null when the Detail group changes nothing.
 */
export function detailRun(
  d: DetailSettings | undefined | null,
  meta: DetailMeta,
  wb: [number, number, number],
  full: [number, number],
  level: number,
  profiles: NoiseProfileData | null,
  autoRadius: RadiusChoice,
  maskPreview = false,
): DetailRun | null {
  if (!d) return null
  const scale = 2 ** -level
  const sharpen = sharpenOn(d) || maskPreview
  if (!sharpen && !noiseOn(d)) return null
  let capture: CaptureRun | null = null
  let radius: RadiusChoice | null = null
  if (sharpen) {
    const p = captureParams(d.sharpen, autoThreshold(meta.white ?? 255, meta.iso))
    // Radius multiplies the photo's automatic radius (each photo keeps its own).
    radius = { ...autoRadius, sigma: sharpenSigma(d.sharpen.radius, autoRadius.sigma), auto: autoRadius.sigma, multiplier: d.sharpen.radius }
    // The PSF at this level's pixels (darktable runs capture sharpening only at full size; a smaller preview of a
    // sharpened photo shows little of it).
    capture = { sigma: radius.sigma * scale, iterations: p.iterations, halo: p.halo, threshold: p.threshold }
  }
  let denoise: DenoiseRun | null = null
  let profile: ProfileChoice | null = null
  if (noiseOn(d)) {
    profile = chooseProfile(profiles, meta)
    denoise = denoiseRun(profile.profile, denoiseCurves(d.noise), wb, scale, full)
  }
  const key = JSON.stringify([level, wb, maskPreview, capture, denoise])
  return { key, level, denoise, capture, maskOnly: maskPreview, profile, radius }
}
