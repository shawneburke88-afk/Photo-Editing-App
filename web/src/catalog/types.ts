/** Shapes shared between the catalog worker and the UI. */

export type Flag = -1 | 0 | 1 // rejected, none, picked
export type ColorLabel = 0 | 1 | 2 | 3 | 4 | 5 // none, red, yellow, green, blue, purple

export interface LibraryRoot {
  id: number
  name: string
}

export interface FolderNode {
  id: number
  rootId: number
  /** Path relative to the root, using "/"; "" is the root itself. */
  path: string
  /** Photos directly in this folder. */
  count: number
}

/** Metadata captured at import time. */
export interface PhotoMeta {
  fileName: string
  fileSize: number
  fileModified: number
  /** Camera-local capture time as Unix seconds read in UTC (0 if unknown). */
  capturedAt: number
  fileType: string
  cameraMake: string
  cameraModel: string
  lens: string
  iso: number
  shutter: number
  aperture: number
  focalLength: number
  width: number
  height: number
  /** LibRaw orientation code: 0, 3 (180°), 5 (90° CCW), 6 (90° CW). */
  orientation: number
}

export interface NewPhoto extends PhotoMeta {
  rootId: number
  folderPath: string
  /** File name on the card before any renaming (used for duplicate detection). */
  originalName: string
}

/** Compact row for grids. */
export interface PhotoRow {
  id: number
  fileName: string
  capturedAt: number
  rating: number
  flag: Flag
  color: ColorLabel
  orientation: number
  /** Has develop edits. */
  edited: boolean
  /** In the Quick Collection. */
  quick: boolean
  /** 0 for the original; 1, 2… for virtual copies. */
  version: number
  /** A virtual copy's name ("Copy 1", or what the user called it); null for the original. */
  versionName: string | null
  /** Stack this photo belongs to (null: none). */
  stackId: number | null
  /** Photos in its stack (0 when not stacked). */
  stackSize: number
  stackTop: boolean
  stackExpanded: boolean
}

export interface PhotoDetail extends PhotoMeta {
  id: number
  rootId: number
  folderId: number
  folderPath: string
  originalName: string
  importedAt: number
  rating: number
  flag: Flag
  color: ColorLabel
  version: number
  versionName: string | null
}

export interface PhotoQuery {
  /** Only these photos (e.g. those whose sidecar another app changed). */
  ids?: number[]
  /** Limit to one folder of a root ("" = the root itself); subfolders are included unless `recursive` is false. */
  folder?: { rootId: number; path: string; recursive?: boolean }
  minRating?: number
  flag?: 'picked' | 'rejected' | 'unflagged' | 'notRejected'
  color?: ColorLabel
  /** Show every photo of collapsed stacks too (default: one photo per collapsed stack). */
  ungrouped?: boolean
  /** Collection id: a manual collection's photos, or a smart collection's matches. */
  collection?: number
  /** Keyword path; photos with it or any keyword below it. */
  keyword?: string
  text?: string
  sort?: 'captureAsc' | 'captureDesc' | 'name'
}

/** Key used to recognise a photo that was already imported (Lightroom's "suspected duplicate" test). */
export interface DuplicateKey {
  originalName: string
  capturedAt: number
  fileSize: number
}

/**
 * Descriptive metadata a photo carries (the IPTC Core fields LightBench edits). '' = not set. Written to sidecars
 * and exports as XMP (sidecar/xmp.ts METADATA_XMP lists the properties).
 */
export interface PhotoMetadata {
  title: string
  caption: string
  creator: string
  copyright: string
  copyrightUrl: string
  headline: string
  city: string
  state: string
  country: string
}

export type MetadataKey = keyof PhotoMetadata

export interface CollectionInfo {
  id: number
  name: string
  kind: 'manual' | 'smart' | 'quick'
  count: number
  /** Smart collections only. */
  rules?: import('./smart').SmartRules
}
