import { useEffect, useState } from 'react'
import { engineMemory, memDebugFlag, useDiagnosticsOn } from './setup'

const mb = (b: number) => `${Math.round(b / 2 ** 20)} MB`

/**
 * A small corner readout of the GPU memory LightBench's engines have made (estimated from the sizes of their textures
 * and buffers), the replaced textures still waiting to be freed, and the drawings in progress. Shown while diagnostics
 * is on, or with `?memdebug` in the address.
 */
export function MemoryReadout() {
  const on = useDiagnosticsOn()
  const shown = on || memDebugFlag
  const [m, setM] = useState(() => engineMemory())
  useEffect(() => {
    if (!shown) return
    const t = setInterval(() => setM(engineMemory()), 1000)
    return () => clearInterval(t)
  }, [shown])
  if (!shown) return null
  return (
    <div className="mem-readout" role="status" aria-label="GPU memory" title="GPU memory LightBench has made (an estimate: the browser can't see the driver's real use or other programs)">
      GPU {mb(m.textureBytes + m.bufferBytes)} · textures {mb(m.textureBytes)} · retired {mb(m.retiredBytes)} ({m.retired}) · drawing {m.leases}
    </div>
  )
}
