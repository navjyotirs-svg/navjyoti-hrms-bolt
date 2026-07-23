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
}

export interface TaskWithAssignments extends TaskRow {
  task_assignments: {
    id: string
    assigned_to: string
    assignment_type: string
    is_current: boolean
    accepted_at: string | null
  }[]
}

export async function fetchMyTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select(`
      *,
      task_assignments!inner (id, assigned_to, assignment_type, is_current, accepted_at)
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
      task_assignments (id, assigned_to, assignment_type, is_current, accepted_at)
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
      task_assignments (id, assigned_to, assignment_type, is_current, accepted_at, assigned_by, assigned_at),
      task_status_history (id, old_status, new_status, changed_by, reason, created_at),
      task_deadline_history (id, old_deadline, new_deadline, changed_by, change_reason, created_at),
      task_progress_updates (id, progress_percent, work_completed, result_so_far, blocker, support_required, hours_spent, created_at, employee_id),
      task_submissions (id, submission_note, result_summary, submitted_at, review_status, reviewed_by, reviewed_at, reviewer_feedback, submitted_by),
      task_comments (id, author_id, comment_text, is_internal, created_at, edited_at, deleted_at),
      task_attachments (id, storage_path, file_name, mime_type, file_size_bytes, attachment_category, uploaded_by, created_at),
      task_dependencies!task_dependencies_task_id_fkey (id, depends_on_task_id, dependency_type, created_at)
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
  title: string
  description: string
  assignee_id: string
  priority?: TaskPriority
  task_type?: TaskType
  start_date: string
  deadline: string
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
}) {
  return callTaskAction('create', payload)
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
