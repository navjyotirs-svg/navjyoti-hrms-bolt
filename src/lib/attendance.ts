import { supabase } from '@/lib/supabase'
import {
  ATTENDANCE_APPROVED_MIME_TYPES,
  ATTENDANCE_APPROVED_EXTENSIONS,
  ATTENDANCE_MAX_PHOTO_BYTES,
  type AttendanceStatus,
} from '@/types/roles'

export interface AttendanceRecord {
  id: string
  employee_id: string
  organization_id: string
  branch_id: string | null
  attendance_date: string
  check_in_at: string
  required_checkout_at: string
  check_out_at: string | null
  required_work_minutes: number
  required_break_minutes: number
  required_total_minutes: number
  actual_elapsed_minutes: number | null
  final_status: AttendanceStatus
  status_reason: string | null
  pre_checkout_reminder_sent_at: string | null
  checkout_ready_reminder_sent_at: string | null
  created_at: string
  updated_at: string
  corrected_at: string | null
  corrected_by: string | null
  correction_version: number
}

export interface AttendanceEvidence {
  id: string
  attendance_record_id: string
  employee_id: string
  evidence_type: string
  storage_path: string
  mime_type: string | null
  file_size_bytes: number | null
  latitude: number | null
  longitude: number | null
  location_accuracy: number | null
  captured_at: string
  uploaded_at: string
}

export interface Notification {
  id: string
  recipient_id: string
  notification_type: string
  title: string
  message: string
  priority: string
  metadata: Record<string, unknown> | null
  is_read: boolean
  created_at: string
}

export interface AttendanceCorrection {
  id: string
  attendance_record_id: string
  employee_id: string
  requested_by: string
  correction_type: string
  requested_check_in_at: string | null
  requested_check_out_at: string | null
  reason: string
  supporting_document_path: string | null
  status: string
  reviewed_by: string | null
  reviewer_remarks: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function callEdgeFunction(slug: string, body: Record<string, unknown>) {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`${FUNCTION_URL}/${slug}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

export async function checkIn() {
  return callEdgeFunction('attendance-action', { action: 'check_in' })
}

export async function checkOut(params: {
  evidence_storage_path: string
  evidence_mime_type: string
  evidence_file_size: number
  latitude: number
  longitude: number
  location_accuracy?: number
}) {
  return callEdgeFunction('attendance-action', { action: 'check_out', ...params })
}

export async function requestCorrection(params: {
  attendance_record_id: string
  correction_type: string
  requested_check_in_at?: string
  requested_check_out_at?: string
  reason: string
  supporting_document_path?: string
}) {
  return callEdgeFunction('attendance-correction', {
    action: 'request_correction',
    ...params,
  })
}

export async function reviewCorrection(params: {
  correction_id: string
  decision: 'APPROVED' | 'REJECTED'
  reviewer_remarks?: string
}) {
  return callEdgeFunction('attendance-correction', {
    action: 'review_correction',
    ...params,
  })
}

export async function fetchTodayAttendance(employeeId: string): Promise<AttendanceRecord | null> {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('attendance_date', today)
    .order('created_at', { ascending: false })
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as AttendanceRecord | null
}

export async function fetchAttendanceHistory(employeeId: string, limit = 30): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('employee_id', employeeId)
    .order('attendance_date', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data ?? []) as AttendanceRecord[]
}

export async function fetchAttendanceEvidence(recordId: string): Promise<AttendanceEvidence[]> {
  const { data, error } = await supabase
    .from('attendance_evidence')
    .select('*')
    .eq('attendance_record_id', recordId)
    .order('uploaded_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as AttendanceEvidence[]
}

export async function fetchCorrections(employeeId: string): Promise<AttendanceCorrection[]> {
  const { data, error } = await supabase
    .from('attendance_corrections')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as AttendanceCorrection[]
}

export async function fetchAllCorrections(orgId: string): Promise<AttendanceCorrection[]> {
  const { data, error } = await supabase
    .from('attendance_corrections')
    .select(`
      *,
      employees!inner (
        full_name,
        employee_code,
        organization_id
      )
    `)
    .eq('employees.organization_id', orgId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as AttendanceCorrection[]
}

export async function fetchUnreadNotifications(): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('is_read', false)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as Notification[]
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false)

  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function markAllNotificationsRead() {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('is_read', false)

  if (error) throw new Error(error.message)
}

export function validateEvidenceFile(file: File): string | null {
  if (!ATTENDANCE_APPROVED_MIME_TYPES.includes(file.type as typeof ATTENDANCE_APPROVED_MIME_TYPES[number])) {
    return `Invalid format. Approved: ${ATTENDANCE_APPROVED_EXTENSIONS.join(', ')}`
  }
  if (file.size > ATTENDANCE_MAX_PHOTO_BYTES) {
    return 'Image size exceeds 10MB limit'
  }
  return null
}

export async function uploadAttendanceEvidence(
  userId: string,
  file: Blob,
  mimeType: string
): Promise<string> {
  const ext = mimeType.split('/')[1] ?? 'jpg'
  const path = `${userId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from('attendance-evidence')
    .upload(path, file, { contentType: mimeType })

  if (error) throw new Error(error.message)
  return path
}

export async function createEvidenceSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('attendance-evidence')
    .createSignedUrl(path, 60)

  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

export function formatTimeRemaining(requiredCheckoutAt: string): string {
  const now = Date.now()
  const target = new Date(requiredCheckoutAt).getTime()
  const diff = target - now

  if (diff <= 0) return '00:00:00'

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((diff % (1000 * 60)) / 1000)

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
