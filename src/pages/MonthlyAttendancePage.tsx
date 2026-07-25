import { useEffect, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { fetchMonthlyAttendanceSummary, type MonthlyAttendanceSummaryRow } from '@/lib/attendance'
import { TableSkeleton } from '@/components/Skeleton'
import '@/styles/shared.css'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function MonthlyAttendancePage() {
  const { profile, permissions } = useAuth()
  const [rows, setRows] = useState<MonthlyAttendanceSummaryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const canReadAll = permissions.includes('attendance.read_all') || permissions.includes('attendance.report_read')

  useEffect(() => {
    if (!profile?.organization_id || !canReadAll) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetchMonthlyAttendanceSummary(profile.organization_id, year, month)
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [profile?.organization_id, year, month, canReadAll])

  if (!canReadAll) {
    return <div className="page-container"><p>You do not have permission to view this page.</p></div>
  }

  return (
    <div className="page-container">
      <h1 className="page-title">Monthly Attendance Summary</h1>

      <div className="filter-bar" style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <label>
          Month:
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={{ marginLeft: 'var(--space-2)' }}>
            {MONTHS.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Year:
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ marginLeft: 'var(--space-2)', width: '90px' }} />
        </label>
      </div>

      {loading && <TableSkeleton rows={10} cols={12} />}
      {error && <div className="form-error">{error}</div>}
      {!loading && !error && rows.length === 0 && <p>No attendance data for this period.</p>}

      {!loading && !error && rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee Code</th>
                <th>Employee Name</th>
                <th>Department</th>
                <th>Branch</th>
                <th>Working Days</th>
                <th>Present</th>
                <th>Half Day</th>
                <th>Absent</th>
                <th>Approved Leave</th>
                <th>Holiday</th>
                <th>Weekly Off</th>
                <th>Pending Checkout</th>
                <th>Attendance %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee_id}>
                  <td className="mono">{r.employee_code}</td>
                  <td>{r.full_name}</td>
                  <td>{r.department ?? '—'}</td>
                  <td>{r.branch ?? '—'}</td>
                  <td style={{ textAlign: 'center' }}>{r.working_days}</td>
                  <td style={{ textAlign: 'center' }}>{r.present}</td>
                  <td style={{ textAlign: 'center' }}>{r.half_day}</td>
                  <td style={{ textAlign: 'center' }}>{r.absent}</td>
                  <td style={{ textAlign: 'center' }}>{r.approved_leave}</td>
                  <td style={{ textAlign: 'center' }}>{r.holiday}</td>
                  <td style={{ textAlign: 'center' }}>{r.weekly_off}</td>
                  <td style={{ textAlign: 'center' }}>{r.pending_checkout}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{r.attendance_percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
