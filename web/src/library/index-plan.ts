// Pure planning for Open folder: which files in a scanned folder still need adding to the library.

import { findRawJpegPairs, joinPath, type SourceFile } from '../import/plan'

/**
 * Returns the files that are not yet catalogued. `known` holds catalogued files as "folder/name" paths
 * relative to the library root, and `subPath` is the opened folder's path inside that root.
 * JPEGs shot alongside a RAW of the same name are left out, as the importer does by default: the RAW is
 * the photo (darktable likewise makes the RAW the representative of such a group).
 */
export function filesToAdd<T extends SourceFile>(files: T[], known: Set<string>, subPath: string): T[] {
  const companions = findRawJpegPairs(files)
  return files.filter((f, i) => !companions.has(i) && !known.has(joinPath(subPath, f.dir, f.name)))
}
