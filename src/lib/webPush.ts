import { supabase } from '@/lib/supabase'

const SW_PATH = '/sw.js'

let cachedVapidKey: string | null = null

async function getVapidPublicKey(): Promise<string | null> {
  if (cachedVapidKey) return cachedVapidKey

  try {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vapid-public-key`, {
      headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
    })
    if (!response.ok) return null
    const data = await response.json()
    cachedVapidKey = data.publicKey ?? null
    return cachedVapidKey
  } catch {
    return null
  }
}

export type NotifPermissionState = 'default' | 'granted' | 'denied' | 'unsupported'
export type LocationPermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported' | 'unavailable'

export interface PushSubscriptionRow {
  id: string
  endpoint: string
  device_name: string | null
  platform: string | null
  browser: string | null
  is_active: boolean
  last_used_at: string | null
  created_at: string
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i)
  }
  return output
}

function parseUserAgent(): { browser: string; platform: string; deviceName: string } {
  const ua = navigator.userAgent
  let browser = 'Unknown'
  let platform = 'Unknown'

  if (/Edg/.test(ua)) browser = 'Edge'
  else if (/Chrome/.test(ua)) browser = 'Chrome'
  else if (/Firefox/.test(ua)) browser = 'Firefox'
  else if (/Safari/.test(ua)) browser = 'Safari'

  if (/Android/.test(ua)) platform = 'Android'
  else if (/iPhone|iPad|iPod/.test(ua)) platform = 'iOS'
  else if (/Windows/.test(ua)) platform = 'Windows'
  else if (/Mac/.test(ua)) platform = 'macOS'
  else if (/Linux/.test(ua)) platform = 'Linux'

  return { browser, platform, deviceName: `${platform} ${browser}` }
}

export function getNotificationPermission(): NotifPermissionState {
  if (!('Notification' in window)) return 'unsupported'
  if (window.isSecureContext === false) return 'unsupported'
  const perm = Notification.permission
  if (perm === 'granted') return 'granted'
  if (perm === 'denied') return 'denied'
  return 'default'
}

export function getLocationPermissionState(): LocationPermissionState {
  if (!('geolocation' in navigator)) return 'unsupported'
  if (window.isSecureContext === false) return 'unsupported'
  return 'prompt'
}

export async function requestNotificationPermission(): Promise<NotifPermissionState> {
  if (!('Notification' in window) || window.isSecureContext === false) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const result = await Notification.requestPermission()
    if (result === 'granted') return 'granted'
    if (result === 'denied') return 'denied'
    return 'default'
  } catch {
    return 'unsupported'
  }
}

export async function requestLocationPermission(): Promise<{ state: LocationPermissionState; coords?: { lat: number; lng: number } }> {
  if (!('geolocation' in navigator) || window.isSecureContext === false) {
    return { state: 'unsupported' }
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          state: 'granted',
          coords: { lat: position.coords.latitude, lng: position.coords.longitude },
        })
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) resolve({ state: 'denied' })
        else if (err.code === err.POSITION_UNAVAILABLE) resolve({ state: 'unavailable' })
        else if (err.code === err.TIMEOUT) resolve({ state: 'unavailable' })
        else resolve({ state: 'denied' })
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  })
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || window.isSecureContext === false) return null
  try {
    return await navigator.serviceWorker.register(SW_PATH, { scope: '/' })
  } catch {
    return null
  }
}

export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null

  try {
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    if (existing) return existing

    const vapidKey = await getVapidPublicKey()
    if (!vapidKey) return null

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
    })
    return sub
  } catch {
    return null
  }
}

export async function saveSubscriptionToServer(sub: PushSubscription, replace = false): Promise<boolean> {
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) return false

  const { browser, platform, deviceName } = parseUserAgent()
  const subJson = sub.toJSON()
  const endpoint = subJson.endpoint
  const p256dh = subJson.keys?.p256dh
  const auth = subJson.keys?.auth
  if (!endpoint || !p256dh || !auth) return false

  try {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/subscribe-device`
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        endpoint,
        p256dh,
        auth,
        userAgent: navigator.userAgent,
        deviceName,
        platform,
        browser,
        replace,
      }),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function unsubscribeFromPush(endpoint: string): Promise<boolean> {
  const { error } = await supabase
    .from('push_subscriptions')
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq('endpoint', endpoint)
  return !error
}

export async function fetchMySubscriptions(): Promise<PushSubscriptionRow[]> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, device_name, platform, browser, is_active, last_used_at, created_at')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  if (error) return []
  return data as PushSubscriptionRow[]
}

