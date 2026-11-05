import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { initWebTransport } from './services/webTransport'

// Retain the existing window-height handling without an inline HTML script.
function updateWindowHeight(): void {
  document.documentElement.style.setProperty('--app-height', window.screen.height + 'px')
}

updateWindowHeight()
window.addEventListener('resize', updateWindowHeight)

// Keep the viewport-height behavior in the bundled entrypoint so CSP can block inline scripts.
function updateAppHeight(): void {
  const fullHeight = window.screen.height
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  const height = viewportHeight && viewportHeight < fullHeight * 0.75 ? viewportHeight : fullHeight
  document.documentElement.style.setProperty('--app-height', `${height}px`)
}

updateAppHeight()
window.addEventListener('resize', updateAppHeight)
window.visualViewport?.addEventListener('resize', updateAppHeight)

async function boot() {
  // Detect web mode (no Electron preload) and install WebSocket transport
  if (typeof window.electronAPI === 'undefined') {
    await initWebTransport()
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

boot()
