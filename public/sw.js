// Navjyoti HRMS Service Worker
// Handles push events, notification clicks, and service-worker updates.
// Does NOT cache authenticated/private API responses.

const CACHE_NAME = 'navjyoti-hrms-shell-v1'
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

// Push event handler
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'Navjyoti HRMS', body: event.data ? event.data.text() : 'New notification' }
  }

  const title = payload.title || 'Navjyoti HRMS'
  const options = {
    body: payload.body || payload.message || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/badge-72.png',
    tag: payload.tag || payload.notificationId || undefined,
    data: {
      actionUrl: payload.actionUrl || '/',
      notificationId: payload.notificationId || null,
      category: payload.category || 'system',
    },
    requireInteraction: payload.priority === 'urgent' || payload.priority === 'high',
    silent: false,
  }

  event.waitUntil(self.registration.showNotification(title, options))
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