export async function removeSubscription(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('push_subscriptions')
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq('id', id)
  return !error
}

export async function sendTestPushNotification(): Promise<{ success: boolean; message: string; errorCategory?: string }> {
  try {
    const { data: session } = await supabase.auth.getSession()
    if (!session.session) return { success: false, message: 'Not authenticated' }

    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-test-push`
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      return {
        success: false,
        message: err.message || err.error || `Request failed (${response.status})`,
        errorCategory: err.errorCategory,
      }
    }
    const result = await response.json()
    const errorCategory = result.errorCategory as string | undefined
    const providerStatus = result.providerStatus as number | undefined
    const message = result.message || (result.success !== false ? 'Test push sent' : 'Push delivery failed.')

    const displayMessage = result.success !== false
      ? message
      : formatStructuredError(message, errorCategory, providerStatus)

    return {
      success: result.success !== false,
      message: displayMessage,
      errorCategory,
    }
  } catch (err) {
    const msg = (err as Error)?.message || ''
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      return { success: false, message: 'Could not reach the push service. Please check your connection and retry.', errorCategory: 'NETWORK_TIMEOUT' }
    }
    return { success: false, message: 'Push delivery failed unexpectedly. Please retry or contact support.', errorCategory: 'UNKNOWN_SERVER_ERROR' }
  }
}

function formatStructuredError(baseMessage: string, errorCategory?: string, providerStatus?: number): string {
  if (!errorCategory || errorCategory === 'UNKNOWN_SERVER_ERROR') {
    return providerStatus ? `${baseMessage} (provider status: ${providerStatus})` : baseMessage
  }
  const categoryLabels: Record<string, string> = {
    AUTHENTICATION_FAILED: 'Authentication failed. Please sign in again.',
    NO_ACTIVE_SUBSCRIPTION: 'No active subscription found. Enable notifications in Account Settings first.',
    INVALID_SUBSCRIPTION_DATA: 'Subscription data is invalid. Please repair your push subscription.',
    VAPID_SECRET_MISSING: 'Push service is not configured. VAPID keys are missing.',
    VAPID_KEY_INVALID: 'Push authentication key is invalid. Please contact support.',
    VAPID_SIGNING_FAILED: 'Push authentication signing failed. Please contact support.',
    PAYLOAD_ENCRYPTION_FAILED: 'Push payload encryption failed. Please contact support.',
    PUSH_PROVIDER_UNAUTHORIZED: 'Push provider rejected authentication. Please contact support.',
    PUSH_PROVIDER_BAD_REQUEST: 'The push provider rejected the request. Please repair your push subscription.',
    SUBSCRIPTION_EXPIRED: 'This device subscription has expired. Please repair your push subscription.',
    PUSH_PROVIDER_RATE_LIMITED: 'Push provider rate limited this request. Please retry in a moment.',
    PUSH_PROVIDER_ERROR: 'Push provider returned an error. Please retry shortly.',
    NETWORK_TIMEOUT: 'Push request timed out. Please check your connection and retry.',
    FUNCTION_NOT_DEPLOYED: 'Push function is not deployed. Please contact support.',
  }
  return categoryLabels[errorCategory] || baseMessage
}

export async function repairPushSubscription(): Promise<{ success: boolean; message: string }> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { success: false, message: 'Push service worker is not active on this device.' }
  }

  try {
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()

    if (existing) {
      await existing.unsubscribe()
    }

    const { data: session } = await supabase.auth.getSession()
    if (!session.session) return { success: false, message: 'Not authenticated' }

    // Deactivate ALL existing active subscriptions for this user + same browser/platform
    // to eliminate duplicate device records
    const { browser, platform } = parseUserAgent()
    await supabase
      .from('push_subscriptions')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('is_active', true)
      .eq('browser', browser)
      .eq('platform', platform)

    // Also deactivate the old endpoint if it exists
    if (existing) {
      const subJson = existing.toJSON()
      if (subJson.endpoint) {
        await supabase
          .from('push_subscriptions')
          .update({ is_active: false, revoked_at: new Date().toISOString() })
          .eq('endpoint', subJson.endpoint)
      }
    }

    const vapidKey = await getVapidPublicKey()
    if (!vapidKey) {
      return { success: false, message: 'Push service is not configured correctly.' }
    }

    const newSub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
    })

    const saved = await saveSubscriptionToServer(newSub, true)
    if (!saved) {
      return { success: false, message: 'Could not save subscription. Please try again.' }
    }

    const testResult = await sendTestPushNotification()
    return {
      success: testResult.success,
      message: testResult.success
        ? 'Push subscription repaired successfully.'
        : `Subscription repaired but test failed: ${testResult.message}`,
    }
  } catch {
    return { success: false, message: 'Could not repair push subscription. Please try again.' }
  }
}

export async function getPushDiagnostics(): Promise<{
  permission: NotifPermissionState
  serviceWorkerActive: boolean
  subscriptionActive: boolean
  subscriptionCount: number
}> {
  const permission = getNotificationPermission()
  let serviceWorkerActive = false
  let subscriptionActive = false
  let subscriptionCount = 0

  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready
      serviceWorkerActive = !!reg
      const sub = await reg.pushManager.getSubscription()
      subscriptionActive = !!sub
    } catch {
      serviceWorkerActive = false
    }
  }

  const subs = await fetchMySubscriptions()
  subscriptionCount = subs.length

  return { permission, serviceWorkerActive, subscriptionActive, subscriptionCount }
}

const PERMISSION_SETUP_KEY = 'navjyoti_permission_setup_done'

export function hasCompletedPermissionSetup(): boolean {
  return localStorage.getItem(PERMISSION_SETUP_KEY) === 'true'
}

export function markPermissionSetupComplete(): void {
  localStorage.setItem(PERMISSION_SETUP_KEY, 'true')
}

export function clearPermissionSetup(): void {
  localStorage.removeItem(PERMISSION_SETUP_KEY)
}

// ---------------------------------------------------------------------------
// Push diagnostic recording
// ---------------------------------------------------------------------------

export interface PushDiagnosticEvent {
  eventType: 'PUSH_PROVIDER_ACCEPTED' | 'SERVICE_WORKER_PUSH_RECEIVED' | 'SHOW_NOTIFICATION_CALLED' | 'SHOW_NOTIFICATION_SUCCEEDED' | 'SHOW_NOTIFICATION_FAILED'
  correlationId: string
  notificationTitle?: string
  actionRoute?: string
  serviceWorkerVersion?: string
  errorCategory?: string
}

export function startPushDiagnosticListener(onEvent: (event: PushDiagnosticEvent) => void): () => void {
  if (!('serviceWorker' in navigator)) return () => {}

  const listener = (event: MessageEvent) => {
    if (event.data && event.data.type === 'PUSH_DIAGNOSTIC') {
      onEvent({
        eventType: event.data.eventType,
        correlationId: event.data.correlationId || crypto.randomUUID(),
        notificationTitle: event.data.title,
        actionRoute: event.data.actionRoute,
        serviceWorkerVersion: event.data.swVersion,
        errorCategory: event.data.errorCategory,
      })
    }
  }

  navigator.serviceWorker.addEventListener('message', listener)

  return () => {
    navigator.serviceWorker.removeEventListener('message', listener)
  }
}

export async function recordPushDiagnostic(event: PushDiagnosticEvent): Promise<void> {
  try {
    await supabase.from('push_diagnostic_events').insert({
      correlation_id: event.correlationId,
      event_type: event.eventType,
      notification_title: event.notificationTitle || null,
      action_route: event.actionRoute || null,
      service_worker_version: event.serviceWorkerVersion || null,
      error_category: event.errorCategory || null,
    })
  } catch {
    // Diagnostics are best-effort — never block user flow
  }
}

export async function fetchPushDiagnostics(limit = 20): Promise<Array<{
  id: string
  correlation_id: string
  event_type: string
  notification_title: string | null
  action_route: string | null
  service_worker_version: string | null
  error_category: string | null
  created_at: string
}>> {
  const { data, error } = await supabase
    .from('push_diagnostic_events')
    .select('id, correlation_id, event_type, notification_title, action_route, service_worker_version, error_category, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return data || []
}

export async function getServiceWorkerVersion(): Promise<string | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.ready
    if (!reg || !reg.active) return null
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 2000)
      const handler = (event: MessageEvent) => {
        if (event.data && event.data.type === 'SW_VERSION') {
          clearTimeout(timeout)
          navigator.serviceWorker.removeEventListener('message', handler)
          resolve(event.data.version)
        }
      }
      navigator.serviceWorker.addEventListener('message', handler)
      reg.active!.postMessage({ type: 'GET_SW_VERSION' })
    })
  } catch {
    return null
  }
}

export async function updateServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (reg) {
      await reg.update()
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' })
    }
  } catch {
    // best-effort
  }
}