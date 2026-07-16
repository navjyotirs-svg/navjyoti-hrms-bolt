import { useEffect, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import { ATTENDANCE_STATUS_LABELS, type AttendanceStatus } from '@/types/roles'
import { formatTimestamp, formatTimeRemaining } from '@/lib/attendance'
import '@/styles/dashboard.css'

export function Dashboard() {
  const { profile, permissions } = useAuth()
  const [todayRecord, setTodayRecord] = useState<{ id: string; check_in_at: string; required_checkout_at: string; final_status: string; check_out_at: string | null; actual_elapsed_minutes: number | null } | null>(null)
  const [remaining, setRemaining] = useState('00:00:00')
  const [employeeCount, setEmployeeCount] = useState<number | null>(null)
  const [pendingCorrections, setPendingCorrections] = useState<number | null>(null)

  const canCheckIn = permissions.includes('attendance.check_in_self')
  const canReadAll = permissions.includes('attendance.read_all')

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false

    async function load() {
      // Fetch employee ID
      const { data: emp } = await supabase
        .from('employees')
        .select('id, organization_id')
        .eq('user_id', profile!.id)
        .maybeSingle()

      if (!emp || cancelled) return

      // Fetch today's attendance
      const today = new Date().toISOString().slice(0, 10)
      const { data: rec } = await supabase
        .from('attendance_records')
        .select('id, check_in_at, required_checkout_at, final_status, check_out_at, actual_elapsed_minutes')
        .eq('employee_id', (emp as { id: string }).id)
        .eq('attendance_date', today)
        .maybeSingle()

      if (!cancelled) setTodayRecord(rec as typeof todayRecord)

      // Fetch employee count for HR/Director
      if (canReadAll && (emp as { organization_id: string }).organization_id) {
        const { count } = await supabase
          .from('employees')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', (emp as { organization_id: string }).organization_id)
          .eq('is_active', true)
        if (!cancelled) setEmployeeCount(count ?? 0)

        const { count: corrCount } = await supabase
          .from('attendance_corrections')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'PENDING')
        if (!cancelled) setPendingCorrections(corrCount ?? 0)
      }
    }

    load()
    return () => { cancelled = true }
  }, [profile?.id, canReadAll])

  useEffect(() => {
    if (todayRecord?.final_status === 'PENDING_CHECKOUT' && todayRecord.required_checkout_at) {
      const update = () => setRemaining(formatTimeRemaining(todayRecord.required_checkout_at))
      update()
      const timer = setInterval(update, 1000)
      return () => clearInterval(timer)
    }
  }, [todayRecord])

  const greeting = profile?.full_name ?? profile?.email
  const roleLabel = profile?.role
    ? (profile.role in ROLE_LABELS_DASH ? ROLE_LABELS_DASH[profile.role as keyof typeof ROLE_LABELS_DASH] : profile.role)
    : ''

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
            {todayRecord ? (
              <>
                <div className="dashboard-status-row">
                  <span className="dashboard-status-label">Check-In</span>
                  <span className="dashboard-status-value mono">{formatTimestamp(todayRecord.check_in_at)}</span>
                </div>
                <div className="dashboard-status-row">
                  <span className="dashboard-status-label">Required Checkout</span>
                  <span className="dashboard-status-value mono">{formatTimestamp(todayRecord.required_checkout_at)}</span>
                </div>
                <div className="dashboard-status-row">
                  <span className="dashboard-status-label">Status</span>
                  <span className="dashboard-status-value">
                    <span className={`attendance-badge ${todayRecord.final_status.toLowerCase()}`}>
                      {ATTENDANCE_STATUS_LABELS[todayRecord.final_status as AttendanceStatus] ?? todayRecord.final_status}
                    </span>
                  </span>
                </div>
                {todayRecord.final_status === 'PENDING_CHECKOUT' && (
                  <div className="dashboard-status-row">
                    <span className="dashboard-status-label">Time Remaining</span>
                    <span className="dashboard-status-value mono" style={{ fontWeight: 700 }}>{remaining}</span>
                  </div>
                )}
                {todayRecord.check_out_at && (
                  <div className="dashboard-status-row">
                    <span className="dashboard-status-label">Elapsed</span>
                    <span className="dashboard-status-value mono">{todayRecord.actual_elapsed_minutes}m</span>
                  </div>
                )}
              </>
            ) : (
              <div className="dashboard-status-row">
                <span className="dashboard-status-label">No check-in yet today</span>
              </div>
            )}
          </div>
        </div>
      )}

      {canReadAll && (
        <div className="dashboard-section">
          <h3 className="dashboard-section-title">Organization Overview</h3>
          <div className="dashboard-grid">
            <div className="dashboard-card">
              <div className="dashboard-card-num">{employeeCount ?? '—'}</div>
              <div className="dashboard-card-lbl">Active Employees</div>
            </div>
            <div className="dashboard-card">
              <div className="dashboard-card-num">{pendingCorrections ?? '—'}</div>
              <div className="dashboard-card-lbl">Pending Corrections</div>
            </div>
          </div>
        </div>
      )}

      <div className="dashboard-section">
        <h3 className="dashboard-section-title">Excluded from Scope</h3>
        <div className="card dashboard-status-card">
          <div className="dashboard-status-row">
            <span className="dashboard-status-label">Payroll</span>
            <span className="dashboard-status-excluded">Not in scope</span>
          </div>
          <div className="dashboard-status-row">
            <span className="dashboard-status-label">Salary / Payslip</span>
            <span className="dashboard-status-excluded">Not in scope</span>
          </div>
          <div className="dashboard-status-row">
            <span className="dashboard-status-label">Compensation / Deductions</span>
            <span className="dashboard-status-excluded">Not in scope</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const ROLE_LABELS_DASH: Record<string, string> = {
  director: 'Director',
  hr_admin: 'HR Administrator',
  manager: 'Manager',
  team_leader: 'Team Leader',
  employee: 'Employee',
  intern: 'Intern / Trainee',
  system_admin: 'System Administrator',
}
