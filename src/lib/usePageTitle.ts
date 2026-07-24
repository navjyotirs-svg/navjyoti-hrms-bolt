import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

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
  '/attendance': 'Attendance',
  '/attendance-management': 'Attendance Management',
  '/attendance-corrections': 'Corrections',
  '/my-reports': 'My Daily Report',
  '/report-history': 'Report History',
  '/team-reports': 'Team Reports',
  '/report-review': 'Report Review',
  '/org-summary': 'Org Daily Summary',
  '/follow-up-queue': 'Follow-up Queue',
  '/announcements': 'Announcements',
  '/export-center': 'Export Center',
  '/notification-inbox': 'Notification Inbox',
  '/settings': 'Account Settings',
  '/my-tasks': 'Tasks',
  '/tasks/create': 'Assign Task',
  '/team-tasks': 'Team Tasks',
  '/task-review': 'Task Review',
  '/my-tickets': 'My Tickets',
  '/ticket-management': 'Ticket Management',
  '/my-leave': 'My Leave',
  '/team-leave': 'Team Leave',
  '/leave-management': 'Leave Management',
  '/calendar': 'Calendar',
  '/holiday-management': 'Holiday Management',
  '/login': 'Login',
  '/forgot-password': 'Forgot Password',
  '/permission-setup': 'Permission Setup',
}

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]
  if (pathname.startsWith('/employees/')) return 'Employee Profile'
  if (pathname.startsWith('/tasks/') && pathname !== '/tasks/create') return 'Task Details'
  if (pathname.startsWith('/tickets/')) return 'Ticket Details'
  return 'Dashboard'
}

export function usePageTitle(): void {
  const location = useLocation()

  useEffect(() => {
    const pageName = getPageTitle(location.pathname)
    document.title = `${pageName} | Navjyoti HRMS`
  }, [location.pathname])
}
