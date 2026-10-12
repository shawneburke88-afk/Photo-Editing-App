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
