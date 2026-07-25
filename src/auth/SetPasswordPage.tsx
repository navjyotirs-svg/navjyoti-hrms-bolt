import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { NavjyotiLogo } from '@/components/NavjyotiLogo'
import '@/styles/auth.css'

type PageState = 'checking' | 'expired' | 'ready' | 'success'

export function SetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pageState, setPageState] = useState<PageState>('checking')

  useEffect(() => {
    let mounted = true

    // Detect expired/invalid invitation links from Supabase Auth redirect
    const url = new URL(window.location.href)
    const errorCode = url.searchParams.get('error_code')
    const hash = url.hash

    // Supabase may put error info in the hash fragment
    const hashParams = new URLSearchParams(hash.replace(/^#/, ''))
    const hashErrorCode = hashParams.get('error_code')

    if (errorCode === 'otp_expired' || hashErrorCode === 'otp_expired') {
      if (mounted) setPageState('expired')
      // Clean the URL so the error doesn't persist on refresh
      window.history.replaceState({}, document.title, '/set-password')
      return
    }

    if (errorCode === 'access_denied' || hashErrorCode === 'access_denied') {
      if (mounted) setPageState('expired')
      window.history.replaceState({}, document.title, '/set-password')
      return
    }

    // The Supabase client has detectSessionInUrl: true, so it will automatically
    // exchange the code from the email link for a session.
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      if (data.session) {
        setPageState('ready')
      } else {
        // Listen for the auth state change from the email link exchange
        const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
          if (!mounted) return
          if (newSession) {
            setPageState('ready')
          } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
            // Wait briefly — the session may still be establishing
          }
        })

        // Timeout — if no session arrives, the invitation link is invalid/expired
        setTimeout(() => {
          if (!mounted) return
          listener.subscription.unsubscribe()
          setPageState((prev) => (prev === 'checking' ? 'expired' : prev))
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

    // Refresh the session to ensure we have a valid, fresh access token for activation
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError || !refreshData.session) {
      // If refresh fails, try getSession as fallback
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        setError('Password created, but session expired before activation. Please contact your administrator.')
        setSubmitting(false)
        await supabase.auth.signOut()
        return
      }
    }

    // Activate the account via the atomic SECURITY DEFINER RPC
    let activationError: string | null = null
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        activationError = 'No session found for activation'
      } else {
        // Use the atomic RPC directly via the Supabase client — it uses auth.uid()
        // internally so no client-supplied user ID is needed.
        const { data: rpcResult, error: rpcError } = await supabase.rpc('activate_employee_account')

        if (rpcError) {
          activationError = rpcError.message
        } else if (rpcResult && !rpcResult.success) {
          activationError = rpcResult.message || rpcResult.error || 'Activation failed'
        }
      }
    } catch (err) {
      activationError = err instanceof Error ? err.message : 'Network error during activation'
    }

    if (activationError) {
      setError(`Password created, but account activation failed: ${activationError}. Please contact your administrator.`)
      setSubmitting(false)
      await supabase.auth.signOut()
      return
    }

    setPageState('success')
    setSubmitting(false)

    // Sign out the recovery/invite session
    await supabase.auth.signOut()

    setTimeout(() => navigate('/login'), 3000)
  }

  if (pageState === 'checking') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <NavjyotiLogo width={240} maxHeight={70} clickable />
          </div>
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

  if (pageState === 'expired') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <NavjyotiLogo width={240} maxHeight={70} clickable />
          </div>
          <div className="auth-brand">
            <h1 className="auth-title">Invitation Link Expired</h1>
            <p className="auth-subtitle">This invitation link is no longer valid</p>
          </div>
          <div className="auth-form">
            <p style={{ fontSize: '13.5px', color: 'var(--ink-text)', lineHeight: 1.6, textAlign: 'center' }}>
              This invitation link has expired or has already been used.
              Please ask HR to send a new invitation.
            </p>
            <Link to="/login" className="auth-link" style={{ display: 'block', textAlign: 'center', marginTop: 'var(--space-4)' }}>
              Return to Login
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (pageState === 'success') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <NavjyotiLogo width={240} maxHeight={70} clickable />
          </div>
          <div className="auth-brand">
            <h1 className="auth-title">Password Created</h1>
          </div>
          <div className="auth-form">
            <div className="form-success">
              Your password has been created successfully. Your account is now active.
              You can sign in with your email and new password.
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
