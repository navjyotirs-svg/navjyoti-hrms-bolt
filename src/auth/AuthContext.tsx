import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)

  async function fetchProfileAndPermissions(userId: string) {
    setProfileError(null)

    const { data: profileData, error: profileError } = await supabase
      .from('user_profiles')
      .select('id, email, full_name, role, organization_id, status, is_active')
      .eq('id', userId)
      .maybeSingle()

    if (profileError) {
      setProfileError(`Failed to load profile: ${profileError.message}`)
      setProfile(null)
      setPermissions([])
      return
    }

    if (!profileData) {
      setProfileError('User profile not found. Please contact your administrator.')
      setProfile(null)
      setPermissions([])
      return
    }

    setProfile(profileData as UserProfile)

    if (!(profileData as UserProfile).organization_id) {
      setProfileError('No organization membership found. Please contact your administrator.')
      setPermissions([])
      return
    }

    if ((profileData as UserProfile).role) {
      const roleCode = (profileData as UserProfile).role as string

      const { data: roleRow, error: roleError } = await supabase
        .from('roles')
        .select('id')
        .eq('code', roleCode)
        .maybeSingle()

      if (roleError || !roleRow) {
        setProfileError(`Failed to resolve role "${roleCode}". Please contact your administrator.`)
        setPermissions([])
        return
      }

      const { data: permData, error: permError } = await supabase
        .from('role_permissions')
        .select('permissions!inner(code)')
        .eq('role_id', (roleRow as { id: string }).id)

      if (permError) {
        setProfileError(`Failed to load permissions: ${permError.message}`)
        setPermissions([])
        return
      }

      if (!permData || permData.length === 0) {
        setProfileError('No permissions assigned to your role. Please contact your administrator.')
        setPermissions([])
        return
      }

      const codes: Permission[] = []
      for (const row of permData as { permissions: { code: string }[] }[]) {
        for (const p of row.permissions) {
          codes.push(p.code as Permission)
        }
      }
      setPermissions(codes)
    }
  }

  async function refreshProfile() {
    if (session?.user) {
      await fetchProfileAndPermissions(session.user.id)
    }
  }

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (data.session) {
        fetchProfileAndPermissions(data.session.user.id).finally(() => {
          if (mounted) setLoading(false)
        })
      } else {
        setLoading(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (newSession) {
        setLoading(true)
        fetchProfileAndPermissions(newSession.user.id).finally(() => setLoading(false))
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
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
    setPermissions([])
    setProfileError(null)
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
