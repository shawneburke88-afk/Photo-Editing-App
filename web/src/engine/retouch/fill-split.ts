// Remove's patch search split among workers (PHASE3.md, Part 22). Runs inside the fill workers (fill.worker.ts); the
// pool on the page (fill-pool.ts) decides which worker leads a completion and which help it.
//
// A completion (completion.ts, `solve`) is a sequence of searches, each followed by a vote. In a search every target
// patch looks for its own best source and writes only its own match (`searchRange`), so the patches can be searched
// in any split, in any order, by any number of workers, and the matches are exactly the serial ones. Everything
// between the searches stays on the leading worker, in the serial order: building the levels, the starts, the votes,
// the weights and the final score.
//
// How the workers meet: the levels' arrays live in SharedArrayBuffers (the estimate `e`, the valid sources, the
// target patches, their matches and distances); a small control array says which search runs now. For each search
// the leader writes its parameters, opens a new generation and wakes the helpers; everyone takes blocks of BLOCK
// patches from a shared counter until none are left; the leader then closes the generation and waits until no
// helper is still searching, and only then votes. A helper that arrives after the generation closed does nothing.
// So a slow or missing helper never changes the result or blocks the leader (the leader searches whatever is left).

import { complete, nothingToCopy, prepare, searchRange, solve, type Alloc, type Completion, type CompletionInput, type Level, type Solved, type Start } from './completion'

/** Slots of the control array. */
export const CTRL = {
  /** Bumped for every search and at the end. */
  GEN: 0,
  /** The generation helpers may join (-1: none). */
  OPEN: 1,
  /** Helpers searching now. */
  ACTIVE: 2,
  /** The next unclaimed target patch. */
  NEXT: 3,
  /** 1: the completion is finished, helpers leave. */
  CMD: 4,
  LEVEL: 5,
  /** The search's reach (−1: the full search). */
  AROUND: 6,
  HAS_IL: 7,
  ILX: 8,
  ILY: 9,
  N: 10,
  SIZE: 11,
} as const

const FINISH = 1

/** Target patches claimed at a time: enough to keep the counter cheap, few enough to balance uneven patches. */
export const BLOCK = 32

/** A control array, ready for a completion. */
export function newControl(): Int32Array {
  const ctrl = new Int32Array(new SharedArrayBuffer(CTRL.SIZE * 4))
  ctrl[CTRL.OPEN] = -1
  return ctrl
}

/** True where SharedArrayBuffer (a cross-origin isolated page) and Atomics.wait in workers are available. */
export const canShare = () => typeof SharedArrayBuffer === 'function' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated !== false

const sharedAlloc: Alloc = {
  f32: (n) => new Float32Array(new SharedArrayBuffer(n * 4)),
  i32: (n) => new Int32Array(new SharedArrayBuffer(n * 4)),
  u8: (n) => new Uint8Array(new SharedArrayBuffer(n)),
}

/** What a helper needs of a level (all of it shared memory). */
export interface SharedLevel {
  w: number
  h: number
  e: Float32Array
  valid: Uint8Array
  validList: Int32Array
  centres: Int32Array
  count: Uint8Array
  src: Int32Array
  dist: Float32Array
}

/** Takes blocks of the current search's patches until none are left. Returns the patches searched. */
function claim(ctrl: Int32Array, L: Level, r: number, il: [number, number] | null, around: number, n: number): number {
  let done = 0
  for (;;) {
    const j0 = Atomics.add(ctrl, CTRL.NEXT, BLOCK)
    if (j0 >= n) return done
    const j1 = Math.min(n, j0 + BLOCK)
    searchRange(L, r, il, around, j0, j1)
    done += j1 - j0
  }
}

/**
 * The leader: one completion (`solve`), with its searches shared with whoever helps. `share` is called once the levels
 * exist, with what the helpers need; nothing is shared when there is nothing to copy from. Null in that case.
 */
export function solveShared(input: CompletionInput, start: Start, ctrl: Int32Array, share: (levels: SharedLevel[], r: number) => void, onProgress: (f: number) => void): Solved | null {
  const prep = prepare(input)
  try {
    const pyr = prep.pyramid(sharedAlloc)
    if (nothingToCopy(pyr)) return null
    share(pyr.map(({ w, h, e, valid, validList, centres, count, src, dist }) => ({ w, h, e, valid, validList, centres, count, src, dist })), prep.r)
    const index = new Map(pyr.map((L, i) => [L, i]))
    return solve(pyr, prep.r, prep.init, start, onProgress, (L, r, il, around) => {
      const n = L.centres.length
      Atomics.store(ctrl, CTRL.LEVEL, index.get(L)!)
      Atomics.store(ctrl, CTRL.AROUND, around === Infinity ? -1 : around)
      Atomics.store(ctrl, CTRL.HAS_IL, il ? 1 : 0)
      Atomics.store(ctrl, CTRL.ILX, il ? il[0] : 0)
      Atomics.store(ctrl, CTRL.ILY, il ? il[1] : 0)
      Atomics.store(ctrl, CTRL.N, n)
      Atomics.store(ctrl, CTRL.NEXT, 0)
      const g = Atomics.load(ctrl, CTRL.GEN) + 1
      Atomics.store(ctrl, CTRL.OPEN, g)
      Atomics.store(ctrl, CTRL.GEN, g)
      Atomics.notify(ctrl, CTRL.GEN)
      claim(ctrl, L, r, il, around, n)
      // Every patch is taken: close the generation, then wait for the helpers still searching theirs.
      Atomics.store(ctrl, CTRL.OPEN, -1)
      for (;;) {
        const a = Atomics.load(ctrl, CTRL.ACTIVE)
        if (!a) break
        Atomics.wait(ctrl, CTRL.ACTIVE, a, 100)
      }
    })
  } finally {
    Atomics.store(ctrl, CTRL.CMD, FINISH)
    Atomics.add(ctrl, CTRL.GEN, 1)
    Atomics.notify(ctrl, CTRL.GEN)
  }
}

