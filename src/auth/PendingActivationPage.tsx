import { useAuth } from './AuthContext'
import '@/styles/auth.css'

export function PendingActivationPage() {
  const { profile, signOut } = useAuth()

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <h1 className="auth-title">Account Pending</h1>
          <p className="auth-subtitle">Awaiting administrator activation</p>
        </div>

        <div className="auth-form">
          <p style={{ fontSize: '13.5px', color: 'var(--ink-text)', lineHeight: 1.6, textAlign: 'center' }}>
            Your account (<strong>{profile?.email}</strong>) has been created but is
            pending activation by a Director or HR Administrator.
          </p>
          <p style={{ fontSize: '12.5px', color: 'var(--slate)', textAlign: 'center', marginTop: 'var(--space-3)' }}>
            You will be able to access the portal once your account is activated.
            Please contact your administrator if you have questions.
          </p>

          <button
            type="button"
            className="auth-submit"
            style={{ marginTop: 'var(--space-5)' }}
            onClick={() => signOut()}
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}
