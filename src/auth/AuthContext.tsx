import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Role, Permission, AccountStatus } from '@/types/roles'

export interface UserProfile {
  id: string
  email: string
  full_name: string | null
  role: Role | null
  organization_id: string | null
  status: AccountStatus
  is_active: boolean
}

interface AuthContextValue {
  session: Session | null
  profile: UserProfile | null
  permissions: Permission[]
  loading: boolean
  profileError: string | null
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error: string | null }>
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const DEV = import.meta.env.DEV

function devLog(label: string, ...args: unknown[]) {
  if (DEV) console.log(`[AuthContext] ${label}`, ...args)
}

function logError(label: string, message: string) {
  console.error(`[AuthContext] ${label}: ${message}`)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)

  const fetchProfileAndPermissions = useCallback(async (userId: string) => {
    setProfileError(null)
    devLog('fetchProfileAndPermissions start, userId:', userId)

    const { data: profileData, error: profileErr } = await supabase
      .from('user_profiles')
      .select('id, email, full_name, role, organization_id, status, is_active')
      .eq('id', userId)
      .maybeSingle()

    if (profileErr) {
      logError('Profile query error', profileErr.message)
      setProfileError(`Failed to load profile: ${profileErr.message}`)
      setProfile(null)
      setPermissions([])
      return
    }

    devLog('Profile loaded:', { role: profileData?.role, org_id: profileData?.organization_id, status: profileData?.status, is_active: profileData?.is_active })

    if (!profileData) {
      setProfileError('User profile not found. Please contact your administrator.')
      setProfile(null)
      setPermissions([])
      return
    }

    setProfile(profileData as UserProfile)

    if (!profileData.organization_id) {
      setProfileError('No organization membership found. Please contact your administrator.')
      setPermissions([])
      return
    }

    if (!profileData.is_active) {
      setProfileError('Your account is not active. Please contact your administrator.')
      setPermissions([])
      return
    }

    const { data: membership, error: membershipErr } = await supabase
      .from('user_organization_memberships')
      .select('organization_id, is_active')
      .eq('user_id', userId)
      .eq('organization_id', profileData.organization_id)
      .maybeSingle()

    devLog('Membership query:', { data: membership, error: membershipErr?.message })

    if (membershipErr || !membership) {
      setProfileError('No active organization membership found. Please contact your administrator.')
      setPermissions([])
      return
    }

    if (!membership.is_active) {
      setProfileError('Your organization membership is not active. Please contact your administrator.')
      setPermissions([])
      return
    }

    devLog('Calling get_my_effective_permissions() RPC...')
    const { data: permCodes, error: permErr } = await supabase
      .rpc('get_my_effective_permissions')

    if (permErr) {
      logError('RPC error', permErr.message)
      setProfileError(`Failed to load permissions: ${permErr.message}`)
      setPermissions([])
      return
    }

    devLog('RPC returned:', { codes: permCodes, count: permCodes?.length ?? 0 })

    if (!permCodes || permCodes.length === 0) {
      setProfileError('Your account role is active, but no permissions are assigned. Please contact the system administrator.')
      setPermissions([])
      return
    }

    devLog('Permissions loaded successfully:', permCodes.length, 'codes')
    setPermissions(permCodes as Permission[])
  }, [])

  const refreshProfile = useCallback(async () => {
    if (session?.user) {
      await fetchProfileAndPermissions(session.user.id)
    }
  }, [session, fetchProfileAndPermissions])

  useEffect(() => {
    let mounted = true

    devLog('AuthProvider mounted, getting session...')

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      devLog('Session result:', { hasSession: !!data.session, userId: data.session?.user?.id })
      setSession(data.session)
      if (data.session) {
        fetchProfileAndPermissions(data.session.user.id).finally(() => {
          if (mounted) setLoading(false)
        })
      } else {
        setLoading(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      devLog('Auth state change:', event, { hasSession: !!newSession })
      setSession(newSession)
      if (newSession) {
        setLoading(true)
        fetchProfileAndPermissions(newSession.user.id).finally(() => {
          if (mounted) setLoading(false)
        })
      } else {
        setProfile(null)
        setPermissions([])
        setProfileError(null)
        setLoading(false)
      }
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [fetchProfileAndPermissions])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
    setPermissions([])
    setProfileError(null)
    // Clear permission setup state so user re-runs setup on next login
    try {
      localStorage.removeItem('navjyoti_permission_setup_done')
    } catch {}
  }

  async function resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { error: error?.message ?? null }
  }

  async function updatePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    return { error: error?.message ?? null }
  }

  return (
    <AuthContext.Provider
      value={{ session, profile, permissions, loading, profileError, signIn, signOut, resetPassword, updatePassword, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
