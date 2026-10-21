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
  /** Where it was taken (EXIF GPS): degrees north and east, metres above sea level; null or absent when not recorded. */
  gpsLat?: number | null
  gpsLon?: number | null
  gpsAlt?: number | null
}

export interface NewPhoto extends PhotoMeta {
  rootId: number
  folderPath: string
  /** File name on the card before any renaming (used for duplicate detection). */
  originalName: string
  /**
   * Import: what is still to be applied to the new photo in the background (import/details.ts), as JSON. Kept in
   * `import_pending` with the photo, in the same transaction, so a closed tab resumes it on the next start.
   */
  importDetails?: string
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
  /** Culling helpers (docs/PHASE3.md Part 18): what the analysis says; null or absent when not analysed yet. */
  cull?: import('./analysis').CullInfo | null
  /** Not measured yet (the background pass will), or its preview couldn't be measured; absent once measured. */
  analysisState?: 'pending' | 'failed'
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
  /** Capture time, file name, or sharpness (relative to photos from the same camera at a similar ISO; Part 18). */
  sort?: 'captureAsc' | 'captureDesc' | 'name' | 'sharpDesc' | 'sharpAsc'
  /**
   * Culling helpers' filter: possibly soft (also shake, or clearly softer than the best of its stack or look-alikes),
   * the rest of the analysed photos, suggested rejects, look-alikes of a sharper photo, or not analysed yet.
   */
  cull?: 'soft' | 'notSoft' | 'suggested' | 'duplicates' | 'unanalysed'
  /** Which reasons count as suggested rejects (default: catalog/analysis.ts DEFAULT_SUGGEST). */
  suggest?: import('./analysis').SuggestOptions
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
