import { useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { ROLE_LABELS } from '@/types/roles'
import { supabase } from '@/lib/supabase'
import '@/styles/shared.css'

export function AccountSettingsPage() {
  const { profile, updatePassword, refreshProfile } = useAuth()
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSuccess, setProfileSuccess] = useState(false)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  async function handleProfileUpdate(e: FormEvent) {
    e.preventDefault()
    setProfileError(null)
    setProfileSuccess(false)
    setSavingProfile(true)

    const { error } = await supabase
      .from('user_profiles')
      .update({ full_name: fullName, updated_at: new Date().toISOString() })
      .eq('id', profile!.id)

    if (error) {
      setProfileError(error.message ?? 'Failed to update profile')
    } else {
      setProfileSuccess(true)
      await refreshProfile()
    }
    setSavingProfile(false)
  }

  async function handlePasswordUpdate(e: FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    setPasswordSuccess(false)

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters')
      return
    }

    setSavingPassword(true)
    const { error } = await updatePassword(newPassword)
    if (error) {
      setPasswordError(error)
    } else {
      setPasswordSuccess(true)
      setNewPassword('')
      setConfirmPassword('')
    }
    setSavingPassword(false)
  }

  if (!profile) return null

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
              <div className="form-field">
                <label htmlFor="fullName">Full Name</label>
                <input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="form-field">
                <label>Email</label>
                <input value={profile.email} disabled style={{ opacity: 0.6 }} />
              </div>
              <div className="form-field">
                <label>Role</label>
                <input value={profile.role ? ROLE_LABELS[profile.role] : '—'} disabled style={{ opacity: 0.6 }} />
              </div>
              <div className="form-field">
                <label>Status</label>
                <input value={profile.status} disabled style={{ opacity: 0.6 }} />
              </div>
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
    </div>
  )
}
