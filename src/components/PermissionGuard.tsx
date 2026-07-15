import type { ReactNode } from 'react'
import { useAuth } from '@/auth/AuthContext'
import type { Permission } from '@/types/roles'
import { UnauthorizedPage } from '@/auth/UnauthorizedPage'

interface PermissionGuardProps {
  permissions: Permission[]
  children: ReactNode
}

export function PermissionGuard({ permissions, children }: PermissionGuardProps) {
  const { permissions: userPerms } = useAuth()

  if (permissions.length === 0) return <>{children}</>

  const hasAccess = permissions.some((p) => userPerms.includes(p))
  if (!hasAccess) return <UnauthorizedPage />
  return <>{children}</>
}
