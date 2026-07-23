import { supabase } from '@/lib/supabase'

const SW_PATH = '/sw.js'
const VAPID_PUBLIC_KEY = 'BCX187-YTkrYO57OkMTO2lYQdzMfukEqVRxidO-ue_8L8YGA1GVossDZ3kDlxyzVK-k3zQ0uYr8EKOAWXd6gIB4'

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

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
    })
    return sub
  } catch {
    return null
  }
}

export async function saveSubscriptionToServer(sub: PushSubscription): Promise<boolean> {
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return false

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (!profile?.organization_id) return false

  const { browser, platform, deviceName } = parseUserAgent()
  const subJson = sub.toJSON()
  const endpoint = subJson.endpoint
  const p256dh = subJson.keys?.p256dh
  const auth = subJson.keys?.auth
  if (!endpoint || !p256dh || !auth) return false

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: userData.user.id,
        organization_id: profile.organization_id,
        endpoint,
        p256dh_key: p256dh,
        auth_key: auth,
        user_agent: navigator.userAgent,
        device_name: deviceName,
        platform,
        browser,
        is_active: true,
        permission_status: 'granted',
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint,user_id' }
    )

  return !error
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

export async function sendTestPushNotification(): Promise<{ success: boolean; message: string }> {
  try {
    const { data: session } = await supabase.auth.getSession()
    if (!session.session) return { success: false, message: 'Not authenticated' }

    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push-notification`
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ test: true }),
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      return { success: false, message: err.error || `Request failed (${response.status})` }
    }
    const result = await response.json()
    return { success: true, message: result.message || 'Test push sent' }
  } catch (e) {
    return { success: false, message: (e as Error).message }
  }
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
