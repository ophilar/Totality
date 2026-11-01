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
