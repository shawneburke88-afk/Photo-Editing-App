// Minimal typed request/response messaging between the UI thread and a Web Worker.

type Handlers = Record<string, (...args: never[]) => unknown>

type Request = { id: number; method: string; args: unknown[] }
type Response = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string; name?: string }

export type RpcClient<H extends Handlers> = {
  [K in keyof H]: (...args: Parameters<H[K]>) => Promise<Awaited<ReturnType<H[K]>>>
}

/** Worker side: answers requests by calling the matching handler. */
export function exposeRpc(handlers: Handlers) {
  self.onmessage = async (e: MessageEvent<Request>) => {
    const { id, method, args } = e.data
    let res: Response
    try {
      const fn = handlers[method] as ((...a: unknown[]) => unknown) | undefined
      if (!fn) throw new Error(`Unknown method ${method}`)
      res = { id, ok: true, value: await fn(...args) }
    } catch (err) {
      res = { id, ok: false, error: err instanceof Error ? err.message : String(err), name: err instanceof Error ? err.name : undefined }
    }
    self.postMessage(res)
  }
}

/**
 * UI side: a proxy whose methods post requests to the worker and resolve with its answers. The error's name
 * (e.g. a worker's own `StorageError`) is kept; `onError` sees every failed call.
 */
export function createRpcClient<H extends Handlers>(worker: Worker, onError?: (method: string, err: Error) => void): RpcClient<H> {
  let nextId = 1
  const pending = new Map<number, { method: string; resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  worker.onmessage = (e: MessageEvent<Response>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.ok) return p.resolve(e.data.value)
    const err = new Error(e.data.error)
    if (e.data.name) err.name = e.data.name
    onError?.(p.method, err)
    p.reject(err)
  }
  worker.onerror = (e) => {
    const err = new Error(e.message || 'Worker failed to start')
    for (const p of pending.values()) p.reject(err)
    pending.clear()
  }
  return new Proxy({} as RpcClient<H>, {
    get: (_, method: string) =>
      (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          const id = nextId++
          pending.set(id, { method, resolve, reject })
          worker.postMessage({ id, method, args } satisfies Request)
        }),
  })
}
