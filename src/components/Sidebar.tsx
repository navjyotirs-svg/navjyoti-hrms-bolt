import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { navItemsForRole, ROLE_LABELS } from '@/types/roles'
import '@/styles/shell.css'

export function Sidebar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const items = navItemsForRole(profile?.role ?? null)

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  function closeMobile() {
    setMobileOpen(false)
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
          <p className="sidebar-brand-name">Navjyoti HRMS</p>
          <p className="sidebar-brand-sub">Unified Ops Portal</p>
        </div>

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
