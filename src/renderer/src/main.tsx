import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'

// Keep viewport sizing in the bundled renderer so the Content Security Policy permits it.
function updateWindowHeight(): void {
  const fullHeight = window.screen.height
  const visibleHeight = window.visualViewport?.height ?? window.innerHeight
  const height = visibleHeight && visibleHeight < fullHeight * 0.75 ? visibleHeight : fullHeight
  document.documentElement.style.setProperty('--app-height', `${height}px`)
}

updateWindowHeight()
window.addEventListener('resize', updateWindowHeight)
window.visualViewport?.addEventListener('resize', updateWindowHeight)

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
