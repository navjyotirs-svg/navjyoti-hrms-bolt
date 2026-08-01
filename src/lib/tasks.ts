import { supabase } from '@/lib/supabase'
import type {
  TaskStatus,
  TaskPriority,
  TaskType,
  TaskRequestType,
  TaskRequestStatus,
  SubmissionReviewStatus,
  AttachmentCategory,
  DependencyType,
} from '@/types/roles'

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/task-action`

async function callTaskAction(action: string, payload: Record<string, unknown>) {
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

// ============================================================
// Task CRUD
// ============================================================

export interface TaskRow {
  id: string
  task_code: string
  title: string
  description: string
  priority: TaskPriority
  task_type: TaskType
  status: TaskStatus
  start_date: string
  original_deadline: string
  current_deadline: string
  expected_result: string
  target_quantity: number | null
  target_unit: string | null
  estimated_hours: number | null
  acceptance_required: boolean
  completion_outcome: string | null
  completed_at: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  created_at: string
  updated_at: string
  created_by: string
  owner_id: string
  branch_id: string | null
  department_id: string | null
  task_cost: number | null
  task_cost_currency: string
  task_cost_updated_by: string | null
  task_cost_updated_at: string | null
}

export interface TaskAssignmentWithEmployee {
  id: string
  assigned_to: string
  assigned_employee_id: string
  assignment_type: string
  is_current: boolean
  accepted_at: string | null
  assignment_status: string
  progress_percent: number
  submitted_at: string | null
  individual_outcome: string | null
  assigned_employee?: {
    id: string
    employee_code: string
    full_name: string
    designation: string | null
  } | null
}

export interface TaskWithAssignments extends TaskRow {
  deadline_at: string | null
  task_assignments: TaskAssignmentWithEmployee[]
  projects?: {
    id: string
    project_name: string
    project_code: string
  } | null
}

export async function fetchMyTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select(`
      *,
      task_assignments!inner (id, assigned_to, assignment_type, is_current, accepted_at, assignment_status, progress_percent, submitted_at, individual_outcome)
    `)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as unknown as TaskWithAssignments[]
}

export async function fetchTeamTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select(`
      *,
      task_assignments (
        id, assigned_to, assigned_employee_id, assignment_type, is_current, accepted_at,
        assignment_status, progress_percent, submitted_at, individual_outcome,
        assigned_employee:employees!task_assignments_assigned_employee_id_fkey (
          id, employee_code, full_name, designation
        )
      ),
      projects ( id, project_name, project_code )
    `)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as unknown as TaskWithAssignments[]
}

export async function fetchTaskById(taskId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select(`
      *,
      task_assignments (
        id, assigned_to, assigned_employee_id, assignment_type, is_current, accepted_at, assigned_by, assigned_at,
        assignment_status, progress_percent, submitted_at, reviewed_at, individual_outcome, rejection_reason,
        assigned_employee:employees!task_assignments_assigned_employee_id_fkey (
          id, employee_code, full_name, designation
        )
      ),
      task_status_history (id, old_status, new_status, changed_by, reason, created_at),
      task_deadline_history (id, old_deadline, new_deadline, changed_by, change_reason, created_at),
      task_progress_updates (id, progress_percent, work_completed, result_so_far, blocker, support_required, hours_spent, created_at, employee_id),
      task_submissions (id, submission_note, result_summary, submitted_at, review_status, reviewed_by, reviewed_at, reviewer_feedback, submitted_by),
      task_comments (id, author_id, comment_text, is_internal, created_at, edited_at, deleted_at),
      task_attachments (id, storage_path, file_name, mime_type, file_size_bytes, attachment_category, uploaded_by, created_at),
      task_dependencies!task_dependencies_task_id_fkey (id, depends_on_task_id, dependency_type, created_at),
      projects ( id, project_name, project_code )
    `)
    .eq('id', taskId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function fetchTaskActionRequests(taskId: string) {
  const { data, error } = await supabase
    .from('task_action_requests')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchPendingActionRequests() {
  const { data, error } = await supabase
    .from('task_action_requests')
    .select(`
      *,
      tasks!inner (task_code, title)
    `)
    .eq('status', 'PENDING')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchPendingSubmissions() {
  const { data, error } = await supabase
    .from('task_submissions')
    .select(`
      *,
      tasks!inner (task_code, title, current_deadline)
    `)
    .eq('review_status', 'PENDING_REVIEW')
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ============================================================
// Task Actions (via edge function)
// ============================================================

export async function createTask(payload: {
  project_id?: string
  title: string
  description: string
  assignee_id?: string
  assignee_ids?: string[]
  priority?: TaskPriority
  task_type?: TaskType
  start_date: string
  deadline?: string
  deadline_at?: string
  expected_result?: string
  target_quantity?: number | null
  target_unit?: string | null
  estimated_hours?: number | null
  acceptance_required?: boolean
  branch_id?: string | null
  department_id?: string | null
  collaborators?: string[]
  reviewers?: string[]
  dependencies?: string[]
  task_cost?: number | null
  draft_id?: string
}) {
  return callTaskAction('create', payload)
}

export async function selfAssignTask(payload: {
  project_id: string
  title: string
  description?: string
  priority: TaskPriority
  start_date: string
  deadline: string
  reason: string
  expected_result?: string
  target_quantity?: number | null
  target_unit?: string | null
  estimated_hours?: number | null
  task_cost?: number | null
}) {
  return callTaskAction('self_assign', payload)
}

export async function updateTaskCost(payload: {
  task_id: string
  new_cost: number | null
  reason: string
}) {
  return callTaskAction('update_cost', payload)
}

export async function acceptTask(taskId: string) {
  return callTaskAction('accept', { task_id: taskId })
}

export async function rejectTask(payload: {
  task_id: string
  reason: string
  current_workload: string
  assigned_target: string
  assigned_deadline: string
  proposed_target: string
  proposed_deadline: string
  support_required: string
}) {
  return callTaskAction('reject', payload)
}

export async function requestTaskChange(payload: {
  task_id: string
  request_type: TaskRequestType
  reason: string
  current_workload?: string
  assigned_target?: string
  assigned_deadline?: string
  proposed_target?: string
  proposed_deadline?: string
  support_required?: string
}) {
  return callTaskAction('request_change', payload)
}

export async function reviewTaskRequest(payload: {
  request_id: string
  decision: TaskRequestStatus
  reviewer_remarks?: string
  new_deadline?: string
  new_target?: number
  new_assignee_id?: string
}) {
  return callTaskAction('review_request', payload)
}

export async function addProgressUpdate(payload: {
  task_id: string
  progress_percent: number
  work_completed: string
  result_so_far?: string
  blocker?: string
  support_required?: string
  hours_spent?: number
}) {
  return callTaskAction('add_progress', payload)
}

export async function submitTask(payload: {
  task_id: string
  result_summary: string
  submission_note?: string
}) {
  return callTaskAction('submit', payload)
}

export async function reviewSubmission(payload: {
  submission_id: string
  decision: SubmissionReviewStatus
  reviewer_feedback?: string
}) {
  return callTaskAction('review_submission', payload)
}

export async function reassignTask(payload: {
  task_id: string
  new_assignee_id: string
  reason: string
}) {
  return callTaskAction('reassign', payload)
}

export async function changeDeadline(payload: {
  task_id: string
  new_deadline: string
  reason: string
}) {
  return callTaskAction('change_deadline', payload)
}

export async function cancelTask(payload: {
  task_id: string
  reason: string
  impact_note?: string
}) {
  return callTaskAction('cancel', payload)
}

export async function addTaskComment(payload: {
  task_id: string
  comment_text: string
  is_internal?: boolean
}) {
  return callTaskAction('add_comment', payload)
}

export async function addDependency(payload: {
  task_id: string
  depends_on_task_id: string
  dependency_type?: DependencyType
}) {
  return callTaskAction('add_dependency', payload)
}

// ============================================================
// Task Attachments
// ============================================================

export async function uploadTaskAttachment(
  taskId: string,
  file: File,
  category: AttachmentCategory,
  userId: string
) {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  const randomId = crypto.randomUUID()
  const path = `${userId}/${randomId}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('task-attachments')
    .upload(path, file, { contentType: file.type })

  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('task_attachments')
    .insert({
      task_id: taskId,
      uploaded_by: userId,
      attachment_category: category,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function createTaskAttachmentSignedUrl(storagePath: string) {
  const { data, error } = await supabase.storage
    .from('task-attachments')
    .createSignedUrl(storagePath, 60)
  if (error) throw error
  return data.signedUrl
}

// ============================================================
// Helpers
// ============================================================

export function formatTaskCost(cost: number | null, currency: string = 'INR'): string {
  if (cost === null || cost === undefined) return '—'
  const symbol = currency === 'INR' ? '₹' : ''
  return `${symbol}${cost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDeadline(deadlineAt: string | null, deadlineDate?: string | null): string {
  if (deadlineAt) return formatDateTime(deadlineAt)
  if (deadlineDate) return formatDate(deadlineDate)
  return '—'
}

export function formatDeadlineShort(deadlineAt: string | null, deadlineDate?: string | null): string {
  if (!deadlineAt && !deadlineDate) return '—'
  const d = new Date(deadlineAt || deadlineDate!)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export function formatAssignees(assignments: TaskAssignmentWithEmployee[]): string {
  const current = assignments.filter((a) => a.is_current && a.assignment_type === 'PRIMARY')
  const names = current
    .map((a) => a.assigned_employee?.full_name || 'Unknown')
    .filter((n) => n !== 'Unknown')
  if (names.length === 0) return '—'
  if (names.length <= 2) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

export function getAssigneeInitials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return parts[0].slice(0, 2).toUpperCase()
}

export async function saveTaskDraft(payload: {
  draft_id?: string
  project_id?: string
  title?: string
  description?: string
  priority?: string
  expected_result?: string
  target_quantity?: number | null
  target_unit?: string | null
  estimated_hours?: number | null
  task_cost?: number | null
  deadline_at?: string
  start_date?: string
  task_type?: string
  acceptance_required?: boolean
  branch_id?: string | null
  department_id?: string | null
  assignee_employee_ids?: string[]
}) {
  return callTaskAction('save_draft', payload)
}

export async function loadTaskDraft() {
  return callTaskAction('load_draft', {})
}

export async function discardTaskDraft(draftId?: string) {
  return callTaskAction('discard_draft', { draft_id: draftId })
}

export async function removeTaskAssignee(payload: {
  task_id: string
  assignment_id: string
  reason?: string
}) {
  return callTaskAction('remove_assignee', payload)
}

export interface TaskEvidenceCount {
  task_id: string
  daily_report_count: number
  photo_count: number
  latest_report_date: string | null
}

export async function fetchTaskEvidenceCounts(taskIds: string[]): Promise<Map<string, TaskEvidenceCount>> {
  const result = new Map<string, TaskEvidenceCount>()
  if (taskIds.length === 0) return result

  const { data, error } = await supabase
    .from('daily_report_task_items')
    .select(`
      task_id,
      daily_report_id,
      daily_reports!inner ( id, report_date )
    `)
    .in('task_id', taskIds)

  if (error || !data) return result

  const taskReportMap = new Map<string, Set<string>>()
  const taskLatestDate = new Map<string, string>()
  const taskReportIds = new Set<string>()

  ;(data as any[]).forEach((item) => {
    if (!item.task_id) return
    const reportId = item.daily_report_id
    if (!reportId) return
    if (!taskReportMap.has(item.task_id)) taskReportMap.set(item.task_id, new Set())
    taskReportMap.get(item.task_id)!.add(reportId)
    taskReportIds.add(reportId)
    const reportDate = item.daily_reports?.report_date
    if (reportDate) {
      const existing = taskLatestDate.get(item.task_id)
      if (!existing || reportDate > existing) taskLatestDate.set(item.task_id, reportDate)
    }
  })

  let photoCountMap = new Map<string, number>()
  if (taskReportIds.size > 0) {
    const { data: photos } = await supabase
      .from('daily_report_task_photos')
      .select('daily_report_id')
      .in('daily_report_id', Array.from(taskReportIds))
      .is('deleted_at', null)
    ;(photos || []).forEach((p: any) => {
      photoCountMap.set(p.daily_report_id, (photoCountMap.get(p.daily_report_id) || 0) + 1)
    })
  }

  for (const [taskId, reportSet] of taskReportMap) {
    let photoCount = 0
    for (const rid of reportSet) { photoCount += photoCountMap.get(rid) || 0 }
    result.set(taskId, {
      task_id: taskId,
      daily_report_count: reportSet.size,
      photo_count: photoCount,
      latest_report_date: taskLatestDate.get(taskId) || null,
    })
  }

  return result
}

// ============================================================
// Team Tasks — Employee Overview & Per-Employee Timeline
// ============================================================

export interface EmployeeTaskSummary {
  id: string
  employee_code: string
  full_name: string
  designation: string | null
  department_id: string | null
  department_name: string | null
  branch_id: string | null
  branch_name: string | null
  reporting_manager_id: string | null
  reporting_manager_name: string | null
  active_tasks: number
  acceptance_pending: number
  in_progress: number
  submitted: number
  completed: number
  overdue: number
  met_deadline: number
  missed_deadline: number
  deadline_success_pct: number | null
}

export interface EmployeeTaskItem {
  task_id: string
  task_code: string
  title: string
  priority: string
  status: string
  project_name: string | null
  project_code: string | null
  task_cost: number | null
  task_cost_currency: string
  original_deadline: string | null
  current_deadline: string | null
  assignment_id: string
  assignment_status: string
  assignment_type: string
  is_current: boolean
  progress_percent: number
  accepted_at: string | null
  submitted_at: string | null
  ended_at: string | null
  assigned_at: string | null
  individual_outcome: string | null
  evidence_count: number
  evidence_photo_count: number
}

const ACTIVE_ASSIGNMENT_STATUSES = [
  'ACCEPTANCE_PENDING', 'ACCEPTED', 'IN_PROGRESS', 'SUBMITTED',
  'REVISION_REQUIRED', 'REASSIGNMENT_REQUESTED',
]
const COMPLETED_ASSIGNMENT_STATUSES = ['COMPLETED', 'CANCELLED', 'REJECTED']

function isAssignmentOverdue(deadline: string | null, status: string, now: Date): boolean {
  if (!deadline) return false
  if (COMPLETED_ASSIGNMENT_STATUSES.includes((status || '').toUpperCase())) return false
  return new Date(deadline).getTime() < now.getTime()
}

export async function fetchTeamEmployeeSummaries(orgId: string, _canReadAll: boolean, _canReadTeam: boolean): Promise<EmployeeTaskSummary[]> {
  const now = new Date()

  let empQuery = supabase
    .from('employees')
    .select('id, employee_code, full_name, designation, department_id, branch_id, reporting_manager_id, is_active, employment_status')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .in('employment_status', ['active', 'on_probation', 'confirmed', 'notice_period'])
    .order('full_name')

  const { data: employees, error: empError } = await empQuery
  if (empError) throw empError
  if (!employees || employees.length === 0) return []

  const empIds = employees.map(e => e.id)

  const { data: assignments, error: aError } = await supabase
    .from('task_assignments')
    .select(`
      id, assigned_employee_id, assignment_status, assignment_type, is_current, progress_percent,
      accepted_at, submitted_at, ended_at, assigned_at, individual_outcome,
      tasks!inner (id, task_code, title, priority, status, original_deadline, current_deadline, task_cost, task_cost_currency, completed_at)
    `)
    .in('assigned_employee_id', empIds)
    .eq('is_current', true)

  if (aError) throw aError

  const deptIds = new Set(employees.map(e => e.department_id).filter(Boolean) as string[])
  const branchIds = new Set(employees.map(e => e.branch_id).filter(Boolean) as string[])
  const mgrIds = new Set(employees.map(e => e.reporting_manager_id).filter(Boolean) as string[])

  const [deptRes, branchRes, mgrRes] = await Promise.all([
    deptIds.size > 0
      ? supabase.from('departments').select('id, name').in('id', Array.from(deptIds))
      : Promise.resolve({ data: [], error: null }),
    branchIds.size > 0
      ? supabase.from('branches').select('id, name').in('id', Array.from(branchIds))
      : Promise.resolve({ data: [], error: null }),
    mgrIds.size > 0
      ? supabase.from('employees').select('id, full_name').in('id', Array.from(mgrIds))
      : Promise.resolve({ data: [], error: null }),
  ])

  const deptMap = new Map((deptRes.data || []).map((d: any) => [d.id, d.name]))
  const branchMap = new Map((branchRes.data || []).map((b: any) => [b.id, b.name]))
  const mgrMap = new Map((mgrRes.data || []).map((m: any) => [m.id, m.full_name]))

  const summaryMap = new Map<string, EmployeeTaskSummary>()
  for (const emp of employees) {
    summaryMap.set(emp.id, {
      id: emp.id,
      employee_code: emp.employee_code,
      full_name: emp.full_name,
      designation: emp.designation,
      department_id: emp.department_id,
      department_name: emp.department_id ? deptMap.get(emp.department_id) || null : null,
      branch_id: emp.branch_id,
      branch_name: emp.branch_id ? branchMap.get(emp.branch_id) || null : null,
      reporting_manager_id: emp.reporting_manager_id,
      reporting_manager_name: emp.reporting_manager_id ? mgrMap.get(emp.reporting_manager_id) || null : null,
      active_tasks: 0,
      acceptance_pending: 0,
      in_progress: 0,
      submitted: 0,
      completed: 0,
      overdue: 0,
      met_deadline: 0,
      missed_deadline: 0,
      deadline_success_pct: null,
    })
  }

  for (const a of (assignments || []) as any[]) {
    const s = summaryMap.get(a.assigned_employee_id)
    if (!s) continue
    const task = a.tasks
    const status = (a.assignment_status || '').toUpperCase()
    const deadline = task?.current_deadline || task?.original_deadline || null

    if (ACTIVE_ASSIGNMENT_STATUSES.includes(status)) {
      s.active_tasks++
      if (status === 'ACCEPTANCE_PENDING' || status === 'REASSIGNMENT_REQUESTED') s.acceptance_pending++
      if (status === 'IN_PROGRESS') s.in_progress++
      if (status === 'SUBMITTED') s.submitted++
      if (isAssignmentOverdue(deadline, status, now)) s.overdue++
    } else if (status === 'COMPLETED') {
      s.completed++
      if (deadline && a.ended_at) {
        if (new Date(a.ended_at).getTime() <= new Date(deadline).getTime()) s.met_deadline++
        else s.missed_deadline++
      }
    }
  }

  for (const s of summaryMap.values()) {
    const totalCompleted = s.met_deadline + s.missed_deadline
    if (totalCompleted > 0) {
      s.deadline_success_pct = Math.round((s.met_deadline / totalCompleted) * 100)
    }
  }

  return Array.from(summaryMap.values())
}

export async function fetchEmployeeTaskTimeline(employeeId: string): Promise<EmployeeTaskItem[]> {
  const { data: assignments, error } = await supabase
    .from('task_assignments')
    .select(`
      id, assigned_employee_id, assignment_status, assignment_type, is_current, progress_percent,
      accepted_at, submitted_at, ended_at, assigned_at, individual_outcome,
      tasks!inner (
        id, task_code, title, priority, status, original_deadline, current_deadline,
        task_cost, task_cost_currency, completed_at,
        projects ( id, project_name, project_code )
      )
    `)
    .eq('assigned_employee_id', employeeId)
    .eq('is_current', true)
    .order('assigned_at', { ascending: false })

  if (error) throw error
  if (!assignments || assignments.length === 0) return []

  const taskIds = (assignments as any[]).map(a => a.tasks?.id).filter(Boolean) as string[]
  let evidenceMap = new Map<string, { reports: number; photos: number }>()

  if (taskIds.length > 0) {
    const { data: evidence } = await supabase
      .from('daily_report_task_items')
      .select('task_id, daily_report_id')
      .in('task_id', taskIds)

    if (evidence) {
      const reportIds = new Set<string>()
      for (const e of evidence as any[]) {
        if (e.daily_report_id) reportIds.add(e.daily_report_id)
      }
      let photoCountMap = new Map<string, number>()
      if (reportIds.size > 0) {
        const { data: photos } = await supabase
          .from('daily_report_task_photos')
          .select('daily_report_id')
          .in('daily_report_id', Array.from(reportIds))
          .is('deleted_at', null)
        ;(photos || []).forEach((p: any) => {
          photoCountMap.set(p.daily_report_id, (photoCountMap.get(p.daily_report_id) || 0) + 1)
        })
      }
      for (const e of evidence as any[]) {
        if (!e.task_id) continue
        const existing = evidenceMap.get(e.task_id) || { reports: 0, photos: 0 }
        existing.reports++
        if (e.daily_report_id) existing.photos += photoCountMap.get(e.daily_report_id) || 0
        evidenceMap.set(e.task_id, existing)
      }
    }
  }

  return (assignments as any[]).map(a => {
    const task = a.tasks
    const ev = evidenceMap.get(task?.id) || { reports: 0, photos: 0 }
    return {
      task_id: task?.id || '',
      task_code: task?.task_code || '',
      title: task?.title || '',
      priority: task?.priority || 'MEDIUM',
      status: task?.status || '',
      project_name: task?.projects?.project_name || null,
      project_code: task?.projects?.project_code || null,
      task_cost: task?.task_cost ?? null,
      task_cost_currency: task?.task_cost_currency || 'INR',
      original_deadline: task?.original_deadline || null,
      current_deadline: task?.current_deadline || null,
      assignment_id: a.id,
      assignment_status: a.assignment_status || '',
      assignment_type: a.assignment_type || '',
      is_current: a.is_current,
      progress_percent: a.progress_percent || 0,
      accepted_at: a.accepted_at || null,
      submitted_at: a.submitted_at || null,
      ended_at: a.ended_at || null,
      assigned_at: a.assigned_at || null,
      individual_outcome: a.individual_outcome || null,
      evidence_count: ev.reports,
      evidence_photo_count: ev.photos,
    }
  })
}

export async function validateEmployeeAccess(employeeId: string, orgId: string, canReadAll: boolean): Promise<boolean> {
  const { data, error } = await supabase
    .from('employees')
    .select('id, organization_id, is_active, employment_status')
    .eq('id', employeeId)
    .maybeSingle()
  if (error || !data) return false
  if (data.organization_id !== orgId) return false
  if (!canReadAll && !data.is_active) return false
  if (!canReadAll && data.employment_status === 'offboarded') return false
  return true
}

