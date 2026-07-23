import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useOutletContext } from 'react-router-dom'
import { ROLE_LABELS } from '@/types/roles'
import { supabase } from '@/lib/supabase'
import {
  getNotificationPermission,
  fetchMySubscriptions,
  removeSubscription,
  sendTestPushNotification,
  registerServiceWorker,
  subscribeToPush,
  saveSubscriptionToServer,
  repairPushSubscription,
  getPushDiagnostics,
  type PushSubscriptionRow,
  type NotifPermissionState,
} from '@/lib/webPush'
import '@/styles/shared.css'

const SELF_SERVICE_FIELDS = [
  'preferred_name',
  'personal_email',
  'mobile_number',
  'alternate_mobile_number',
  'current_address',
  'permanent_address',
  'emergency_contact_name',
  'emergency_contact_relation',
  'emergency_contact_phone',
] as const

type SelfService = Record<(typeof SELF_SERVICE_FIELDS)[number], string>

interface EmployeeRecord extends SelfService {
  id: string
  employee_code: string
  full_name: string
  designation: string | null
  work_email: string
  employment_status: string
  joining_date: string
  branch_id: string | null
  department_id: string | null
  organization_id: string
  reporting_manager_id: string | null
}

const EMPTY_SELF: SelfService = {
  preferred_name: '',
  personal_email: '',
  mobile_number: '',
  alternate_mobile_number: '',
  current_address: '',
  permanent_address: '',
  emergency_contact_name: '',
  emergency_contact_relation: '',
  emergency_contact_phone: '',
}

