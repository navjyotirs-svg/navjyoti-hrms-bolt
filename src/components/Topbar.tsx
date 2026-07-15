import { useAuth } from '@/auth/AuthContext'
import { ROLE_LABELS } from '@/types/roles'
import '@/styles/shell.css'

interface TopbarProps {
  title: string
}

export function Topbar({ title }: TopbarProps) {
  const { profile } = useAuth()

  return (
    <header className="topbar">
      <h1 className="topbar-title">{title}</h1>
      <div className="topbar-right">
        <button className="topbar-bell" type="button" aria-label="Notifications">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </button>
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
