import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { NavjyotiLogo } from '@/components/NavjyotiLogo'
import '@/styles/auth.css'

const COOLDOWN_SECONDS = 30

export function ForgotPasswordPage() {
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setSubmitting(true)

    const { error } = await resetPassword(email)
    if (error) {
      setError(error)
    } else {
      setSuccess(true)
      setCooldown(COOLDOWN_SECONDS)
      const timer = setInterval(() => {
        setCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(timer)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    setSubmitting(false)
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <NavjyotiLogo width={240} maxHeight={70} clickable />
        </div>
        <div className="auth-brand">
          <h1 className="auth-title">Reset Password</h1>
          <p className="auth-subtitle">Enter your email to receive a reset link</p>
        </div>

        {success ? (
          <div className="auth-form">
            <div className="form-success">
              If an account exists for this email, a password reset link has been sent.
            </div>
            <Link to="/login" className="auth-link" style={{ display: 'block', textAlign: 'center', marginTop: 'var(--space-4)' }}>
              Back to sign in
            </Link>
          </div>
        ) : (
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

            {error && <div className="auth-error">{error}</div>}

            <button type="submit" className="auth-submit" disabled={submitting || cooldown > 0}>
              {submitting ? 'Please wait…' : cooldown > 0 ? `Wait ${cooldown}s` : 'Send Reset Link'}
            </button>
          </form>
        )}

        <p className="auth-note">
          <Link to="/login" className="auth-link">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
