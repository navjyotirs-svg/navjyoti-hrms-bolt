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
  attendance_policy_version: string
  final_status: AttendanceStatus
  status_reason: string | null
  checkout_type: 'MANUAL' | 'AUTO'
  checkout_status: 'COMPLETED' | 'MISSED_CHECKOUT' | 'PENDING'
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

export interface EdgeFunctionError {
  success: false
  errorCode: string
  message: string
  correlationId: string
  retryable: boolean
}

export function isEdgeFunctionError(e: unknown): e is EdgeFunctionError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'success' in e &&
    (e as Record<string, unknown>).success === false &&
    'errorCode' in e
  )
}

async function callEdgeFunction(slug: string, body: Record<string, unknown>) {
  let { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError || !refreshed.session) {
      throw {
        success: false,
        errorCode: 'SESSION_EXPIRED',
        message: 'Your session has expired. Please sign in again.',
        correlationId: crypto.randomUUID(),
        retryable: false,
      } as EdgeFunctionError
    }
    sessionData = refreshed
  }

  let data: unknown
  let invokeError: unknown = null

  try {
    const result = await supabase.functions.invoke(slug, { body })
    data = result.data
    invokeError = result.error
  } catch (err) {
    throw {
      success: false,
      errorCode: 'FUNCTION_NOT_REACHABLE',
      message: 'The server could not be reached. Please check your connection and try again.',
      correlationId: crypto.randomUUID(),
      retryable: true,
    } as EdgeFunctionError
  }

  if (invokeError) {
    const errObj = invokeError as { message?: string; context?: Response }
    let serverMessage: string | undefined
    let serverErrorCode: string | undefined
    let serverRetryable = true
    let serverCorrelationId: string | undefined
    try {
      if (errObj.context) {
        const json = await errObj.context.json() as {
          error?: string
          message?: string
          errorCode?: string
          retryable?: boolean
          correlationId?: string
          success?: boolean
        }
        serverMessage = json?.message ?? json?.error
        serverErrorCode = json?.errorCode
        serverRetryable = json?.retryable ?? true
        serverCorrelationId = json?.correlationId
      }
    } catch { /* ignore parse failure */ }

    const isRelayError = errObj.message?.includes('Edge Function') || errObj.message?.includes('Failed to fetch')
    if (isRelayError && !serverMessage) {
      throw {
        success: false,
        errorCode: 'FUNCTION_NOT_REACHABLE',
        message: 'The attendance service could not be reached. This may be a temporary network issue. Please try again.',
        correlationId: crypto.randomUUID(),
        retryable: true,
      } as EdgeFunctionError
    }

    throw {
      success: false,
      errorCode: serverErrorCode ?? 'UNKNOWN_ATTENDANCE_ERROR',
      message: serverMessage ?? errObj.message ?? 'Request failed',
      correlationId: serverCorrelationId ?? crypto.randomUUID(),
      retryable: serverRetryable,
    } as EdgeFunctionError
  }

  const resultObj = data as {
    error?: string
    message?: string
    success?: boolean
    errorCode?: string
    retryable?: boolean
    correlationId?: string
  } | null

  if (resultObj && resultObj.success === false) {
    throw {
      success: false,
      errorCode: resultObj.errorCode ?? 'UNKNOWN_ATTENDANCE_ERROR',
      message: resultObj.message ?? resultObj.error ?? 'Request failed',
      correlationId: resultObj.correlationId ?? crypto.randomUUID(),
      retryable: resultObj.retryable ?? true,
    } as EdgeFunctionError
  }

  if (resultObj && resultObj.error && resultObj.success !== true) {
    throw {
      success: false,
      errorCode: 'UNKNOWN_ATTENDANCE_ERROR',
      message: resultObj.error,
      correlationId: crypto.randomUUID(),
      retryable: true,
    } as EdgeFunctionError
  }

  return data
}

const FALLBACK_ERROR_CODES = new Set([
  'FUNCTION_NOT_REACHABLE',
  'FUNCTION_BOOT_FAILED',
  'CORS_PREFLIGHT_FAILED',
  'FUNCTION_NOT_DEPLOYED',
  'NETWORK_TIMEOUT',
])

