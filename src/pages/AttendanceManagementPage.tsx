import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import { ATTENDANCE_STATUS_LABELS, CHECKOUT_TYPE_LABELS, CHECKOUT_STATUS_LABELS, type AttendanceStatus, type CheckoutType, type CheckoutStatus } from '@/types/roles'
import { formatTimestamp, formatDate, createEvidenceSignedUrl } from '@/lib/attendance'
import { TableSkeleton } from '@/components/Skeleton'
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
  checkout_type: string
  checkout_status: string
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
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all')
  const [dateFilter, setDateFilter] = useState(searchParams.get('date') === 'today'
    ? new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }).slice(0, 10)
    : searchParams.get('date') || new Date().toISOString().slice(0, 10))
  const [evidenceLoading, setEvidenceLoading] = useState(false)
  const [evidenceModal, setEvidenceModal] = useState<{
    employeeName: string
    date: string
    items: Array<EvidenceDetail & { imageUrl: string | null }>
    loading: boolean
  } | null>(null)
  const [checkoutTypeFilter, setCheckoutTypeFilter] = useState('all')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 25

  // Sync filter changes back to URL
  useEffect(() => {
    const params: Record<string, string> = {}
    if (statusFilter !== 'all') params.status = statusFilter
    if (dateFilter) params.date = dateFilter
    setSearchParams(params, { replace: true })
  }, [statusFilter, dateFilter, setSearchParams])

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
        checkout_type, checkout_status,
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

  const CHECKED_IN_STATUSES = ['PENDING_CHECKOUT', 'FULL_DAY', 'HALF_DAY']
  const filtered = records.filter((r) => {
    const q = search.trim().toLowerCase()
    const emp = r.employees
    const matchesSearch = !q || (emp?.full_name.toLowerCase().includes(q) || emp?.employee_code.toLowerCase().includes(q))
    let matchesStatus = statusFilter === 'all' || r.final_status === statusFilter
    if (statusFilter === 'checked_in') matchesStatus = CHECKED_IN_STATUSES.includes(r.final_status)
    const matchesCheckoutType = checkoutTypeFilter === 'all' || r.checkout_type === checkoutTypeFilter
    return matchesSearch && matchesStatus && matchesCheckoutType
  })
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const hasFilters = statusFilter !== 'all' || checkoutTypeFilter !== 'all' || search.trim() !== ''

  async function viewEvidence(recordId: string, employeeName: string, date: string) {
    setEvidenceLoading(true)
    setEvidenceModal({ employeeName, date, items: [], loading: true })
    try {
      const { data } = await supabase
        .from('attendance_evidence')
        .select('storage_path, mime_type, latitude, longitude, location_accuracy, captured_at, evidence_type')
        .eq('attendance_record_id', recordId)
        .order('captured_at', { ascending: true })
        .limit(2)

      const evidenceData = (data ?? []) as EvidenceDetail[]
      if (evidenceData.length === 0) {
        setEvidenceModal({ employeeName, date, items: [], loading: false })
        setEvidenceLoading(false)
        return
      }

      const items = await Promise.all(
        evidenceData.map(async (ev) => ({
          ...ev,
          imageUrl: await createEvidenceSignedUrl(ev.storage_path),
        }))
      )

      setEvidenceModal({ employeeName, date, items, loading: false })
    } catch (e) {
      setError((e as Error).message)
      setEvidenceModal(null)
    }
    setEvidenceLoading(false)
  }

  if (!canReadAll) {
    return <div className="page"><div className="empty-state"><div className="empty-state-text">You do not have permission to view attendance management.</div></div></div>
  }

  function clearFilters() {
    setStatusFilter('all')
    setCheckoutTypeFilter('all')
    setSearch('')
    setPage(0)
  }

  const statusLabel = statusFilter === 'checked_in' ? 'Checked In' : (statusFilter === 'all' ? null : ATTENDANCE_STATUS_LABELS[statusFilter as AttendanceStatus] ?? statusFilter)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <button className="btn btn-sm btn-secondary" onClick={() => navigate('/')} style={{ marginBottom: 'var(--space-2)' }}>← Back to Dashboard</button>
          <h2 className="page-title">Attendance Management</h2>
          {!loading && <div className="page-summary">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</div>}
        </div>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      <div className="card">
        {(hasFilters || dateFilter) && (
          <div className="filter-chips" style={{ marginBottom: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            {statusLabel && <span className="filter-chip">Status: {statusLabel} <button onClick={() => setStatusFilter('all')} aria-label="Clear status filter">×</button></span>}
            {dateFilter && <span className="filter-chip">Date: {dateFilter} <button onClick={() => setDateFilter(new Date().toISOString().slice(0, 10))} aria-label="Reset date">×</button></span>}
            {search.trim() && <span className="filter-chip">Search: "{search}" <button onClick={() => setSearch('')} aria-label="Clear search">×</button></span>}
            {hasFilters && <button className="btn btn-sm btn-secondary" onClick={clearFilters}>Clear Filters</button>}
          </div>
        )}

        <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="form-field">
            <label htmlFor="att-search">Search</label>
            <input id="att-search" type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} placeholder="Name or employee code" />
          </div>
          <div className="form-field">
            <label htmlFor="att-status">Status</label>
            <select id="att-status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }}>
              <option value="all">All Statuses</option>
              <option value="checked_in">Checked In</option>
              {Object.entries(ATTENDANCE_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="att-date">Date</label>
            <input id="att-date" type="date" value={dateFilter} onChange={(e) => { setDateFilter(e.target.value); setPage(0) }} />
          </div>
          <div className="form-field">
            <label htmlFor="att-checkout-type">Checkout Type</label>
            <select id="att-checkout-type" value={checkoutTypeFilter} onChange={(e) => { setCheckoutTypeFilter(e.target.value); setPage(0) }}>
              <option value="all">All Checkout Types</option>
              <option value="MANUAL">Manual</option>
              <option value="AUTO">Automatic</option>
            </select>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={10} cols={11} />
        ) : filtered.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No attendance records for this date.</div></div>
        ) : (
          <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th><th>Code</th><th>Branch</th><th>Date</th>
                  <th>Check-In</th><th>Required Checkout</th><th>Actual Checkout</th>
                  <th>Elapsed</th><th>Status</th><th>Checkout</th><th>Correction</th><th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Employee">{r.employees?.full_name ?? '—'}</td>
                    <td data-label="Code" className="mono">{r.employees?.employee_code ?? '—'}</td>
                    <td data-label="Branch">{r.branches?.name ?? '—'}</td>
                    <td data-label="Date" className="mono">{formatDate(r.attendance_date)}</td>
                    <td data-label="Check-In" className="mono">{formatTimestamp(r.check_in_at)}</td>
                    <td data-label="Required Checkout" className="mono">{formatTimestamp(r.required_checkout_at)}</td>
                    <td data-label="Actual Checkout" className="mono">{r.check_out_at ? formatTimestamp(r.check_out_at) : '—'}</td>
                    <td data-label="Elapsed" className="mono">{r.actual_elapsed_minutes ? `${r.actual_elapsed_minutes}m` : '—'}</td>
                    <td data-label="Status"><span className={`attendance-badge ${r.final_status.toLowerCase()}`}>{ATTENDANCE_STATUS_LABELS[r.final_status as AttendanceStatus] ?? r.final_status}</span></td>
                    <td data-label="Checkout">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '11px' }}>{CHECKOUT_TYPE_LABELS[r.checkout_type as CheckoutType] ?? r.checkout_type}</span>
                        <span className={`attendance-badge ${r.checkout_status.toLowerCase()}`} style={{ fontSize: '10px' }}>{CHECKOUT_STATUS_LABELS[r.checkout_status as CheckoutStatus] ?? r.checkout_status}</span>
                      </div>
                    </td>
                    <td data-label="Correction">{r.correction_version > 0 ? <span className="tag tag-amber">v{r.correction_version}</span> : '—'}</td>
                    <td data-label="Evidence">
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
          {totalPages > 1 && (
            <div className="pagination" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              <button className="btn btn-sm btn-secondary" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Previous</button>
              <span className="mono">Page {page + 1} of {totalPages}</span>
              <button className="btn btn-sm btn-secondary" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Next</button>
            </div>
          )}
          </>
        )}
      </div>

      {evidenceModal && (
        <EvidenceModal
          employeeName={evidenceModal.employeeName}
          date={evidenceModal.date}
          items={evidenceModal.items}
          loading={evidenceModal.loading}
          onClose={() => setEvidenceModal(null)}
        />
      )}
    </div>
  )
}

