import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startLaunchQueue } from './pwa/launch'
import { startServiceWorker } from './pwa/register'

startServiceWorker()
startLaunchQueue()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