function isFallbackTriggeredError(e: unknown): boolean {
  if (!isEdgeFunctionError(e)) return false
  return FALLBACK_ERROR_CODES.has(e.errorCode)
}

async function uploadEvidenceToStorage(
  photoBase64: string,
  mimeType: string
): Promise<string> {
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) throw new Error('Not authenticated')

  const ext = mimeType.split('/')[1] ?? 'jpg'
  const path = `${userData.user.id}/${crypto.randomUUID()}.${ext}`

  const binaryString = atob(photoBase64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  const { error } = await supabase.storage
    .from('attendance-evidence')
    .upload(path, bytes, { contentType: mimeType, upsert: false })

  if (error) throw new Error(`Evidence upload failed: ${error.message}`)
  return path
}

async function callAttendanceRpc(
  action: 'check_in' | 'check_out',
  requestId: string,
  photoStoragePath: string,
  latitude: number,
  longitude: number,
  locationAccuracy?: number
): Promise<unknown> {
  const { data, error } = await supabase.rpc('process_attendance_action', {
    p_action: action,
    p_request_id: requestId,
    p_photo_storage_path: photoStoragePath,
    p_latitude: latitude,
    p_longitude: longitude,
    p_accuracy_meters: locationAccuracy ?? null,
  })

  if (error) {
    throw {
      success: false,
      errorCode: 'DATABASE_UPDATE_FAILED',
      message: error.message,
      correlationId: crypto.randomUUID(),
      retryable: true,
    } as EdgeFunctionError
  }

  const result = data as { success?: boolean; errorCode?: string; message?: string } | null
  if (result && result.success === false) {
    throw {
      success: false,
      errorCode: result.errorCode ?? 'UNKNOWN_ATTENDANCE_ERROR',
      message: result.message ?? 'Attendance processing failed',
      correlationId: crypto.randomUUID(),
      retryable: false,
    } as EdgeFunctionError
  }

  return data
}

export async function checkIn(params: {
  photo_base64: string
  evidence_mime_type: string
  latitude: number
  longitude: number
  location_accuracy?: number
}) {
  const requestId = crypto.randomUUID()

  try {
    return await callEdgeFunction('attendance-action', {
      action: 'check_in',
      ...params,
      requestId,
    })
  } catch (err) {
    if (!isFallbackTriggeredError(err)) throw err

    const storagePath = await uploadEvidenceToStorage(params.photo_base64, params.evidence_mime_type)
    return callAttendanceRpc('check_in', requestId, storagePath, params.latitude, params.longitude, params.location_accuracy)
  }
}

