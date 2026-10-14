// Tells Develop that a photo's snapshots changed outside it (Read changes, or a sidecar's snapshots taken into the
// library before it is rewritten), so the Snapshots panel shows the catalog's list again.

const listeners = new Set<(photoId: number) => void>()

export const snapshotsChanged = {
  emit: (photoId: number) => listeners.forEach((fn) => fn(photoId)),
  subscribe(fn: (photoId: number) => void) {
    listeners.add(fn)
    return () => void listeners.delete(fn)
  },
}
