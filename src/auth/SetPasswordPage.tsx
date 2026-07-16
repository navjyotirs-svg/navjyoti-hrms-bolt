import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import '@/styles/auth.css'

export function SetPasswordPage() {
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

    // The Supabase client has detectSessionInUrl: true, so it will automatically
    // exchange the code from the email link for a session.
    // We need to wait for the session to be established.
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      if (data.session) {
        setSessionReady(true)
        setCheckingSession(false)
      } else {
        // If no session yet, listen for the auth state change
        const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
          if (!mounted) return
          if (newSession) {
            setSessionReady(true)
            setCheckingSession(false)
          } else if (event === 'SIGNED_OUT') {
            setSessionReady(false)
            setCheckingSession(false)
          }
        })

        // Give it a short timeout — if no session arrives, the invitation link is invalid/expired
        setTimeout(() => {
          if (!mounted) return
          if (!sessionReady) {
            setCheckingSession(false)
          }
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

    // Account is already active from invite time — just set the password
    setSuccess(true)
    setSubmitting(false)

    // Sign out the recovery/invite session
    await supabase.auth.signOut()

    setTimeout(() => navigate('/login'), 3000)
  }

  if (checkingSession) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <h1 className="auth-title">Setting up your account</h1>
            <p className="auth-subtitle">Verifying your invitation link…</p>
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
          <div className="auth-brand">
            <h1 className="auth-title">Invalid or Expired Link</h1>
            <p className="auth-subtitle">This invitation link is no longer valid</p>
          </div>
          <div className="auth-form">
            <p style={{ fontSize: '13.5px', color: 'var(--ink-text)', lineHeight: 1.6, textAlign: 'center' }}>
              This invitation link may have expired or has already been used.
              Please contact your administrator to request a new invitation.
            </p>
            <Link to="/login" className="auth-link" style={{ display: 'block', textAlign: 'center', marginTop: 'var(--space-4)' }}>
              Back to sign in
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
          <div className="auth-brand">
            <h1 className="auth-title">Password Created</h1>
          </div>
          <div className="auth-form">
            <div className="form-success">
              Your password has been created successfully. You can now sign in.
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
        <div className="auth-brand">
          <h1 className="auth-title">Create Your Password</h1>
          <p className="auth-subtitle">Set a password to activate your account</p>
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
            {submitting ? 'Creating…' : 'Create Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
