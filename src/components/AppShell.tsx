import { useState, useEffect, useCallback } from 'react'
import { Outlet, useLocation, Navigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { useAuth } from '@/auth/AuthContext'
import { PendingActivationPage } from '@/auth/PendingActivationPage'
import '@/styles/shell.css'

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/organization': 'Organization',
  '/branches': 'Branches',
  '/departments': 'Departments',
  '/employees': 'Employees',
  '/employees/add': 'Invite Employee',
  '/hierarchy': 'Reporting Hierarchy',
  '/roles': 'Roles & Permissions',
  '/audit': 'Audit Trail',
  '/attendance': 'My Attendance',
  '/attendance-management': 'Attendance Management',
  '/attendance-corrections': 'Corrections',
  '/settings': 'Account Settings',
}

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]
  if (pathname.startsWith('/employees/')) return 'Employee Profile'
  return 'Dashboard'
}

const SOUND_PREF_KEY = 'navjyoti_notif_sound_enabled'

export function AppShell() {
  const location = useLocation()
  const { profile } = useAuth()
  const title = getPageTitle(location.pathname)
  const [soundEnabled, setSoundEnabled] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(SOUND_PREF_KEY)
    setSoundEnabled(stored === 'true')
  }, [])

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev
      localStorage.setItem(SOUND_PREF_KEY, String(next))
      return next
    })
  }, [])

  if (profile?.status === 'pending_activation') {
    return <PendingActivationPage />
  }

  if (profile?.status === 'disabled') {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-main">
        <Topbar title={title} soundEnabled={soundEnabled} />
        <main className="app-content">
          <Outlet context={{ soundEnabled, toggleSound }} />
        </main>
      </div>
    </div>
  )
}
