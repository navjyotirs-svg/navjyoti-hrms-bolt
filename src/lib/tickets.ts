import { supabase } from '@/lib/supabase'
import type { TicketCategory, TicketStatus, TaskPriority } from '@/types/roles'

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ticket-action`

async function callTicketAction(action: string, payload: Record<string, unknown>) {
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
// Ticket Types
// ============================================================

export interface TicketRow {
  id: string
  ticket_code: string
  category: TicketCategory
  subject: string
  description: string
  priority: TaskPriority
  status: TicketStatus
  raised_by: string
  related_task_id: string | null
  assigned_to: string | null
  assigned_department_id: string | null
  sla_due_at: string | null
  resolved_at: string | null
  resolution_summary: string | null
  created_at: string
  updated_at: string
}

// ============================================================
// Ticket Fetch
// ============================================================

export async function fetchMyTickets() {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as TicketRow[]
}

export async function fetchTeamTickets() {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as TicketRow[]
}

export async function fetchTicketById(ticketId: string) {
  const { data, error } = await supabase
    .from('tickets')
    .select(`
      *,
      ticket_history (id, old_status, new_status, changed_by, reason, created_at),
      ticket_comments (id, author_id, comment_text, is_internal, created_at, edited_at),
      ticket_attachments (id, storage_path, file_name, mime_type, file_size_bytes, uploaded_by, created_at),
      ticket_escalations (id, escalation_level, escalated_from, escalated_to, reason, created_at)
    `)
    .eq('id', ticketId)
    .maybeSingle()
  if (error) throw error
  return data
}

// ============================================================
// Ticket Actions (via edge function)
// ============================================================

export async function createTicket(payload: {
  category: TicketCategory
  subject: string
  description: string
  priority?: TaskPriority
  related_task_id?: string | null
  branch_id?: string | null
}) {
  return callTicketAction('create', payload)
}

export async function assignTicket(payload: {
  ticket_id: string
  assigned_to?: string
  assigned_department_id?: string
  reason?: string
}) {
  return callTicketAction('assign', payload)
}

export async function escalateTicket(payload: {
  ticket_id: string
  escalated_to?: string
  reason: string
}) {
  return callTicketAction('escalate', payload)
}

export async function resolveTicket(payload: {
  ticket_id: string
  resolution_summary: string
}) {
  return callTicketAction('resolve', payload)
}

export async function closeTicket(payload: {
  ticket_id: string
  reason?: string
}) {
  return callTicketAction('close', payload)
}

export async function reopenTicket(payload: {
  ticket_id: string
  reason: string
}) {
  return callTicketAction('reopen', payload)
}

export async function addTicketComment(payload: {
  ticket_id: string
  comment_text: string
  is_internal?: boolean
}) {
  return callTicketAction('comment', payload)
}

// ============================================================
// Ticket Attachments
// ============================================================

export async function uploadTicketAttachment(
  ticketId: string,
  file: File,
  userId: string
) {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  const randomId = crypto.randomUUID()
  const path = `${userId}/${randomId}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('ticket-attachments')
    .upload(path, file, { contentType: file.type })

  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('ticket_attachments')
    .insert({
      ticket_id: ticketId,
      uploaded_by: userId,
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

export async function createTicketAttachmentSignedUrl(storagePath: string) {
  const { data, error } = await supabase.storage
    .from('ticket-attachments')
    .createSignedUrl(storagePath, 60)
  if (error) throw error
  return data.signedUrl
}

// ============================================================
// Helpers
// ============================================================

export function formatTicketDate(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatTicketDateTime(dateStr: string): string {
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
