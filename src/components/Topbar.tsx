import { useAuth } from '@/auth/AuthContext'
import { ROLE_LABELS } from '@/types/roles'
import { NotificationBell } from '@/components/NotificationBell'
import '@/styles/shell.css'

interface TopbarProps {
  title: string
  soundEnabled: boolean
}

export function Topbar({ title, soundEnabled }: TopbarProps) {
  const { profile } = useAuth()

  return (
    <header className="topbar">
      <h1 className="topbar-title">{title}</h1>
      <div className="topbar-right">
        {profile?.id && <NotificationBell userId={profile.id} soundEnabled={soundEnabled} />}
        <div className="topbar-user">
          <span className="topbar-user-name">{profile?.full_name ?? profile?.email}</span>
          <span className="topbar-user-role">
            {profile?.role ? ROLE_LABELS[profile.role] : ''}
          </span>
        </div>
      </div>
    </header>
  )
}
