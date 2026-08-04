import { useEffect, useState, useCallback, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import { ATTENDANCE_STATUS_LABELS, ROLE_LABELS, type AttendanceStatus } from '@/types/roles'
import { formatTimeRemaining, formatTimestamp, fetchTodayAttendance } from '@/lib/attendance'
import { CheckInModal } from '@/components/CheckInModal'
import { CheckoutModal } from '@/components/CheckoutModal'
import { DashboardSkeleton } from '@/components/Skeleton'
import { DeadlinePerformanceCard } from '@/components/DeadlinePerformanceCard'
import { EmployeeAvatar } from '@/components/EmployeeAvatar'
import '@/styles/dashboard.css'

// ============================================================
// Types — all optional fields marked correctly
// ============================================================

interface DashboardMetrics {
  activeEmployees: number | null
  pendingActivation: number | null
  onboardingPending: number | null
  documentsPendingVerification: number | null
  onLeave: number | null
  notCheckedIn: number | null
  checkedInToday: number | null
  pendingCheckout: number | null
  fullDay: number | null
  halfDay: number | null
  pendingCorrections: number | null
  unreadNotifications: number | null
  pendingReviews: number | null
  returnedForCorrection: number | null
  reportsWithPhotos: number | null
  openFollowUps: number | null
  todayReports: number | null
  activeTasks: number | null
  acceptancePending: number | null
  inProgressTasks: number | null
  submittedTasks: number | null
  overdueTasks: number | null
  activeProjects: number | null
  onHoldProjects: number | null
  nearDeadlineProjects: number | null
  completedProjectsThisMonth: number | null
  myPendingReports: number | null
  myOpenTickets: number | null
  myLeavePending: number | null
  myActiveTasks: number | null
}

interface NotCheckedInEmp {
  id: string
  full_name: string
  designation: string | null
  department_name: string | null
  manager_name: string | null
  profile_photo_reference: string | null
  attendance_state: string
}

interface ScheduleItem {
  id: string
  time: string
  title: string
  category: string
  status: string
  link: string
}

interface CalendarEvent {
  date: string
  type: string
  label: string
}

interface ActivityItem {
  id: string
  action: string
  entity_type: string
  created_at: string
}

interface EmployeePerf {
  employeeId: string
  employeeName: string
  photoPath: string | null
  onTrack: number
  overdue: number
  metDeadline: number
  noDeadline: number
}

interface SectionState<T> {
  data: T
  loading: boolean
  error: string | null
}

// ============================================================
// Helpers
// ============================================================

function getKolkataDate(): string {
  const now = new Date()
  const kolkata = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return kolkata.toISOString().slice(0, 10)
}

function greetingText(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function isValidDateStr(s: string | null | undefined): s is string {
  if (!s) return false
  const d = new Date(s)
  return !isNaN(d.getTime())
}

// ============================================================
// Null-safe task extraction
// tasks!inner(...) returns a single object, not an array
// ============================================================

interface TaskJoinRow {
  current_deadline?: string | null
  original_deadline?: string | null
  deadline_at?: string | null
  status?: string | null
  title?: string | null
  id?: string | null
}

function extractTask(row: unknown): TaskJoinRow | null {
  if (!row) return null
  if (Array.isArray(row)) return (row[0] as TaskJoinRow) ?? null
  return row as TaskJoinRow
}

function getDeadline(task: TaskJoinRow | null): string | null {
  if (!task) return null
  return task.current_deadline ?? task.original_deadline ?? task.deadline_at ?? null
}

function parseDeadline(dl: string | null): Date | null {
  if (!dl) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(dl)) return new Date(dl + 'T17:30:00+05:30')
  const d = new Date(dl)
  return isNaN(d.getTime()) ? null : d
}

// ============================================================
// Section Error Boundary
// ============================================================

function SectionError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="dash-section-error">
      <span className="dash-section-error-msg">{message}</span>
      {onRetry && <button className="btn btn-section-retry" onClick={onRetry}>Retry</button>}
    </div>
  )
}

function SectionWrapper({
  title, loading, error, onRetry, children, showSkeleton = true,
}: {
  title?: string
  loading: boolean
  error: string | null
  onRetry?: () => void
  children: ReactNode
  showSkeleton?: boolean
}) {
  return (
    <div className="dash-section">
      {title && <h3 className="dash-section-title">{title}</h3>}
      {loading && showSkeleton && <div className="dash-section-skeleton" />}
      {!loading && error && <SectionError message={error} onRetry={onRetry} />}
      {!loading && !error && children}
    </div>
  )
}

// ============================================================
// Main Dashboard
// ============================================================

