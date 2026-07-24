import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { NavjyotiLogo } from '@/components/NavjyotiLogo'
import '@/styles/auth.css'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      if (data.session) {
        setSessionReady(true)
        setCheckingSession(false)
      } else {
        const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
          if (!mounted) return
          if (newSession) {
            setSessionReady(true)
            setCheckingSession(false)
          }
        })

        setTimeout(() => {
          if (!mounted) return
          setCheckingSession(false)
          listener.subscription.unsubscribe()
        }, 5000)
      }
    })

    return () => {
      mounted = false
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password must include uppercase, lowercase, and a number')
      return
    }

    setSubmitting(true)

    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(updateError.message)
      setSubmitting(false)
      return
    }

    setSuccess(true)
    setSubmitting(false)

    // Sign out the recovery session
    await supabase.auth.signOut()

    setTimeout(() => navigate('/login'), 3000)
  }

  if (checkingSession) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <NavjyotiLogo width={240} maxHeight={70} clickable />
          </div>
          <div className="auth-brand">
            <h1 className="auth-title">Reset Password</h1>
            <p className="auth-subtitle">Verifying your reset link…</p>
          </div>
          <div style={{ textAlign: 'center', padding: 'var(--space-6) 0' }}>
            <p style={{ color: 'var(--slate)', fontSize: '14px' }}>Please wait…</p>
          </div>
        </div>
      </div>
    )
  }

  if (!sessionReady && !success) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <NavjyotiLogo width={240} maxHeight={70} clickable />
          </div>
          <div className="auth-brand">
            <h1 className="auth-title">Invalid or Expired Link</h1>
            <p className="auth-subtitle">This password reset link is no longer valid</p>
          </div>
          <div className="auth-form">
            <p style={{ fontSize: '13.5px', color: 'var(--ink-text)', lineHeight: 1.6, textAlign: 'center' }}>
              This reset link may have expired or has already been used.
              Please request a new password reset link.
            </p>
            <Link to="/forgot-password" className="auth-link" style={{ display: 'block', textAlign: 'center', marginTop: 'var(--space-4)' }}>
              Request new reset link
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <NavjyotiLogo width={240} maxHeight={70} clickable />
          </div>
          <div className="auth-brand">
            <h1 className="auth-title">Password Reset</h1>
          </div>
          <div className="auth-form">
            <div className="form-success">
              Your password has been reset successfully.
            </div>
            <p style={{ fontSize: '12.5px', color: 'var(--slate)', textAlign: 'center', marginTop: 'var(--space-3)' }}>
              Redirecting to sign in…
            </p>
            <Link to="/login" className="auth-link" style={{ display: 'block', textAlign: 'center', marginTop: 'var(--space-4)' }}>
              Go to sign in
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <NavjyotiLogo width={240} maxHeight={70} clickable />
        </div>
        <div className="auth-brand">
          <h1 className="auth-title">Set New Password</h1>
          <p className="auth-subtitle">Choose a new password for your account</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label htmlFor="password">New Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div className="auth-field">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>

          <p style={{ fontSize: '11.5px', color: 'var(--slate)', marginTop: 'var(--space-2)' }}>
            Password must be at least 8 characters with uppercase, lowercase, and a number.
          </p>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
