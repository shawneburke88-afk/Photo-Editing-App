import { describe, expect, it } from 'vitest'
import { isStorageFailure } from './errors'
import { QUIET_MS, storageProblems } from './storage'

describe('storage problems', () => {
  it('recognises storage failures, not ordinary request errors', () => {
    expect(isStorageFailure({ resultCode: 13 })).toBe(true) // SQLITE_FULL
    expect(isStorageFailure({ resultCode: 778 })).toBe(true) // SQLITE_IOERR_WRITE
    expect(isStorageFailure({ resultCode: 8 })).toBe(true) // SQLITE_READONLY
    expect(isStorageFailure({ resultCode: 19 })).toBe(false) // SQLITE_CONSTRAINT
    expect(isStorageFailure({ resultCode: 1 })).toBe(false) // SQLITE_ERROR
    expect(isStorageFailure(new DOMException('quota', 'QuotaExceededError'))).toBe(true)
    expect(isStorageFailure(new Error('A copy with that name already exists'))).toBe(false)
    expect(isStorageFailure(null)).toBe(false)
  })

  it('shows the persistent-storage notice only when refused, until hidden', () => {
    storageProblems.setPersistent(true)
    expect(storageProblems.get().notPersistent).toBe(false)
    storageProblems.setPersistent(false)
    expect(storageProblems.get().notPersistent).toBe(true)
    storageProblems.hidePersistNotice()
    storageProblems.setPersistent(false)
    expect(storageProblems.get().notPersistent).toBe(false)
  })

  it('counts catalog failures in one notice and doesn’t bring a hidden one straight back', () => {
    const t = 1_000_000
    storageProblems.catalogFailed('disk I/O error', t)
    storageProblems.catalogFailed('disk I/O error', t + 1)
    expect(storageProblems.get().catalogError).toEqual({ message: 'disk I/O error', count: 2 })
    storageProblems.hideCatalogError(t + 2)
    storageProblems.catalogFailed('disk I/O error', t + 3)
    expect(storageProblems.get().catalogError).toBeNull()
    storageProblems.catalogFailed('database or disk is full', t + 2 + QUIET_MS)
    expect(storageProblems.get().catalogError).toEqual({ message: 'database or disk is full', count: 2 })
  })
})
