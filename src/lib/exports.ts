import { supabase } from '@/lib/supabase'

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-handler`

async function callExportAction(action: string, payload: Record<string, unknown>) {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new Error('Not authenticated')

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ action, ...payload }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error || `Request failed (${response.status})`)
  }
  return response.json()
}

export interface ExportJobRow {
  id: string
  organization_id: string
  requested_by: string
  export_type: string
  filters: Record<string, unknown>
  format: string
  status: string
  storage_path: string | null
  failure_reason: string | null
  requested_at: string
  started_at: string | null
  completed_at: string | null
  expires_at: string | null
}

export const EXPORT_TYPES = [
  { value: 'daily_reports', label: 'Daily Reports' },
  { value: 'missing_reports', label: 'Missing Reports' },
  { value: 'task_progress', label: 'Task Progress' },
  { value: 'attendance_summary', label: 'Attendance Summary' },
  { value: 'leave_summary', label: 'Leave Summary' },
  { value: 'ticket_summary', label: 'Ticket Summary' },
  { value: 'follow_up_report', label: 'Follow-up Report' },
  { value: 'branch_report', label: 'Branch Report' },
  { value: 'department_report', label: 'Department Report' },
  { value: 'org_daily_summary', label: 'Org Daily Summary' },
] as const

export async function fetchExportJobs(page = 1, pageSize = 20) {
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const { data, error, count } = await supabase
    .from('export_jobs')
    .select('*', { count: 'exact' })
    .order('requested_at', { ascending: false })
    .range(from, to)
  if (error) throw error
  return { data: (data || []) as ExportJobRow[], count: count || 0 }
}

export async function requestExport(payload: {
  export_type: string
  format?: string
  filters?: Record<string, unknown>
}) {
  return callExportAction('request_export', payload)
}

export async function getDownloadUrl(jobId: string) {
  const result = await callExportAction('get_download_url', { job_id: jobId })
  return result.download_url as string
}

export async function cancelExport(jobId: string) {
  return callExportAction('cancel_export', { job_id: jobId })
}
