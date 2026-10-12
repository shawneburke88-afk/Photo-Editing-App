// Pure planning for Open folder: which files in a scanned folder still need adding to the library.

import { joinPath, type SourceFile } from '../import/plan'

/**
 * Returns the files that are not yet catalogued. `known` holds catalogued files as "folder/name" paths
 * relative to the library root, and `subPath` is the opened folder's path inside that root. JPEGs shot
 * alongside a RAW are included; they are stacked under the RAW once added (darktable-style, owner's choice).
 */
export function filesToAdd<T extends SourceFile>(files: T[], known: Set<string>, subPath: string): T[] {
  return files.filter((f) => !known.has(joinPath(subPath, f.dir, f.name)))
}
