import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import { ATTENDANCE_STATUS_LABELS, ROLE_LABELS, type AttendanceStatus } from '@/types/roles'
import { formatTimeRemaining, formatTimestamp, fetchTodayAttendance } from '@/lib/attendance'
import { CheckInModal } from '@/components/CheckInModal'
import { CheckoutModal } from '@/components/CheckoutModal'
import { DashboardSkeleton } from '@/components/Skeleton'
import '@/styles/dashboard.css'

export function Dashboard() {
  const { profile, permissions } = useAuth()
  const navigate = useNavigate()
  const [metrics, setMetrics] = useState<Record<string, number | null>>({
    activeEmployees: null,
    branches: null,
    departments: null,
    pendingActivation: null,
    onboardingPending: null,
    documentsPendingVerification: null,
    checkedInToday: null,
    pendingCheckout: null,
    fullDay: null,
    halfDay: null,
    pendingCorrections: null,
    unreadNotifications: null,
    pendingReviews: null,
    openFollowUps: null,
    todayReports: null,
  })
  const [recentAudit, setRecentAudit] = useState<{ action: string; entity_type: string; created_at: string }[]>([])
  const [todayAttendance, setTodayAttendance] = useState<{
    check_in_at: string
    required_checkout_at: string
    final_status: string
    actual_elapsed_minutes: number | null
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCheckout, setShowCheckout] = useState(false)
  const [attendanceSuccess, setAttendanceSuccess] = useState<string | null>(null)

  const canReadAll = permissions.includes('attendance.read_all')
  const canCheckIn = permissions.includes('attendance.check_in_self')
  const canCheckOut = permissions.includes('attendance.check_out_self')
  const canReadAudit = permissions.includes('audit.read')
  const canReadEmployees = permissions.includes('employee.read_all') || permissions.includes('employee.read_team')
  const canReadOrg = permissions.includes('organization.read')

  const canManageProjects = permissions.includes('project.create') || permissions.includes('project.read_team') || permissions.includes('project.read_all')
  const canManageRecurring = permissions.includes('recurring_task.create') || permissions.includes('recurring_task.read_all') || permissions.includes('recurring_task.read_team')
  const canSendVoiceNotes = permissions.includes('voice_note.send')
  const canSelfAssign = permissions.includes('task.self_assign')
  const hasManagementTools = canManageProjects || canManageRecurring || canSendVoiceNotes || canSelfAssign

  useEffect(() => {
    if (!profile?.id) { setLoading(false); return }
    let cancelled = false

    async function load() {
      try {
        const { data: emp } = await supabase
          .from('employees')
          .select('id, organization_id')
          .eq('user_id', profile!.id)
          .maybeSingle()

        if (!emp || cancelled) { setLoading(false); return }
        const empData = emp as { id: string; organization_id: string }
        const orgId = empData.organization_id

        const updates: Record<string, number | null> = {}

        if (canReadEmployees) {
          const { count } = await supabase
            .from('employees')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('is_active', true)
          updates.activeEmployees = count ?? 0
        }

        if (canReadOrg) {
          const { count: branchCount } = await supabase
            .from('branches')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('is_active', true)
          updates.branches = branchCount ?? 0

          const { count: deptCount } = await supabase
            .from('departments')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('is_active', true)
          updates.departments = deptCount ?? 0
        }

        if (canReadEmployees) {
          const { count: pendingCount } = await supabase
            .from('employees')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .in('employment_status', ['invited', 'pending_activation'])
          updates.pendingActivation = pendingCount ?? 0

          const { data: orgEmps } = await supabase
            .from('employees')
            .select('id')
            .eq('organization_id', orgId)
            .eq('is_active', true)
          const empIds = (orgEmps ?? []).map((e: { id: string }) => e.id)

          if (empIds.length > 0) {
            const { count: onboardCount } = await supabase
              .from('onboarding_checklists')
              .select('*', { count: 'exact', head: true })
              .eq('status', 'pending')
              .in('employee_id', empIds)
            updates.onboardingPending = onboardCount ?? 0
          } else {
            updates.onboardingPending = 0
          }

          const { data: allOrgEmps } = await supabase
            .from('employees')
            .select('id')
            .eq('organization_id', orgId)
          const allEmpIds = (allOrgEmps ?? []).map((e: { id: string }) => e.id)

          if (allEmpIds.length > 0) {
            const { count: docCount } = await supabase
              .from('employee_documents')
              .select('*', { count: 'exact', head: true })
              .eq('is_verified', false)
              .in('employee_id', allEmpIds)
            updates.documentsPendingVerification = docCount ?? 0
          } else {
            updates.documentsPendingVerification = 0
          }
        }

        if (canReadAll) {
          const today = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
          const kolkataDate = new Date(today).toISOString().slice(0, 10)

          const { count: checkedIn } = await supabase
            .from('attendance_records')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('attendance_date', kolkataDate)
          updates.checkedInToday = checkedIn ?? 0

          const { count: pendingOut } = await supabase
            .from('attendance_records')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('attendance_date', kolkataDate)
            .eq('final_status', 'PENDING_CHECKOUT')
          updates.pendingCheckout = pendingOut ?? 0

          const { count: fullD } = await supabase
            .from('attendance_records')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('attendance_date', kolkataDate)
            .eq('final_status', 'FULL_DAY')
          updates.fullDay = fullD ?? 0

          const { count: halfD } = await supabase
            .from('attendance_records')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('attendance_date', kolkataDate)
            .eq('final_status', 'HALF_DAY')
          updates.halfDay = halfD ?? 0

          const { count: corrCount } = await supabase
            .from('attendance_corrections')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'PENDING')
          updates.pendingCorrections = corrCount ?? 0
        }

        const canReviewReports = permissions.includes('daily_report.review')
        const canReadFollowUps = permissions.includes('follow_up.read_all') || permissions.includes('follow_up.read_team')
        const canReadReports = permissions.includes('daily_report.read_all') || permissions.includes('daily_report.read_team')

        if (canReviewReports) {
          const { count: reviewCount } = await supabase
            .from('daily_reports')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'SUBMITTED')
          updates.pendingReviews = reviewCount ?? 0
        }

        if (canReadFollowUps) {
          const { count: fuCount } = await supabase
            .from('management_follow_ups')
            .select('*', { count: 'exact', head: true })
            .in('status', ['open', 'assigned', 'in_progress'])
          updates.openFollowUps = fuCount ?? 0
        }

        if (canReadReports) {
          const todayDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
          const kolkataDate = new Date(todayDate).toISOString().slice(0, 10)
          const { count: reportCount } = await supabase
            .from('daily_reports')
            .select('*', { count: 'exact', head: true })
            .eq('report_date', kolkataDate)
          updates.todayReports = reportCount ?? 0
        }

        const { count: unread } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('is_read', false)
        updates.unreadNotifications = unread ?? 0

        if (canReadAudit) {
          const { data: audit } = await supabase
            .from('audit_logs')
            .select('action, entity_type, created_at')
            .order('created_at', { ascending: false })
            .limit(5)
          if (!cancelled) setRecentAudit((audit ?? []) as { action: string; entity_type: string; created_at: string }[])
        }

        if (canCheckIn) {
          const today = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
          const kolkataDate = new Date(today).toISOString().slice(0, 10)
          const { data: att } = await supabase
            .from('attendance_records')
            .select('check_in_at, required_checkout_at, final_status, actual_elapsed_minutes')
            .eq('employee_id', empData.id)
            .eq('attendance_date', kolkataDate)
            .maybeSingle()
          if (!cancelled) setTodayAttendance(att as { check_in_at: string; required_checkout_at: string; final_status: string; actual_elapsed_minutes: number | null } | null)
        }

        if (!cancelled) {
          setMetrics((prev) => ({ ...prev, ...updates }))
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
      if (!cancelled) setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [profile?.id, profile?.organization_id, permissions.length, canReadAll, canCheckIn, canReadAudit, canReadEmployees, canReadOrg])

  const greeting = profile?.full_name ?? profile?.email
  const roleLabel = profile?.role ? (ROLE_LABELS as Record<string, string>)[profile.role] ?? profile.role : ''

  const [showDashboardCheckIn, setShowDashboardCheckIn] = useState(false)

  const handleDashboardCheckIn = useCallback(async () => {
    setShowDashboardCheckIn(true)
  }, [])

  function handleDashboardCheckoutSuccess(result: { final_status: string; elapsed_minutes: number }) {
    setShowCheckout(false)
    setAttendanceSuccess(`Checked out! Status: ${ATTENDANCE_STATUS_LABELS[result.final_status as AttendanceStatus] ?? result.final_status}`)
    if (profile?.id) {
      ;(async () => {
        const { data: emp } = await supabase
          .from('employees')
          .select('id')
          .eq('user_id', profile!.id)
          .maybeSingle()
        const empId = (emp as { id: string } | null)?.id
        if (empId) {
          const rec = await fetchTodayAttendance(empId)
          setTodayAttendance(rec ? {
            check_in_at: rec.check_in_at,
            required_checkout_at: rec.required_checkout_at,
            final_status: rec.final_status,
            actual_elapsed_minutes: (rec as { actual_elapsed_minutes?: number }).actual_elapsed_minutes ?? null,
          } : null)
        }
      })()
    }
  }

  const todayKolkata = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
  const todayDate = new Date(todayKolkata).toISOString().slice(0, 10)

  if (loading) {
    return <div className="dashboard"><DashboardSkeleton /></div>
  }

  if (error) {
    return <div className="dashboard"><div className="form-error">Failed to load dashboard: {error}</div></div>
  }

  return (
    <div className="dashboard">
      <div className="dashboard-welcome">
        <h2 className="dashboard-greeting">Welcome, {greeting}</h2>
        <p className="dashboard-role">
          <span className="dashboard-role-badge">{roleLabel}</span>
        </p>
      </div>

      {canCheckIn && (
        <div className="dashboard-section">
          <h3 className="dashboard-section-title">Today's Attendance</h3>
          <div className="card dashboard-status-card">
            {attendanceSuccess && <div className="form-success" style={{ marginBottom: '12px' }}>{attendanceSuccess}</div>}
            {todayAttendance ? (
              <>
                <div className="dashboard-status-row">
                  <span className="dashboard-status-label">Check-In</span>
                  <span className="dashboard-status-value mono">{formatTimestamp(todayAttendance.check_in_at)}</span>
                </div>
                <div className="dashboard-status-row">
                  <span className="dashboard-status-label">Standard Checkout Time</span>
                  <span className="dashboard-status-value mono">{formatTimestamp(todayAttendance.required_checkout_at)}</span>
                </div>
                <div className="dashboard-status-row">
                  <span className="dashboard-status-label">Standard Shift</span>
                  <span className="dashboard-status-value">9 Hours</span>
                </div>
                <div className="dashboard-status-row">
                  <span className="dashboard-status-label">Status</span>
                  <span className="dashboard-status-value">
                    <span className={`attendance-badge ${todayAttendance.final_status.toLowerCase()}`}>
                      {ATTENDANCE_STATUS_LABELS[todayAttendance.final_status as AttendanceStatus] ?? todayAttendance.final_status}
                    </span>
                  </span>
                </div>
                {todayAttendance.final_status === 'PENDING_CHECKOUT' && todayAttendance.actual_elapsed_minutes !== null && (
                  <div className="dashboard-status-row">
                    <span className="dashboard-status-label">Working Hours Completed</span>
                    <span className="dashboard-status-value mono" style={{ fontWeight: 700 }}>
                      {Math.floor(todayAttendance.actual_elapsed_minutes / 60)}h {todayAttendance.actual_elapsed_minutes % 60}m
                    </span>
                  </div>
                )}
                {todayAttendance.final_status === 'PENDING_CHECKOUT' && todayAttendance.actual_elapsed_minutes !== null && todayAttendance.actual_elapsed_minutes < 540 && (
                  <div className="form-success" style={{ marginTop: '8px' }}>
                    You must complete the standard 9-hour attendance duration to qualify for Full Day. Early checkout will be marked Half Day.
                  </div>
                )}
                {todayAttendance.final_status === 'PENDING_CHECKOUT' && todayAttendance.actual_elapsed_minutes !== null && todayAttendance.actual_elapsed_minutes >= 540 && (
                  <div className="form-success" style={{ marginTop: '8px' }}>
                    You have completed the standard 9-hour attendance duration and now qualify for Full Day.
                  </div>
                )}
                {todayAttendance.final_status === 'PENDING_CHECKOUT' && (
                  <>
                    <div className="dashboard-status-row">
                      <span className="dashboard-status-label">Time Remaining</span>
                      <span className="dashboard-status-value mono" style={{ fontWeight: 700 }}>
                        {formatTimeRemaining(todayAttendance.required_checkout_at)}
                      </span>
                    </div>
                    {canCheckOut && (
                      <button className="btn btn-checkout" style={{ marginTop: '12px', width: '100%' }} onClick={() => setShowCheckout(true)}>
                        Check Out
                      </button>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <div className="dashboard-status-row">
                  <span className="dashboard-status-label">No check-in yet today</span>
                </div>
                <button className="btn btn-checkin" style={{ marginTop: '12px', width: '100%' }} onClick={handleDashboardCheckIn}>
                  Check In
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {hasManagementTools && (
        <div className="dashboard-section">
          <h3 className="dashboard-section-title">Management Tools</h3>
          <div className="dashboard-grid">
            {canManageProjects && (
              <div
                className="dashboard-card dashboard-card-interactive"
                onClick={() => navigate('/projects')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/projects') } }}
                role="button"
                tabIndex={0}
                aria-label="Manage projects"
              >
                <div className="dashboard-card-lbl" style={{ fontSize: '1.1rem', fontWeight: 600 }}>Projects</div>
                <div className="dashboard-card-details">
                  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                  Manage
                </div>
              </div>
            )}
            {canManageRecurring && (
              <div
                className="dashboard-card dashboard-card-interactive"
                onClick={() => navigate('/recurring-tasks')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/recurring-tasks') } }}
                role="button"
                tabIndex={0}
                aria-label="Manage recurring task templates"
              >
                <div className="dashboard-card-lbl" style={{ fontSize: '1.1rem', fontWeight: 600 }}>Recurring Tasks</div>
                <div className="dashboard-card-details">
                  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 4v5h.582m9.69-5L12 12m-8 0a8 8 0 1116 0 8 8 0 01-16 0z" /></svg>
                  Manage
                </div>
              </div>
            )}
            {canSendVoiceNotes && (
              <div
                className="dashboard-card dashboard-card-interactive"
                onClick={() => navigate('/voice-notes')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/voice-notes') } }}
                role="button"
                tabIndex={0}
                aria-label="Record and send voice notes"
              >
                <div className="dashboard-card-lbl" style={{ fontSize: '1.1rem', fontWeight: 600 }}>Voice Notes</div>
                <div className="dashboard-card-details">
                  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4a2 2 0 002 2h2a2 2 0 002-2v-4M12 2a3 3 0 013 3v6a3 3 0 01-6 0V5a3 3 0 013-3z" /></svg>
                  Record & Send
                </div>
              </div>
            )}
            {canSelfAssign && (
              <div
                className="dashboard-card dashboard-card-interactive"
                onClick={() => navigate('/self-assign-task')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/self-assign-task') } }}
                role="button"
                tabIndex={0}
                aria-label="Create a task for yourself"
              >
                <div className="dashboard-card-lbl" style={{ fontSize: '1.1rem', fontWeight: 600 }}>Self-Assign Task</div>
                <div className="dashboard-card-details">
                  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9 5H7a2 2 0 00-2 2v6a2 2 0 002 2h6a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5V3a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2" /></svg>
                  Create
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {canReadAll && (
        <div className="dashboard-section">
          <h3 className="dashboard-section-title">Attendance Today</h3>
          <div className="dashboard-grid">
            <MetricCard label="Checked In" value={metrics.checkedInToday} onClick={() => navigate(`/attendance-management?date=${todayDate}&status=checked_in`)} ariaLabel="View checked-in employees" />
            <MetricCard label="Pending Checkout" value={metrics.pendingCheckout} onClick={() => navigate(`/attendance-management?date=${todayDate}&status=PENDING_CHECKOUT`)} ariaLabel="View employees pending checkout" />
            <MetricCard label="Full Day" value={metrics.fullDay} onClick={() => navigate(`/attendance-management?date=${todayDate}&status=FULL_DAY`)} ariaLabel="View full day employees" />
            <MetricCard label="Half Day" value={metrics.halfDay} onClick={() => navigate(`/attendance-management?date=${todayDate}&status=HALF_DAY`)} ariaLabel="View half day employees" />
            <MetricCard label="Pending Corrections" value={metrics.pendingCorrections} onClick={() => navigate('/attendance-corrections?status=pending')} ariaLabel="View pending corrections" />
          </div>
        </div>
      )}

      {canReadEmployees && (
        <div className="dashboard-section">
          <h3 className="dashboard-section-title">Organization Overview</h3>
          <div className="dashboard-grid">
            <MetricCard label="Active Employees" value={metrics.activeEmployees} onClick={() => navigate('/employees?access_status=Active')} ariaLabel="View active employees" />
            {canReadOrg && <MetricCard label="Branches" value={metrics.branches} onClick={() => navigate('/branches')} ariaLabel="View branches" />}
            {canReadOrg && <MetricCard label="Departments" value={metrics.departments} onClick={() => navigate('/departments')} ariaLabel="View departments" />}
            <MetricCard label="Pending Activation" value={metrics.pendingActivation} onClick={() => navigate('/employees?access_status=Activation Pending')} ariaLabel="View pending activation employees" />
            <MetricCard label="Onboarding Pending" value={metrics.onboardingPending} onClick={() => navigate('/employees?access_status=Activation Pending')} ariaLabel="View onboarding pending" />
            <MetricCard label="Documents Pending Verification" value={metrics.documentsPendingVerification} onClick={() => navigate('/employees?access_status=Active')} ariaLabel="View documents pending verification" />
          </div>
        </div>
      )}

      <div className="dashboard-section">
        <h3 className="dashboard-section-title">Notifications</h3>
        <div className="dashboard-grid">
          <MetricCard label="Unread" value={metrics.unreadNotifications} onClick={() => navigate('/notification-inbox?read=false')} ariaLabel="View unread notifications" />
        </div>
      </div>

      {(metrics.pendingReviews !== null || metrics.openFollowUps !== null || metrics.todayReports !== null) && (
        <div className="dashboard-section">
          <h3 className="dashboard-section-title">Daily Reports & Follow-ups</h3>
          <div className="dashboard-grid">
            {metrics.pendingReviews !== null && <MetricCard label="Pending Reviews" value={metrics.pendingReviews} onClick={() => navigate('/report-review?status=submitted')} ariaLabel="View pending report reviews" />}
            {metrics.openFollowUps !== null && <MetricCard label="Open Follow-ups" value={metrics.openFollowUps} onClick={() => navigate('/follow-up-queue?status=open')} ariaLabel="View open follow-ups" />}
            {metrics.todayReports !== null && <MetricCard label="Today's Reports" value={metrics.todayReports} onClick={() => navigate('/team-reports?date=today')} ariaLabel="View today's reports" />}
          </div>
        </div>
      )}

      {canReadAudit && recentAudit.length > 0 && (
        <div className="dashboard-section">
          <h3 className="dashboard-section-title">Recent Activity</h3>
          <div className="card dashboard-status-card">
            {recentAudit.map((a, i) => (
              <div key={i} className="dashboard-status-row">
                <span className="dashboard-status-label">
                  <span className="tag tag-ink">{a.action}</span>
                </span>
                <span className="dashboard-status-value mono" style={{ fontSize: '11px' }}>
                  {a.entity_type} · {new Date(a.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCheckout && (
        <CheckoutModal
          userId={profile!.id}
          onClose={() => setShowCheckout(false)}
          onSuccess={handleDashboardCheckoutSuccess}
        />
      )}
      {showDashboardCheckIn && profile?.id && (
        <CheckInModal
          userId={profile.id}
          onClose={() => setShowDashboardCheckIn(false)}
          onSuccess={(result) => {
            setShowDashboardCheckIn(false)
            setAttendanceSuccess(result.recurring_tasks_generated
              ? `Checked in! ${result.recurring_tasks_generated} recurring task(s) assigned for today.`
              : 'Checked in successfully!')
            if (profile?.id) {
              ;(async () => {
                const { data: emp } = await supabase
                  .from('employees')
                  .select('id')
                  .eq('user_id', profile!.id)
                  .maybeSingle()
                const empId = (emp as { id: string } | null)?.id
                if (empId) {
                  const rec = await fetchTodayAttendance(empId)
                  setTodayAttendance(rec ? {
                    check_in_at: rec.check_in_at,
                    required_checkout_at: rec.required_checkout_at,
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

function MetricCard({
  label,
  value,
  onClick,
  ariaLabel,
}: {
  label: string
  value: number | null
  onClick?: () => void
  ariaLabel?: string
}) {
  if (!onClick) {
    return (
      <div className="dashboard-card">
        <div className="dashboard-card-num">{value ?? '—'}</div>
        <div className="dashboard-card-lbl">{label}</div>
      </div>
    )
  }
  return (
    <div
      className="dashboard-card dashboard-card-interactive"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel ?? `View details for ${label}`}
    >
      <div className="dashboard-card-num">{value ?? '—'}</div>
      <div className="dashboard-card-lbl">{label}</div>
      <div className="dashboard-card-details">
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M6 3l5 5-5 5V3z" />
        </svg>
        View details
      </div>
    </div>
  )
}
