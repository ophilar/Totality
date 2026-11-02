import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'

// Configure the viewport in the bundled renderer rather than an inline CSP-blocked script.
function updateWindowHeight(): void {
  document.documentElement.style.setProperty('--app-height', window.screen.height + 'px')
}

updateWindowHeight()
window.addEventListener('resize', updateWindowHeight)

async function boot() {
  // Detect web mode (no Electron preload) and install WebSocket transport
  if (typeof window.electronAPI === 'undefined') {
    const { initWebTransport } = await import('./services/webTransport')
    await initWebTransport()
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

boot()
