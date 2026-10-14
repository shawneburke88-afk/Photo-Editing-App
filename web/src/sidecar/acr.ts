// Lightroom's `.acr` sidecar (docs/PHASE3.md Part 23; owner's decision 8). Adobe: "If heavy edits are applied to an
// image, Lightroom will create an XMP and an ACR file to store the metadata … Lightroom identifies if there are any heavy
// edits, masks, or AI settings like Super Resolution … It writes the heavy edits to the ACR sidecar while keeping the XMP
// sidecar lightweight" (helpx.adobe.com, "Create XMP and ACR files", updated 2025-10-27; read by Cowork,
// docs/research/cowork-2026-10-13b/B_MASKING.md item 4i). The .acr format isn't documented, so LightBench can't read it:
// it only says the file is there, so masks missing from the photo aren't a surprise.

import { getDirAt, getRootHandle } from '../platform/roots'

/** The .acr name Lightroom gives a photo's sidecar: as the .xmp, the file name with its extension replaced (assumed). */
export function acrName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return `${dot > 0 ? fileName.slice(0, dot) : fileName}.acr`
}

/** Whether a name in a folder listing is the photo's .acr sidecar (any case). */
export const isAcrFor = (photo: string, name: string) => name.toLowerCase() === acrName(photo).toLowerCase()

/** True when the photo's folder holds a Lightroom .acr file for it (false when the folder isn't connected). */
export async function hasAcrSidecar(rootId: number, folderPath: string, fileName: string): Promise<boolean> {
  const root = await getRootHandle(rootId)
  if (!root || (await root.queryPermission({ mode: 'read' })) !== 'granted') return false
  try {
    const dir = await getDirAt(root, folderPath)
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) if (isAcrFor(fileName, name)) return true
  } catch {
    // The folder isn't there: nothing to say.
  }
  return false
}
