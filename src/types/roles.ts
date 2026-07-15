export type Role =
  | 'director'
  | 'hr_administrator'
  | 'manager'
  | 'team_leader'
  | 'employee'
  | 'intern_trainee'
  | 'system_administrator'

export interface RoleDefinition {
  key: Role
  label: string
  description: string
}

export const ROLES: RoleDefinition[] = [
  { key: 'director', label: 'Director', description: 'Full system access and final approval authority' },
  { key: 'hr_administrator', label: 'HR Administrator', description: 'Employee lifecycle, leave, and HR operations' },
  { key: 'manager', label: 'Manager', description: 'Department management, task assignment, and approvals' },
  { key: 'team_leader', label: 'Team Leader', description: 'Team coordination and task oversight' },
  { key: 'employee', label: 'Employee', description: 'Personal attendance, tasks, reports, and tickets' },
  { key: 'intern_trainee', label: 'Intern / Trainee', description: 'Learning track with guided task assignment' },
  { key: 'system_administrator', label: 'System Administrator', description: 'Platform configuration and security' },
]

export const ROLE_LABELS: Record<Role, string> = ROLES.reduce(
  (acc, r) => ({ ...acc, [r.key]: r.label }),
  {} as Record<Role, string>
)

export type NavItem = {
  id: string
  label: string
  icon: string
  roles: Role[]
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z', roles: ['director', 'hr_administrator', 'manager', 'team_leader', 'employee', 'intern_trainee', 'system_administrator'] },
  { id: 'employees', label: 'Employees', icon: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-2a4 4 0 10-8 4 4 0 000 8z', roles: ['director', 'hr_administrator', 'manager'] },
  { id: 'attendance', label: 'Attendance', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', roles: ['director', 'hr_administrator', 'manager', 'team_leader', 'employee', 'intern_trainee'] },
  { id: 'leave', label: 'Leave', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', roles: ['director', 'hr_administrator', 'manager', 'team_leader', 'employee', 'intern_trainee'] },
  { id: 'tasks', label: 'Tasks', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4', roles: ['director', 'hr_administrator', 'manager', 'team_leader', 'employee', 'intern_trainee'] },
  { id: 'tickets', label: 'Tickets', icon: 'M8 10h8M8 14h5m-9 7h11a2 2 0 002-2V5a2 2 0 00-2-2H4a2 2 0 00-2 2v14a2 2 0 002 2z', roles: ['director', 'hr_administrator', 'manager', 'team_leader', 'employee', 'intern_trainee'] },
  { id: 'daily-reports', label: 'Daily Reports', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', roles: ['director', 'hr_administrator', 'manager', 'team_leader', 'employee', 'intern_trainee'] },
  { id: 'calendar', label: 'Calendar', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', roles: ['director', 'hr_administrator', 'manager', 'team_leader', 'employee', 'intern_trainee'] },
  { id: 'notifications', label: 'Notifications', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9', roles: ['director', 'hr_administrator', 'manager', 'team_leader', 'employee', 'intern_trainee'] },
  { id: 'audit', label: 'Audit Trail', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', roles: ['director', 'system_administrator'] },
]

export function navItemsForRole(role: Role | null): NavItem[] {
  if (!role) return []
  return NAV_ITEMS.filter((item) => item.roles.includes(role))
}
