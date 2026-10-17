/// <reference types="vite/client" />
declare const __APP_VERSION__: string

/** The pinned Lensfun database this build serves (web/lensfun-plugin.ts). */
interface LensfunInfo {
  /** Path of the JSON file, relative to the site root. */
  file: string
  repo: string
  commit: string
  date: string
  licence: string
}
declare const __LENSFUN_DB__: LensfunInfo

/** The pinned copy of darktable's noise profiles this build serves (web/noiseprofiles-plugin.ts). */
interface NoiseProfilesInfo {
  /** Path of the JSON file, relative to the site root. */
  file: string
  repo: string
  commit: string
  date: string
  licence: string
}
declare const __NOISE_PROFILES__: NoiseProfilesInfo

/** The pinned AI models and their runtime this build serves (web/models-plugin.ts; src/ai/manifest.ts). */
declare const __LB_AI__: import('./ai/manifest').AiInfo
