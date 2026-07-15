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

  async function fetchProfileAndPermissions(userId: string) {
    const { data: profileData, error: profileError } = await supabase
      .from('user_profiles')
      .select('id, email, full_name, role, organization_id, status, is_active')
      .eq('id', userId)
      .maybeSingle()

    if (profileError) {
      console.error('Failed to load user profile:', profileError.message)
      return
    }

    setProfile(profileData as UserProfile | null)

    if (profileData?.role) {
      const { data: permData, error: permError } = await supabase
        .from('role_permissions')
        .select('permissions!inner(code)')
        .eq('role_id', (await supabase.from('roles').select('id').eq('code', profileData.role).maybeSingle()).data?.id)

      if (!permError && permData) {
        const codes: Permission[] = []
        for (const row of permData as { permissions: { code: string }[] }[]) {
          for (const p of row.permissions) {
            codes.push(p.code as Permission)
          }
        }
        setPermissions(codes)
      }
    }
  }

  async function refreshProfile() {
    if (session?.user) {
      await fetchProfileAndPermissions(session.user.id)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) {
        fetchProfileAndPermissions(data.session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      ;(async () => {
        setSession(newSession)
        if (newSession) {
          await fetchProfileAndPermissions(newSession.user.id)
        } else {
          setProfile(null)
          setPermissions([])
        }
      })()
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
    setPermissions([])
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
      value={{ session, profile, permissions, loading, signIn, signOut, resetPassword, updatePassword, refreshProfile }}
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
