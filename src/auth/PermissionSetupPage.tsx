import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import { NavjyotiLogo } from '@/components/NavjyotiLogo'
import {
  getNotificationPermission,
  requestNotificationPermission,
  requestLocationPermission,
  registerServiceWorker,
  subscribeToPush,
  saveSubscriptionToServer,
  markPermissionSetupComplete,
  type NotifPermissionState,
  type LocationPermissionState,
} from '@/lib/webPush'
import '@/styles/auth.css'

interface OrgPermissionSettings {
  notification_permission_required: boolean
  location_permission_required: boolean
  allow_dashboard_without_push: boolean
  allow_dashboard_without_location: boolean
}

export function PermissionSetupPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [notifState, setNotifState] = useState<NotifPermissionState>('default')
  const [locationState, setLocationState] = useState<LocationPermissionState>('prompt')
  const [orgSettings, setOrgSettings] = useState<OrgPermissionSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [notifBusy, setNotifBusy] = useState(false)
  const [locationBusy, setLocationBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    checkStates()
  }, [])

  async function checkStates() {
    const nPerm = getNotificationPermission()
    setNotifState(nPerm)

    if (nPerm === 'granted') {
      const reg = await registerServiceWorker()
      if (reg) {
        const sub = await subscribeToPush()
        if (sub) {
          await saveSubscriptionToServer(sub)
        }
      }
    }

    setLocationState('prompt')

    if (profile?.organization_id) {
      const { data } = await supabase
        .from('organization_permission_settings')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .maybeSingle()
      if (data) setOrgSettings(data as OrgPermissionSettings)
    }

    setLoading(false)
  }

  async function handleEnableNotifications() {
    setError(null)
    setNotifBusy(true)
    try {
      const result = await requestNotificationPermission()
      setNotifState(result)

      if (result === 'granted') {
        const reg = await registerServiceWorker()
        if (reg) {
          const sub = await subscribeToPush()
          if (sub) {
            const saved = await saveSubscriptionToServer(sub)
            if (!saved) {
              setError('Push subscription could not be saved. In-app notifications will still work.')
            }
          }
        }
      }
    } catch {
      setError('Could not request notification permission. Please try again.')
    }
    setNotifBusy(false)
  }

  async function handleEnableLocation() {
    setError(null)
    setLocationBusy(true)
    try {
      const result = await requestLocationPermission()
      setLocationState(result.state)
    } catch {
      setError('Could not request location permission. Please try again.')
    }
    setLocationBusy(false)
  }

  function handleContinue() {
    markPermissionSetupComplete()
    navigate('/', { replace: true })
  }

  function canContinue(): boolean {
    if (!orgSettings) return true
    if (orgSettings.notification_permission_required && !orgSettings.allow_dashboard_without_push && notifState !== 'granted') {
      return false
    }
    if (orgSettings.location_permission_required && !orgSettings.allow_dashboard_without_location && locationState !== 'granted') {
      return false
    }
    return true
  }

  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <NavjyotiLogo width={240} maxHeight={70} clickable />
          </div>
          <p style={{ color: 'var(--slate)', fontSize: '14px' }}>Loading…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: '560px' }}>
        <div className="auth-logo">
          <NavjyotiLogo width={240} maxHeight={70} clickable />
        </div>
        <h1 className="auth-title">Permission Setup</h1>
        <p style={{ fontSize: '13.5px', color: 'var(--slate)', lineHeight: 1.6, marginBottom: 'var(--space-5)' }}>
          Enable notifications and location to get the most out of Navjyoti HRMS.
          You can change these settings later in your browser or Account Settings.
        </p>

        {/* Notifications section */}
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: 'var(--space-2)' }}>Notifications</h3>
          <p style={{ fontSize: '12.5px', color: 'var(--slate)', lineHeight: 1.5, marginBottom: 'var(--space-3)' }}>
            Used for: task assignments, task deadlines, task change requests, leave approvals/rejections,
            attendance checkout reminders, tickets, daily reports, follow-ups, calendar events,
            announcements, and security alerts.
          </p>

          {notifState === 'unsupported' && (
            <div className="form-error" style={{ marginBottom: 'var(--space-3)' }}>
              Push notifications are not supported in this browser. In-app notifications will still work when the tab is open.
            </div>
          )}

          {notifState === 'denied' && (
            <div className="form-error" style={{ marginBottom: 'var(--space-3)' }}>
              Notifications are blocked. Open your browser Site Settings and allow Notifications for this HRMS.
              <br /><br />
              <strong>Chrome/Edge:</strong> Click the lock icon next to the URL &gt; Site settings &gt; Notifications &gt; Allow.<br />
              <strong>Firefox:</strong> Click the lock icon &gt; Clear permissions, then reload.<br />
              <strong>Safari:</strong> Preferences &gt; Websites &gt; Notifications &gt; Allow for this site.
            </div>
          )}

          {notifState === 'default' && (
            <button
              className="btn"
              onClick={handleEnableNotifications}
              disabled={notifBusy}
              style={{ width: '100%' }}
            >
              {notifBusy ? 'Requesting…' : 'Enable Notifications'}
            </button>
          )}

          {notifState === 'granted' && (
            <div className="form-success" style={{ marginBottom: 0 }}>
              Notifications enabled. You will receive push notifications on this device.
            </div>
          )}

          {notifState === 'denied' && (
            <p style={{ fontSize: '12px', color: 'var(--slate)', marginTop: 'var(--space-2)' }}>
              You can continue with in-app notifications only. Push notifications will not work until you allow them in browser settings.
            </p>
          )}
        </div>

        {/* Location section */}
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: 'var(--space-2)' }}>Location</h3>
          <p style={{ fontSize: '12.5px', color: 'var(--slate)', lineHeight: 1.5, marginBottom: 'var(--space-3)' }}>
            Used only for attendance checkout and attendance evidence.
            Location is not tracked continuously and is only requested during attendance actions.
          </p>

          {locationState === 'unsupported' && (
            <div className="form-error" style={{ marginBottom: 'var(--space-3)' }}>
              Geolocation is not supported in this browser. Attendance checkout may not work on this device.
            </div>
          )}

          {locationState === 'denied' && (
            <div className="form-error" style={{ marginBottom: 'var(--space-3)' }}>
              Location is blocked. Open your browser Site Settings and allow Location for this HRMS.
              <br /><br />
              <strong>Chrome/Edge:</strong> Click the lock icon next to the URL &gt; Site settings &gt; Location &gt; Allow.<br />
              <strong>Firefox:</strong> Click the lock icon &gt; Clear permissions, then reload.<br />
              <strong>Safari:</strong> Preferences &gt; Websites &gt; Location &gt; Allow for this site.
            </div>
          )}

          {(locationState === 'prompt' || locationState === 'unavailable') && (
            <button
              className="btn btn-secondary"
              onClick={handleEnableLocation}
              disabled={locationBusy}
              style={{ width: '100%' }}
            >
              {locationBusy ? 'Checking…' : 'Enable Location'}
            </button>
          )}

          {locationState === 'granted' && (
            <div className="form-success" style={{ marginBottom: 0 }}>
              Location enabled. Attendance checkout will work on this device.
            </div>
          )}

          {locationState === 'denied' && (
            <p style={{ fontSize: '12px', color: 'var(--slate)', marginTop: 'var(--space-2)' }}>
              You can still use non-attendance modules. Attendance checkout will be blocked until location is allowed.
            </p>
          )}
        </div>

        {error && (
          <div className="form-error" style={{ marginBottom: 'var(--space-4)' }}>{error}</div>
        )}

        <button
          className="btn"
          onClick={handleContinue}
          disabled={!canContinue()}
          style={{ width: '100%' }}
        >
          Continue to Dashboard
        </button>

        {!canContinue() && orgSettings && (
          <p style={{ fontSize: '11.5px', color: 'var(--slate)', marginTop: 'var(--space-3)', textAlign: 'center', lineHeight: 1.5 }}>
            {orgSettings.notification_permission_required && !orgSettings.allow_dashboard_without_push && notifState !== 'granted' && 'Notifications are required by your organization policy. '}
            {orgSettings.location_permission_required && !orgSettings.allow_dashboard_without_location && locationState !== 'granted' && 'Location is required by your organization policy. '}
            Please contact your administrator if you cannot enable these permissions.
          </p>
        )}
      </div>
    </div>
  )
}
