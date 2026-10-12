// Tells the rest of the app which photos were just added to the library (by Open folder or Import), after their
// sidecars were read. Used to develop new photos with the preset chosen for them.

type Listener = (ids: number[]) => void

const listeners = new Set<Listener>()

export const photosAdded = {
  emit(ids: number[]) {
    if (ids.length) listeners.forEach((fn) => fn(ids))
  },
  subscribe(fn: Listener) {
    listeners.add(fn)
    return () => void listeners.delete(fn)
  },
}
