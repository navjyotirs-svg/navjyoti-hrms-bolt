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

interface EvidenceDetail {
  storage_path: string
  mime_type: string | null
  latitude: number | null
  longitude: number | null
  location_accuracy: number | null
  captured_at: string
  evidence_type: string
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
  const [evidenceModal, setEvidenceModal] = useState<{
    employeeName: string
    date: string
    evidence: EvidenceDetail | null
    imageUrl: string | null
    loading: boolean
  } | null>(null)

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

  async function viewEvidence(recordId: string, employeeName: string, date: string) {
    setEvidenceLoading(true)
    setEvidenceModal({ employeeName, date, evidence: null, imageUrl: null, loading: true })
    try {
      const { data } = await supabase
        .from('attendance_evidence')
        .select('storage_path, mime_type, latitude, longitude, location_accuracy, captured_at, evidence_type')
        .eq('attendance_record_id', recordId)
        .order('captured_at', { ascending: false })
        .limit(2)

      const evidenceData = (data ?? []) as EvidenceDetail[]
      if (evidenceData.length === 0) {
        setEvidenceModal({ employeeName, date, evidence: null, imageUrl: null, loading: false })
        setEvidenceLoading(false)
        return
      }

      // Get signed URLs for all evidence items
      const evidenceWithUrls = await Promise.all(
        evidenceData.map(async (ev) => {
          const url = await createEvidenceSignedUrl(ev.storage_path)
          return { ...ev, imageUrl: url }
        })
      )

      setEvidenceModal({
        employeeName,
        date,
        evidence: evidenceWithUrls[0] ?? null,
        imageUrl: evidenceWithUrls[0]?.imageUrl ?? null,
        loading: false,
      })
    } catch (e) {
      setError((e as Error).message)
      setEvidenceModal(null)
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
                        <button className="btn btn-sm btn-secondary" onClick={() => viewEvidence(r.id, r.employees?.full_name ?? '—', r.attendance_date)} disabled={evidenceLoading}>
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

      {evidenceModal && (
        <EvidenceModal
          employeeName={evidenceModal.employeeName}
          date={evidenceModal.date}
          evidence={evidenceModal.evidence}
          imageUrl={evidenceModal.imageUrl}
          loading={evidenceModal.loading}
          onClose={() => setEvidenceModal(null)}
        />
      )}
    </div>
  )
}

function EvidenceModal({
  employeeName,
  date,
  evidence,
  imageUrl,
  loading,
  onClose,
}: {
  employeeName: string
  date: string
  evidence: EvidenceDetail | null
  imageUrl: string | null
  loading: boolean
  onClose: () => void
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card" style={{ maxWidth: '520px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div className="card-header">
          <h3 className="card-title">Attendance Evidence — {employeeName}</h3>
          <button className="btn btn-sm btn-secondary" onClick={onClose} type="button">Close</button>
        </div>
        <div className="card-body">
          {loading ? (
            <div className="loading-state">Loading evidence…</div>
          ) : !evidence ? (
            <div className="empty-state"><div className="empty-state-text">No evidence found for this record.</div></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {imageUrl && (
                <div style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <img
                    src={imageUrl}
                    alt="Attendance evidence"
                    style={{ width: '100%', display: 'block', maxHeight: '300px', objectFit: 'cover' }}
                  />
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Date</span>
                  <span className="mono" style={{ fontSize: '13px' }}>{formatDate(date)}</span>
                </div>
                {evidence.captured_at && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Captured At</span>
                    <span className="mono" style={{ fontSize: '13px' }}>{formatTimestamp(evidence.captured_at)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Type</span>
                  <span style={{ fontSize: '13px' }}>{evidence.evidence_type || 'photo'}</span>
                </div>
                {evidence.latitude !== null && evidence.longitude !== null && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Latitude</span>
                      <span className="mono" style={{ fontSize: '13px' }}>{evidence.latitude.toFixed(6)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Longitude</span>
                      <span className="mono" style={{ fontSize: '13px' }}>{evidence.longitude.toFixed(6)}</span>
                    </div>
                    {evidence.location_accuracy !== null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Accuracy</span>
                        <span className="mono" style={{ fontSize: '13px' }}>±{evidence.location_accuracy.toFixed(1)}m</span>
                      </div>
                    )}
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${evidence.latitude}&mlon=${evidence.longitude}&zoom=16`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: '12px', color: 'var(--teal)', textDecoration: 'none' }}
                    >
                      View on Map ↗
                    </a>
                  </>
                )}
                {evidence.latitude === null && (
                  <div style={{ color: 'var(--slate)', fontSize: '13px', fontStyle: 'italic' }}>
                    No location data captured
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
