// A Remove fill worker (PHASE3.md, Part 22): computes a whole completion, one of its two halves, or helps another
// worker search one (fill-split.ts). Driven by the fill pool on the page (fill-pool.ts).

import { handleFillRequest, type FillReply, type FillRequest } from './fill-split'

self.onmessage = (e: MessageEvent<FillRequest>) =>
  handleFillRequest(e.data, (m: FillReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer))
