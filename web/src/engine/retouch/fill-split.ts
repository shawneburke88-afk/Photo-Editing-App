// Remove's completion split among workers (PHASE3.md, Part 22). Runs inside the fill workers (fill.worker.ts); the
// pool on the page (fill-pool.ts) decides which worker leads a completion and which help it.
//
// Three steps of a completion (completion.ts) are made of independent pieces, and only those are split:
//   - the patch vectors (`patchVectorRows`): each row's vectors depend only on the image around it;
//   - each search (`searchRange`): every target patch looks for its own best source and writes only its own match;
//   - each vote, in two halves (`voteSums`, `voteWrite`): each pixel's sums run over the matches in their order, whoever
//     makes them, and the means are written only once every sum is made.
// So the pieces can be done in any split, in any order, by any number of workers, and the results are exactly the
// serial ones. Everything else stays on the leading worker, in the serial order (see `solve`).
//
// How the workers meet: the arrays live in SharedArrayBuffers (the image, the patch vectors, the levels' estimates,
// valid sources, target patches, matches, distances, weights and vote sums); a small control array says which step
// runs now. For each step the leader writes its parameters, opens a new generation and wakes the helpers; everyone
// takes blocks of pieces from a shared counter until none are left; the leader then closes the generation and waits
// until no helper is still working, and only then goes on. A helper that arrives after the generation closed does
// nothing. So a slow or missing helper never changes the result or blocks the leader (the leader does whatever is
// left itself).

import {
  complete, nothingToCopy, patchVectorRows, prepare, searchRange, solve, voteSums, voteWrite,
  type Alloc, type Completion, type CompletionInput, type Level, type Solved, type Start,
} from './completion'

/** Slots of the control array. */
const GEN = 0 // bumped for every step and at the end
const OPEN = 1 // the generation helpers may join (−1: none)
const ACTIVE = 2 // helpers working now
const NEXT = 3 // the next unclaimed piece
const CMD = 4 // 1: finished, helpers leave
const OP = 5
const N = 6 // pieces in this step
const BLOCK = 7 // pieces claimed at a time
const LEVEL = 8
const AROUND = 9 // the search's reach (−1: the full search)
const HAS_IL = 10
const ILX = 11
const ILY = 12
const SIZE = 13

const FINISH = 1
const OP_VECTORS = 1
const OP_SEARCH = 2
const OP_SUMS = 3
const OP_MEANS = 4

/** Target patches claimed at a time: enough to keep the counter cheap, few enough to balance uneven patches. */
export const PATCHES_PER_CLAIM = 32
/** Rows claimed at a time by the patch vectors and the vote. */
const ROWS_PER_CLAIM = 4

function newControl(): Int32Array {
  const ctrl = new Int32Array(new SharedArrayBuffer(SIZE * 4))
  ctrl[OPEN] = -1
  return ctrl
}

/** True where SharedArrayBuffer (a cross-origin isolated page) and Atomics.wait in workers are available. */
export const canShare = () => typeof SharedArrayBuffer === 'function' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated !== false

const sharedAlloc: Alloc = {
  f32: (n) => new Float32Array(new SharedArrayBuffer(n * 4)),
  f64: (n) => new Float64Array(new SharedArrayBuffer(n * 8)),
  i32: (n) => new Int32Array(new SharedArrayBuffer(n * 4)),
  u8: (n) => new Uint8Array(new SharedArrayBuffer(n)),
}

/** What helpers get: the patch-vector step's arrays, or the levels' (all of them shared memory). */
export type Shared =
  | { kind: 'vectors'; w: number; h: number; image: Float32Array; hole: Uint8Array; e: Float32Array }
  | { kind: 'levels'; r: number; levels: SharedLevel[] }

export type SharedLevel = Pick<Level, 'w' | 'h' | 'e' | 'hole' | 'valid' | 'validList' | 'centres' | 'count' | 'src' | 'dist' | 'weight' | 'box' | 'acc' | 'ws'>

