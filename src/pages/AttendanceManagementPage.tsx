import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import { ATTENDANCE_STATUS_LABELS, type AttendanceStatus } from '@/types/roles'
import { formatTimestamp, formatDate, createEvidenceSignedUrl } from '@/lib/attendance'
import '@/styles/shared.css'

interface AttendanceRow {
  id: string
  employee_id: string
  attendance_date: string
  check_in_at: string
  required_checkout_at: string
  check_out_at: string | null
  actual_elapsed_minutes: number | null
  final_status: string
  status_reason: string | null
  correction_version: number
  employees: { full_name: string; employee_code: string } | null
  branches: { name: string } | null
}

export function AttendanceManagementPage() {
  const { profile, permissions } = useAuth()
  const [records, setRecords] = useState<AttendanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10))
  const [evidenceLoading, setEvidenceLoading] = useState(false)

  const canReadAll = permissions.includes('attendance.read_all')
  const canReadEvidence = permissions.includes('attendance.evidence_read_all')

  useEffect(() => {
    if (!profile?.organization_id || !canReadAll) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)

    let query = supabase
      .from('attendance_records')
      .select(`
        id, employee_id, attendance_date, check_in_at, required_checkout_at,
        check_out_at, actual_elapsed_minutes, final_status, status_reason, correction_version,
        employees!inner (full_name, employee_code),
        branches (name)
      `)
      .eq('organization_id', profile.organization_id)

    if (dateFilter) {
      query = query.eq('attendance_date', dateFilter)
    }

    query
      .order('check_in_at', { ascending: false })
      .limit(200)
      .then(({ data, error: qError }) => {
        if (qError) {
          setError(qError.message)
          setLoading(false)
          return
        }
        setRecords((data ?? []) as unknown as AttendanceRow[])
        setLoading(false)
      })
  }, [profile?.organization_id, canReadAll, dateFilter])

  const filtered = records.filter((r) => {
    const q = search.trim().toLowerCase()
    const emp = r.employees
    const matchesSearch = !q || (emp?.full_name.toLowerCase().includes(q) || emp?.employee_code.toLowerCase().includes(q))
    const matchesStatus = statusFilter === 'all' || r.final_status === statusFilter
    return matchesSearch && matchesStatus
  })

  async function viewEvidence(recordId: string) {
    setEvidenceLoading(true)
    try {
      const { data } = await supabase
        .from('attendance_evidence')
        .select('storage_path')
        .eq('attendance_record_id', recordId)
        .maybeSingle()

      if (data) {
        const url = await createEvidenceSignedUrl((data as { storage_path: string }).storage_path)
        if (url) {
          window.open(url, '_blank')
        } else {
          setError('Unable to generate signed URL for evidence.')
        }
      } else {
        setError('No evidence found for this record.')
      }
    } catch (e) {
      setError((e as Error).message)
    }
    setEvidenceLoading(false)
  }

  if (!canReadAll) {
    return <div className="page"><div className="empty-state"><div className="empty-state-text">You do not have permission to view attendance management.</div></div></div>
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Attendance Management</h2>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      <div className="card">
        <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="form-field">
            <label htmlFor="att-search">Search</label>
            <input id="att-search" type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or employee code" />
          </div>
          <div className="form-field">
            <label htmlFor="att-status">Status</label>
            <select id="att-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              {Object.entries(ATTENDANCE_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="att-date">Date</label>
            <input id="att-date" type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="loading-state">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No attendance records for this date.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th><th>Code</th><th>Branch</th><th>Date</th>
                  <th>Check-In</th><th>Required Checkout</th><th>Actual Checkout</th>
                  <th>Elapsed</th><th>Status</th><th>Correction</th><th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>{r.employees?.full_name ?? '—'}</td>
                    <td className="mono">{r.employees?.employee_code ?? '—'}</td>
                    <td>{r.branches?.name ?? '—'}</td>
                    <td className="mono">{formatDate(r.attendance_date)}</td>
                    <td className="mono">{formatTimestamp(r.check_in_at)}</td>
                    <td className="mono">{formatTimestamp(r.required_checkout_at)}</td>
                    <td className="mono">{r.check_out_at ? formatTimestamp(r.check_out_at) : '—'}</td>
                    <td className="mono">{r.actual_elapsed_minutes ? `${r.actual_elapsed_minutes}m` : '—'}</td>
                    <td><span className={`attendance-badge ${r.final_status.toLowerCase()}`}>{ATTENDANCE_STATUS_LABELS[r.final_status as AttendanceStatus] ?? r.final_status}</span></td>
                    <td>{r.correction_version > 0 ? <span className="tag tag-amber">v{r.correction_version}</span> : '—'}</td>
                    <td>
                      {canReadEvidence && (
                        <button className="btn btn-sm btn-secondary" onClick={() => viewEvidence(r.id)} disabled={evidenceLoading}>
                          View
                        </button>
                      )}
                      {!canReadEvidence && <span style={{ color: 'var(--slate)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
