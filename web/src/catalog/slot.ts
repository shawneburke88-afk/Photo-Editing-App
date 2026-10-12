// Where the library lives in the browser's private storage (OPFS). There are two places ("slots"), each a catalog
// file and a thumbnail folder, and a small file names the one in use. Restoring a backup writes it into the other
// slot and switches only once everything is written and checked, so a failed restore leaves the library as it was.
// The slot no longer in use is removed the next time the catalog opens. Used by the catalog worker and the page.

export interface Slot {
  id: 'a' | 'b'
  /** The catalog's name in the SQLite storage pool (`installOpfsSAHPoolVfs`, directory `.lightbench-catalog`). */
  dbFile: string
  /** The thumbnail folder at the top of OPFS. */
  thumbsDir: string
}

/** Slot a is where every library was before backups existed. */
export const SLOTS: Record<Slot['id'], Slot> = {
  a: { id: 'a', dbFile: '/lightbench-catalog.sqlite3', thumbsDir: 'thumbnails' },
  b: { id: 'b', dbFile: '/lightbench-catalog-b.sqlite3', thumbsDir: 'thumbnails-b' },
}

const POINTER = 'lightbench-library-slot.json'

export const otherSlot = (s: Slot): Slot => (s.id === 'a' ? SLOTS.b : SLOTS.a)

/** The slot in use: slot a unless a restore switched to b. */
export async function activeSlot(): Promise<Slot> {
  const root = await navigator.storage.getDirectory()
  let text: string
  try {
    text = await (await (await root.getFileHandle(POINTER)).getFile()).text()
  } catch {
    return SLOTS.a
  }
  // Empty: created by a first switch whose write didn't complete, so the switch didn't happen.
  if (!text.trim()) return SLOTS.a
  let id: unknown
  try {
    id = (JSON.parse(text) as { slot?: unknown }).slot
  } catch {
    id = null
  }
  if (id !== 'a' && id !== 'b') throw new Error(`The record of where the library is stored is damaged (${POINTER} in the browser's storage).`)
  return SLOTS[id]
}

/** Switches to a slot. The browser replaces the file only when the write is closed, so it is all or nothing. */
export async function setActiveSlot(id: Slot['id']) {
  const root = await navigator.storage.getDirectory()
  const w = await (await root.getFileHandle(POINTER, { create: true })).createWritable()
  try {
    await w.write(JSON.stringify({ slot: id }))
    await w.close()
  } catch (err) {
    await w.abort().catch(() => {})
    throw err
  }
}

/** Removes a slot's thumbnail folder (the catalog file is removed by the worker, which owns the storage pool). */
export async function removeThumbsDir(slot: Slot) {
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(slot.thumbsDir, { recursive: true }).catch((err: DOMException) => {
    if (err.name !== 'NotFoundError') throw err
  })
}
