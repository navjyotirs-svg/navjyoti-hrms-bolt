import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from './AuthContext'
import '@/styles/auth.css'

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { error } = await signIn(email, password)
    if (error) {
      const msg = error.toLowerCase()
      if (msg.includes('invalid login credentials')) {
        setError('Invalid email or password.')
      } else if (msg.includes('email not confirmed')) {
        setError('Your account setup is incomplete. Please open the invitation email and create your password.')
      } else if (msg.includes('disabled') || msg.includes('inactive')) {
        setError('Your account is inactive. Please contact HR.')
      } else {
        setError('Unable to sign in. Please try again or contact your administrator.')
      }
      setSubmitting(false)
    } else {
      // Check if the user profile is pending activation
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('status')
        .eq('email', email)
        .maybeSingle()

      if (profile?.status === 'pending_activation') {
        setError('Your account setup is incomplete. Please open the invitation email and create your password.')
        await supabase.auth.signOut()
        setSubmitting(false)
        return
      }

      navigate('/')
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <h1 className="auth-title">Navjyoti HRMS</h1>
          <p className="auth-subtitle">Unified Operations Portal</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@navjyoti.org"
              required
            />
          </div>
          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? 'Please wait…' : 'Sign In'}
          </button>
        </form>

        <p className="auth-note">
          <Link to="/forgot-password" className="auth-link">
            Forgot password?
          </Link>
        </p>

        <p className="auth-note" style={{ marginTop: 'var(--space-3)', fontSize: '11.5px' }}>
          Account creation is managed by authorized administrators.
        </p>
      </div>
    </div>
  )
}
