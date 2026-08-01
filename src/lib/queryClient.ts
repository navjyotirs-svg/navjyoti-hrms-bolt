import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
})

export type QueryKey =
  | 'employees'
  | 'employee-directory'
  | 'employee-profile'
  | 'organization-dashboard'
  | 'activation-summary'
  | 'my-attendance'
  | 'attendance-management'
  | 'attendance-today'
  | 'monthly-attendance'
  | 'director-dashboard'
  | 'hr-dashboard'
  | 'my-tasks'
  | 'team-tasks'
  | 'task-detail'
  | 'task-dashboard'
  | 'notifications'
  | 'my-leave'
  | 'leave-requests'
  | 'leave-balances'
  | 'leave-calendar'
  | 'management-dashboard'
  | 'my-tickets'
  | 'team-tickets'
  | 'ticket-detail'
  | 'daily-reports'
  | 'team-reports'
  | 'report-review'
  | 'org-summary'
  | 'follow-up-queue'
  | 'announcements'
  | 'calendar-events'
  | 'holidays'
  | 'audit-trail'
  | 'projects'
  | 'recurring-tasks'
  | 'voice-notes'
  | 'my-voice-notes'

const TABLE_TO_QUERIES: Record<string, QueryKey[]> = {
  employees: ['employees', 'employee-directory', 'employee-profile', 'organization-dashboard', 'activation-summary', 'director-dashboard', 'hr-dashboard'],
  user_profiles: ['employees', 'employee-directory', 'employee-profile', 'organization-dashboard'],
  user_organization_memberships: ['employees', 'employee-directory', 'organization-dashboard'],
  employee_status_history: ['employee-profile', 'audit-trail'],

  attendance_records: ['my-attendance', 'attendance-management', 'attendance-today', 'monthly-attendance', 'director-dashboard', 'hr-dashboard'],
  attendance_corrections: ['my-attendance', 'attendance-management'],

  leave_requests: ['my-leave', 'leave-requests', 'leave-calendar', 'management-dashboard'],
  leave_balances: ['my-leave', 'leave-balances'],
  leave_ledger: ['my-leave', 'leave-balances'],

  calendar_events: ['calendar-events', 'leave-calendar'],
  holiday_calendar_dates: ['holidays', 'calendar-events'],

  tasks: ['my-tasks', 'team-tasks', 'task-detail', 'task-dashboard', 'notifications'],
  task_assignments: ['my-tasks', 'team-tasks', 'task-detail', 'task-dashboard'],
  task_status_history: ['task-detail'],
  task_submissions: ['task-detail', 'task-dashboard'],
  task_progress_updates: ['my-tasks', 'team-tasks', 'task-detail', 'task-dashboard'],
  task_comments: ['task-detail'],

  tickets: ['my-tickets', 'team-tickets', 'ticket-detail'],
  ticket_comments: ['ticket-detail'],
  ticket_history: ['ticket-detail'],

  daily_reports: ['daily-reports', 'team-reports', 'report-review', 'org-summary'],
  daily_report_history: ['daily-reports', 'report-review'],
  daily_report_comments: ['daily-reports', 'report-review'],

  notifications: ['notifications'],
  announcements: ['announcements'],

  management_follow_ups: ['follow-up-queue', 'management-dashboard'],

  projects: ['projects', 'director-dashboard', 'hr-dashboard', 'management-dashboard'],
  project_history: ['projects'],
  recurring_task_templates: ['recurring-tasks', 'management-dashboard', 'my-tasks'],
  voice_notes: ['voice-notes', 'my-voice-notes', 'management-dashboard'],
  voice_note_recipients: ['my-voice-notes', 'voice-notes'],

  task_drafts: [],
  task_draft_assignees: [],
}

export function getQueriesForTable(table: string): QueryKey[] {
  return TABLE_TO_QUERIES[table] ?? []
}
