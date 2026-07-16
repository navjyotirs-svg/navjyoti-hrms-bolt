import { supabase } from '@/lib/supabase'
import {
  LEAVE_STATUS_LABELS,
  LEAVE_TRANSACTION_LABELS,
  CALENDAR_EVENT_LABELS,
  type LeaveStatus,
  type LeaveTransactionType,
  type CalendarEventType,
} from '@/types/roles'

export interface LeaveType {
  id: string
  organization_id: string
  code: string
  name: string
  description: string | null
  is_paid: boolean
  monthly_credit: number
  carry_forward_enabled: boolean
  maximum_carry_forward: number | null
  allow_half_day: boolean
  requires_document: boolean
  minimum_notice_days: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface LeaveBalance {
  id: string
  employee_id: string
  organization_id: string
  leave_type_id: string
  opening_balance: number
  accrued: number
  used: number
  adjusted: number
  cancelled_restored: number
  closing_balance: number
  balance_year: number
  version: number
  created_at: string
  updated_at: string
  leave_types?: LeaveType
}

export interface LeaveLedgerEntry {
  id: string
  employee_id: string
  organization_id: string
  leave_type_id: string
  transaction_type: LeaveTransactionType
  quantity: number
  balance_before: number
  balance_after: number
  reference_type: string | null
  reference_id: string | null
  description: string | null
  effective_date: string
  created_by: string | null
  created_at: string
  idempotency_key: string
  leave_types?: LeaveType
}

export interface LeaveRequest {
  id: string
  employee_id: string
  organization_id: string
  branch_id: string | null
  leave_type_id: string
  from_date: string
  to_date: string
  requested_days: number
  half_day_type: string | null
  reason: string
  supporting_document_path: string | null
  status: LeaveStatus
  current_approver_id: string | null
  manager_decision: string | null
  manager_remarks: string | null
  hr_decision: string | null
  hr_remarks: string | null
  approved_by: string | null
  approved_at: string | null
  rejected_by: string | null
  rejected_at: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  created_at: string
  updated_at: string
  version: number
  leave_types?: LeaveType
  employees?: { id: string; full_name: string; employee_code: string }
}

export interface LeaveRequestHistoryEntry {
  id: string
  leave_request_id: string
  action: string
  performed_by: string | null
  remarks: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  created_at: string
}

export interface CalendarEvent {
  id: string
  organization_id: string
  branch_id: string | null
  department_id: string | null
  title: string
  description: string | null
  event_type: CalendarEventType
  start_date: string
  end_date: string
  start_time: string | null
  end_time: string | null
  is_all_day: boolean
  is_working_day_override: boolean
  is_weekly_off_override: boolean
  visibility_scope: string
  created_by: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface HolidayCalendar {
  id: string
  organization_id: string
  branch_id: string | null
  name: string
  year: number
  timezone: string
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface HolidayCalendarDate {
  id: string
  holiday_calendar_id: string
  date: string
  name: string
  holiday_type: string
  is_paid_holiday: boolean
  is_working_day_override: boolean
  created_by: string | null
  created_at: string
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

export async function calculateLeaveDays(params: {
  from_date: string
  to_date: string
  branch_id?: string | null
  half_day_type?: string | null
  organization_id?: string
}) {
  return callEdgeFunction('leave-action', { action: 'calculate_days', ...params })
}

export async function submitLeaveRequest(params: {
  leave_type_id: string
  from_date: string
  to_date: string
  half_day_type?: string | null
  reason: string
  supporting_document_path?: string | null
  branch_id?: string | null
}) {
  return callEdgeFunction('leave-action', { action: 'submit', ...params })
}

export async function managerReviewLeave(params: {
  leave_request_id: string
  decision: 'APPROVED' | 'REJECTED' | 'RETURNED'
  remarks?: string
}) {
  return callEdgeFunction('leave-action', { action: 'manager_review', ...params })
}

export async function hrReviewLeave(params: {
  leave_request_id: string
  decision: 'APPROVED' | 'REJECTED'
  remarks?: string
}) {
  return callEdgeFunction('leave-action', { action: 'hr_review', ...params })
}

export async function cancelLeaveRequest(params: {
  leave_request_id: string
  reason: string
}) {
  return callEdgeFunction('leave-action', { action: 'cancel', ...params })
}

export async function withdrawLeaveRequest(params: {
  leave_request_id: string
}) {
  return callEdgeFunction('leave-action', { action: 'withdraw', ...params })
}

export async function adjustLeaveBalance(params: {
  employee_id: string
  leave_type_id: string
  quantity: number
  description?: string
}) {
  return callEdgeFunction('leave-action', { action: 'adjust_balance', ...params })
}

export async function fetchLeaveTypes(orgId: string): Promise<LeaveType[]> {
  const { data, error } = await supabase
    .from('leave_types')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('code')
  if (error) throw new Error(error.message)
  return (data ?? []) as LeaveType[]
}

export async function fetchMyLeaveBalances(employeeId: string): Promise<LeaveBalance[]> {
  const { data, error } = await supabase
    .from('leave_balances')
    .select('*, leave_types!inner(*)')
    .eq('employee_id', employeeId)
    .order('leave_types(code)')
  if (error) throw new Error(error.message)
  return (data ?? []) as LeaveBalance[]
}

export async function fetchAllLeaveBalances(orgId: string): Promise<LeaveBalance[]> {
  const { data, error } = await supabase
    .from('leave_balances')
    .select('*, leave_types!inner(*)')
    .eq('organization_id', orgId)
    .order('leave_types(code)')
  if (error) throw new Error(error.message)
  return (data ?? []) as LeaveBalance[]
}

export async function fetchMyLeaveLedger(employeeId: string, limit = 50): Promise<LeaveLedgerEntry[]> {
  const { data, error } = await supabase
    .from('leave_ledger')
    .select('*, leave_types!inner(*)')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as LeaveLedgerEntry[]
}

export async function fetchMyLeaveRequests(employeeId: string): Promise<LeaveRequest[]> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*, leave_types!inner(*)')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as LeaveRequest[]
}

export async function fetchTeamLeaveRequests(): Promise<LeaveRequest[]> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*, leave_types!inner(*), employees!inner(id, full_name, employee_code)')
    .in('status', ['PENDING_MANAGER', 'PENDING_HR', 'APPROVED', 'REJECTED'])
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as LeaveRequest[]
}

export async function fetchAllLeaveRequests(orgId: string): Promise<LeaveRequest[]> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*, leave_types!inner(*), employees!inner(id, full_name, employee_code)')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as LeaveRequest[]
}

export async function fetchLeaveRequestHistory(leaveRequestId: string): Promise<LeaveRequestHistoryEntry[]> {
  const { data, error } = await supabase
    .from('leave_request_history')
    .select('*')
    .eq('leave_request_id', leaveRequestId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as LeaveRequestHistoryEntry[]
}

export async function fetchCalendarEvents(orgId: string, startDate?: string, endDate?: string): Promise<CalendarEvent[]> {
  let query = supabase
    .from('calendar_events')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('start_date', { ascending: true })
  if (startDate) query = query.gte('start_date', startDate)
  if (endDate) query = query.lte('end_date', endDate)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as CalendarEvent[]
}

export async function createCalendarEvent(params: Omit<CalendarEvent, 'id' | 'created_at' | 'updated_at' | 'created_by'>): Promise<CalendarEvent> {
  const { data: session } = await supabase.auth.getSession()
  const userId = session.session?.user?.id
  const { data, error } = await supabase
    .from('calendar_events')
    .insert({ ...params, created_by: userId })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as CalendarEvent
}

export async function updateCalendarEvent(id: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent> {
  const { data, error } = await supabase
    .from('calendar_events')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as CalendarEvent
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const { error } = await supabase
    .from('calendar_events')
    .update({ is_active: false })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function fetchHolidayCalendars(orgId: string): Promise<HolidayCalendar[]> {
  const { data, error } = await supabase
    .from('holiday_calendars')
    .select('*')
    .eq('organization_id', orgId)
    .order('year', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as HolidayCalendar[]
}

export async function createHolidayCalendar(params: {
  organization_id: string
  branch_id?: string | null
  name: string
  year: number
  timezone?: string
  is_default?: boolean
}): Promise<HolidayCalendar> {
  const { data, error } = await supabase
    .from('holiday_calendars')
    .insert({
      organization_id: params.organization_id,
      branch_id: params.branch_id ?? null,
      name: params.name,
      year: params.year,
      timezone: params.timezone ?? 'Asia/Kolkata',
      is_default: params.is_default ?? false,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as HolidayCalendar
}

export async function fetchHolidayDates(calendarId: string): Promise<HolidayCalendarDate[]> {
  const { data, error } = await supabase
    .from('holiday_calendar_dates')
    .select('*')
    .eq('holiday_calendar_id', calendarId)
    .order('date', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as HolidayCalendarDate[]
}

export async function addHolidayDate(params: {
  holiday_calendar_id: string
  date: string
  name: string
  holiday_type: string
  is_paid_holiday?: boolean
  is_working_day_override?: boolean
}): Promise<HolidayCalendarDate> {
  const { data: session } = await supabase.auth.getSession()
  const userId = session.session?.user?.id
  const { data, error } = await supabase
    .from('holiday_calendar_dates')
    .insert({
      ...params,
      is_paid_holiday: params.is_paid_holiday ?? true,
      is_working_day_override: params.is_working_day_override ?? false,
      created_by: userId,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as HolidayCalendarDate
}

export async function deleteHolidayDate(id: string): Promise<void> {
  const { error } = await supabase
    .from('holiday_calendar_dates')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export function validateLeaveDocument(file: File): string | null {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']
  if (!allowedTypes.includes(file.type)) {
    return 'Invalid format. Approved: PDF, JPG, PNG, WebP'
  }
  if (file.size > 10 * 1024 * 1024) {
    return 'File size exceeds 10MB limit'
  }
  return null
}

export async function uploadLeaveDocument(userId: string, file: Blob, mimeType: string): Promise<string> {
  const ext = mimeType.split('/')[1]?.split('+')[0] ?? 'pdf'
  const path = `${userId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from('leave-documents')
    .upload(path, file, { contentType: mimeType })
  if (error) throw new Error(error.message)
  return path
}

export async function createLeaveDocSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('leave-documents')
    .createSignedUrl(path, 60)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

export function formatLeaveDate(date: string): string {
  return new Date(date).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export { LEAVE_STATUS_LABELS, LEAVE_TRANSACTION_LABELS, CALENDAR_EVENT_LABELS }
