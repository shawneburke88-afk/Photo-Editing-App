// Thumbnail cache in the browser's private storage, so the library grid works even when the
// photo folders are not connected.

const DIR = 'thumbnails'
let dirPromise: Promise<FileSystemDirectoryHandle> | null = null

function dir() {
  dirPromise ??= navigator.storage.getDirectory().then((root) => root.getDirectoryHandle(DIR, { create: true }))
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

export function forgetThumbUrl(photoId: number) {
  const url = urls.get(photoId)
  if (url) URL.revokeObjectURL(url)
  urls.delete(photoId)
}
