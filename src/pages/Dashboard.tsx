import { useEffect, useState, useCallback } from 'react'
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
// Types
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
  projectsWithoutTasks: number | null
  myAttendanceStatus: string | null
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
  employeeName?: string
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
  const canReadOrg = permissions.includes('organization.read')
  const canReviewReports = permissions.includes('daily_report.review')
  const canReadReports = permissions.includes('daily_report.read_all') || permissions.includes('daily_report.read_team')
  const canReadTasksAll = permissions.includes('task.read_all')
  const canReadTasksTeam = permissions.includes('task.read_team')
  const canManageProjects = permissions.includes('project.create') || permissions.includes('project.read_team') || permissions.includes('project.read_all')
  const canManageRecurring = permissions.includes('recurring_task.create') || permissions.includes('recurring_task.read_all') || permissions.includes('recurring_task.read_team')
  const canSendVoiceNotes = permissions.includes('voice_note.send')
  const canSelfAssign = permissions.includes('task.self_assign')
  const canCreateTask = permissions.includes('task.create') || permissions.includes('task.assign')
  const canExport = permissions.includes('export.organization') || permissions.includes('export.team') || permissions.includes('export.self')
  const canManageAnnouncements = permissions.includes('announcement.create') || permissions.includes('announcement.manage')
  const canReadLeaveAll = permissions.includes('leave.read_all')
  const canReadLeaveTeam = permissions.includes('leave.read_team')

  const isEmployeeOnly = !canReadEmployees && !canReadAll && !canReadTasksTeam && !canReadTasksAll

  const [metrics, setMetrics] = useState<DashboardMetrics>({
    activeEmployees: null, pendingActivation: null, onboardingPending: null,
    documentsPendingVerification: null, onLeave: null, notCheckedIn: null,
    checkedInToday: null, pendingCheckout: null, fullDay: null, halfDay: null,
    pendingCorrections: null, unreadNotifications: null, pendingReviews: null,
    returnedForCorrection: null, reportsWithPhotos: null, openFollowUps: null,
    todayReports: null, activeTasks: null, acceptancePending: null,
    inProgressTasks: null, submittedTasks: null, overdueTasks: null,
    activeProjects: null, onHoldProjects: null, nearDeadlineProjects: null,
    completedProjectsThisMonth: null, projectsWithoutTasks: null,
    myAttendanceStatus: null, myPendingReports: null, myOpenTickets: null,
    myLeavePending: null, myActiveTasks: null,
  })
  const [notCheckedIn, setNotCheckedIn] = useState<NotCheckedInEmp[]>([])
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([])
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([])
  const [employeePerf, setEmployeePerf] = useState<EmployeePerf[]>([])
  const [todayAttendance, setTodayAttendance] = useState<{
    check_in_at: string; required_checkout_at: string; final_status: string; actual_elapsed_minutes: number | null
  } | null>(null)
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)
  const [myEmpData, setMyEmpData] = useState<{
    full_name: string; designation: string | null; department_name: string | null; profile_photo_reference: string | null
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCheckout, setShowCheckout] = useState(false)
  const [showCheckIn, setShowCheckIn] = useState(false)
  const [attendanceSuccess, setAttendanceSuccess] = useState<string | null>(null)
  const [selectedCalDate, setSelectedCalDate] = useState(getKolkataDate())
  const [retryCount, setRetryCount] = useState(0)

  // ============================================================
  // Data loading
  // ============================================================

  const loadDashboard = useCallback(async () => {
    if (!profile?.id) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)

    try {
      const { data: emp } = await supabase
        .from('employees')
        .select('id, organization_id, full_name, designation, profile_photo_reference, department_id')
        .eq('user_id', profile.id)
        .maybeSingle()

      if (!emp || cancelled) { setLoading(false); return }
      const empData = emp as {
        id: string; organization_id: string; full_name: string; designation: string | null;
        profile_photo_reference: string | null; department_id: string | null
      }
      const orgId = empData.organization_id
      const myId = empData.id

      if (!cancelled) {
        setMyEmployeeId(myId)
        let deptName: string | null = null
        if (empData.department_id) {
          const { data: dept } = await supabase
            .from('departments')
            .select('name')
            .eq('id', empData.department_id)
            .maybeSingle()
          deptName = (dept as { name: string } | null)?.name ?? null
        }
        setMyEmpData({
          full_name: empData.full_name,
          designation: empData.designation,
          department_name: deptName,
          profile_photo_reference: empData.profile_photo_reference,
        })
      }

      const kolkataDate = getKolkataDate()
      const updates: Partial<DashboardMetrics> = {}

      // ---- Employee metrics ----
      if (canReadEmployees) {
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
      }

      // ---- Attendance metrics ----
      if (canReadAll || canReadTeam) {
        const { data: scopeEmps } = canReadAll
          ? await supabase.from('employees').select('id').eq('organization_id', orgId).eq('is_active', true)
          : await supabase.from('employees').select('id').eq('reporting_manager_id', myId).eq('is_active', true)
        const scopeIds = (scopeEmps ?? []).map((e: { id: string }) => e.id)

        if (scopeIds.length > 0) {
          const { count: checkedIn } = await supabase
            .from('attendance_records').select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId).eq('attendance_date', kolkataDate)
          updates.checkedInToday = checkedIn ?? 0

          const activeCount = updates.activeEmployees ?? scopeIds.length
          updates.notCheckedIn = Math.max(0, activeCount - (checkedIn ?? 0))

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
        }

        const { count: corrCount } = await supabase
          .from('attendance_corrections').select('*', { count: 'exact', head: true })
          .eq('status', 'PENDING')
        updates.pendingCorrections = corrCount ?? 0

        // On leave today
        const { count: onLeaveCount } = await supabase
          .from('leave_applications')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'APPROVED')
          .lte('start_date', kolkataDate)
          .gte('end_date', kolkataDate)
        updates.onLeave = onLeaveCount ?? 0
      }

      // ---- Not Checked In employees ----
      if (canReadAll || canReadTeam) {
        const { data: scopeEmpsData } = canReadAll
          ? await supabase.from('employees')
            .select('id, full_name, designation, profile_photo_reference, department_id, reporting_manager_id')
            .eq('organization_id', orgId).eq('is_active', true)
          : await supabase.from('employees')
            .select('id, full_name, designation, profile_photo_reference, department_id, reporting_manager_id')
            .eq('reporting_manager_id', myId).eq('is_active', true)

        const scopeEmpList = (scopeEmpsData ?? []) as {
          id: string; full_name: string; designation: string | null;
          profile_photo_reference: string | null; department_id: string | null; reporting_manager_id: string | null
        }[]

        const { data: checkedInRecs } = await supabase
          .from('attendance_records').select('employee_id')
          .eq('attendance_date', kolkataDate)
        const checkedInIds = new Set((checkedInRecs ?? []).map((r: { employee_id: string }) => r.employee_id))
        const notCheckedInList = scopeEmpList.filter(e => !checkedInIds.has(e.id))

        // Get department names and manager names
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

        if (!cancelled) {
          setNotCheckedIn(notCheckedInList.slice(0, 12).map(e => ({
            id: e.id,
            full_name: e.full_name,
            designation: e.designation,
            department_name: e.department_id ? (deptMap[e.department_id] ?? null) : null,
            manager_name: e.reporting_manager_id ? (managerMap[e.reporting_manager_id] ?? null) : null,
            profile_photo_reference: e.profile_photo_reference,
            attendance_state: 'Not Checked In',
          })))
        }
      }

      // ---- Task metrics ----
      if (canReadTasksAll || canReadTasksTeam) {

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

        // Overdue: tasks past deadline, not completed
        const { data: activeAssignments } = await supabase
          .from('task_assignments')
          .select('id, tasks!inner(current_deadline, original_deadline, status)')
          .eq('is_current', true)
          .in('assignment_status', ['ASSIGNED', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'IN_PROGRESS'])
        const now = new Date()
        let overdue = 0
        for (const a of (activeAssignments ?? [])) {
          const task = (a.tasks as unknown[])[0] as { current_deadline: string; original_deadline: string; status: string }
          const dl = task.current_deadline || task.original_deadline
          if (dl) {
            const dlDate = /^\d{4}-\d{2}-\d{2}$/.test(dl) ? new Date(dl + 'T17:30:00+05:30') : new Date(dl)
            if (dlDate < now) overdue++
          }
        }
        updates.overdueTasks = overdue
      }

      // ---- Employee's own task count ----
      if (isEmployeeOnly || permissions.includes('task.read_self')) {
        const { count: myTasks } = await supabase
          .from('task_assignments').select('*', { count: 'exact', head: true })
          .eq('assigned_to', myId).eq('is_current', true)
          .in('assignment_status', ['ASSIGNED', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'IN_PROGRESS', 'SUBMITTED'])
        updates.myActiveTasks = myTasks ?? 0
      }

      // ---- Report metrics ----
      if (canReviewReports) {
        const { count: reviewCount } = await supabase
          .from('daily_reports').select('*', { count: 'exact', head: true })
          .eq('status', 'SUBMITTED')
        updates.pendingReviews = reviewCount ?? 0

        const { count: returnedCount } = await supabase
          .from('daily_reports').select('*', { count: 'exact', head: true })
          .eq('status', 'REVISION_REQUIRED')
        updates.returnedForCorrection = returnedCount ?? 0
      }

      const canReadFollowUps = permissions.includes('follow_up.read_all') || permissions.includes('follow_up.read_team')
      if (canReadFollowUps) {
        const { count: fuCount } = await supabase
          .from('management_follow_ups').select('*', { count: 'exact', head: true })
          .in('status', ['open', 'assigned', 'in_progress'])
        updates.openFollowUps = fuCount ?? 0
      }

      if (canReadReports || canReviewReports) {
        const { count: reportCount } = await supabase
          .from('daily_reports').select('*', { count: 'exact', head: true })
          .eq('report_date', kolkataDate)
        updates.todayReports = reportCount ?? 0

        const { count: photoCount } = await supabase
          .from('daily_report_photos').select('*', { count: 'exact', head: true })
        updates.reportsWithPhotos = photoCount ?? 0
      }

      // ---- Project metrics ----
      if (canManageProjects) {
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
            if (ed >= nowDate && ed <= weekLater) nearDeadline++
          }
        }
        updates.nearDeadlineProjects = nearDeadline

        const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).toISOString()
        const { count: completedMonth } = await supabase
          .from('projects').select('*', { count: 'exact', head: true })
          .eq('status', 'COMPLETED').gte('updated_at', monthStart)
        updates.completedProjectsThisMonth = completedMonth ?? 0
      }

      // ---- Employee own metrics ----
      if (isEmployeeOnly) {
        const { count: myReports } = await supabase
          .from('daily_reports').select('*', { count: 'exact', head: true })
          .eq('employee_id', myId).eq('status', 'DRAFT')
        updates.myPendingReports = myReports ?? 0

        const { count: myTickets } = await supabase
          .from('tickets').select('*', { count: 'exact', head: true })
          .eq('created_by', myId)
          .in('status', ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_EMPLOYEE', 'ESCALATED'])
        updates.myOpenTickets = myTickets ?? 0

        const { count: myLeave } = await supabase
          .from('leave_applications').select('*', { count: 'exact', head: true })
          .eq('employee_id', myId)
          .in('status', ['PENDING_MANAGER', 'PENDING_HR'])
        updates.myLeavePending = myLeave ?? 0
      }

      // ---- Notifications ----
      const { count: unread } = await supabase
        .from('notifications').select('*', { count: 'exact', head: true })
        .eq('is_read', false)
      updates.unreadNotifications = unread ?? 0

      // ---- Today's attendance for self ----
      if (canCheckIn) {
        const rec = await fetchTodayAttendance(myId)
        if (!cancelled) {
          setTodayAttendance(rec ? {
            check_in_at: rec.check_in_at,
            required_checkout_at: rec.required_checkout_at,
            final_status: rec.final_status,
            actual_elapsed_minutes: (rec as { actual_elapsed_minutes?: number }).actual_elapsed_minutes ?? null,
          } : null)
        }
      }

      // ---- Recent activity ----
      if (canReadAudit) {
        const { data: audit } = await supabase
          .from('audit_logs').select('id, action, entity_type, created_at')
          .order('created_at', { ascending: false }).limit(8)
        if (!cancelled) setRecentActivity((audit ?? []) as ActivityItem[])
      }

      // ---- Calendar events ----
      const { data: holidays } = await supabase
        .from('calendar_events').select('event_date, event_type, title')
        .gte('event_date', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10))
        .lte('event_date', new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10))
      if (!cancelled) {
        setCalendarEvents((holidays ?? []).map((h: { event_date: string; event_type: string; title: string }) => ({
          date: h.event_date, type: h.event_type, label: h.title,
        })))
      }

      // ---- Today's schedule ----
      const schedItems: ScheduleItem[] = []
      const { data: todayTasks } = await supabase
        .from('tasks').select('id, task_code, title, current_deadline, original_deadline, status')
        .or(`current_deadline.eq.${kolkataDate},original_deadline.eq.${kolkataDate}`)
      for (const t of (todayTasks ?? [])) {
        schedItems.push({
          id: t.id, time: '17:30', title: t.title,
          category: 'Task Deadline', status: t.status,
          link: `/tasks/${t.id}`,
        })
      }
      const { data: todayReports } = await supabase
        .from('daily_reports').select('id, report_date, status, employee_id')
        .eq('report_date', kolkataDate)
      for (const r of (todayReports ?? [])) {
        schedItems.push({
          id: r.id, time: '18:00', title: 'Daily Report',
          category: 'Report', status: r.status,
          link: `/team-reports?date=${kolkataDate}`,
        })
      }
      const { data: todayEvents } = await supabase
        .from('calendar_events').select('id, event_date, event_type, title, start_time')
        .eq('event_date', kolkataDate)
      for (const e of (todayEvents ?? [])) {
        schedItems.push({
          id: e.id, time: e.start_time || 'All day', title: e.title,
          category: 'Meeting', status: e.event_type,
          link: '/calendar',
        })
      }
      if (!cancelled) setScheduleItems(schedItems)

      // ---- Employee performance (management) ----
      if (canReadTasksAll || canReadTasksTeam) {
        const { data: scopeEmpsData } = canReadTasksAll
          ? await supabase.from('employees')
            .select('id, full_name, profile_photo_reference')
            .eq('organization_id', orgId).eq('is_active', true)
          : await supabase.from('employees')
            .select('id, full_name, profile_photo_reference')
            .eq('reporting_manager_id', myId).eq('is_active', true)

        const perfList: EmployeePerf[] = []
        for (const emp of (scopeEmpsData ?? []) as { id: string; full_name: string; profile_photo_reference: string | null }[]) {
          const { data: assignments } = await supabase
            .from('task_assignments')
            .select('id, assignment_status, ended_at, tasks!inner(current_deadline, original_deadline, status)')
            .eq('assigned_to', emp.id).eq('is_current', true)
          let onTrack = 0, overdue = 0, metDeadline = 0
          const nowPerf = new Date()
          for (const a of (assignments ?? [])) {
            const task = (a.tasks as unknown[])[0] as { current_deadline: string; original_deadline: string; status: string }
            const dl = task.current_deadline || task.original_deadline
            const dlDate = dl ? (/^\d{4}-\d{2}-\d{2}$/.test(dl) ? new Date(dl + 'T17:30:00+05:30') : new Date(dl)) : null
            if (a.assignment_status === 'COMPLETED' || task.status === 'COMPLETED') {
              metDeadline++
            } else if (dlDate && dlDate < nowPerf) {
              overdue++
            } else {
              onTrack++
            }
          }
          if (assignments && assignments.length > 0) {
            perfList.push({
              employeeId: emp.id, employeeName: emp.full_name,
              photoPath: emp.profile_photo_reference,
              onTrack, overdue, metDeadline,
            })
          }
        }
        if (!cancelled) setEmployeePerf(perfList.slice(0, 8))
      }

      if (!cancelled) {
        setMetrics(prev => ({ ...prev, ...updates }))
        setError(null)
      }
    } catch (e) {
      if (!cancelled) setError((e as Error).message)
    }
    if (!cancelled) setLoading(false)
  }, [profile?.id, permissions, canReadAll, canReadTeam, canReadEmployees, canReadOrg,
      canReviewReports, canReadReports, canReadTasksAll, canReadTasksTeam,
      canManageProjects, canManageRecurring, canSendVoiceNotes, canSelfAssign,
      canReadAudit, canCheckIn, isEmployeeOnly])

  useEffect(() => {
    loadDashboard()
    return () => {}
  }, [loadDashboard, retryCount])

  // ============================================================
  // Realtime subscriptions
  // ============================================================
  useEffect(() => {
    if (!profile?.id) return
    const channel = supabase.channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records' }, () => loadDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => loadDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignments' }, () => loadDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_reports' }, () => loadDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_applications' }, () => loadDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => loadDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => loadDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'voice_notes' }, () => loadDashboard())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile?.id, loadDashboard])

  // ============================================================
  // Handlers
  // ============================================================
  function handleCheckoutSuccess(result: { final_status: string; elapsed_minutes: number }) {
    setShowCheckout(false)
    setAttendanceSuccess(`Checked out! Status: ${ATTENDANCE_STATUS_LABELS[result.final_status as AttendanceStatus] ?? result.final_status}`)
    if (profile?.id) {
      ;(async () => {
        const { data: emp } = await supabase.from('employees').select('id').eq('user_id', profile!.id).maybeSingle()
        const empId = (emp as { id: string } | null)?.id
        if (empId) {
          const rec = await fetchTodayAttendance(empId)
          setTodayAttendance(rec ? {
            check_in_at: rec.check_in_at, required_checkout_at: rec.required_checkout_at,
            final_status: rec.final_status,
            actual_elapsed_minutes: (rec as { actual_elapsed_minutes?: number }).actual_elapsed_minutes ?? null,
          } : null)
        }
      })()
    }
  }

  const todayDate = getKolkataDate()
  const roleLabel = profile?.role ? (ROLE_LABELS as Record<string, string>)[profile.role] ?? profile.role : ''

  if (loading) return <div className="dashboard"><DashboardSkeleton /></div>
  if (error) return (
    <div className="dashboard">
      <div className="dash-error-banner">
        <span>Failed to load dashboard: {error}</span>
        <button className="btn btn-retry" onClick={() => setRetryCount(c => c + 1)}>Retry</button>
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
        <AttendanceWidget
          attendance={todayAttendance}
          canCheckOut={canCheckOut}
          successMsg={attendanceSuccess}
          onCheckIn={() => setShowCheckIn(true)}
          onCheckOut={() => setShowCheckout(true)}
        />
      )}

      {/* === KPI CARDS === */}
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
        canReadLeaveAll={canReadLeaveAll}
        canReadLeaveTeam={canReadLeaveTeam}
        todayDate={todayDate}
        navigate={navigate}
      />

      {/* === CALENDAR & SCHEDULE === */}
      <CalendarSchedule
        events={calendarEvents}
        scheduleItems={scheduleItems}
        selectedDate={selectedCalDate}
        onSelectDate={setSelectedCalDate}
      />

      {/* === NOT CHECKED IN === */}
      {(canReadAll || canReadTeam) && notCheckedIn.length > 0 && (
        <NotCheckedInSection employees={notCheckedIn} todayDate={todayDate} navigate={navigate} />
      )}

      {/* === TASK PERFORMANCE === */}
      {myEmployeeId && <DeadlinePerformanceCard employeeId={myEmployeeId} />}

      {employeePerf.length > 0 && (
        <EmployeePerfSection employees={employeePerf} navigate={navigate} />
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
      {canReadAudit && recentActivity.length > 0 && (
        <RecentActivitySection items={recentActivity} navigate={navigate} />
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
            if (profile?.id) {
              ;(async () => {
                const { data: emp } = await supabase.from('employees').select('id').eq('user_id', profile!.id).maybeSingle()
                const empId = (emp as { id: string } | null)?.id
                if (empId) {
                  const rec = await fetchTodayAttendance(empId)
                  setTodayAttendance(rec ? {
                    check_in_at: rec.check_in_at, required_checkout_at: rec.required_checkout_at,
                    final_status: rec.final_status,
                    actual_elapsed_minutes: (rec as { actual_elapsed_minutes?: number }).actual_elapsed_minutes ?? null,
                  } : null)
                }
              })()
            }
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
  canManageProjects, canReadLeaveAll, canReadLeaveTeam, todayDate, navigate,
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
  canReadLeaveAll: boolean
  canReadLeaveTeam: boolean
  todayDate: string
  navigate: (path: string) => void
}) {
  if (isEmployeeOnly) {
    return (
      <div className="dash-kpi-row">
        <KpiCard label="My Tasks" value={metrics.myActiveTasks} gradient="purple"
          subMetrics={[
            { label: 'Active', value: metrics.myActiveTasks ?? '—' },
          ]}
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
      {(canReadLeaveAll || canReadLeaveTeam) && (
        <KpiCard label="Unread Notifications" value={metrics.unreadNotifications} gradient="cyan"
          onClick={() => navigate('/notification-inbox?read=false')} />
      )}
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
// Calendar & Schedule
// ============================================================

function CalendarSchedule({
  events, scheduleItems, selectedDate, onSelectDate,
}: {
  events: CalendarEvent[]
  scheduleItems: ScheduleItem[]
  selectedDate: string
  onSelectDate: (d: string) => void
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
      </div>

      <div className="dash-schedule">
        <h3 className="dash-sched-title">Today's Schedule</h3>
        {scheduleItems.length === 0 ? (
          <div className="dash-sched-empty">No events scheduled for today</div>
        ) : (
          <div className="dash-sched-timeline">
            {scheduleItems.map((item, i) => (
              <div
                key={`${item.id}-${i}`}
                className="dash-sched-item"
                onClick={() => { /* navigate handled by parent */ }}
                role="button"
                tabIndex={0}
              >
                <div className="dash-sched-time">{item.time}</div>
                <div className="dash-sched-content">
                  <div className="dash-sched-name">{item.title}</div>
                  <div className="dash-sched-cat">{item.category}</div>
                </div>
                <span className={`dash-sched-status status-${item.status.toLowerCase().replace(/_/g, '-')}`} />
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
    <div className="dash-section">
      <div className="dash-section-header">
        <h3 className="dash-section-title">Not Checked In Today</h3>
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
    </div>
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
    <div className="dash-section">
      <h3 className="dash-section-title">Team Task Performance</h3>
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
            </div>
          </div>
        ))}
      </div>
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
    <div className="dash-section">
      <h3 className="dash-section-title">Recent Activity</h3>
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
              <div className="dash-activity-title">{item.action.replace(/_/g, ' ')}</div>
              <div className="dash-activity-meta">
                {item.entity_type} · {new Date(item.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
