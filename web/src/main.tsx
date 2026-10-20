import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startDiagnostics } from './diagnostics/setup'
import { presentChoice } from './engine/gpu/present'
import { startLaunchQueue } from './pwa/launch'
import { startServiceWorker } from './pwa/register'
import { applyDisplay, settings } from './settings/store'

// Interface size and photo background before the first paint.
applyDisplay(settings.get().display)
startServiceWorker()
startLaunchQueue()
// Whether WebGPU canvases can be shown here, tested once before any GPU work (engine/gpu/present.ts; PHASE3.md Part 14).
void presentChoice()
// Diagnostics (off by default; Settings → Diagnostics): connects its log to the engine when it is on.
startDiagnostics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