const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  CHECK_IN_PHOTO: 'Check-In Photo',
  CHECK_OUT_PHOTO: 'Check-Out Photo',
}

function EvidenceModal({
  employeeName,
  date,
  items,
  loading,
  onClose,
}: {
  employeeName: string
  date: string
  items: Array<EvidenceDetail & { imageUrl: string | null }>
  loading: boolean
  onClose: () => void
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card" style={{ maxWidth: '640px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div className="card-header">
          <h3 className="card-title">Attendance Evidence — {employeeName}</h3>
          <button className="btn btn-sm btn-secondary" onClick={onClose} type="button">Close</button>
        </div>
        <div className="card-body">
          {loading ? (
            <div className="loading-state">Loading evidence…</div>
          ) : items.length === 0 ? (
            <div className="empty-state"><div className="empty-state-text">No evidence found for this record.</div></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                {items.map((ev) => (
                  <div
                    key={ev.evidence_type + ev.captured_at}
                    style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
                  >
                    <div style={{
                      fontSize: '12px', fontWeight: 600, textTransform: 'uppercase',
                      letterSpacing: '0.05em', color: 'var(--slate)',
                    }}>
                      {EVIDENCE_TYPE_LABELS[ev.evidence_type] ?? ev.evidence_type}
                    </div>
                    <div style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface-2)', aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {ev.imageUrl ? (
                        <img
                          src={ev.imageUrl}
                          alt={EVIDENCE_TYPE_LABELS[ev.evidence_type] ?? 'Evidence photo'}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      ) : (
                        <span style={{ color: 'var(--slate)', fontSize: '12px' }}>Photo unavailable</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--slate)' }}>Date</span>
                        <span className="mono">{formatDate(date)}</span>
                      </div>
                      {ev.captured_at && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--slate)' }}>Time</span>
                          <span className="mono">{formatTimestamp(ev.captured_at)}</span>
                        </div>
                      )}
                      {ev.latitude !== null && ev.longitude !== null && (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--slate)' }}>Latitude</span>
                            <span className="mono">{ev.latitude.toFixed(6)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--slate)' }}>Longitude</span>
                            <span className="mono">{ev.longitude.toFixed(6)}</span>
                          </div>
                          {ev.location_accuracy !== null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--slate)' }}>Accuracy</span>
                              <span className="mono">±{ev.location_accuracy.toFixed(1)}m</span>
                            </div>
                          )}
                          <a
                            href={`https://www.openstreetmap.org/?mlat=${ev.latitude}&mlon=${ev.longitude}&zoom=16`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: '12px', color: 'var(--teal)', textDecoration: 'none' }}
                          >
                            View on Map ↗
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
