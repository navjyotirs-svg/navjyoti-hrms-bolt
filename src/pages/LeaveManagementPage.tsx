import { useEffect, useState, useCallback, useMemo } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  fetchAllLeaveRequests,
  fetchAllLeaveBalances,
  fetchLeaveTypes,
  hrReviewLeave,
  adjustLeaveBalance,
  formatLeaveDate,
  type LeaveRequest,
  type LeaveBalance,
  type LeaveType,
} from '@/lib/leave'
import { LEAVE_STATUS_LABELS, type LeaveStatus } from '@/types/roles'
import '@/styles/shared.css'

type Tab = 'pending' | 'all' | 'balances'

interface EmployeeLookup {
  id: string
  full_name: string
  employee_code: string
}

export function LeaveManagementPage() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('pending')

  const orgId = profile?.organization_id ?? null

  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [employeeMap, setEmployeeMap] = useState<Record<string, EmployeeLookup>>({})

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  // Filters for the "All Leave Requests" tab
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | 'ALL'>('ALL')
  const [employeeSearch, setEmployeeSearch] = useState('')

  // Balance adjustment modal state
  const [adjustModalOpen, setAdjustModalOpen] = useState(false)
  const [adjustTarget, setAdjustTarget] = useState<LeaveBalance | null>(null)
  const [adjustForm, setAdjustForm] = useState({ leaveTypeId: '', quantity: '', description: '' })
  const [adjusting, setAdjusting] = useState(false)

  const loadAll = useCallback(async (org: string) => {
    setLoading(true)
    setError(null)
    try {
      const [reqs, bals, types, empData] = await Promise.all([
        fetchAllLeaveRequests(org),
        fetchAllLeaveBalances(org),
        fetchLeaveTypes(org),
        supabase
          .from('employees')
          .select('id, full_name, employee_code')
          .eq('organization_id', org)
          .order('full_name', { ascending: true }),
      ])
      setRequests(reqs)
      setBalances(bals)
      setLeaveTypes(types)
      const emps = (empData.data ?? []) as EmployeeLookup[]
      const map: Record<string, EmployeeLookup> = {}
      for (const e of emps) map[e.id] = e
      setEmployeeMap(map)
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!orgId) {
      setLoading(false)
      return
    }
    ;(async () => {
      await loadAll(orgId)
    })()
  }, [orgId, loadAll])

  const pendingRequests = useMemo(
    () => requests.filter((r) => r.status === 'PENDING_HR'),
    [requests],
  )

  const filteredRequests = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase()
    return requests.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false
      if (q) {
        const name = (r.employees?.full_name ?? '').toLowerCase()
        const code = (r.employees?.employee_code ?? '').toLowerCase()
        if (!name.includes(q) && !code.includes(q)) return false
      }
      return true
    })
  }, [requests, statusFilter, employeeSearch])

  async function reload(org: string) {
    try {
      const [reqs, bals] = await Promise.all([
        fetchAllLeaveRequests(org),
        fetchAllLeaveBalances(org),
      ])
      setRequests(reqs)
      setBalances(bals)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleHrReview(
    req: LeaveRequest,
    decision: 'APPROVED' | 'REJECTED',
  ) {
    const promptLabel = decision === 'APPROVED' ? 'Approve' : 'Reject'
    const remarks = window.prompt(`${promptLabel} this leave request. Remarks (optional):`) ?? ''
    setError(null)
    setSuccess(null)
    setActionLoadingId(req.id)
    try {
      await hrReviewLeave({
        leave_request_id: req.id,
        decision,
        remarks: remarks.trim() || undefined,
      })
      setSuccess(`Leave request ${decision.toLowerCase()} successfully.`)
      if (orgId) await reload(orgId)
    } catch (e) {
      setError((e as Error).message)
    }
    setActionLoadingId(null)
  }

  function openAdjustModal(b: LeaveBalance) {
    setAdjustTarget(b)
    setAdjustForm({ leaveTypeId: b.leave_type_id, quantity: '', description: '' })
    setAdjustModalOpen(true)
  }

  function closeAdjustModal() {
    setAdjustModalOpen(false)
    setAdjustTarget(null)
    setAdjustForm({ leaveTypeId: '', quantity: '', description: '' })
  }

  async function handleAdjustSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!adjustTarget || !orgId) return
    const qty = Number(adjustForm.quantity)
    if (!Number.isFinite(qty) || qty === 0) {
      setError('Quantity must be a non-zero number (use negative values to deduct).')
      return
    }
    if (!adjustForm.leaveTypeId) {
      setError('Leave type is required.')
      return
    }
    setError(null)
    setSuccess(null)
    setAdjusting(true)
    try {
      await adjustLeaveBalance({
        employee_id: adjustTarget.employee_id,
        leave_type_id: adjustForm.leaveTypeId,
        quantity: qty,
        description: adjustForm.description.trim() || undefined,
      })
      setSuccess('Leave balance adjusted successfully.')
      closeAdjustModal()
      await reload(orgId)
    } catch (err) {
      setError((err as Error).message)
    }
    setAdjusting(false)
  }

  function statusLabel(status: LeaveStatus): string {
    return LEAVE_STATUS_LABELS[status] ?? status
  }

  function employeeName(id: string): string {
    const e = employeeMap[id]
    if (!e) return 'Unknown employee'
    return e.full_name + (e.employee_code ? ` (${e.employee_code})` : '')
  }

  function renderRequestCard(r: LeaveRequest, withActions: boolean) {
    const employeeNameStr = r.employees?.full_name ?? 'Unknown employee'
    const employeeCode = r.employees?.employee_code ?? ''
    return (
      <div className="card" key={r.id} style={{ marginBottom: '12px' }}>
        <div
          className="card-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div>
            <div style={{ fontWeight: 600 }}>{employeeNameStr}</div>
            {employeeCode && (
              <div style={{ fontSize: '12px', color: 'var(--slate)' }}>{employeeCode}</div>
            )}
          </div>
          <span className={`leave-badge ${r.status.toLowerCase()}`}>
            {statusLabel(r.status as LeaveStatus)}
          </span>
        </div>
        <div className="card-body">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
              marginBottom: '12px',
            }}
          >
            <div>
              <div style={{ fontSize: '12px', color: 'var(--slate)' }}>Leave Type</div>
              <div style={{ fontWeight: 600 }}>
                {r.leave_types?.name ?? r.leave_types?.code ?? '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--slate)' }}>Requested Days</div>
              <div className="mono" style={{ fontWeight: 600 }}>{r.requested_days}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--slate)' }}>From</div>
              <div className="mono">{formatLeaveDate(r.from_date)}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--slate)' }}>To</div>
              <div className="mono">{formatLeaveDate(r.to_date)}</div>
            </div>
          </div>

          <div style={{ fontSize: '12px', color: 'var(--slate)', marginBottom: '4px' }}>Reason</div>
          <div style={{ marginBottom: '12px' }}>{r.reason || '—'}</div>

          {r.half_day_type && (
            <div style={{ fontSize: '12px', color: 'var(--slate)', marginBottom: '12px' }}>
              Half-day: <strong>{r.half_day_type === 'FIRST_HALF' ? 'First Half' : 'Second Half'}</strong>
            </div>
          )}

          {withActions && r.status === 'PENDING_HR' && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                className="btn btn-sm"
                disabled={actionLoadingId === r.id}
                onClick={() => handleHrReview(r, 'APPROVED')}
              >
                Approve
              </button>
              <button
                className="btn btn-sm btn-danger"
                disabled={actionLoadingId === r.id}
                onClick={() => handleHrReview(r, 'REJECTED')}
              >
                Reject
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-state">Loading…</div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Leave Management</h2>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}
      {success && <div className="form-success" style={{ marginBottom: '12px' }}>{success}</div>}

      {!orgId ? (
        <div className="empty-state">
          <div className="empty-state-text">Your organization could not be determined.</div>
        </div>
      ) : (
        <>
          <div className="attendance-tabs">
            <button
              className={`attendance-tab ${tab === 'pending' ? 'active' : ''}`}
              onClick={() => setTab('pending')}
            >
              Pending HR Approval{pendingRequests.length > 0 ? ` (${pendingRequests.length})` : ''}
            </button>
            <button
              className={`attendance-tab ${tab === 'all' ? 'active' : ''}`}
              onClick={() => setTab('all')}
            >
              All Leave Requests
            </button>
            <button
              className={`attendance-tab ${tab === 'balances' ? 'active' : ''}`}
              onClick={() => setTab('balances')}
            >
              Leave Balances
            </button>
          </div>

          {/* ---------------- Pending HR Approval tab ---------------- */}
          {tab === 'pending' && (
            <>
              {pendingRequests.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-text">No leave requests pending HR approval.</div>
                </div>
              ) : (
                pendingRequests.map((r) => renderRequestCard(r, true))
              )}
            </>
          )}

          {/* ---------------- All Leave Requests tab ---------------- */}
          {tab === 'all' && (
            <div className="card">
              <div className="card-header">All Leave Requests</div>
              <div className="card-body">
                <div
                  style={{
                    display: 'flex',
                    gap: '12px',
                    flexWrap: 'wrap',
                    marginBottom: '16px',
                    alignItems: 'flex-end',
                  }}
                >
                  <div className="form-field" style={{ marginBottom: 0, minWidth: '200px' }}>
                    <label>Status</label>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as LeaveStatus | 'ALL')}
                    >
                      <option value="ALL">All statuses</option>
                      {Object.keys(LEAVE_STATUS_LABELS).map((s) => (
                        <option key={s} value={s}>
                          {LEAVE_STATUS_LABELS[s as LeaveStatus]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field" style={{ marginBottom: 0, minWidth: '240px' }}>
                    <label>Search employee</label>
                    <input
                      type="text"
                      placeholder="Name or employee code…"
                      value={employeeSearch}
                      onChange={(e) => setEmployeeSearch(e.target.value)}
                    />
                  </div>
                </div>

                {filteredRequests.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-text">No leave requests match your filters.</div>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Type</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Days</th>
                          <th>Status</th>
                          <th>Submitted</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRequests.map((r) => (
                          <tr key={r.id}>
                            <td>
                              {r.employees?.full_name ?? 'Unknown'}
                              {r.employees?.employee_code && (
                                <span
                                  style={{
                                    fontSize: '12px',
                                    color: 'var(--slate)',
                                    marginLeft: '6px',
                                  }}
                                >
                                  ({r.employees.employee_code})
                                </span>
                              )}
                            </td>
                            <td>{r.leave_types?.name ?? r.leave_types?.code ?? '—'}</td>
                            <td className="mono">{formatLeaveDate(r.from_date)}</td>
                            <td className="mono">{formatLeaveDate(r.to_date)}</td>
                            <td className="mono">{r.requested_days}</td>
                            <td>
                              <span className={`leave-badge ${r.status.toLowerCase()}`}>
                                {statusLabel(r.status as LeaveStatus)}
                              </span>
                            </td>
                            <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                              {formatLeaveDate(r.created_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---------------- Leave Balances tab ---------------- */}
          {tab === 'balances' && (
            <div className="card">
              <div className="card-header">Leave Balances</div>
              {balances.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-text">No leave balances found.</div>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Leave Type</th>
                        <th>Year</th>
                        <th>Opening</th>
                        <th>Accrued</th>
                        <th>Used</th>
                        <th>Adjusted</th>
                        <th>Closing</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {balances.map((b) => (
                        <tr key={b.id}>
                          <td>{employeeName(b.employee_id)}</td>
                          <td>{b.leave_types?.name ?? b.leave_types?.code ?? '—'}</td>
                          <td className="mono">{b.balance_year}</td>
                          <td className="mono">{b.opening_balance}</td>
                          <td className="mono">{b.accrued}</td>
                          <td className="mono">{b.used}</td>
                          <td className="mono">{b.adjusted}</td>
                          <td className="mono" style={{ fontWeight: 600 }}>{b.closing_balance}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button
                              className="btn btn-sm btn-secondary"
                              onClick={() => openAdjustModal(b)}
                            >
                              Adjust Balance
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ---------------- Balance Adjustment Modal ---------------- */}
      {adjustModalOpen && adjustTarget && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={closeAdjustModal}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '480px',
              maxHeight: '90vh',
              overflowY: 'auto',
              margin: '16px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="card-header"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>Adjust Leave Balance</span>
              <button
                className="btn btn-sm btn-secondary"
                onClick={closeAdjustModal}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="card-body">
              <form onSubmit={handleAdjustSubmit}>
                <div className="form-field" style={{ marginBottom: '12px' }}>
                  <label>Employee</label>
                  <input
                    type="text"
                    value={employeeName(adjustTarget.employee_id)}
                    readOnly
                  />
                </div>

                <div className="form-field" style={{ marginBottom: '12px' }}>
                  <label>Leave Type</label>
                  <select
                    value={adjustForm.leaveTypeId}
                    onChange={(e) =>
                      setAdjustForm({ ...adjustForm, leaveTypeId: e.target.value })
                    }
                    required
                  >
                    <option value="">Select leave type…</option>
                    {leaveTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field" style={{ marginBottom: '12px' }}>
                  <label>Quantity (use negative to deduct)</label>
                  <input
                    type="number"
                    step="any"
                    value={adjustForm.quantity}
                    onChange={(e) =>
                      setAdjustForm({ ...adjustForm, quantity: e.target.value })
                    }
                    placeholder="e.g. 2 or -1.5"
                    required
                  />
                </div>

                <div className="form-field" style={{ marginBottom: '12px' }}>
                  <label>Description</label>
                  <textarea
                    rows={3}
                    value={adjustForm.description}
                    onChange={(e) =>
                      setAdjustForm({ ...adjustForm, description: e.target.value })
                    }
                    placeholder="Reason for adjustment…"
                  />
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <button type="submit" className="btn" disabled={adjusting} style={{ flex: 1 }}>
                    {adjusting ? 'Submitting…' : 'Submit Adjustment'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={closeAdjustModal}
                    disabled={adjusting}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
