// Persists folder handles in IndexedDB so the browser can offer "allow on every visit".

const DB_NAME = 'lightbench'
const STORE = 'handles'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export const saveHandle = (key: string, handle: FileSystemDirectoryHandle) =>
  tx('readwrite', (s) => s.put(handle, key)).then(() => undefined)

export const loadHandle = (key: string) =>
  tx<FileSystemDirectoryHandle | undefined>('readonly', (s) => s.get(key))

export const deleteHandle = (key: string) => tx('readwrite', (s) => s.delete(key)).then(() => undefined)