/** Takes blocks of the current step's pieces until none are left. */
function claim(ctrl: Int32Array, n: number, block: number, work: (i0: number, i1: number) => void) {
  for (;;) {
    const i0 = Atomics.add(ctrl, NEXT, block)
    if (i0 >= n) return
    work(i0, Math.min(n, i0 + block))
  }
}

/** The leader runs a step with whoever helps: parameters, open, its own share, close, wait for the helpers. */
function step(ctrl: Int32Array, op: number, n: number, block: number, params: [number, number][], work: (i0: number, i1: number) => void) {
  for (const [k, v] of params) Atomics.store(ctrl, k, v)
  Atomics.store(ctrl, OP, op)
  Atomics.store(ctrl, N, n)
  Atomics.store(ctrl, BLOCK, block)
  Atomics.store(ctrl, NEXT, 0)
  const g = Atomics.load(ctrl, GEN) + 1
  Atomics.store(ctrl, OPEN, g)
  Atomics.store(ctrl, GEN, g)
  Atomics.notify(ctrl, GEN)
  claim(ctrl, n, block, work)
  // Every piece is taken: close the generation, then wait for the helpers still working on theirs.
  Atomics.store(ctrl, OPEN, -1)
  for (;;) {
    const a = Atomics.load(ctrl, ACTIVE)
    if (!a) break
    Atomics.wait(ctrl, ACTIVE, a, 100)
  }
}

function finish(ctrl: Int32Array) {
  Atomics.store(ctrl, CMD, FINISH)
  Atomics.add(ctrl, GEN, 1)
  Atomics.notify(ctrl, GEN)
}

/**
 * The leader: one completion (`solve`), sharing the patch vectors, the searches and the votes with whoever helps.
 * `share` is called with what helpers need, once for the patch vectors and once for the levels (not when there is
 * nothing to copy from). Null in that case.
 */
export function solveShared(input: CompletionInput, start: Start, share: (ctrl: Int32Array, s: Shared) => void, onProgress: (f: number) => void): Solved | null {
  const { width: w, height: h } = input
  // The patch vectors, by rows.
  const vectors = newControl()
  const image = sharedAlloc.f32(input.image.length)
  image.set(input.image)
  const hole = sharedAlloc.u8(input.hole.length)
  hole.set(input.hole)
  const e0 = sharedAlloc.f32(w * h * 5)
  try {
    share(vectors, { kind: 'vectors', w, h, image, hole, e: e0 })
    step(vectors, OP_VECTORS, h, ROWS_PER_CLAIM, [], (y0, y1) => patchVectorRows(w, h, image, hole, y0, y1, e0))
  } finally {
    finish(vectors)
  }
  const prep = prepare(input, e0)
  const pyr = prep.pyramid(sharedAlloc)
  if (nothingToCopy(pyr)) return null
  const ctrl = newControl()
  try {
    share(ctrl, { kind: 'levels', r: prep.r, levels: pyr.map(({ w, h, e, hole, valid, validList, centres, count, src, dist, weight, box, acc, ws }) => ({ w, h, e, hole, valid, validList, centres, count, src, dist, weight, box, acc, ws })) })
    const index = new Map(pyr.map((L, i) => [L, i]))
    return solve(pyr, prep.r, prep.init, start, onProgress, {
      search: (L, r, il, around) =>
        step(ctrl, OP_SEARCH, L.centres.length, PATCHES_PER_CLAIM, [[LEVEL, index.get(L)!], [AROUND, around === Infinity ? -1 : around], [HAS_IL, il ? 1 : 0], [ILX, il ? il[0] : 0], [ILY, il ? il[1] : 0]], (j0, j1) =>
          searchRange(L, r, il, around, j0, j1),
        ),
      vote: (L, r) => {
        const rows = L.box[3] - L.box[1]
        step(ctrl, OP_SUMS, rows, ROWS_PER_CLAIM, [[LEVEL, index.get(L)!]], (k0, k1) => voteSums(L, r, k0, k1))
        step(ctrl, OP_MEANS, rows, ROWS_PER_CLAIM, [[LEVEL, index.get(L)!]], (k0, k1) => voteWrite(L, k0, k1))
      },
    })
  } finally {
    finish(ctrl)
  }
}