export function AccountSettingsPage() {
  const { profile, updatePassword } = useAuth()
  const { soundEnabled, toggleSound } = useOutletContext<{ soundEnabled: boolean; toggleSound: () => void }>()
  const [emp, setEmp] = useState<EmployeeRecord | null>(null)
  const [self, setSelf] = useState<SelfService>(EMPTY_SELF)
  const [branchName, setBranchName] = useState<string | null>(null)
  const [deptName, setDeptName] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string | null>(null)
  const [managerName, setManagerName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSuccess, setProfileSuccess] = useState(false)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  const [notifPerm, setNotifPerm] = useState<NotifPermissionState>('default')
  const [subs, setSubs] = useState<PushSubscriptionRow[]>([])
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [reSubscribing, setReSubscribing] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [diagnostics, setDiagnostics] = useState<{
    permission: NotifPermissionState
    serviceWorkerActive: boolean
    subscriptionActive: boolean
    subscriptionCount: number
  } | null>(null)

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, employee_code, full_name, designation, work_email, employment_status, joining_date, branch_id, department_id, organization_id, reporting_manager_id, preferred_name, personal_email, mobile_number, alternate_mobile_number, current_address, permanent_address, emergency_contact_name, emergency_contact_relation, emergency_contact_phone')
        .eq('user_id', profile.id)
        .maybeSingle()
      if (cancelled) return
      if (error || !data) {
        setProfileError(error?.message ?? 'Employee record not found')
        setLoading(false)
        return
      }
      const e = data as EmployeeRecord
      setEmp(e)
      setSelf({
        preferred_name: e.preferred_name ?? '',
        personal_email: e.personal_email ?? '',
        mobile_number: e.mobile_number ?? '',
        alternate_mobile_number: e.alternate_mobile_number ?? '',
        current_address: e.current_address ?? '',
        permanent_address: e.permanent_address ?? '',
        emergency_contact_name: e.emergency_contact_name ?? '',
        emergency_contact_relation: e.emergency_contact_relation ?? '',
        emergency_contact_phone: e.emergency_contact_phone ?? '',
      })
      const [b, d, o] = await Promise.all([
        e.branch_id ? supabase.from('branches').select('name').eq('id', e.branch_id).maybeSingle() : Promise.resolve({ data: null }),
        e.department_id ? supabase.from('departments').select('name').eq('id', e.department_id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from('organizations').select('name').eq('id', e.organization_id).maybeSingle(),
      ])
      if (cancelled) return
      setBranchName((b.data as { name: string } | null)?.name ?? null)
      setDeptName((d.data as { name: string } | null)?.name ?? null)
      setOrgName((o.data as { name: string } | null)?.name ?? null)
      if (e.reporting_manager_id) {
        const { data: mgr } = await supabase.from('employees').select('full_name').eq('id', e.reporting_manager_id).maybeSingle()
        if (!cancelled) setManagerName((mgr as { full_name: string } | null)?.full_name ?? null)
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [profile?.id])

  async function handleProfileUpdate(e: FormEvent) {
    e.preventDefault()
    setProfileError(null)
    setProfileSuccess(false)
    if (!emp) return
    setSavingProfile(true)
    const { error } = await supabase
      .from('employees')
      .update({ ...self, updated_at: new Date().toISOString() })
      .eq('id', emp.id)
      .eq('user_id', profile!.id)
    if (error) {
      setProfileError(error.message ?? 'Failed to update profile')
    } else {
      setProfileSuccess(true)
    }
    setSavingProfile(false)
  }

  async function handlePasswordUpdate(e: FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    setPasswordSuccess(false)
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match'); return }
    if (newPassword.length < 6) { setPasswordError('Password must be at least 6 characters'); return }
    setSavingPassword(true)
    const { error } = await updatePassword(newPassword)
    if (error) { setPasswordError(error) } else { setPasswordSuccess(true); setNewPassword(''); setConfirmPassword('') }
    setSavingPassword(false)
  }

  useEffect(() => {
    setNotifPerm(getNotificationPermission())
    fetchMySubscriptions().then(setSubs)
  }, [])

  async function handleTestPush() {
    setTesting(true)
    setTestResult(null)
    const result = await sendTestPushNotification()
    setTestResult(result.message)
    setTesting(false)
    refreshDiagnostics()
  }

  async function refreshDiagnostics() {
    const d = await getPushDiagnostics()
    setDiagnostics(d)
    setNotifPerm(d.permission)
    setSubs(await fetchMySubscriptions())
  }

  async function handleRepairPush() {
    setRepairing(true)
    setTestResult(null)
    const result = await repairPushSubscription()
    setTestResult(result.message)
    setRepairing(false)
    refreshDiagnostics()
  }

  async function handleRemoveSub(id: string) {
    const ok = await removeSubscription(id)
    if (ok) setSubs(subs.filter((s) => s.id !== id))
  }

  async function handleReEnablePush() {
    setReSubscribing(true)
    setTestResult(null)
    try {
      await registerServiceWorker()
      const sub = await subscribeToPush()
      if (sub) {
        const saved = await saveSubscriptionToServer(sub)
        if (saved) {
          setNotifPerm('granted')
          const updated = await fetchMySubscriptions()
          setSubs(updated)
          setTestResult('Push notifications re-enabled.')
        } else {
          setTestResult('Could not save subscription. Please try again.')
        }
      } else {
        setTestResult('Could not subscribe to push. Check browser notification settings.')
      }
    } catch {
      setTestResult('An error occurred. Please try again.')
    }
    setReSubscribing(false)
  }

  if (!profile) return null
  if (loading) return <div className="page"><div className="card"><div className="card-body">Loading…</div></div></div>

  const readonlyFields: { label: string; value: string | null }[] = [
    { label: 'Full Name', value: emp?.full_name ?? null },
    { label: 'Work Email', value: emp?.work_email ?? null },
    { label: 'Role', value: profile.role ? ROLE_LABELS[profile.role] : null },
    { label: 'Status', value: profile.status },
    { label: 'Employee Code', value: emp?.employee_code ?? null },
    { label: 'Designation', value: emp?.designation ?? null },
    { label: 'Organization', value: orgName },
    { label: 'Branch', value: branchName },
    { label: 'Department', value: deptName },
    { label: 'Reporting Manager', value: managerName },
    { label: 'Joining Date', value: emp?.joining_date ?? null },
    { label: 'Employment Status', value: emp?.employment_status ?? null },
  ]

  const selfFields: { key: keyof SelfService; label: string }[] = [
    { key: 'preferred_name', label: 'Preferred Name' },
    { key: 'personal_email', label: 'Personal Email' },
    { key: 'mobile_number', label: 'Mobile Number' },
    { key: 'alternate_mobile_number', label: 'Alternate Mobile' },
    { key: 'current_address', label: 'Current Address' },
    { key: 'permanent_address', label: 'Permanent Address' },
    { key: 'emergency_contact_name', label: 'Emergency Contact Name' },
    { key: 'emergency_contact_relation', label: 'Emergency Contact Relation' },
    { key: 'emergency_contact_phone', label: 'Emergency Contact Phone' },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Account Settings</h2>
      </div>

      <div className="card">
        <div className="card-header">Profile Information</div>
        <div className="card-body">
          {profileError && <div className="form-error" style={{ marginBottom: 'var(--space-4)' }}>{profileError}</div>}
          {profileSuccess && <div className="form-success" style={{ marginBottom: 'var(--space-4)' }}>Profile updated successfully.</div>}
          <form onSubmit={handleProfileUpdate}>
            <div className="form-grid">
              {readonlyFields.map((f) => (
                <div className="form-field" key={f.label}>
                  <label>{f.label}</label>
                  <input value={f.value ?? '—'} disabled style={{ opacity: 0.6 }} readOnly />
                </div>
              ))}
              {selfFields.map((f) => (
                <div className="form-field" key={f.key}>
                  <label htmlFor={f.key}>{f.label}</label>
                  <input id={f.key} value={self[f.key]} onChange={(e) => setSelf({ ...self, [f.key]: e.target.value })} />
                </div>
              ))}
            </div>
            <div className="form-actions">
              <button type="submit" className="btn" disabled={savingProfile}>
                {savingProfile ? 'Saving…' : 'Save Profile'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Change Password</div>
        <div className="card-body">
          {passwordError && <div className="form-error" style={{ marginBottom: 'var(--space-4)' }}>{passwordError}</div>}
          {passwordSuccess && <div className="form-success" style={{ marginBottom: 'var(--space-4)' }}>Password updated successfully.</div>}
          <form onSubmit={handlePasswordUpdate}>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="newPassword">New Password</label>
                <input id="newPassword" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
              </div>
              <div className="form-field">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn" disabled={savingPassword}>
                {savingPassword ? 'Updating…' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Notification Preferences</div>
        <div className="card-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '13.5px' }}>Enable Notification Sound</div>
              <div style={{ fontSize: '12px', color: 'var(--slate)', marginTop: '2px' }}>
                Play a sound alert for attendance reminders. Sound only plays when the browser tab is open.
              </div>
            </div>
            <button
              className={`btn btn-sm ${soundEnabled ? '' : 'btn-secondary'}`}
              onClick={toggleSound}
              type="button"
            >
              {soundEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--slate)', marginTop: 'var(--space-3)', lineHeight: 1.5 }}>
            Note: Browser autoplay restrictions may prevent sound before interaction. If the tab is open and sound is enabled, a clear alert will play for attendance reminders. Sound does not play when the browser is fully closed.
          </p>
        </div>
      </div>

      {(profile.role === 'director' || profile.role === 'hr_admin' || profile.role === 'system_admin') && (
        <div className="card">
          <div className="card-header">Security — MFA</div>
          <div className="card-body">
            <p style={{ fontSize: '13px', color: 'var(--ink-text)', lineHeight: 1.6 }}>
              Multi-factor authentication is recommended for your role ({ROLE_LABELS[profile.role]}).
              MFA enrollment will be available in a future update. Please ensure your password is strong and unique.
            </p>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">Permissions & Devices</div>
        <div className="card-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div className="info-row" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="info-label">Notifications</span>
              <span className="info-value">
                {notifPerm === 'granted' && <span className="tag tag-teal">Enabled</span>}
                {notifPerm === 'denied' && <span className="tag tag-rose">Blocked</span>}
                {notifPerm === 'default' && <span className="tag tag-gray">Not configured</span>}
                {notifPerm === 'unsupported' && <span className="tag tag-gray">Unsupported</span>}
              </span>
            </div>

            <div className="info-row" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="info-label">Push Subscription</span>
              <span className="info-value">
                {subs.length > 0 ? <span className="tag tag-teal">Active ({subs.length})</span> : <span className="tag tag-gray">Inactive</span>}
              </span>
            </div>

            {notifPerm === 'denied' && (
              <div className="form-error" style={{ fontSize: '12px' }}>
                Notifications are blocked. Open your browser Site Settings and allow Notifications for this HRMS.
                <br /><br />
                <strong>Chrome/Edge:</strong> Click the lock icon next to the URL &gt; Site settings &gt; Notifications &gt; Allow.<br />
                <strong>Firefox:</strong> Click the lock icon &gt; Clear permissions, then reload.<br />
                <strong>Safari:</strong> Preferences &gt; Websites &gt; Notifications &gt; Allow for this site.
              </div>
            )}

            {notifPerm === 'default' && (
              <button className="btn btn-sm" onClick={handleReEnablePush} disabled={reSubscribing}>
                {reSubscribing ? 'Enabling…' : 'Enable Push Notifications'}
              </button>
            )}

            {testResult && (
              <div className="form-success" style={{ fontSize: '12.5px' }}>{testResult}</div>
            )}

            {subs.length > 0 && (
              <div style={{ marginTop: 'var(--space-3)' }}>
                <h4 style={{ fontSize: '13px', fontWeight: 600, marginBottom: 'var(--space-2)' }}>Registered Devices</h4>
                {subs.map((s) => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border)', gap: 'var(--space-2)' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '12.5px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.device_name || `${s.platform || ''} ${s.browser || ''}`}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--slate)' }}>
                        Last used: {s.last_used_at ? new Date(s.last_used_at).toLocaleDateString('en-IN') : 'Never'}
                      </div>
                    </div>
                    <button className="btn btn-sm btn-danger" onClick={() => handleRemoveSub(s.id)} type="button">
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {notifPerm === 'granted' && subs.length > 0 && (
              <button className="btn btn-sm btn-secondary" onClick={handleTestPush} disabled={testing} type="button" style={{ marginTop: 'var(--space-3)' }}>
                {testing ? 'Sending…' : 'Send Test Push Notification'}
              </button>
            )}

            {notifPerm === 'granted' && subs.length > 0 && (
              <button className="btn btn-sm btn-outline" onClick={handleRepairPush} disabled={repairing} type="button" style={{ marginTop: 'var(--space-2)' }}>
                {repairing ? 'Repairing…' : 'Repair Push Subscription'}
              </button>
            )}

            {diagnostics && (
              <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--surface)', borderRadius: '8px', fontSize: '11.5px', color: 'var(--slate)' }}>
                <div style={{ fontWeight: 600, marginBottom: 'var(--space-2)', color: 'var(--ink)' }}>Push Diagnostics</div>
                <div>Permission: <strong style={{ color: diagnostics.permission === 'granted' ? 'var(--success)' : 'var(--error)' }}>{diagnostics.permission}</strong></div>
                <div>Service Worker: <strong style={{ color: diagnostics.serviceWorkerActive ? 'var(--success)' : 'var(--error)' }}>{diagnostics.serviceWorkerActive ? 'Active' : 'Inactive'}</strong></div>
                <div>Browser Subscription: <strong style={{ color: diagnostics.subscriptionActive ? 'var(--success)' : 'var(--error)' }}>{diagnostics.subscriptionActive ? 'Active' : 'None'}</strong></div>
                <div>Registered Devices: <strong>{diagnostics.subscriptionCount}</strong></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
