import { useState, useEffect, useCallback } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { navItemsForPermissions, NAV_ITEMS, ROLE_LABELS } from '@/types/roles'
import { NavjyotiLogo } from '@/components/NavjyotiLogo'
import { SidebarHrmsLabel } from '@/components/HrmsLabel'
import '@/styles/shell.css'

export function Sidebar() {
  const { profile, permissions, signOut, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  const items = navItemsForPermissions(permissions)

  const closeMobile = useCallback(() => setMobileOpen(false), [])

  // Close drawer on route change
  useEffect(() => {
    closeMobile()
  }, [location.pathname, closeMobile])

  // Escape closes drawer + body scroll lock
  useEffect(() => {
    if (!mobileOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMobile()
    }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [mobileOpen, closeMobile])

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  async function handleReload() {
    setReloading(true)
    await refreshProfile()
    setReloading(false)
  }

  return (
    <>
      <button
        className="sidebar-toggle"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle navigation"
        type="button"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="6" x2="17" y2="6" />
          <line x1="3" y1="10" x2="17" y2="10" />
          <line x1="3" y1="14" x2="17" y2="14" />
        </svg>
      </button>

      {mobileOpen && <div className="sidebar-overlay" onClick={closeMobile} />}

      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-logo">
            <NavjyotiLogo width={195} maxHeight={75} clickable />
          </div>
        </div>

        <SidebarHrmsLabel />

        <nav className="sidebar-nav">
          {items.map((item) => (
            <NavLink
              key={item.id}
              to={`/${item.id === 'dashboard' ? '' : item.id}`}
              end={item.id === 'dashboard'}
              className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
              onClick={closeMobile}
            >
              <svg
                className="sidebar-item-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={item.icon} />
              </svg>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {import.meta.env.DEV && (
          <div className="sidebar-diagnostics">
            <button
              type="button"
              className="sidebar-diagnostics-toggle"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
            >
              {showDiagnostics ? 'Hide' : 'Show'} permission diagnostics
            </button>
            {showDiagnostics && (
              <DevDiagnostics
                role={profile?.role}
                permCount={permissions.length}
                orgId={profile?.organization_id}
                hiddenItems={NAV_ITEMS.filter((n) => n.permissions.length > 0 && !n.permissions.some((p) => permissions.includes(p as typeof permissions[number])))}
                onReload={handleReload}
                reloading={reloading}
              />
            )}
          </div>
        )}

        <div className="sidebar-foot">
          <p className="sidebar-foot-label">Signed in as</p>
          <p className="sidebar-foot-name">{profile?.full_name ?? profile?.email}</p>
          <p className="sidebar-foot-role">{profile?.role ? ROLE_LABELS[profile.role] : '—'}</p>
          <button className="sidebar-signout" onClick={handleSignOut} type="button">
            Sign Out
          </button>
        </div>
      </aside>
    </>
  )
}

function DevDiagnostics({ role, permCount, orgId, hiddenItems, onReload, reloading }: {
  role: string | null | undefined
  permCount: number
  orgId: string | null | undefined
  hiddenItems: { id: string; label: string; permissions: string[] }[]
  onReload: () => void
  reloading: boolean
}) {
  return (
    <div className="sidebar-diagnostics-panel">
      <div className="sidebar-diagnostics-title">DEV DIAGNOSTICS</div>
      <div>Role: {role ?? 'none'}</div>
      <div>Org: {orgId ? 'set' : 'MISSING'}</div>
      <div>Permissions: {permCount}</div>
      {hiddenItems.length > 0 && (
        <div className="sidebar-diagnostics-hidden">
          <div className="sidebar-diagnostics-title">Hidden nav:</div>
          {hiddenItems.map((h) => (
            <div key={h.id} className="sidebar-diagnostics-hidden-item">
              {h.label} — needs: {h.permissions.join(', ')}
            </div>
          ))}
        </div>
      )}
      <button
        onClick={onReload}
        disabled={reloading}
        type="button"
        className="sidebar-diagnostics-reload"
      >
        {reloading ? 'Reloading…' : 'Reload permissions'}
      </button>
    </div>
  )
}
