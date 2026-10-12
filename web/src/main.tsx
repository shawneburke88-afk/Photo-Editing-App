import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startLaunchQueue } from './pwa/launch'
import { startServiceWorker } from './pwa/register'
import { applyDisplay, settings } from './settings/store'

// Interface size and photo background before the first paint.
applyDisplay(settings.get().display)
startServiceWorker()
startLaunchQueue()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