export function Dashboard() {
  const { profile, permissions } = useAuth()
  const navigate = useNavigate()

  const canReadAll = permissions.includes('attendance.read_all')
  const canReadTeam = permissions.includes('attendance.read_team')
  const canCheckIn = permissions.includes('attendance.check_in_self')
  const canCheckOut = permissions.includes('attendance.check_out_self')
  const canReadAudit = permissions.includes('audit.read')
  const canReadEmployees = permissions.includes('employee.read_all') || permissions.includes('employee.read_team')
  const canReviewReports = permissions.includes('daily_report.review')
  const canReadReports = permissions.includes('daily_report.read_all') || permissions.includes('daily_report.read_team')
  const canReadTasksAll = permissions.includes('task.read_all')
  const canReadTasksTeam = permissions.includes('task.read_team')
  const canManageProjects = permissions.includes('project.create') || permissions.includes('project.read_team') || permissions.includes('project.read_all')
  const canManageRecurring = permissions.includes('recurring_task.create') || permissions.includes('recurring_task.read_all') || permissions.includes('recurring_task.read_team')
  const canSendVoiceNotes = permissions.includes('voice_note.send')
  const canCreateTask = permissions.includes('task.create') || permissions.includes('task.assign')
  const canExport = permissions.includes('export.organization') || permissions.includes('export.team') || permissions.includes('export.self')
  const canManageAnnouncements = permissions.includes('announcement.create') || permissions.includes('announcement.manage')

  const isEmployeeOnly = !canReadEmployees && !canReadAll && !canReadTasksTeam && !canReadTasksAll

  // Core state (profile + employee lookup)
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)
  const [myEmpData, setMyEmpData] = useState<{
    full_name: string; designation: string | null; department_name: string | null; profile_photo_reference: string | null
  } | null>(null)
  const [coreLoading, setCoreLoading] = useState(true)
  const [coreError, setCoreError] = useState<string | null>(null)

  // Section states
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    activeEmployees: null, pendingActivation: null, onboardingPending: null,
    documentsPendingVerification: null, onLeave: null, notCheckedIn: null,
    checkedInToday: null, pendingCheckout: null, fullDay: null, halfDay: null,
    pendingCorrections: null, unreadNotifications: null, pendingReviews: null,
    returnedForCorrection: null, reportsWithPhotos: null, openFollowUps: null,
    todayReports: null, activeTasks: null, acceptancePending: null,
    inProgressTasks: null, submittedTasks: null, overdueTasks: null,
    activeProjects: null, onHoldProjects: null, nearDeadlineProjects: null,
    completedProjectsThisMonth: null,
    myPendingReports: null, myOpenTickets: null, myLeavePending: null,
    myActiveTasks: null,
  })
  const [metricsState, setMetricsState] = useState<SectionState<null>>({ data: null, loading: true, error: null })

  const [notCheckedIn, setNotCheckedIn] = useState<NotCheckedInEmp[]>([])
  const [notCheckedInState, setNotCheckedInState] = useState<SectionState<null>>({ data: null, loading: true, error: null })

  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([])
  const [scheduleState, setScheduleState] = useState<SectionState<null>>({ data: null, loading: true, error: null })

  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [calendarState, setCalendarState] = useState<SectionState<null>>({ data: null, loading: true, error: null })

  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([])
  const [activityState, setActivityState] = useState<SectionState<null>>({ data: null, loading: true, error: null })

  const [employeePerf, setEmployeePerf] = useState<EmployeePerf[]>([])
  const [perfState, setPerfState] = useState<SectionState<null>>({ data: null, loading: true, error: null })

  const [todayAttendance, setTodayAttendance] = useState<{
    check_in_at: string; required_checkout_at: string; final_status: string; actual_elapsed_minutes: number | null
  } | null>(null)
  const [attendanceState, setAttendanceState] = useState<SectionState<null>>({ data: null, loading: true, error: null })

  const [showCheckout, setShowCheckout] = useState(false)
  const [showCheckIn, setShowCheckIn] = useState(false)
  const [attendanceSuccess, setAttendanceSuccess] = useState<string | null>(null)
  const [selectedCalDate, setSelectedCalDate] = useState(getKolkataDate())

  // ============================================================
  // Core: load employee record (required for all other sections)
  // ============================================================
  const loadCore = useCallback(async () => {
    if (!profile?.id) { setCoreLoading(false); return }
    setCoreLoading(true)
    setCoreError(null)
    try {
      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .select('id, organization_id, full_name, designation, profile_photo_reference, department_id')
        .eq('user_id', profile.id)
        .maybeSingle()

      if (empErr) throw new Error(empErr.message)
      if (!emp) { setCoreLoading(false); return }

      const empData = emp as {
        id: string; organization_id: string; full_name: string; designation: string | null;
        profile_photo_reference: string | null; department_id: string | null
      }

      let deptName: string | null = null
      if (empData.department_id) {
        const { data: dept } = await supabase
          .from('departments')
          .select('name')
          .eq('id', empData.department_id)
          .maybeSingle()
        deptName = (dept as { name: string } | null)?.name ?? null
      }

      setMyEmployeeId(empData.id)
      setMyEmpData({
        full_name: empData.full_name,
        designation: empData.designation,
        department_name: deptName,
        profile_photo_reference: empData.profile_photo_reference,
      })
    } catch (e) {
      setCoreError((e as Error).message)
    }
    setCoreLoading(false)
  }, [profile?.id])

  // ============================================================
  // Section: KPI Metrics
  // ============================================================
  const loadMetrics = useCallback(async () => {
    if (!myEmployeeId || !myEmpData) return
    setMetricsState(s => ({ ...s, loading: true, error: null }))
    try {
      const orgId = (myEmpData as unknown as { organization_id?: string }).organization_id
      if (!orgId) throw new Error('Organization not found')
      const kolkataDate = getKolkataDate()
      const updates: Partial<DashboardMetrics> = {}

      // Use Promise.allSettled for independent metric groups
      const tasks: Promise<void>[] = []

      if (canReadEmployees) {
        tasks.push((async () => {
          const { count: activeCount } = await supabase
            .from('employees').select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId).eq('is_active', true)
          updates.activeEmployees = activeCount ?? 0

          const { count: pendingCount } = await supabase
            .from('employees').select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId).in('employment_status', ['invited', 'pending_activation'])
          updates.pendingActivation = pendingCount ?? 0

          const { data: orgEmpIds } = await supabase
            .from('employees').select('id').eq('organization_id', orgId).eq('is_active', true)
          const empIds = (orgEmpIds ?? []).map((e: { id: string }) => e.id)

          if (empIds.length > 0) {
            const { count: onboardCount } = await supabase
              .from('onboarding_checklists').select('*', { count: 'exact', head: true })
              .eq('status', 'pending').in('employee_id', empIds)
            updates.onboardingPending = onboardCount ?? 0
          } else { updates.onboardingPending = 0 }

          const { data: allOrgEmps } = await supabase
            .from('employees').select('id').eq('organization_id', orgId)
          const allEmpIds = (allOrgEmps ?? []).map((e: { id: string }) => e.id)
          if (allEmpIds.length > 0) {
            const { count: docCount } = await supabase
              .from('employee_documents').select('*', { count: 'exact', head: true })
              .eq('is_verified', false).in('employee_id', allEmpIds)
            updates.documentsPendingVerification = docCount ?? 0
          } else { updates.documentsPendingVerification = 0 }
        })())
      }

      if (canReadAll || canReadTeam) {
        tasks.push((async () => {
          const { count: checkedIn } = await supabase
            .from('attendance_records').select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId).eq('attendance_date', kolkataDate)
          updates.checkedInToday = checkedIn ?? 0

          const { count: activeCount } = await supabase
            .from('employees').select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId).eq('is_active', true)
          updates.notCheckedIn = Math.max(0, (activeCount ?? 0) - (checkedIn ?? 0))

          const { count: pendingOut } = await supabase
            .from('attendance_records').select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId).eq('attendance_date', kolkataDate).eq('final_status', 'PENDING_CHECKOUT')
          updates.pendingCheckout = pendingOut ?? 0

          const { count: fullD } = await supabase
            .from('attendance_records').select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId).eq('attendance_date', kolkataDate).eq('final_status', 'FULL_DAY')
          updates.fullDay = fullD ?? 0

          const { count: halfD } = await supabase
            .from('attendance_records').select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId).eq('attendance_date', kolkataDate).eq('final_status', 'HALF_DAY')
          updates.halfDay = halfD ?? 0

          const { count: corrCount } = await supabase
            .from('attendance_corrections').select('*', { count: 'exact', head: true })
            .eq('status', 'PENDING')
          updates.pendingCorrections = corrCount ?? 0

          const { count: onLeaveCount } = await supabase
            .from('leave_applications')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'APPROVED')
            .lte('start_date', kolkataDate)
            .gte('end_date', kolkataDate)
          updates.onLeave = onLeaveCount ?? 0
        })())
      }

      if (canReadTasksAll || canReadTasksTeam) {
        tasks.push((async () => {
          const { count: activeTaskCount } = await supabase
            .from('task_assignments').select('*', { count: 'exact', head: true })
            .eq('is_current', true)
            .in('assignment_status', ['ASSIGNED', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'IN_PROGRESS', 'SUBMITTED'])
          updates.activeTasks = activeTaskCount ?? 0

          const { count: accPen } = await supabase
            .from('task_assignments').select('*', { count: 'exact', head: true })
            .eq('is_current', true).eq('assignment_status', 'ACCEPTANCE_PENDING')
          updates.acceptancePending = accPen ?? 0

          const { count: inProg } = await supabase
            .from('task_assignments').select('*', { count: 'exact', head: true })
            .eq('is_current', true).eq('assignment_status', 'IN_PROGRESS')
          updates.inProgressTasks = inProg ?? 0

          const { count: submitted } = await supabase
            .from('task_assignments').select('*', { count: 'exact', head: true })
            .eq('is_current', true).eq('assignment_status', 'SUBMITTED')
          updates.submittedTasks = submitted ?? 0

          // Overdue: null-safe — tasks!inner returns single object
          const { data: activeAssignments } = await supabase
            .from('task_assignments')
            .select('id, tasks!inner(current_deadline, original_deadline, deadline_at, status)')
            .eq('is_current', true)
            .in('assignment_status', ['ASSIGNED', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'IN_PROGRESS'])
          const now = new Date()
          let overdue = 0
          for (const a of (activeAssignments ?? [])) {
            const task = extractTask(a.tasks)
            const dl = getDeadline(task)
            const dlDate = parseDeadline(dl)
            if (dlDate && dlDate < now) overdue++
          }
          updates.overdueTasks = overdue
        })())
      }

      if (isEmployeeOnly || permissions.includes('task.read_self')) {
        tasks.push((async () => {
          const { count: myTasks } = await supabase
            .from('task_assignments').select('*', { count: 'exact', head: true })
            .eq('assigned_to', myEmployeeId).eq('is_current', true)
            .in('assignment_status', ['ASSIGNED', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'IN_PROGRESS', 'SUBMITTED'])
          updates.myActiveTasks = myTasks ?? 0
        })())
      }

      if (canReviewReports) {
        tasks.push((async () => {
          const { count: reviewCount } = await supabase
            .from('daily_reports').select('*', { count: 'exact', head: true })
            .eq('status', 'SUBMITTED')
          updates.pendingReviews = reviewCount ?? 0

          const { count: returnedCount } = await supabase
            .from('daily_reports').select('*', { count: 'exact', head: true })
            .eq('status', 'REVISION_REQUIRED')
          updates.returnedForCorrection = returnedCount ?? 0
        })())
      }

      const canReadFollowUps = permissions.includes('follow_up.read_all') || permissions.includes('follow_up.read_team')
      if (canReadFollowUps) {
        tasks.push((async () => {
          const { count: fuCount } = await supabase
            .from('management_follow_ups').select('*', { count: 'exact', head: true })
            .in('status', ['open', 'assigned', 'in_progress'])
          updates.openFollowUps = fuCount ?? 0
        })())
      }

      if (canReadReports || canReviewReports) {
        tasks.push((async () => {
          const { count: reportCount } = await supabase
            .from('daily_reports').select('*', { count: 'exact', head: true })
            .eq('report_date', kolkataDate)
          updates.todayReports = reportCount ?? 0

          const { count: photoCount } = await supabase
            .from('daily_report_photos').select('*', { count: 'exact', head: true })
          updates.reportsWithPhotos = photoCount ?? 0
        })())
      }

      if (canManageProjects) {
        tasks.push((async () => {
          const { count: activeProj } = await supabase
            .from('projects').select('*', { count: 'exact', head: true })
            .eq('status', 'ACTIVE')
          updates.activeProjects = activeProj ?? 0

          const { count: onHold } = await supabase
            .from('projects').select('*', { count: 'exact', head: true })
            .eq('status', 'ON_HOLD')
          updates.onHoldProjects = onHold ?? 0

          const { data: activeProjRecs } = await supabase
            .from('projects').select('id, end_date, status').eq('status', 'ACTIVE')
          const nowDate = new Date()
          const weekLater = new Date(nowDate.getTime() + 7 * 24 * 60 * 60 * 1000)
          let nearDeadline = 0
          for (const p of (activeProjRecs ?? [])) {
            if (p.end_date) {
              const ed = new Date(p.end_date)
              if (!isNaN(ed.getTime()) && ed >= nowDate && ed <= weekLater) nearDeadline++
            }
          }
          updates.nearDeadlineProjects = nearDeadline

          const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).toISOString()
          const { count: completedMonth } = await supabase
            .from('projects').select('*', { count: 'exact', head: true })
            .eq('status', 'COMPLETED').gte('updated_at', monthStart)
          updates.completedProjectsThisMonth = completedMonth ?? 0
        })())
      }

      if (isEmployeeOnly) {
        tasks.push((async () => {
          const { count: myReports } = await supabase
            .from('daily_reports').select('*', { count: 'exact', head: true })
            .eq('employee_id', myEmployeeId).eq('status', 'DRAFT')
          updates.myPendingReports = myReports ?? 0

          const { count: myTickets } = await supabase
            .from('tickets').select('*', { count: 'exact', head: true })
            .eq('created_by', myEmployeeId)
            .in('status', ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_EMPLOYEE', 'ESCALATED'])
          updates.myOpenTickets = myTickets ?? 0

          const { count: myLeave } = await supabase
            .from('leave_applications').select('*', { count: 'exact', head: true })
            .eq('employee_id', myEmployeeId)
            .in('status', ['PENDING_MANAGER', 'PENDING_HR'])
          updates.myLeavePending = myLeave ?? 0
        })())
      }

      // Notifications (always loaded)
      tasks.push((async () => {
        const { count: unread } = await supabase
          .from('notifications').select('*', { count: 'exact', head: true })
          .eq('is_read', false)
        updates.unreadNotifications = unread ?? 0
      })())

      const results = await Promise.allSettled(tasks)
      // Check for any rejections — collect errors but don't fail entire section
      const errors = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
      if (errors.length > 0 && errors.length === results.length) {
        throw new Error(errors[0].reason?.message ?? 'Failed to load metrics')
      }

      setMetrics(prev => ({ ...prev, ...updates }))
      setMetricsState({ data: null, loading: false, error: null })
    } catch (e) {
      setMetricsState({ data: null, loading: false, error: (e as Error).message })
    }
  }, [myEmployeeId, myEmpData, permissions, canReadAll, canReadTeam, canReadEmployees,
      canReviewReports, canReadReports, canReadTasksAll, canReadTasksTeam,
      canManageProjects, canReadAudit, canCheckIn, isEmployeeOnly])

  // ============================================================
  // Section: Not Checked In
  // ============================================================
  const loadNotCheckedIn = useCallback(async () => {
    if (!myEmployeeId || !myEmpData || (!canReadAll && !canReadTeam)) {
      setNotCheckedInState({ data: null, loading: false, error: null })
      return
    }
    setNotCheckedInState(s => ({ ...s, loading: true, error: null }))
    try {
      const orgId = (myEmpData as unknown as { organization_id?: string }).organization_id
      if (!orgId) throw new Error('Organization not found')
      const kolkataDate = getKolkataDate()

      const { data: scopeEmpsData } = canReadAll
        ? await supabase.from('employees')
          .select('id, full_name, designation, profile_photo_reference, department_id, reporting_manager_id')
          .eq('organization_id', orgId).eq('is_active', true)
        : await supabase.from('employees')
          .select('id, full_name, designation, profile_photo_reference, department_id, reporting_manager_id')
          .eq('reporting_manager_id', myEmployeeId).eq('is_active', true)

      const scopeEmpList = (scopeEmpsData ?? []) as {
        id: string; full_name: string; designation: string | null;
        profile_photo_reference: string | null; department_id: string | null; reporting_manager_id: string | null
      }[]

      const { data: checkedInRecs } = await supabase
        .from('attendance_records').select('employee_id')
        .eq('attendance_date', kolkataDate)
      const checkedInIds = new Set((checkedInRecs ?? []).map((r: { employee_id: string }) => r.employee_id))
      const notCheckedInList = scopeEmpList.filter(e => !checkedInIds.has(e.id))

      const deptIds = [...new Set(notCheckedInList.map(e => e.department_id).filter(Boolean))] as string[]
      const managerIds = [...new Set(notCheckedInList.map(e => e.reporting_manager_id).filter(Boolean))] as string[]

      let deptMap: Record<string, string> = {}
      if (deptIds.length > 0) {
        const { data: depts } = await supabase.from('departments').select('id, name').in('id', deptIds)
        deptMap = Object.fromEntries((depts ?? []).map((d: { id: string; name: string }) => [d.id, d.name]))
      }

      let managerMap: Record<string, string> = {}
      if (managerIds.length > 0) {
        const { data: managers } = await supabase.from('employees').select('id, full_name').in('id', managerIds)
        managerMap = Object.fromEntries((managers ?? []).map((m: { id: string; full_name: string }) => [m.id, m.full_name]))
      }

      setNotCheckedIn(notCheckedInList.slice(0, 12).map(e => ({
        id: e.id,
        full_name: e.full_name,
        designation: e.designation,
        department_name: e.department_id ? (deptMap[e.department_id] ?? null) : null,
        manager_name: e.reporting_manager_id ? (managerMap[e.reporting_manager_id] ?? null) : null,
        profile_photo_reference: e.profile_photo_reference,
        attendance_state: 'Not Checked In',
      })))
      setNotCheckedInState({ data: null, loading: false, error: null })
    } catch (e) {
      setNotCheckedInState({ data: null, loading: false, error: (e as Error).message })
    }
  }, [myEmployeeId, myEmpData, canReadAll, canReadTeam])

  // ============================================================
  // Section: Calendar
  // ============================================================
  const loadCalendar = useCallback(async () => {
    setCalendarState(s => ({ ...s, loading: true, error: null }))
    try {
      const { data: holidays, error: calErr } = await supabase
        .from('calendar_events').select('event_date, event_type, title')
        .gte('event_date', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10))
        .lte('event_date', new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10))
      if (calErr) throw new Error(calErr.message)

      const events: CalendarEvent[] = []
      for (const h of (holidays ?? [])) {
        const row = h as { event_date?: string | null; event_type?: string | null; title?: string | null }
        if (isValidDateStr(row.event_date)) {
          events.push({
            date: row.event_date!,
            type: row.event_type ?? 'OTHER',
            label: row.title ?? 'Untitled',
          })
        }
      }
      setCalendarEvents(events)
      setCalendarState({ data: null, loading: false, error: null })
    } catch (e) {
      setCalendarState({ data: null, loading: false, error: (e as Error).message })
    }
  }, [])

  // ============================================================
  // Section: Today's Schedule
  // ============================================================
  const loadSchedule = useCallback(async () => {
    if (!myEmpData) { setScheduleState({ data: null, loading: false, error: null }); return }
    setScheduleState(s => ({ ...s, loading: true, error: null }))
    try {
      const kolkataDate = getKolkataDate()
      const schedItems: ScheduleItem[] = []

      // Tasks with deadline today — use deadline_at (canonical) with fallback to current_deadline
      const { data: todayTasks, error: taskErr } = await supabase
        .from('tasks').select('id, task_code, title, current_deadline, original_deadline, deadline_at, status')
        .or(`current_deadline.eq.${kolkataDate},original_deadline.eq.${kolkataDate}`)
      if (taskErr) throw new Error(taskErr.message)

      for (const t of (todayTasks ?? [])) {
        const row = t as {
          id: string; title?: string | null; status?: string | null;
          current_deadline?: string | null; original_deadline?: string | null; deadline_at?: string | null
        }
        schedItems.push({
          id: row.id,
          time: '17:30',
          title: row.title ?? 'Untitled task',
          category: 'Task Deadline',
          status: row.status ?? 'UNKNOWN',
          link: `/tasks/${row.id}`,
        })
      }

      const { data: todayReports } = await supabase
        .from('daily_reports').select('id, report_date, status, employee_id')
        .eq('report_date', kolkataDate)
      for (const r of (todayReports ?? [])) {
        const row = r as { id: string; status?: string | null }
        schedItems.push({
          id: row.id, time: '18:00', title: 'Daily Report',
          category: 'Report', status: row.status ?? 'UNKNOWN',
          link: `/team-reports?date=${kolkataDate}`,
        })
      }

      const { data: todayEvents } = await supabase
        .from('calendar_events').select('id, event_date, event_type, title, start_time')
        .eq('event_date', kolkataDate)
      for (const e of (todayEvents ?? [])) {
        const row = e as {
          id: string; title?: string | null; event_type?: string | null; start_time?: string | null
        }
        schedItems.push({
          id: row.id,
          time: row.start_time || 'All day',
          title: row.title ?? 'Untitled event',
          category: 'Meeting',
          status: row.event_type ?? 'OTHER',
          link: '/calendar',
        })
      }

      setScheduleItems(schedItems)
      setScheduleState({ data: null, loading: false, error: null })
    } catch (e) {
      setScheduleState({ data: null, loading: false, error: (e as Error).message })
    }
  }, [myEmpData])

  // ============================================================
  // Section: Recent Activity
  // ============================================================
  const loadActivity = useCallback(async () => {
    if (!canReadAudit) { setActivityState({ data: null, loading: false, error: null }); return }
    setActivityState(s => ({ ...s, loading: true, error: null }))
    try {
      const { data: audit, error: auditErr } = await supabase
        .from('audit_logs').select('id, action, entity_type, created_at')
        .order('created_at', { ascending: false }).limit(8)
      if (auditErr) throw new Error(auditErr.message)
      setRecentActivity((audit ?? []) as ActivityItem[])
      setActivityState({ data: null, loading: false, error: null })
    } catch (e) {
      setActivityState({ data: null, loading: false, error: (e as Error).message })
    }
  }, [canReadAudit])

  // ============================================================
  // Section: Employee Performance
  // ============================================================
  const loadPerf = useCallback(async () => {
    if (!myEmployeeId || !myEmpData || (!canReadTasksAll && !canReadTasksTeam)) {
      setPerfState({ data: null, loading: false, error: null })
      return
    }
    setPerfState(s => ({ ...s, loading: true, error: null }))
    try {
      const orgId = (myEmpData as unknown as { organization_id?: string }).organization_id
      if (!orgId) throw new Error('Organization not found')

      const { data: scopeEmpsData } = canReadTasksAll
        ? await supabase.from('employees')
          .select('id, full_name, profile_photo_reference')
          .eq('organization_id', orgId).eq('is_active', true)
        : await supabase.from('employees')
          .select('id, full_name, profile_photo_reference')
          .eq('reporting_manager_id', myEmployeeId).eq('is_active', true)

      const perfList: EmployeePerf[] = []
      for (const emp of (scopeEmpsData ?? []) as { id: string; full_name: string; profile_photo_reference: string | null }[]) {
        const { data: assignments } = await supabase
          .from('task_assignments')
          .select('id, assignment_status, ended_at, tasks!inner(current_deadline, original_deadline, deadline_at, status)')
          .eq('assigned_to', emp.id).eq('is_current', true)

        let onTrack = 0, overdue = 0, metDeadline = 0, noDeadline = 0
        const nowPerf = new Date()
        for (const a of (assignments ?? [])) {
          const task = extractTask(a.tasks)
          const dl = getDeadline(task)
          const dlDate = parseDeadline(dl)
          const taskStatus = task?.status ?? null
          const assignStatus = a.assignment_status ?? null

          if (assignStatus === 'COMPLETED' || taskStatus === 'COMPLETED') {
            metDeadline++
          } else if (!dlDate) {
            noDeadline++
          } else if (dlDate < nowPerf) {
            overdue++
          } else {
            onTrack++
          }
        }
        if (assignments && assignments.length > 0) {
          perfList.push({
            employeeId: emp.id, employeeName: emp.full_name,
            photoPath: emp.profile_photo_reference,
            onTrack, overdue, metDeadline, noDeadline,
          })
        }
      }
      setEmployeePerf(perfList.slice(0, 8))
      setPerfState({ data: null, loading: false, error: null })
    } catch (e) {
      setPerfState({ data: null, loading: false, error: (e as Error).message })
    }
  }, [myEmployeeId, myEmpData, canReadTasksAll, canReadTasksTeam])

  // ============================================================
  // Section: Self Attendance
  // ============================================================
  const loadSelfAttendance = useCallback(async () => {
    if (!myEmployeeId || !canCheckIn) {
      setAttendanceState({ data: null, loading: false, error: null })
      return
    }
    setAttendanceState(s => ({ ...s, loading: true, error: null }))
    try {
      const rec = await fetchTodayAttendance(myEmployeeId)
      setTodayAttendance(rec ? {
        check_in_at: rec.check_in_at,
        required_checkout_at: rec.required_checkout_at,
        final_status: rec.final_status,
        actual_elapsed_minutes: (rec as { actual_elapsed_minutes?: number }).actual_elapsed_minutes ?? null,
      } : null)
      setAttendanceState({ data: null, loading: false, error: null })
    } catch (e) {
      setAttendanceState({ data: null, loading: false, error: (e as Error).message })
    }
  }, [myEmployeeId, canCheckIn])

  // ============================================================
  // Load core — all sections kicked off after core completes
  // ============================================================
  useEffect(() => {
    loadCore()
  }, [loadCore])

  // After core loads, kick off all sections in parallel
  useEffect(() => {
    if (myEmployeeId && myEmpData) {
      loadMetrics()
      loadNotCheckedIn()
      loadCalendar()
      loadSchedule()
      loadActivity()
      loadPerf()
      loadSelfAttendance()
    }
  }, [myEmployeeId, myEmpData, loadMetrics, loadNotCheckedIn, loadCalendar,
      loadSchedule, loadActivity, loadPerf, loadSelfAttendance])

  // ============================================================
  // Realtime — refetch only the relevant section, not full reload
  // ============================================================
  useEffect(() => {
    if (!profile?.id) return
    const channel = supabase.channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records' },
        () => { loadMetrics(); loadNotCheckedIn(); loadSelfAttendance() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' },
        () => { loadMetrics(); loadSchedule(); loadPerf() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignments' },
        () => { loadMetrics(); loadPerf() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_reports' },
        () => { loadMetrics(); loadSchedule() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_applications' },
        () => { loadMetrics() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' },
        () => { loadMetrics() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' },
        () => { loadMetrics() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'voice_notes' },
        () => {})
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' },
        () => { loadCalendar(); loadSchedule() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile?.id, loadMetrics, loadNotCheckedIn, loadSelfAttendance,
      loadSchedule, loadPerf, loadCalendar])

  // ============================================================
  // Handlers
  // ============================================================
  function handleCheckoutSuccess(result: { final_status: string; elapsed_minutes: number }) {
    setShowCheckout(false)
    setAttendanceSuccess(`Checked out! Status: ${ATTENDANCE_STATUS_LABELS[result.final_status as AttendanceStatus] ?? result.final_status}`)
    loadSelfAttendance()
  }

  const todayDate = getKolkataDate()
  const roleLabel = profile?.role ? (ROLE_LABELS as Record<string, string>)[profile.role] ?? profile.role : ''

  if (coreLoading) return <div className="dashboard"><DashboardSkeleton /></div>
  if (coreError) return (
    <div className="dashboard">
      <div className="dash-error-banner">
        <span>Failed to load dashboard: {coreError}</span>
        <button className="btn btn-retry" onClick={() => loadCore()}>Retry</button>
      </div>
    </div>
  )

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="dashboard">
      {/* === PROFILE GREETING === */}
      <DashboardGreeting
        fullName={myEmpData?.full_name || profile?.full_name || profile?.email || ''}
        role={roleLabel}
        designation={myEmpData?.designation || null}
        department={myEmpData?.department_name || null}
        photoPath={myEmpData?.profile_photo_reference || null}
        employeeId={myEmployeeId || undefined}
      />

      {/* === ATTENDANCE WIDGET (self) === */}
      {canCheckIn && (
        <SectionWrapper
          loading={attendanceState.loading}
          error={attendanceState.error}
          onRetry={loadSelfAttendance}
          showSkeleton={false}
        >
          <AttendanceWidget
            attendance={todayAttendance}
            canCheckOut={canCheckOut}
            successMsg={attendanceSuccess}
            onCheckIn={() => setShowCheckIn(true)}
            onCheckOut={() => setShowCheckout(true)}
          />
        </SectionWrapper>
      )}

      {/* === KPI CARDS === */}
      <SectionWrapper
        loading={metricsState.loading}
        error={metricsState.error}
        onRetry={loadMetrics}
        showSkeleton={false}
      >
        <KpiCards
          metrics={metrics}
          isEmployeeOnly={isEmployeeOnly}
          canReadEmployees={canReadEmployees}
          canReadAll={canReadAll}
          canReadTeam={canReadTeam}
          canReadTasksAll={canReadTasksAll}
          canReadTasksTeam={canReadTasksTeam}
          canReviewReports={canReviewReports}
          canReadReports={canReadReports}
          canManageProjects={canManageProjects}
          todayDate={todayDate}
          navigate={navigate}
        />
      </SectionWrapper>

      {/* === CALENDAR & SCHEDULE === */}
      <CalendarSchedule
        events={calendarEvents}
        scheduleItems={scheduleItems}
        selectedDate={selectedCalDate}
        onSelectDate={setSelectedCalDate}
        calendarLoading={calendarState.loading}
        calendarError={calendarState.error}
        onCalendarRetry={loadCalendar}
        scheduleLoading={scheduleState.loading}
        scheduleError={scheduleState.error}
        onScheduleRetry={loadSchedule}
      />

      {/* === NOT CHECKED IN === */}
      {(canReadAll || canReadTeam) && (
        <SectionWrapper
          title="Not Checked In Today"
          loading={notCheckedInState.loading}
          error={notCheckedInState.error}
          onRetry={loadNotCheckedIn}
        >
          {notCheckedIn.length > 0 ? (
            <NotCheckedInSection employees={notCheckedIn} todayDate={todayDate} navigate={navigate} />
          ) : (
            <div className="dash-empty-state">All employees have checked in today.</div>
          )}
        </SectionWrapper>
      )}

      {/* === TASK PERFORMANCE === */}
      {myEmployeeId && <DeadlinePerformanceCard employeeId={myEmployeeId} />}

      {(canReadTasksAll || canReadTasksTeam) && (
        <SectionWrapper
          title="Team Task Performance"
          loading={perfState.loading}
          error={perfState.error}
          onRetry={loadPerf}
        >
          {employeePerf.length > 0 ? (
            <EmployeePerfSection employees={employeePerf} navigate={navigate} />
          ) : (
            <div className="dash-empty-state">No team task performance data available.</div>
          )}
        </SectionWrapper>
      )}

      {/* === MANAGEMENT QUICK ACTIONS === */}
      <QuickActions
        canCreateTask={canCreateTask}
        canReadTasksTeam={canReadTasksTeam}
        canReadTasksAll={canReadTasksAll}
        canManageProjects={canManageProjects}
        canManageRecurring={canManageRecurring}
        canSendVoiceNotes={canSendVoiceNotes}
        canReviewReports={canReviewReports}
        canReadAll={canReadAll}
        canReadEmployees={canReadEmployees}
        canExport={canExport}
        canManageAnnouncements={canManageAnnouncements}
        metrics={metrics}
        navigate={navigate}
      />

      {/* === DAILY REPORTS / FOLLOW-UPS === */}
      {(metrics.pendingReviews !== null || metrics.openFollowUps !== null || metrics.todayReports !== null) && (
        <div className="dash-section">
          <h3 className="dash-section-title">Daily Reports & Follow-ups</h3>
          <div className="dash-kpi-row">
            {metrics.pendingReviews !== null && (
              <KpiCard
                label="Pending Reviews" value={metrics.pendingReviews}
                gradient="orange"
                onClick={() => navigate('/report-review?status=submitted')}
              />
            )}
            {metrics.returnedForCorrection !== null && (
              <KpiCard
                label="Returned for Correction" value={metrics.returnedForCorrection}
                gradient="orange"
                onClick={() => navigate('/report-review?status=revision_required')}
              />
            )}
            {metrics.openFollowUps !== null && (
              <KpiCard
                label="Open Follow-ups" value={metrics.openFollowUps}
                gradient="orange"
                onClick={() => navigate('/follow-up-queue?status=open')}
              />
            )}
            {metrics.todayReports !== null && (
              <KpiCard
                label="Today's Reports" value={metrics.todayReports}
                gradient="orange"
                onClick={() => navigate('/team-reports?date=today')}
              />
            )}
          </div>
        </div>
      )}

      {/* === RECENT ACTIVITY === */}
      {canReadAudit && (
        <SectionWrapper
          title="Recent Activity"
          loading={activityState.loading}
          error={activityState.error}
          onRetry={loadActivity}
        >
          {recentActivity.length > 0 ? (
            <RecentActivitySection items={recentActivity} navigate={navigate} />
          ) : (
            <div className="dash-empty-state">No recent activity.</div>
          )}
        </SectionWrapper>
      )}

      {/* === MODALS === */}
      {showCheckout && (
        <CheckoutModal
          userId={profile!.id}
          onClose={() => setShowCheckout(false)}
          onSuccess={handleCheckoutSuccess}
        />
      )}
      {showCheckIn && profile?.id && (
        <CheckInModal
          userId={profile.id}
          onClose={() => setShowCheckIn(false)}
          onSuccess={(result) => {
            setShowCheckIn(false)
            setAttendanceSuccess(result.recurring_tasks_generated
              ? `Checked in! ${result.recurring_tasks_generated} recurring task(s) assigned for today.`
              : 'Checked in successfully!')
            loadSelfAttendance()
          }}
        />
      )}
    </div>
  )
}

// ============================================================
// Dashboard Greeting
// ============================================================

function DashboardGreeting({
  fullName, role, designation, department, photoPath, employeeId,
}: {
  fullName: string; role: string; designation: string | null; department: string | null
  photoPath: string | null; employeeId?: string
}) {
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata',
  })
  return (
    <div className="dash-greeting">
      <EmployeeAvatar
        employeeId={employeeId}
        fullName={fullName}
        photoPath={photoPath}
        size="large"
      />
      <div className="dash-greeting-text">
        <h2 className="dash-greeting-title">{greetingText()}, {fullName}!</h2>
        <p className="dash-greeting-sub">Here is your overview for today.</p>
        <div className="dash-greeting-meta">
          <span className="dash-greeting-role">{role}</span>
          {designation && <span className="dash-greeting-sep">·</span>}
          {designation && <span className="dash-greeting-desig">{designation}</span>}
          {department && <span className="dash-greeting-sep">·</span>}
          {department && <span className="dash-greeting-dept">{department}</span>}
        </div>
        <p className="dash-greeting-date">{today}</p>
      </div>
    </div>
  )
}

// ============================================================
// Attendance Widget
// ============================================================

function AttendanceWidget({
  attendance, canCheckOut, successMsg, onCheckIn, onCheckOut,
}: {
  attendance: { check_in_at: string; required_checkout_at: string; final_status: string; actual_elapsed_minutes: number | null } | null
  canCheckOut: boolean
  successMsg: string | null
  onCheckIn: () => void
  onCheckOut: () => void
}) {
  return (
    <div className="dash-attendance-widget">
      {successMsg && <div className="form-success" style={{ marginBottom: '8px' }}>{successMsg}</div>}
      {attendance ? (
        <div className="dash-att-grid">
          <div className="dash-att-item">
            <span className="dash-att-label">Check-In</span>
            <span className="dash-att-value mono">{formatTimestamp(attendance.check_in_at)}</span>
          </div>
          <div className="dash-att-item">
            <span className="dash-att-label">Checkout Time</span>
            <span className="dash-att-value mono">{formatTimestamp(attendance.required_checkout_at)}</span>
          </div>
          <div className="dash-att-item">
            <span className="dash-att-label">Status</span>
            <span className={`attendance-badge ${attendance.final_status.toLowerCase()}`}>
              {ATTENDANCE_STATUS_LABELS[attendance.final_status as AttendanceStatus] ?? attendance.final_status}
            </span>
          </div>
          {attendance.final_status === 'PENDING_CHECKOUT' && attendance.actual_elapsed_minutes !== null && (
            <div className="dash-att-item">
              <span className="dash-att-label">Hours Completed</span>
              <span className="dash-att-value mono" style={{ fontWeight: 700 }}>
                {Math.floor(attendance.actual_elapsed_minutes / 60)}h {attendance.actual_elapsed_minutes % 60}m
              </span>
            </div>
          )}
          {attendance.final_status === 'PENDING_CHECKOUT' && (
            <>
              <div className="dash-att-item">
                <span className="dash-att-label">Time Remaining</span>
                <span className="dash-att-value mono" style={{ fontWeight: 700 }}>
                  {formatTimeRemaining(attendance.required_checkout_at)}
                </span>
              </div>
              {canCheckOut && (
                <button className="btn btn-checkout dash-att-btn" onClick={onCheckOut}>Check Out</button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="dash-att-empty">
          <span>No check-in yet today</span>
          <button className="btn btn-checkin" onClick={onCheckIn}>Check In</button>
        </div>
      )}
    </div>
  )
}

// ============================================================
// KPI Cards Section
// ============================================================

function KpiCards({
  metrics, isEmployeeOnly, canReadEmployees, canReadAll, canReadTeam,
  canReadTasksAll, canReadTasksTeam, canReviewReports, canReadReports,
  canManageProjects, todayDate, navigate,
}: {
  metrics: DashboardMetrics
  isEmployeeOnly: boolean
  canReadEmployees: boolean
  canReadAll: boolean
  canReadTeam: boolean
  canReadTasksAll: boolean
  canReadTasksTeam: boolean
  canReviewReports: boolean
  canReadReports: boolean
  canManageProjects: boolean
  todayDate: string
  navigate: (path: string) => void
}) {
  if (isEmployeeOnly) {
    return (
      <div className="dash-kpi-row">
        <KpiCard label="My Tasks" value={metrics.myActiveTasks} gradient="purple"
          subMetrics={[{ label: 'Active', value: metrics.myActiveTasks ?? '—' }]}
          onClick={() => navigate('/my-tasks')} />
        <KpiCard label="My Reports" value={metrics.myPendingReports} gradient="orange"
          onClick={() => navigate('/my-reports')} />
        <KpiCard label="My Leave" value={metrics.myLeavePending} gradient="teal"
          onClick={() => navigate('/my-leave')} />
        <KpiCard label="My Tickets" value={metrics.myOpenTickets} gradient="coral"
          onClick={() => navigate('/my-tickets')} />
        <KpiCard label="Unread Notifications" value={metrics.unreadNotifications} gradient="cyan"
          onClick={() => navigate('/notification-inbox?read=false')} />
      </div>
    )
  }

  return (
    <div className="dash-kpi-row">
      {canReadEmployees && (
        <KpiCard label="Employees" value={metrics.activeEmployees} gradient="green"
          subMetrics={[
            { label: 'Pending Activation', value: metrics.pendingActivation ?? '—' },
            { label: 'On Leave', value: metrics.onLeave ?? '—' },
            { label: 'Not Checked In', value: metrics.notCheckedIn ?? '—' },
            { label: 'Onboarding', value: metrics.onboardingPending ?? '—' },
          ]}
          onClick={() => navigate('/employees?access_status=Active')} />
      )}
      {(canReadAll || canReadTeam) && (
        <KpiCard label="Attendance" value={metrics.checkedInToday} gradient="blue"
          subMetrics={[
            { label: 'Pending Checkout', value: metrics.pendingCheckout ?? '—' },
            { label: 'Full Day', value: metrics.fullDay ?? '—' },
            { label: 'Half Day', value: metrics.halfDay ?? '—' },
            { label: 'Corrections', value: metrics.pendingCorrections ?? '—' },
          ]}
          onClick={() => navigate(`/attendance-management?date=${todayDate}&status=checked_in`)} />
      )}
      {(canReadTasksAll || canReadTasksTeam) && (
        <KpiCard label="Tasks" value={metrics.activeTasks} gradient="purple"
          subMetrics={[
            { label: 'Acceptance Pending', value: metrics.acceptancePending ?? '—' },
            { label: 'In Progress', value: metrics.inProgressTasks ?? '—' },
            { label: 'Submitted', value: metrics.submittedTasks ?? '—' },
            { label: 'Overdue', value: metrics.overdueTasks ?? '—' },
          ]}
          onClick={() => navigate('/team-tasks')} />
      )}
      {(canReviewReports || canReadReports) && (
        <KpiCard label="Daily Reports" value={metrics.todayReports} gradient="orange"
          subMetrics={[
            { label: 'Pending Reviews', value: metrics.pendingReviews ?? '—' },
            { label: 'Returned', value: metrics.returnedForCorrection ?? '—' },
            { label: 'With Photos', value: metrics.reportsWithPhotos ?? '—' },
            { label: 'Follow-ups', value: metrics.openFollowUps ?? '—' },
          ]}
          onClick={() => navigate('/team-reports?date=today')} />
      )}
      {canManageProjects && (
        <KpiCard label="Projects" value={metrics.activeProjects} gradient="indigo"
          subMetrics={[
            { label: 'On Hold', value: metrics.onHoldProjects ?? '—' },
            { label: 'Near Deadline', value: metrics.nearDeadlineProjects ?? '—' },
            { label: 'Completed', value: metrics.completedProjectsThisMonth ?? '—' },
          ]}
          onClick={() => navigate('/projects')} />
      )}
      <KpiCard label="Unread Notifications" value={metrics.unreadNotifications} gradient="cyan"
        onClick={() => navigate('/notification-inbox?read=false')} />
    </div>
  )
}

// ============================================================
// KPI Card
// ============================================================

type GradientTheme = 'green' | 'blue' | 'purple' | 'orange' | 'indigo' | 'cyan' | 'coral' | 'violet' | 'teal'

function KpiCard({
  label, value, subMetrics, gradient, onClick,
}: {
  label: string
  value: number | null
  subMetrics?: { label: string; value: number | string | null }[]
  gradient: GradientTheme
  onClick?: () => void
}) {
  const interactive = !!onClick
  return (
    <div
      className={`dash-kpi-card dash-kpi-${gradient} ${interactive ? 'dash-kpi-clickable' : ''}`}
      onClick={onClick}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick!() } } : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={onClick ? `View details for ${label}` : undefined}
    >
      <div className="dash-kpi-header">
        <span className="dash-kpi-label">{label}</span>
      </div>
      <div className="dash-kpi-value">{value ?? '—'}</div>
      {subMetrics && subMetrics.length > 0 && (
        <div className="dash-kpi-subs">
          {subMetrics.map((sm, i) => (
            <div key={i} className="dash-kpi-sub">
              <span className="dash-kpi-sub-val">{sm.value}</span>
              <span className="dash-kpi-sub-lbl">{sm.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Calendar & Schedule (with section-level error states)
// ============================================================

function CalendarSchedule({
  events, scheduleItems, selectedDate, onSelectDate,
  calendarLoading, calendarError, onCalendarRetry,
  scheduleLoading, scheduleError, onScheduleRetry,
}: {
  events: CalendarEvent[]
  scheduleItems: ScheduleItem[]
  selectedDate: string
  onSelectDate: (d: string) => void
  calendarLoading: boolean
  calendarError: string | null
  onCalendarRetry: () => void
  scheduleLoading: boolean
  scheduleError: string | null
  onScheduleRetry: () => void
}) {
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const year = calMonth.getFullYear()
  const month = calMonth.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startWeekday = firstDay.getDay()
  const daysInMonth = lastDay.getDate()
  const todayStr = getKolkataDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const eventMap: Record<string, CalendarEvent[]> = {}
  for (const e of events) {
    if (!eventMap[e.date]) eventMap[e.date] = []
    eventMap[e.date].push(e)
  }

  const monthName = calMonth.toLocaleString('en-IN', { month: 'long', year: 'numeric' })

  const eventColors: Record<string, string> = {
    PUBLIC_HOLIDAY: '#ef4444',
    COMPANY_HOLIDAY: '#f97316',
    BRANCH_HOLIDAY: '#eab308',
    MEETING: '#3b82f6',
    TRAINING: '#8b5cf6',
    COMPANY_EVENT: '#10b981',
    WEEKLY_OFF: '#6b7280',
    WORKING_DAY_OVERRIDE: '#14b8a6',
    OTHER: '#6366f1',
    ANNOUNCEMENT: '#ec4899',
  }

  return (
    <div className="dash-cal-sched">
      <div className="dash-calendar">
        <div className="dash-cal-header">
          <button className="dash-cal-nav" onClick={() => setCalMonth(new Date(year, month - 1, 1))} aria-label="Previous month">‹</button>
          <span className="dash-cal-month">{monthName}</span>
          <button className="dash-cal-nav" onClick={() => setCalMonth(new Date(year, month + 1, 1))} aria-label="Next month">›</button>
        </div>
        {calendarLoading ? (
          <div className="dash-section-skeleton" style={{ height: '200px' }} />
        ) : calendarError ? (
          <SectionError message="Calendar could not be loaded." onRetry={onCalendarRetry} />
        ) : (
          <>
            <div className="dash-cal-grid">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <div key={i} className="dash-cal-dow">{d}</div>
              ))}
              {cells.map((day, i) => {
                if (day === null) return <div key={i} className="dash-cal-cell empty" />
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                const dayEvents = eventMap[dateStr] || []
                const isToday = dateStr === todayStr
                const isSelected = dateStr === selectedDate
                return (
                  <div
                    key={i}
                    className={`dash-cal-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
                    onClick={() => onSelectDate(dateStr)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') onSelectDate(dateStr) }}
                  >
                    <span className="dash-cal-day">{day}</span>
                    {dayEvents.length > 0 && (
                      <div className="dash-cal-dots">
                        {dayEvents.slice(0, 3).map((ev, j) => (
                          <span key={j} className="dash-cal-dot"
                            style={{ background: eventColors[ev.type] || '#6366f1' }}
                            title={ev.label} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="dash-cal-legend">
              {Object.entries(eventColors).slice(0, 5).map(([type, color]) => (
                <span key={type} className="dash-cal-legend-item">
                  <span className="dash-cal-dot" style={{ background: color }} />
                  {type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="dash-schedule">
        <h3 className="dash-sched-title">Today's Schedule</h3>
        {scheduleLoading ? (
          <div className="dash-section-skeleton" style={{ height: '200px' }} />
        ) : scheduleError ? (
          <SectionError message="Schedule could not be loaded." onRetry={onScheduleRetry} />
        ) : scheduleItems.length === 0 ? (
          <div className="dash-sched-empty">No events scheduled for today</div>
        ) : (
          <div className="dash-sched-timeline">
            {scheduleItems.map((item, i) => (
              <div
                key={`${item.id}-${i}`}
                className="dash-sched-item"
                role="button"
                tabIndex={0}
              >
                <div className="dash-sched-time">{item.time}</div>
                <div className="dash-sched-content">
                  <div className="dash-sched-name">{item.title}</div>
                  <div className="dash-sched-cat">{item.category}</div>
                </div>
                <span className={`dash-sched-status status-${(item.status || 'unknown').toLowerCase().replace(/_/g, '-')}`} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Not Checked In Section
// ============================================================

function NotCheckedInSection({
  employees, todayDate, navigate,
}: {
  employees: NotCheckedInEmp[]
  todayDate: string
  navigate: (path: string) => void
}) {
  return (
    <>
      <div className="dash-section-header">
        <button className="btn btn-view-all" onClick={() => navigate(`/attendance-management?date=${todayDate}&status=not_checked_in`)}>
          View All
        </button>
      </div>
      <div className="dash-emp-scroll">
        {employees.map(emp => (
          <div
            key={emp.id}
            className="dash-emp-card"
            onClick={() => navigate(`/employees/${emp.id}`)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/employees/${emp.id}`) }}
          >
            <EmployeeAvatar
              employeeId={emp.id}
              fullName={emp.full_name}
              photoPath={emp.profile_photo_reference}
              size="medium"
            />
            <div className="dash-emp-info">
              <div className="dash-emp-name">{emp.full_name}</div>
              <div className="dash-emp-desig">{emp.designation || '—'}</div>
              <div className="dash-emp-dept">{emp.department_name || '—'}</div>
            </div>
            <span className="dash-emp-state">{emp.attendance_state}</span>
          </div>
        ))}
      </div>
    </>
  )
}

// ============================================================
// Employee Performance Section
// ============================================================

function EmployeePerfSection({
  employees, navigate,
}: {
  employees: EmployeePerf[]
  navigate: (path: string) => void
}) {
  return (
    <div className="dash-perf-list">
      {employees.map(emp => (
        <div
          key={emp.employeeId}
          className="dash-perf-row"
          onClick={() => navigate(`/employees/${emp.employeeId}`)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/employees/${emp.employeeId}`) }}
        >
          <EmployeeAvatar
            employeeId={emp.employeeId}
            fullName={emp.employeeName}
            photoPath={emp.photoPath}
            size="small"
          />
          <div className="dash-perf-name">{emp.employeeName}</div>
          <div className="dash-perf-stats">
            <span className="dash-perf-stat perf-on-track">On Track: {emp.onTrack}</span>
            <span className="dash-perf-stat perf-overdue">Overdue: {emp.overdue}</span>
            <span className="dash-perf-stat perf-met">Met: {emp.metDeadline}</span>
            {emp.noDeadline > 0 && <span className="dash-perf-stat perf-no-deadline">No Deadline: {emp.noDeadline}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================
// Quick Actions
// ============================================================

function QuickActions({
  canCreateTask, canReadTasksTeam, canReadTasksAll, canManageProjects,
  canManageRecurring, canSendVoiceNotes, canReviewReports, canReadAll,
  canReadEmployees, canExport, canManageAnnouncements, metrics, navigate,
}: {
  canCreateTask: boolean
  canReadTasksTeam: boolean
  canReadTasksAll: boolean
  canManageProjects: boolean
  canManageRecurring: boolean
  canSendVoiceNotes: boolean
  canReviewReports: boolean
  canReadAll: boolean
  canReadEmployees: boolean
  canExport: boolean
  canManageAnnouncements: boolean
  metrics: DashboardMetrics
  navigate: (path: string) => void
}) {
  type Action = { label: string; desc: string; icon: string; gradient: GradientTheme; count?: string; show: boolean; link: string }
  const actions: Action[] = [
    { label: 'Assign Task', desc: 'Create and assign a task', icon: '➕', gradient: 'purple', count: '+ New Task', show: canCreateTask, link: '/tasks/create' },
    { label: 'Team Tasks', desc: 'View team task assignments', icon: '📋', gradient: 'blue', show: canReadTasksTeam || canReadTasksAll, link: '/team-tasks' },
    { label: 'Projects', desc: 'Manage active projects', icon: '📁', gradient: 'indigo', count: `${metrics.activeProjects ?? ''} Active`, show: canManageProjects, link: '/projects' },
    { label: 'Recurring Tasks', desc: 'Manage recurring templates', icon: '🔄', gradient: 'teal', show: canManageRecurring, link: '/recurring-tasks' },
    { label: 'Voice Notes', desc: 'Send an audio message', icon: '🎙', gradient: 'violet', show: canSendVoiceNotes, link: '/voice-notes' },
    { label: 'Report Review', desc: 'Review pending reports', icon: '✅', gradient: 'orange', count: metrics.pendingReviews != null ? `${metrics.pendingReviews} Pending` : undefined, show: canReviewReports, link: '/report-review' },
    { label: 'Attendance', desc: 'Manage attendance records', icon: '🕐', gradient: 'cyan', show: canReadAll, link: '/attendance-management' },
    { label: 'Employees', desc: 'View employee directory', icon: '👥', gradient: 'green', show: canReadEmployees, link: '/employees' },
    { label: 'Export Center', desc: 'Export HRMS data', icon: '📤', gradient: 'coral', show: canExport, link: '/export-center' },
    { label: 'Announcements', desc: 'Create announcements', icon: '📢', gradient: 'coral', show: canManageAnnouncements, link: '/announcements' },
  ]

  const visible = actions.filter(a => a.show)
  if (visible.length === 0) return null

  return (
    <div className="dash-section">
      <h3 className="dash-section-title">Management Tools</h3>
      <div className="dash-actions-grid">
        {visible.map(a => (
          <div
            key={a.label}
            className={`dash-action-card dash-action-${a.gradient}`}
            onClick={() => navigate(a.link)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(a.link) } }}
            aria-label={a.label}
          >
            <div className="dash-action-icon">{a.icon}</div>
            <div className="dash-action-text">
              <div className="dash-action-name">{a.label}</div>
              <div className="dash-action-desc">{a.desc}</div>
              {a.count && <div className="dash-action-count">{a.count}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================
// Recent Activity
// ============================================================

function RecentActivitySection({
  items, navigate,
}: {
  items: ActivityItem[]
  navigate: (path: string) => void
}) {
  const iconMap: Record<string, string> = {
    task: '📋', leave: '🏖', attendance: '🕐', report: '📝',
    employee: '👤', project: '📁', voice_note: '🎙', notification: '🔔',
  }
  return (
    <div className="dash-activity-list">
      {items.map(item => (
        <div
          key={item.id}
          className="dash-activity-item"
          onClick={() => navigate('/audit')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate('/audit') }}
        >
          <span className="dash-activity-icon">
            {iconMap[item.entity_type] || '📄'}
          </span>
          <div className="dash-activity-content">
            <div className="dash-activity-title">{(item.action || 'unknown').replace(/_/g, ' ')}</div>
            <div className="dash-activity-meta">
              {item.entity_type || 'unknown'} · {new Date(item.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
