import { supabase } from '@/lib/supabase'
import type { ProjectStatus } from '@/types/roles'

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/project-action`

async function callProjectAction(action: string, payload: Record<string, unknown>) {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

export interface ProjectRow {
  id: string
  organization_id: string
  project_code: string
  project_name: string
  description: string | null
  project_owner_employee_id: string | null
  branch_id: string | null
  department_id: string | null
  priority: string
  start_date: string
  expected_end_date: string | null
  actual_end_date: string | null
  status: ProjectStatus
  created_by: string
  created_at: string
  updated_at: string
  is_active: boolean
}

export async function fetchProjects(): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as ProjectRow[]
}

export async function fetchProjectById(id: string): Promise<ProjectRow | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as ProjectRow | null
}

export async function fetchProjectTaskCount(projectId: string): Promise<{ active: number; completed: number }> {
  const { count: active, error: activeErr } = await supabase
    .from('tasks')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .not('status', 'eq', 'COMPLETED')
    .not('status', 'eq', 'CANCELLED')

  const { count: completed, error: completedErr } = await supabase
    .from('tasks')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('status', 'COMPLETED')

  if (activeErr || completedErr) throw new Error(activeErr?.message || completedErr?.message)
  return { active: active ?? 0, completed: completed ?? 0 }
}

export async function createProject(payload: {
  project_name: string
  description?: string
  project_owner_employee_id?: string
  branch_id?: string
  department_id?: string
  priority?: string
  start_date?: string
  expected_end_date?: string
}) {
  return callProjectAction('create', payload)
}

export async function updateProject(payload: {
  project_id: string
  project_name?: string
  description?: string
  project_owner_employee_id?: string
  branch_id?: string
  department_id?: string
  priority?: string
  expected_end_date?: string
}) {
  return callProjectAction('update', payload)
}

export async function changeProjectStatus(payload: {
  project_id: string
  new_status: string
}) {
  return callProjectAction('change_status', payload)
}

export async function archiveProject(project_id: string) {
  return callProjectAction('archive', { project_id })
}
