import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@/styles/tokens.css'

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
  })

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'NAVIGATE' && event.data?.url) {
      window.location.href = event.data.url
    }
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
