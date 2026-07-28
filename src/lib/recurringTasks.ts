import { supabase } from '@/lib/supabase'
import type { RecurrenceType, AssignmentTrigger } from '@/types/roles'

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/recurring-task-action`

async function callRecurringTaskAction(action: string, payload: Record<string, unknown>) {
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

export interface RecurringTaskTemplateRow {
  id: string
  organization_id: string
  project_id: string
  template_code: string
  title: string
  description: string | null
  expected_result: string | null
  priority: string
  target_quantity: number | null
  target_unit: string | null
  estimated_hours: number | null
  task_cost: number | null
  assigned_employee_id: string
  created_by: string
  recurrence_type: RecurrenceType
  selected_weekdays: number[] | null
  start_date: string
  end_date: string | null
  assignment_trigger: AssignmentTrigger
  is_active: boolean
  is_paused: boolean
  last_generated_date: string | null
  next_generation_date: string | null
  created_at: string
  updated_at: string
  deactivated_at: string | null
}

export async function fetchRecurringTemplates(): Promise<RecurringTaskTemplateRow[]> {
  const { data, error } = await supabase
    .from('recurring_task_templates')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as RecurringTaskTemplateRow[]
}

export async function createRecurringTemplate(payload: {
  project_id: string
  title: string
  description?: string
  expected_result?: string
  priority?: string
  target_quantity?: number | null
  target_unit?: string | null
  estimated_hours?: number | null
  task_cost?: number | null
  assigned_employee_id: string
  start_date: string
  end_date?: string
}) {
  return callRecurringTaskAction('create', payload)
}

export async function updateRecurringTemplate(payload: {
  template_id: string
  title?: string
  description?: string
  expected_result?: string
  priority?: string
  end_date?: string
  estimated_hours?: number | null
}) {
  return callRecurringTaskAction('update', payload)
}

export async function pauseRecurringTemplate(template_id: string) {
  return callRecurringTaskAction('pause', { template_id })
}

export async function resumeRecurringTemplate(template_id: string) {
  return callRecurringTaskAction('resume', { template_id })
}

export async function deactivateRecurringTemplate(template_id: string) {
  return callRecurringTaskAction('deactivate', { template_id })
}