/**
 * A helper: does its share of every step until the leader finishes (or has not been heard of for `patienceMs`, e.g.
 * because it was stopped). Returns the pieces it did.
 */
export function help(ctrl: Int32Array, shared: Shared, patienceMs = 20000): number {
  const levels = shared.kind === 'levels' ? shared.levels.map((s) => ({ ...s, at: new Int32Array(0) }) as Level) : []
  let seen = -1
  let done = 0
  let heard = performance.now()
  for (;;) {
    if (Atomics.load(ctrl, CMD) === FINISH) return done
    const g = Atomics.load(ctrl, GEN)
    if (g !== seen) {
      seen = g
      heard = performance.now()
      Atomics.add(ctrl, ACTIVE, 1)
      try {
        // Joined in time: the leader waits for us before it changes anything.
        if (Atomics.load(ctrl, OPEN) === g) {
          const op = Atomics.load(ctrl, OP)
          const n = Atomics.load(ctrl, N)
          const block = Atomics.load(ctrl, BLOCK)
          let work: (i0: number, i1: number) => void
          if (shared.kind === 'vectors') {
            const { w, h, image, hole, e } = shared
            work = (y0, y1) => patchVectorRows(w, h, image, hole, y0, y1, e)
          } else {
            const L = levels[Atomics.load(ctrl, LEVEL)]
            const r = shared.r
            if (op === OP_SEARCH) {
              const a = Atomics.load(ctrl, AROUND)
              const il: [number, number] | null = Atomics.load(ctrl, HAS_IL) ? [Atomics.load(ctrl, ILX), Atomics.load(ctrl, ILY)] : null
              work = (j0, j1) => searchRange(L, r, il, a < 0 ? Infinity : a, j0, j1)
            } else if (op === OP_SUMS) work = (k0, k1) => voteSums(L, r, k0, k1)
            else work = (k0, k1) => voteWrite(L, k0, k1)
          }
          claim(ctrl, n, block, (i0, i1) => {
            work(i0, i1)
            done += i1 - i0
          })
        }
      } finally {
        Atomics.sub(ctrl, ACTIVE, 1)
        Atomics.notify(ctrl, ACTIVE)
      }
      continue
    }
    if (Atomics.wait(ctrl, GEN, seen, 1000) === 'timed-out' && performance.now() - heard > patienceMs) return done
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
  /** `helpers`: share the work (the leader then sends `share`s for its helpers). */
  | { kind: 'solve'; id: number; input: CompletionInput; start: Start; helpers: boolean }
  | { kind: 'help'; id: number; ctrl: Int32Array; shared: Shared }

export type FillReply =
  | { kind: 'progress'; id: number; f: number }
  | { kind: 'share'; id: number; ctrl: Int32Array; shared: Shared }
  | { kind: 'done'; id: number; completion: Completion; energy: number }
  | { kind: 'helped'; id: number; pieces: number }
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
      post({ id: m.id, kind: 'helped', pieces: help(m.ctrl, m.shared) })
      return
    }
    if (m.kind === 'complete') {
      const completion = complete({ ...m.input, onProgress })
      post({ id: m.id, kind: 'done', completion, energy: 0 }, transfers(completion))
      return
    }
    const solved = m.helpers
      ? solveShared(m.input, m.start, (ctrl, shared) => post({ id: m.id, kind: 'share', ctrl, shared }), onProgress)
      : solveAlone(m.input, m.start, onProgress)
    const completion = solved ? unshare(solved.completion) : emptyCompletion(m.input)
    post({ id: m.id, kind: 'done', completion, energy: solved ? solved.energy : 0 }, transfers(completion))
  } catch (err) {
    post({ id: m.id, kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
