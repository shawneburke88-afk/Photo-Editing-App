// Which sidecar file a photo reads and writes, when several files share a base name (RAW+JPEG twins).
//
// LightBench's rule (owner's choice, 2026-10-12; the rule is LightCraft's, crates/engine/src/sidecar.rs):
//  - Lightroom-style `NAME.xmp` belongs to one file of those sharing the base name: the RAW. When no RAW (or more
//    than one) shares it, the first by file name, ignoring case, so the choice never depends on the order photos
//    were added.
//  - Every other file uses darktable-style `NAME.ext.xmp` (`IMG_1.JPG.xmp`), so the twins never overwrite each other.
//  - A file alone with its base name owns `NAME.xmp`, as before.
//
// Why: Adobe's XMP specification names a sidecar after the file with its extension replaced by .xmp (XMP
// Specification Part 3, 2020, "External storage of metadata", p. 7), which is what Lightroom and Bridge write for
// raws; Adobe keeps a JPEG's settings inside the JPEG itself, so Adobe never needs a sidecar for the JPEG twin.
// darktable always writes `NAME.ext.xmp` for every file (src/common/image.c, dt_image_write_sidecar_file). Keeping
// `NAME.xmp` for the RAW keeps Lightroom/Bridge reading the raw's stars and keywords; giving the JPEG darktable's
// name keeps darktable reading it too.

/** Lightroom-style sidecar name: the file name with its extension replaced by .xmp. */
export function stemSidecarName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return `${dot > 0 ? fileName.slice(0, dot) : fileName}.xmp`
}

/** darktable-style sidecar name: the whole file name followed by .xmp. */
export const fullSidecarName = (fileName: string) => `${fileName}.xmp`

/** The base name ignoring case (the key twins share). */
export function stemKey(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return (dot > 0 ? fileName.slice(0, dot) : fileName).toLowerCase()
}

const isJpegName = (name: string) => /\.jpe?g$/i.test(name)

/** Sort key: a RAW first (everything LightBench opens that isn't a JPEG is a RAW), then the name ignoring case. */
const rank = (name: string): [number, string, string] => [isJpegName(name) ? 1 : 0, name.toLowerCase(), name]

/** Of files sharing a base name (in one folder), the one that owns `NAME.xmp`. */
export function stemOwner(names: string[]): string | undefined {
  let best: string | undefined
  for (const n of names) {
    if (best === undefined) {
      best = n
      continue
    }
    const a = rank(n)
    const b = rank(best)
    if (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))) best = n
  }
  return best
}

/** Whether `fileName` owns `NAME.xmp` among the files in its folder (`folderNames`, which may include it). */
export function ownsStem(fileName: string, folderNames: Iterable<string>): boolean {
  const key = stemKey(fileName)
  const twins = [fileName]
  for (const n of folderNames) if (n !== fileName && stemKey(n) === key) twins.push(n)
  return stemOwner(twins) === fileName
}

/** The sidecar a photo writes. */
export const sidecarFor = (fileName: string, owner: boolean) => (owner ? stemSidecarName(fileName) : fullSidecarName(fileName))

/**
 * The sidecar names a photo reads, in order: its own, then (for the owner) darktable's `NAME.ext.xmp`, which is only
 * read, as before. A file that doesn't own `NAME.xmp` never takes it as its own (that is its twin's).
 */
export const sidecarCandidates = (fileName: string, owner: boolean) => (owner ? [stemSidecarName(fileName), fullSidecarName(fileName)] : [fullSidecarName(fileName)])

/** Owner of each file among `files` (grouped by folder), keyed by `${dir}/${name}`. */
export function stemOwners(files: { dir: string; name: string }[]): Set<string> {
  const groups = new Map<string, string[]>()
  for (const f of files) {
    const k = `${f.dir}/${stemKey(f.name)}`
    const g = groups.get(k)
    if (g) g.push(f.name)
    else groups.set(k, [f.name])
  }
  const out = new Set<string>()
  for (const [k, names] of groups) {
    const dir = k.slice(0, k.lastIndexOf('/'))
    const owner = stemOwner(names)
    if (owner !== undefined) out.add(`${dir}/${owner}`)
  }
  return out
}