/**
 * A helper: searches its share of every search of a completion until the leader finishes (or has not been heard of
 * for `patienceMs`, e.g. because it was stopped). Returns the patches it searched.
 */
export function help(ctrl: Int32Array, shared: SharedLevel[], r: number, patienceMs = 20000): number {
  const levels = shared.map((s) => ({ ...s, hole: new Uint8Array(0), at: new Int32Array(0), weight: new Float32Array(0), box: [0, 0, 0, 0] }) as Level)
  let seen = -1
  let searched = 0
  let heard = performance.now()
  for (;;) {
    if (Atomics.load(ctrl, CTRL.CMD) === FINISH) return searched
    const g = Atomics.load(ctrl, CTRL.GEN)
    if (g !== seen) {
      seen = g
      heard = performance.now()
      Atomics.add(ctrl, CTRL.ACTIVE, 1)
      try {
        // Joined in time: the leader waits for us before it changes anything.
        if (Atomics.load(ctrl, CTRL.OPEN) === g) {
          const L = levels[Atomics.load(ctrl, CTRL.LEVEL)]
          const a = Atomics.load(ctrl, CTRL.AROUND)
          const il: [number, number] | null = Atomics.load(ctrl, CTRL.HAS_IL) ? [Atomics.load(ctrl, CTRL.ILX), Atomics.load(ctrl, CTRL.ILY)] : null
          searched += claim(ctrl, L, r, il, a < 0 ? Infinity : a, Atomics.load(ctrl, CTRL.N))
        }
      } finally {
        Atomics.sub(ctrl, CTRL.ACTIVE, 1)
        Atomics.notify(ctrl, CTRL.ACTIVE)
      }
      continue
    }
    if (Atomics.wait(ctrl, CTRL.GEN, seen, 1000) === 'timed-out' && performance.now() - heard > patienceMs) return searched
  }
}

/** One completion on one worker, without helpers: exactly `complete`'s half for `start`. */
export function solveAlone(input: CompletionInput, start: Start, onProgress: (f: number) => void): Solved | null {
  const prep = prepare(input)
  const pyr = prep.pyramid()
  if (nothingToCopy(pyr)) return null
  return solve(pyr, prep.r, prep.init, start, onProgress)
}

/** The result when there is nothing to copy from (as `complete` gives it). */
export const emptyCompletion = (input: CompletionInput): Completion => ({
  width: input.width,
  height: input.height,
  radius: input.radius ?? 3,
  centres: new Int32Array(0),
  sources: new Int32Array(0),
  weights: new Float32Array(0),
})

// ---- the fill worker's messages (fill.worker.ts; the tests run them in-process)

export type FillRequest =
  | { kind: 'complete'; id: number; input: CompletionInput }
  | { kind: 'solve'; id: number; input: CompletionInput; start: Start; ctrl: Int32Array | null }
  | { kind: 'help'; id: number; ctrl: Int32Array; levels: SharedLevel[]; r: number }

export type FillReply =
  | { kind: 'progress'; id: number; f: number }
  | { kind: 'share'; id: number; levels: SharedLevel[]; r: number }
  | { kind: 'done'; id: number; completion: Completion; energy: number }
  | { kind: 'helped'; id: number; patches: number }
  | { kind: 'error'; id: number; message: string }

const transfers = (c: Completion): Transferable[] => [c.centres.buffer as ArrayBuffer, c.sources.buffer as ArrayBuffer, c.weights.buffer as ArrayBuffer]

/** A completion's arrays as plain (transferable) ones: the leader's live in shared memory. */
const unshare = (c: Completion): Completion => ({ ...c, centres: c.centres.slice(), sources: c.sources.slice(), weights: c.weights.slice() })

/** Answers one request; `post` sends a reply (with what to transfer). */
export function handleFillRequest(m: FillRequest, post: (r: FillReply, transfer?: Transferable[]) => void) {
  // Progress at most every 100 ms.
  let last = 0
  const onProgress = (f: number) => {
    const now = performance.now()
    if (now - last < 100) return
    last = now
    post({ id: m.id, kind: 'progress', f })
  }
  try {
    if (m.kind === 'help') {
      post({ id: m.id, kind: 'helped', patches: help(m.ctrl, m.levels, m.r) })
      return
    }
    if (m.kind === 'complete') {
      const completion = complete({ ...m.input, onProgress })
      post({ id: m.id, kind: 'done', completion, energy: 0 }, transfers(completion))
      return
    }
    const solved = m.ctrl
      ? solveShared(m.input, m.start, m.ctrl, (levels, r) => post({ id: m.id, kind: 'share', levels, r }), onProgress)
      : solveAlone(m.input, m.start, onProgress)
    const completion = solved ? unshare(solved.completion) : emptyCompletion(m.input)
    post({ id: m.id, kind: 'done', completion, energy: solved ? solved.energy : 0 }, transfers(completion))
  } catch (err) {
    post({ id: m.id, kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
