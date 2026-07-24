import { Link } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { NavjyotiLogo } from '@/components/NavjyotiLogo'
import '@/styles/auth.css'

export function UnauthorizedPage() {
  const { signOut } = useAuth()

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <NavjyotiLogo width={240} maxHeight={70} clickable />
        </div>
        <div className="auth-brand">
          <h1 className="auth-title">Access Denied</h1>
          <p className="auth-subtitle">You do not have permission to view this page</p>
        </div>

        <div className="auth-form">
          <p style={{ fontSize: '13.5px', color: 'var(--ink-text)', lineHeight: 1.6, textAlign: 'center' }}>
            Your role does not grant access to this section of the portal.
            If you believe this is an error, please contact your administrator.
          </p>

          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-5)' }}>
            <Link to="/" className="auth-submit" style={{ textDecoration: 'none', textAlign: 'center' }}>
              Go to Dashboard
            </Link>
            <button
              type="button"
              className="auth-submit btn-secondary"
              style={{ background: 'var(--surface)', color: 'var(--ink-text)', border: '1px solid var(--border)' }}
              onClick={() => signOut()}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
