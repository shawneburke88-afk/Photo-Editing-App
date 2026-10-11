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
}

export interface PhotoQuery {
  /** Limit to one folder of a root ("" = the root itself), including its subfolders. */
  folder?: { rootId: number; path: string }
  minRating?: number
  flag?: 'picked' | 'rejected' | 'unflagged' | 'notRejected'
  color?: ColorLabel
  text?: string
  sort?: 'captureAsc' | 'captureDesc' | 'name'
}

/** Key used to recognise a photo that was already imported (Lightroom's "suspected duplicate" test). */
export interface DuplicateKey {
  originalName: string
  capturedAt: number
  fileSize: number
}