export async function checkOut(params: {
  photo_base64: string
  evidence_mime_type: string
  latitude: number
  longitude: number
  location_accuracy?: number
}) {
  const requestId = crypto.randomUUID()

  try {
    return await callEdgeFunction('attendance-action', {
      action: 'check_out',
      ...params,
      requestId,
    })
  } catch (err) {
    if (!isFallbackTriggeredError(err)) throw err

    const storagePath = await uploadEvidenceToStorage(params.photo_base64, params.evidence_mime_type)
    return callAttendanceRpc('check_out', requestId, storagePath, params.latitude, params.longitude, params.location_accuracy)
  }
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

export interface MonthlyAttendanceSummaryRow {
  employee_id: string
  employee_code: string
  full_name: string
  department: string | null
  branch: string | null
  present: number
  half_day: number
  absent: number
  approved_leave: number
  holiday: number
  weekly_off: number
  pending_checkout: number
  working_days: number
  attendance_percent: number
}

export async function fetchMonthlyAttendanceSummary(
  orgId: string,
  year: number,
  month: number
): Promise<MonthlyAttendanceSummaryRow[]> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`

  const { data: records, error } = await supabase
    .from('attendance_records')
    .select(`
      final_status,
      attendance_date,
      employees!inner (
        id,
        employee_code,
        full_name,
        organization_id,
        department_id,
        branch_id,
        departments ( name ),
        branches ( name )
      )
    `)
    .eq('employees.organization_id', orgId)
    .gte('attendance_date', startDate)
    .lte('attendance_date', endDate)

  if (error) throw new Error(error.message)

  const { data: approvedLeaves, error: leaveError } = await supabase
    .from('leave_requests')
    .select(`
      from_date,
      to_date,
      status,
      employees!inner ( id, organization_id )
    `)
    .eq('employees.organization_id', orgId)
    .eq('status', 'APPROVED')
    .or(`and(from_date.lte.${endDate},to_date.gte.${startDate})`)

  if (leaveError) throw new Error(leaveError.message)

  const { data: holidays, error: holidayError } = await supabase
    .from('holiday_calendar_dates')
    .select(`date, holiday_calendars!inner ( organization_id )`)
    .eq('holiday_calendars.organization_id', orgId)
    .gte('date', startDate)
    .lte('date', endDate)

  if (holidayError) throw new Error(holidayError.message)

  const holidayDates = new Set((holidays ?? []).map((h: { date: string }) => h.date))
  const sundayDates = new Set<string>()
  for (let d = 1; d <= endDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const dow = new Date(year, month - 1, d).getDay()
    if (dow === 0) sundayDates.add(dateStr)
  }

  const approvedLeaveDates = new Set<string>()
  for (const lr of approvedLeaves ?? []) {
    const from = lr.from_date as string
    const to = lr.to_date as string
    const fromTime = new Date(from).getTime()
    const toTime = new Date(to).getTime()
    const empId = (lr.employees as unknown as { id: string }).id
    for (let t = fromTime; t <= toTime; t += 86400000) {
      const ds = new Date(t).toISOString().slice(0, 10)
      if (ds >= startDate && ds <= endDate) approvedLeaveDates.add(`${empId}:${ds}`)
    }
  }

  const employeeMap = new Map<string, MonthlyAttendanceSummaryRow>()

  for (const r of records ?? []) {
    const emp = (r.employees as unknown as {
      id: string
      employee_code: string
      full_name: string
      department_id: string | null
      branch_id: string | null
      departments: { name: string } | null
      branches: { name: string } | null
    })
    if (!employeeMap.has(emp.id)) {
      employeeMap.set(emp.id, {
        employee_id: emp.id,
        employee_code: emp.employee_code,
        full_name: emp.full_name,
        department: emp.departments?.name ?? null,
        branch: emp.branches?.name ?? null,
        present: 0,
        half_day: 0,
        absent: 0,
        approved_leave: 0,
        holiday: 0,
        weekly_off: 0,
        pending_checkout: 0,
        working_days: 0,
        attendance_percent: 0,
      })
    }
    const row = employeeMap.get(emp.id)!
    const dateStr = r.attendance_date as string
    const isSunday = sundayDates.has(dateStr)
    const isHoliday = holidayDates.has(dateStr)
    const hasApprovedLeave = approvedLeaveDates.has(`${emp.id}:${dateStr}`)

    if (isHoliday) {
      row.holiday++
    } else if (isSunday) {
      row.weekly_off++
    } else if (hasApprovedLeave) {
      row.approved_leave++
    } else if (r.final_status === 'FULL_DAY') {
      row.present++
    } else if (r.final_status === 'HALF_DAY') {
      row.half_day++
    } else if (r.final_status === 'PENDING_CHECKOUT') {
      row.pending_checkout++
    }

    if (!isSunday && !isHoliday && !hasApprovedLeave) {
      row.working_days++
    }
  }

  for (const row of employeeMap.values()) {
    const units = row.present + row.half_day * 0.5
    row.attendance_percent = row.working_days > 0 ? Math.round((units / row.working_days) * 1000) / 10 : 0
  }

  return Array.from(employeeMap.values()).sort((a, b) => a.full_name.localeCompare(b.full_name))
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
  _userId: string,
  _file: Blob,
  _mimeType: string
): Promise<string> {
  throw new Error('Use checkIn/checkOut with photo_base64 instead')
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('Failed to convert photo'))
    reader.readAsDataURL(blob)
  })
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
