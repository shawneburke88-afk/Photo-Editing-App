// Thumbnail cache in the browser's private storage, so the library grid works even when the
// photo folders are not connected. The folder is the library slot's (slot.ts; "thumbnails" unless a restore moved it).

import { activeSlot } from './slot'

let dirPromise: Promise<FileSystemDirectoryHandle> | null = null

function dir() {
  dirPromise ??= Promise.all([navigator.storage.getDirectory(), activeSlot()]).then(([root, slot]) => root.getDirectoryHandle(slot.thumbsDir, { create: true }))
  return dirPromise
}

export async function saveThumb(photoId: number, jpeg: Uint8Array<ArrayBuffer>) {
  const fh = await (await dir()).getFileHandle(`${photoId}.jpg`, { create: true })
  const w = await fh.createWritable()
  await w.write(jpeg)
  await w.close()
}

export async function loadThumb(photoId: number): Promise<Blob | null> {
  try {
    return await (await (await dir()).getFileHandle(`${photoId}.jpg`)).getFile()
  } catch {
    return null
  }
}

export async function deleteThumbs(photoIds: number[]) {
  const d = await dir()
  await Promise.all(photoIds.map((id) => d.removeEntry(`${id}.jpg`).catch(() => {})))
}

/** Small LRU of object URLs so scrolling the grid doesn't re-read files constantly. */
const urls = new Map<number, string>()
const MAX_URLS = 600

export async function thumbUrl(photoId: number): Promise<string | null> {
  const hit = urls.get(photoId)
  if (hit) {
    urls.delete(photoId)
    urls.set(photoId, hit)
    return hit
  }
  const blob = await loadThumb(photoId)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  urls.set(photoId, url)
  if (urls.size > MAX_URLS) {
    const [oldId, oldUrl] = urls.entries().next().value!
    urls.delete(oldId)
    URL.revokeObjectURL(oldUrl)
  }
  return url
}

/**
 * A photo's thumbnail in an object URL of the caller's own, for an image shown for a while outside the grid (Develop's
 * placeholder): the cache's URLs above are revoked when a thumbnail is replaced (`forgetThumbUrl`, after a save) or the
 * cache is full, and an `<img>` given one later fails (`ERR_FILE_NOT_FOUND`). `show` gets the URL once it is read. The
 * returned function stops it: a read still running is dropped; a URL already shown is taken back (`show(null)`) and
 * revoked. Call it once the URL is off the page (React: an effect's cleanup, after the render that stopped showing it).
 */
export function holdThumbUrl(photoId: number, show: (url: string | null) => void, load: (id: number) => Promise<Blob | null> = loadThumb): () => void {
  let url: string | null = null
  let stopped = false
  void load(photoId).then(
    (blob) => {
      if (stopped || !blob) return
      url = URL.createObjectURL(blob)
      show(url)
    },
    () => {},
  )
  return () => {
    stopped = true
    if (!url) return
    show(null)
    URL.revokeObjectURL(url)
    url = null
  }
}

/** Fires `thumbchange` (detail = photo id) when a thumbnail is replaced, so visible ones reload. */
export const thumbEvents = new EventTarget()

export function forgetThumbUrl(photoId: number) {
  const url = urls.get(photoId)
  urls.delete(photoId)
  thumbEvents.dispatchEvent(new CustomEvent('thumbchange', { detail: photoId }))
  // Revoke after listeners have swapped to the new URL.
  if (url) setTimeout(() => URL.revokeObjectURL(url), 1000)
}
