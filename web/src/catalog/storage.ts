// Problems with the browser storage that holds the library (the catalog and thumbnails), shown as small notices:
//  - the browser didn't agree to keep it when disk space runs low (navigator.storage.persist() said no);
//  - a change couldn't be saved to the catalog (disk full, storage error).
// Notices can be hidden. A hidden failure notice comes back only for a failure at least a minute later, so a
// broken disk doesn't bring it back on every click.

const PERSIST_HIDDEN_KEY = 'storage:persist-notice-hidden'
/** How long "OK" hides the persistent-storage notice in this browser. */
const PERSIST_HIDE_MS = 30 * 24 * 60 * 60 * 1000
/** A hidden failure notice stays hidden for failures within this time. */
export const QUIET_MS = 60 * 1000

export interface StorageStatus {
  /** The browser may clear the library when space runs low (and the notice isn't hidden). */
  notPersistent: boolean
  /** The last change that couldn't be saved to the catalog, and how many failed since the notice was last hidden. */
  catalogError: { message: string; count: number } | null
}

function persistHidden(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(PERSIST_HIDDEN_KEY) ?? 0) < PERSIST_HIDE_MS
  } catch {
    return false
  }
}

class StorageProblems {
  status: StorageStatus = { notPersistent: false, catalogError: null }
  private listeners = new Set<() => void>()
  private quietUntil = 0
  private hiddenCount = 0
  private persistNoticeHidden = false

  /** The answer to navigator.storage.persist(). */
  setPersistent(granted: boolean) {
    const notPersistent = !granted && !this.persistNoticeHidden && !persistHidden()
    if (notPersistent !== this.status.notPersistent) this.set({ notPersistent })
  }

  hidePersistNotice() {
    this.persistNoticeHidden = true
    try {
      localStorage.setItem(PERSIST_HIDDEN_KEY, String(Date.now()))
    } catch {
      // Hidden for this visit only.
    }
    this.set({ notPersistent: false })
  }

  /** A catalog request failed because storage failed. */
  catalogFailed(message: string, now = Date.now()) {
    if (!this.status.catalogError && now < this.quietUntil) {
      this.hiddenCount++
      return
    }
    const count = (this.status.catalogError?.count ?? 0) + this.hiddenCount + 1
    this.hiddenCount = 0
    this.set({ catalogError: { message, count } })
  }

  hideCatalogError(now = Date.now()) {
    this.quietUntil = now + QUIET_MS
    this.set({ catalogError: null })
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  get = (): StorageStatus => this.status

  private set(patch: Partial<StorageStatus>) {
    this.status = { ...this.status, ...patch }
    for (const fn of this.listeners) fn()
  }
}

export const storageProblems = new StorageProblems()
