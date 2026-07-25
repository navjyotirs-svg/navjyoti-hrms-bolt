// Navjyoti HRMS Service Worker v3
// Handles push events, notification clicks, and service-worker updates.
// Reports diagnostic events back to the page for end-to-end push tracing.
// Does NOT cache authenticated/private API responses.

const SW_VERSION = 'v3'
const CACHE_NAME = `navjyoti-hrms-shell-${SW_VERSION}`
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  )
  self.clients.claim()
})

// Fetch handler: network-first for everything, no caching of API responses
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Never intercept auth, API, or Supabase requests
  if (url.pathname.startsWith('/functions/') ||
      url.hostname.includes('supabase') ||
      url.hostname.includes('bolt.host')) {
    return
  }

  // Network-first for navigation requests
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          return response
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match('/index.html')))
    )
    return
  }

  // Network-first for static assets
  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          }
          return response
        })
        .catch(() => caches.match(event.request))
    )
  }
})

// Message handler — allows page to trigger service worker update and query version
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
  if (event.data && event.data.type === 'GET_SW_VERSION') {
    event.source && event.source.postMessage({ type: 'SW_VERSION', version: SW_VERSION })
  }
})

// Helper: post a diagnostic event to all controlled pages
function reportDiagnostic(eventType, data) {
  const payload = { type: 'PUSH_DIAGNOSTIC', eventType, swVersion: SW_VERSION, ...data }
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      client.postMessage(payload)
    }
  })
}

// Push event handler
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'Navjyoti HRMS', body: event.data ? event.data.text() : 'New notification' }
  }

  const title = payload.title || 'Navjyoti HRMS'
  const safeActionUrl = payload.actionUrl || '/'
  const notificationId = payload.notificationId || null
  const priority = payload.priority || 'normal'
  const isHigh = priority === 'urgent' || priority === 'high'

  // Report that the service worker received the push
  reportDiagnostic('SERVICE_WORKER_PUSH_RECEIVED', {
    title,
    actionRoute: safeActionUrl,
    notificationId,
  })

  const options = {
    body: payload.body || payload.message || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/badge-72.png',
    tag: payload.tag || notificationId || `navjyoti-${Date.now()}`,
    data: {
      actionUrl: safeActionUrl,
      notificationId,
      category: payload.category || 'system',
    },
    requireInteraction: isHigh,
    silent: false,
  }

  // Report that showNotification is about to be called
  reportDiagnostic('SHOW_NOTIFICATION_CALLED', {
    title,
    actionRoute: safeActionUrl,
    notificationId,
  })

  event.waitUntil(
    self.registration.showNotification(title, options)
      .then(() => {
        reportDiagnostic('SHOW_NOTIFICATION_SUCCEEDED', {
          title,
          actionRoute: safeActionUrl,
          notificationId,
        })
      })
      .catch((err) => {
        reportDiagnostic('SHOW_NOTIFICATION_FAILED', {
          title,
          actionRoute: safeActionUrl,
          notificationId,
          errorCategory: err && err.name ? err.name : 'UNKNOWN',
        })
      })
  )
})

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const actionUrl = event.notification.data?.actionUrl || '/'
  const origin = self.location.origin

  // Validate action URL — prevent open redirect to external origins
  let safeUrl = '/'
  try {
    const parsed = new URL(actionUrl, origin)
    if (parsed.origin === origin) {
      safeUrl = parsed.pathname + parsed.search + parsed.hash
    }
  } catch {
    safeUrl = '/'
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing tab if open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.focus()
          client.postMessage({ type: 'NAVIGATE', url: safeUrl })
          return
        }
      }
      // Open new tab
      if (self.clients.openWindow) {
        return self.clients.openWindow(origin + safeUrl)
      }
    })
  )
})
