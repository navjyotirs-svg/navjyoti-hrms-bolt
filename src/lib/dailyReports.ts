import { supabase } from '@/lib/supabase'

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/daily-report-action`

async function callReportAction(action: string, payload: Record<string, unknown>) {
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

export interface DailyReportRow {
  id: string
  organization_id: string
  branch_id: string | null
  department_id: string | null
  employee_id: string
  report_date: string
  overall_summary: string
  work_planned: string
  work_completed: string
  overall_result: string
  pending_work: string
  blockers: string
  support_required: string
  follow_up_required: boolean
  tomorrow_plan: string
  total_hours_reported: number | null
  status: string
  submitted_at: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  manager_comments: string | null
  reopened_at: string | null
  reopened_by: string | null
  version: number
  created_at: string
  updated_at: string
}

export interface DailyReportTaskItem {
  id: string
  daily_report_id: string
  task_id: string | null
  progress_before: number
  progress_after: number
  work_done: string
  result_achieved: string
  pending_item: string | null
  blocker: string | null
  support_required: string | null
  follow_up: boolean
  hours_spent: number
  evidence_required: boolean
}

export interface DailyReportComment {
  id: string
  daily_report_id: string
  author_id: string
  comment_text: string
  comment_type: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

export interface FollowUpRow {
  id: string
  organization_id: string
  daily_report_id: string | null
  task_id: string | null
  employee_id: string
  created_by: string
  assigned_to: string | null
  follow_up_type: string
  subject: string
  description: string
  priority: string
  due_at: string | null
  status: string
  resolution: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export function getKolkataDate(): string {
  const now = new Date()
  const kolkata = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return kolkata.toISOString().slice(0, 10)
}

export async function fetchMyReport(reportDate: string) {
  const { data, error } = await supabase
    .from('daily_reports')
    .select(`
      *,
      daily_report_task_items (*),
      daily_report_comments (*)
    `)
    .eq('report_date', reportDate)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function fetchMyReportHistory(page = 1, pageSize = 20) {
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const { data, error, count } = await supabase
    .from('daily_reports')
    .select('*', { count: 'exact' })
    .order('report_date', { ascending: false })
    .range(from, to)
  if (error) throw error
  return { data: (data || []) as DailyReportRow[], count: count || 0 }
}

export async function fetchTeamReports(reportDate: string) {
  const { data, error } = await supabase
    .from('daily_reports')
    .select(`
      *,
      employees!inner (id, employee_code, first_name, last_name, designation)
    `)
    .eq('report_date', reportDate)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function fetchAllReports(filters: {
  from_date?: string
  to_date?: string
  status?: string
  branch_id?: string
  department_id?: string
}) {
  let query = supabase
    .from('daily_reports')
    .select(`
      *,
      employees!inner (id, employee_code, first_name, last_name, designation),
      branches (id, name),
      departments (id, name)
    `)
    .order('report_date', { ascending: false })

  if (filters.from_date) query = query.gte('report_date', filters.from_date)
  if (filters.to_date) query = query.lte('report_date', filters.to_date)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.branch_id) query = query.eq('branch_id', filters.branch_id)
  if (filters.department_id) query = query.eq('department_id', filters.department_id)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function fetchReportById(reportId: string) {
  const { data, error } = await supabase
    .from('daily_reports')
    .select(`
      *,
      daily_report_task_items (*),
      daily_report_comments (*),
      daily_report_history (*),
      employees!inner (id, employee_code, first_name, last_name, designation)
    `)
    .eq('id', reportId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function fetchPendingReviews() {
  const { data, error } = await supabase
    .from('daily_reports')
    .select(`
      *,
      employees!inner (id, employee_code, first_name, last_name, designation)
    `)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function fetchOrgSummary(reportDate: string) {
  const { data, error } = await supabase
    .from('management_report_snapshots')
    .select('*')
    .eq('report_date', reportDate)
    .eq('report_type', 'daily_summary')
    .order('generated_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchFollowUps(filters?: {
  status?: string
  assigned_to?: string
}) {
  let query = supabase
    .from('management_follow_ups')
    .select(`
      *,
      employees!inner (id, employee_code, first_name, last_name, designation)
    `)
    .order('created_at', { ascending: false })

  if (filters?.status) query = query.eq('status', filters.status)
  if (filters?.assigned_to) query = query.eq('assigned_to', filters.assigned_to)

  const { data, error } = await query
  if (error) throw error
  return (data || []) as unknown as FollowUpRow[]
}

export async function saveDraft(payload: {
  report_date?: string
  overall_summary?: string
  work_planned?: string
  work_completed?: string
  overall_result?: string
  pending_work?: string
  blockers?: string
  support_required?: string
  follow_up_required?: boolean
  tomorrow_plan?: string
  task_items?: Array<Record<string, unknown>>
}) {
  return callReportAction('save_draft', payload)
}

export async function submitReport(payload: {
  report_date?: string
  overall_summary: string
  work_planned?: string
  work_completed?: string
  overall_result?: string
  pending_work?: string
  blockers?: string
  support_required?: string
  follow_up_required?: boolean
  tomorrow_plan?: string
  task_items?: Array<Record<string, unknown>>
}) {
  return callReportAction('submit', payload)
}

export async function reviewReport(payload: {
  report_id: string
  decision: 'approved' | 'returned'
  manager_comments?: string
}) {
  return callReportAction('review', payload)
}

export async function reopenReport(payload: {
  report_id: string
  reason: string
}) {
  return callReportAction('reopen', payload)
}

export async function addReportComment(payload: {
  report_id: string
  comment_text: string
  comment_type?: string
}) {
  return callReportAction('add_comment', payload)
}

export async function createFollowUp(payload: {
  daily_report_id?: string
  task_id?: string
  employee_id: string
  follow_up_type: string
  subject: string
  description?: string
  priority?: string
  due_at?: string
  assigned_to?: string
}) {
  return callReportAction('create_follow_up', payload)
}

export async function assignFollowUp(follow_up_id: string, assigned_to: string) {
  return callReportAction('assign_follow_up', { follow_up_id, assigned_to })
}

export async function resolveFollowUp(follow_up_id: string, resolution: string) {
  return callReportAction('resolve_follow_up', { follow_up_id, resolution })
}

export async function closeFollowUp(follow_up_id: string, resolution?: string) {
  return callReportAction('close_follow_up', { follow_up_id, resolution })
}

export async function uploadReportAttachment(
  reportId: string,
  file: File,
  attachmentType: string = 'evidence'
) {
  const fileName = `${reportId}/${Date.now()}-${file.name}`
  const { error: uploadError } = await supabase.storage
    .from('daily-report-attachments')
    .upload(fileName, file, { contentType: file.type })

  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('daily_report_attachments')
    .insert({
      daily_report_id: reportId,
      storage_path: fileName,
      file_name: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
      attachment_type: attachmentType,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getAttachmentDownloadUrl(storagePath: string) {
  const { data, error } = await supabase.storage
    .from('daily-report-attachments')
    .createSignedUrl(storagePath, 300)
  if (error) throw error
  return data?.signedUrl || null
}
