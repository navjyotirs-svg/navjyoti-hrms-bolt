import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import '@/styles/shell.css'

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/employees': 'Employees',
  '/attendance': 'Attendance',
  '/leave': 'Leave Management',
  '/tasks': 'Tasks',
  '/tickets': 'Tickets',
  '/daily-reports': 'Daily Reports',
  '/calendar': 'Calendar',
  '/notifications': 'Notifications',
  '/audit': 'Audit Trail',
}

export function AppShell() {
  const location = useLocation()
  const title = PAGE_TITLES[location.pathname] ?? 'Dashboard'

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-main">
        <Topbar title={title} />
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
