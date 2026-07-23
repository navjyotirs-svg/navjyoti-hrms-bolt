import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import { ATTENDANCE_STATUS_LABELS, ROLE_LABELS, type AttendanceStatus } from '@/types/roles'
import { formatTimeRemaining, formatTimestamp, checkIn, fetchTodayAttendance } from '@/lib/attendance'
import { CheckoutModal } from '@/components/CheckoutModal'
import '@/styles/dashboard.css'

export function Dashboard() {
  const { profile, permissions } = useAuth()
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
  const [todayAttendance, setTodayAttendance] = useState<{ check_in_at: string; required_checkout_at: string; final_status: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkingIn, setCheckingIn] = useState(false)
  const [showCheckout, setShowCheckout] = useState(false)
  const [attendanceError, setAttendanceError] = useState<string | null>(null)
  const [attendanceSuccess, setAttendanceSuccess] = useState<string | null>(null)

  const canReadAll = permissions.includes('attendance.read_all')
  const canCheckIn = permissions.includes('attendance.check_in_self')
  const canCheckOut = permissions.includes('attendance.check_out_self')
  const canReadAudit = permissions.includes('audit.read')
  const canReadEmployees = permissions.includes('employee.read_all') || permissions.includes('employee.read_team')
  const canReadOrg = permissions.includes('organization.read')

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

        // Employee count
        if (canReadEmployees) {
          const { count } = await supabase
            .from('employees')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('is_active', true)
          updates.activeEmployees = count ?? 0
        }

        // Branches
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

        // Pending activation
        if (canReadEmployees) {
          const { count: pendingCount } = await supabase
            .from('employees')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .in('employment_status', ['invited', 'pending_activation'])
          updates.pendingActivation = pendingCount ?? 0

          // Onboarding pending
          const { count: onboardCount } = await supabase
            .from('onboarding_checklists')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending')
            .in('employee_id',
              (await supabase.from('employees').select('id').eq('organization_id', orgId).eq('is_active', true)).data ?? []
            )
          updates.onboardingPending = onboardCount ?? 0

          // Documents pending verification
          const { count: docCount } = await supabase
            .from('employee_documents')
            .select('*', { count: 'exact', head: true })
            .eq('is_verified', false)
            .in('employee_id',
              (await supabase.from('employees').select('id').eq('organization_id', orgId)).data ?? []
            )
          updates.documentsPendingVerification = docCount ?? 0
        }

        // Attendance metrics
        if (canReadAll) {
          const today = new Date().toISOString().slice(0, 10)
          const { count: checkedIn } = await supabase
            .from('attendance_records')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('attendance_date', today)
          updates.checkedInToday = checkedIn ?? 0

          const { count: pendingOut } = await supabase
            .from('attendance_records')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('attendance_date', today)
            .eq('final_status', 'PENDING_CHECKOUT')
          updates.pendingCheckout = pendingOut ?? 0

          const { count: fullD } = await supabase
            .from('attendance_records')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('attendance_date', today)
            .eq('final_status', 'FULL_DAY')
          updates.fullDay = fullD ?? 0

          const { count: halfD } = await supabase
            .from('attendance_records')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('attendance_date', today)
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

        // Pending report reviews
        if (canReviewReports) {
          const { count: reviewCount } = await supabase
            .from('daily_reports')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'submitted')
          updates.pendingReviews = reviewCount ?? 0
        }

        // Open follow-ups
        if (canReadFollowUps) {
          const { count: fuCount } = await supabase
            .from('management_follow_ups')
            .select('*', { count: 'exact', head: true })
            .in('status', ['open', 'assigned', 'in_progress'])
          updates.openFollowUps = fuCount ?? 0
        }

        // Today's reports (team/all)
        if (canReadReports) {
          const todayDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
          const kolkataDate = new Date(todayDate).toISOString().slice(0, 10)
          const { count: reportCount } = await supabase
            .from('daily_reports')
            .select('*', { count: 'exact', head: true })
            .eq('report_date', kolkataDate)
          updates.todayReports = reportCount ?? 0
        }

        // Unread notifications
        const { count: unread } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('is_read', false)
        updates.unreadNotifications = unread ?? 0

        // Recent audit
        if (canReadAudit) {
          const { data: audit } = await supabase
            .from('audit_logs')
            .select('action, entity_type, created_at')
            .order('created_at', { ascending: false })
            .limit(5)
          if (!cancelled) setRecentAudit((audit ?? []) as { action: string; entity_type: string; created_at: string }[])
        }

        // Today's own attendance
        if (canCheckIn) {
          const today = new Date().toISOString().slice(0, 10)
          const { data: att } = await supabase
            .from('attendance_records')
            .select('check_in_at, required_checkout_at, final_status')
            .eq('employee_id', empData.id)
            .eq('attendance_date', today)
            .maybeSingle()
          if (!cancelled) setTodayAttendance(att as { check_in_at: string; required_checkout_at: string; final_status: string } | null)
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
  const roleLabel = profile?.role ? ROLE_LABELS[profile.role] : ''

  const handleDashboardCheckIn = useCallback(async () => {
    setAttendanceError(null)
    setAttendanceSuccess(null)
    setCheckingIn(true)
    try {
      await checkIn()
      setAttendanceSuccess('Checked in successfully!')
      // Reload today's attendance
      if (profile?.id) {
        const { data: emp } = await supabase
          .from('employees')
          .select('id')
          .eq('user_id', profile.id)
          .maybeSingle()
        const empId = (emp as { id: string } | null)?.id
        if (empId) {
          const rec = await fetchTodayAttendance(empId)
          setTodayAttendance(rec ? {
            check_in_at: rec.check_in_at,
            required_checkout_at: rec.required_checkout_at,
            final_status: rec.final_status,
          } : null)
        }
      }
    } catch (e) {
      setAttendanceError((e as Error).message)
    }
    setCheckingIn(false)
  }, [profile?.id])

  function handleDashboardCheckoutSuccess(result: { final_status: string; elapsed_minutes: number }) {
    setShowCheckout(false)
    setAttendanceSuccess(`Checked out! Status: ${ATTENDANCE_STATUS_LABELS[result.final_status as AttendanceStatus] ?? result.final_status}`)
    // Reload today's attendance
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
          } : null)
        }
      })()
    }
  }

  if (loading) {
    return <div className="dashboard"><div className="loading-state">Loading dashboard…</div></div>
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
            {attendanceError && <div className="form-error" style={{ marginBottom: '12px' }}>{attendanceError}</div>}
            {attendanceSuccess && <div className="form-success" style={{ marginBottom: '12px' }}>{attendanceSuccess}</div>}
            {todayAttendance ? (
              <>
                <div className="dashboard-status-row">
                  <span className="dashboard-status-label">Check-In</span>
                  <span className="dashboard-status-value mono">{formatTimestamp(todayAttendance.check_in_at)}</span>
                </div>
                <div className="dashboard-status-row">
                  <span className="dashboard-status-label">Required Checkout</span>
                  <span className="dashboard-status-value mono">{formatTimestamp(todayAttendance.required_checkout_at)}</span>
                </div>
                <div className="dashboard-status-row">
                  <span className="dashboard-status-label">Status</span>
                  <span className="dashboard-status-value">
                    <span className={`attendance-badge ${todayAttendance.final_status.toLowerCase()}`}>
                      {ATTENDANCE_STATUS_LABELS[todayAttendance.final_status as AttendanceStatus] ?? todayAttendance.final_status}
                    </span>
                  </span>
                </div>
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
                <button className="btn btn-checkin" style={{ marginTop: '12px', width: '100%' }} onClick={handleDashboardCheckIn} disabled={checkingIn}>
                  {checkingIn ? 'Checking in…' : 'Check In'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {canReadAll && (
        <div className="dashboard-section">
          <h3 className="dashboard-section-title">Attendance Today</h3>
          <div className="dashboard-grid">
            <MetricCard label="Checked In" value={metrics.checkedInToday} />
            <MetricCard label="Pending Checkout" value={metrics.pendingCheckout} />
            <MetricCard label="Full Day" value={metrics.fullDay} />
            <MetricCard label="Half Day" value={metrics.halfDay} />
            <MetricCard label="Pending Corrections" value={metrics.pendingCorrections} />
          </div>
        </div>
      )}

      {canReadEmployees && (
        <div className="dashboard-section">
          <h3 className="dashboard-section-title">Organization Overview</h3>
          <div className="dashboard-grid">
            <MetricCard label="Active Employees" value={metrics.activeEmployees} />
            {canReadOrg && <MetricCard label="Branches" value={metrics.branches} />}
            {canReadOrg && <MetricCard label="Departments" value={metrics.departments} />}
            <MetricCard label="Pending Activation" value={metrics.pendingActivation} />
            <MetricCard label="Onboarding Pending" value={metrics.onboardingPending} />
            <MetricCard label="Documents Pending Verification" value={metrics.documentsPendingVerification} />
          </div>
        </div>
      )}

      <div className="dashboard-section">
        <h3 className="dashboard-section-title">Notifications</h3>
        <div className="dashboard-grid">
          <MetricCard label="Unread" value={metrics.unreadNotifications} />
        </div>
      </div>

      {(metrics.pendingReviews !== null || metrics.openFollowUps !== null || metrics.todayReports !== null) && (
        <div className="dashboard-section">
          <h3 className="dashboard-section-title">Daily Reports & Follow-ups</h3>
          <div className="dashboard-grid">
            {metrics.pendingReviews !== null && <MetricCard label="Pending Reviews" value={metrics.pendingReviews} />}
            {metrics.openFollowUps !== null && <MetricCard label="Open Follow-ups" value={metrics.openFollowUps} />}
            {metrics.todayReports !== null && <MetricCard label="Today's Reports" value={metrics.todayReports} />}
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
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="dashboard-card">
      <div className="dashboard-card-num">{value ?? '—'}</div>
      <div className="dashboard-card-lbl">{label}</div>
    </div>
  )
}
