import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  fetchMyLeaveBalances,
  fetchMyLeaveLedger,
  fetchMyLeaveRequests,
  fetchLeaveTypes,
  calculateLeaveDays,
  submitLeaveRequest,
  cancelLeaveRequest,
  withdrawLeaveRequest,
  uploadLeaveDocument,
  validateLeaveDocument,
  formatLeaveDate,
  LEAVE_STATUS_LABELS,
  LEAVE_TRANSACTION_LABELS,
  type LeaveType,
  type LeaveBalance,
  type LeaveLedgerEntry,
  type LeaveRequest,
} from '@/lib/leave'
import { LEAVE_STATUS_LABELS as ROLE_LEAVE_STATUS_LABELS, type LeaveStatus } from '@/types/roles'
import '@/styles/shared.css'

type Tab = 'balances' | 'apply' | 'requests'

interface CalcResult {
  days?: number
  working_days?: number
  holidays?: number
  weekends?: number
  error?: string
}

export function MyLeavePage() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('balances')

  // employee + org context
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [branchId, setBranchId] = useState<string | null>(null)

  // balances tab
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [ledger, setLedger] = useState<LeaveLedgerEntry[]>([])

  // apply tab
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [form, setForm] = useState({
    leaveTypeId: '',
    fromDate: '',
    toDate: '',
    halfDay: false,
    halfDayType: 'FIRST_HALF' as 'FIRST_HALF' | 'SECOND_HALF',
    reason: '',
  })
  const [docPath, setDocPath] = useState<string | null>(null)
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null)
  const [calcLoading, setCalcLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // requests tab
  const [requests, setRequests] = useState<LeaveRequest[]>([])

  // shared ui state
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Resolve employee id from user_profiles -> employees lookup
  const resolveEmployee = useCallback(async (userId: string) => {
    const { data: empData } = await supabase
      .from('employees')
      .select('id, branch_id')
      .eq('user_id', userId)
      .maybeSingle()
    const emp = empData as { id: string; branch_id: string | null } | null
    if (emp) {
      setEmployeeId(emp.id)
      setBranchId(emp.branch_id ?? null)
    }
    return emp?.id ?? null
  }, [])

  // Initial load: resolve employee + balances + ledger
  useEffect(() => {
    if (!profile?.id) return
    let active = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const emp = await resolveEmployee(profile.id)
        if (!emp) {
          setLoading(false)
          return
        }
        const [bals, led] = await Promise.all([
          fetchMyLeaveBalances(emp),
          fetchMyLeaveLedger(emp, 50),
        ])
        if (!active) return
        setBalances(bals)
        setLedger(led)
      } catch (e) {
        if (active) setError((e as Error).message)
      }
      if (active) setLoading(false)
    })()
    return () => { active = false }
  }, [profile?.id, resolveEmployee])

  // Lazy-load leave types when entering apply tab
  useEffect(() => {
    if (tab !== 'apply' || !profile?.organization_id || leaveTypes.length > 0) return
    fetchLeaveTypes(profile.organization_id)
      .then(setLeaveTypes)
      .catch((e) => setError((e as Error).message))
  }, [tab, profile?.organization_id, leaveTypes.length])

  // Lazy-load requests when entering requests tab
  useEffect(() => {
    if (tab !== 'requests' || !employeeId) return
    fetchMyLeaveRequests(employeeId)
      .then(setRequests)
      .catch((e) => setError((e as Error).message))
  }, [tab, employeeId])

  // Recalculate leave days whenever dates / half-day / type change
  useEffect(() => {
    if (!form.fromDate || !form.toDate || !form.leaveTypeId) {
      setCalcResult(null)
      return
    }
    let active = true
    setCalcLoading(true)
    calculateLeaveDays({
      from_date: form.fromDate,
      to_date: form.toDate,
      branch_id: branchId,
      half_day_type: form.halfDay ? form.halfDayType : null,
      organization_id: profile?.organization_id ?? undefined,
    })
      .then((res: CalcResult) => { if (active) setCalcResult(res) })
      .catch((e) => { if (active) setCalcResult({ error: (e as Error).message }) })
      .finally(() => { if (active) setCalcLoading(false) })
    return () => { active = false }
  }, [form.fromDate, form.toDate, form.halfDay, form.halfDayType, form.leaveTypeId, branchId, profile?.organization_id])

  const selectedType = leaveTypes.find((t) => t.id === form.leaveTypeId) ?? null
  const selectedBalance = selectedType
    ? balances.find((b) => b.leave_type_id === selectedType.id) ?? null
    : null
  const projectedDays = calcResult?.days ?? 0
  const projectedBalance = selectedBalance
    ? Math.max(0, selectedBalance.closing_balance - projectedDays)
    : null

  async function handleDocChange(file: File | null) {
    if (!file) { setDocPath(null); return }
    const vErr = validateLeaveDocument(file)
    if (vErr) { setError(vErr); setDocPath(null); return }
    setError(null)
    try {
      const path = await uploadLeaveDocument(profile!.id, file, file.type)
      setDocPath(path)
    } catch (e) {
      setError((e as Error).message)
      setDocPath(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (!form.leaveTypeId || !form.fromDate || !form.toDate || !form.reason.trim()) {
      setError('Leave type, dates and reason are required')
      return
    }
    if (selectedType?.requires_document && !docPath) {
      setError('A supporting document is required for this leave type')
      return
    }
    setSubmitting(true)
    try {
      await submitLeaveRequest({
        leave_type_id: form.leaveTypeId,
        from_date: form.fromDate,
        to_date: form.toDate,
        half_day_type: form.halfDay ? form.halfDayType : null,
        reason: form.reason.trim(),
        supporting_document_path: docPath,
        branch_id: branchId,
      })
      setSuccess('Leave request submitted successfully.')
      // reset form
      setForm({ leaveTypeId: '', fromDate: '', toDate: '', halfDay: false, halfDayType: 'FIRST_HALF', reason: '' })
      setDocPath(null)
      setCalcResult(null)
      // refresh balances + requests
      if (employeeId) {
        fetchMyLeaveBalances(employeeId).then(setBalances).catch(() => {})
        fetchMyLeaveRequests(employeeId).then(setRequests).catch(() => {})
      }
      setTab('requests')
    } catch (e) {
      setError((e as Error).message)
    }
    setSubmitting(false)
  }

  async function handleCancel(req: LeaveRequest) {
    const reason = window.prompt('Reason for cancelling this leave request?')
    if (!reason) return
    setError(null)
    try {
      await cancelLeaveRequest({ leave_request_id: req.id, reason })
      setSuccess('Leave request cancelled.')
      if (employeeId) setRequests(await fetchMyLeaveRequests(employeeId))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleWithdraw(req: LeaveRequest) {
    if (!window.confirm('Withdraw this leave request?')) return
    setError(null)
    try {
      await withdrawLeaveRequest({ leave_request_id: req.id })
      setSuccess('Leave request withdrawn.')
      if (employeeId) setRequests(await fetchMyLeaveRequests(employeeId))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (loading) return <div className="page"><div className="loading-state">Loading…</div></div>

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">My Leave</h2>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}
      {success && <div className="form-success" style={{ marginBottom: '12px' }}>{success}</div>}

      <div className="attendance-tabs">
        <button className={`attendance-tab ${tab === 'balances' ? 'active' : ''}`} onClick={() => setTab('balances')}>Balances</button>
        <button className={`attendance-tab ${tab === 'apply' ? 'active' : ''}`} onClick={() => setTab('apply')}>Apply Leave</button>
        <button className={`attendance-tab ${tab === 'requests' ? 'active' : ''}`} onClick={() => setTab('requests')}>My Requests</button>
      </div>

      {/* ---------------- Balances tab ---------------- */}
      {tab === 'balances' && (
        <>
          <div className="attendance-status-grid">
            {balances.filter((b) => b.leave_types?.code === 'CL' || b.leave_types?.code === 'SL').map((b) => (
              <div className="attendance-status-card" key={b.id}>
                <div className="attendance-status-label">{b.leave_types?.name ?? b.leave_types?.code}</div>
                <div className="attendance-status-value mono" style={{ fontSize: '24px' }}>
                  {b.closing_balance}
                </div>
                <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--slate)' }}>
                  Accrued: <strong>{b.accrued}</strong> · Used: <strong>{b.used}</strong>
                </div>
              </div>
            ))}
            {balances.filter((b) => b.leave_types?.code === 'CL' || b.leave_types?.code === 'SL').length === 0 && (
              <div className="empty-state"><div className="empty-state-text">No CL/SL balances found.</div></div>
            )}
          </div>

          <div className="card" style={{ marginTop: '16px' }}>
            <div className="card-header">Leave Ledger</div>
            {ledger.length === 0 ? (
              <div className="empty-state"><div className="empty-state-text">No ledger entries yet.</div></div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>Date</th><th>Type</th><th>Transaction</th><th>Quantity</th><th>Balance After</th></tr>
                  </thead>
                  <tbody>
                    {ledger.map((l) => (
                      <tr key={l.id}>
                        <td className="mono">{formatLeaveDate(l.effective_date)}</td>
                        <td>{l.leave_types?.code ?? '—'}</td>
                        <td>{LEAVE_TRANSACTION_LABELS[l.transaction_type] ?? l.transaction_type}</td>
                        <td className="mono">{l.quantity}</td>
                        <td className="mono">{l.balance_after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ---------------- Apply Leave tab ---------------- */}
      {tab === 'apply' && (
        <div className="card">
          <div className="card-header">Apply for Leave</div>
          <div className="card-body">
            <form onSubmit={handleSubmit}>
              <div className="form-field" style={{ marginBottom: '12px' }}>
                <label>Leave Type</label>
                <select
                  value={form.leaveTypeId}
                  onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}
                  required
                >
                  <option value="">Select leave type…</option>
                  {leaveTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-field">
                  <label>From Date</label>
                  <input
                    type="date"
                    value={form.fromDate}
                    onChange={(e) => setForm({ ...form, fromDate: e.target.value })}
                    required
                  />
                </div>
                <div className="form-field">
                  <label>To Date</label>
                  <input
                    type="date"
                    value={form.toDate}
                    min={form.fromDate || undefined}
                    onChange={(e) => setForm({ ...form, toDate: e.target.value })}
                    required
                  />
                </div>
              </div>

              {selectedType?.allow_half_day && (
                <div className="form-field" style={{ marginTop: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'normal' }}>
                    <input
                      type="checkbox"
                      checked={form.halfDay}
                      onChange={(e) => setForm({ ...form, halfDay: e.target.checked })}
                    />
                    Half-day leave
                  </label>
                  {form.halfDay && (
                    <select
                      value={form.halfDayType}
                      onChange={(e) => setForm({ ...form, halfDayType: e.target.value as 'FIRST_HALF' | 'SECOND_HALF' })}
                      style={{ marginTop: '6px' }}
                    >
                      <option value="FIRST_HALF">First Half</option>
                      <option value="SECOND_HALF">Second Half</option>
                    </select>
                  )}
                </div>
              )}

              {/* Calculated days preview */}
              <div style={{ marginTop: '12px', padding: '10px 12px', background: 'var(--card-2, #f6f8fa)', borderRadius: '6px', fontSize: '13px' }}>
                {calcLoading && <span>Calculating days…</span>}
                {!calcLoading && calcResult?.error && <span style={{ color: 'var(--danger, #c0392b)' }}>{calcResult.error}</span>}
                {!calcLoading && calcResult && !calcResult.error && (
                  <span>
                    Calculated leave days: <strong>{calcResult.days ?? 0}</strong>
                    {typeof calcResult.working_days === 'number' && ` (working: ${calcResult.working_days}`}
                    {typeof calcResult.holidays === 'number' && `, holidays: ${calcResult.holidays}`}
                    {typeof calcResult.weekends === 'number' && `, weekends: ${calcResult.weekends}`}
                    {typeof calcResult.working_days === 'number' && `)`}
                  </span>
                )}
                {!calcLoading && !calcResult && <span style={{ color: 'var(--slate)' }}>Select dates to calculate leave days.</span>}
              </div>

              {/* Balance projection */}
              {selectedBalance && (
                <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--slate)' }}>
                  Current balance: <strong>{selectedBalance.closing_balance}</strong> ·
                  Projected balance after leave: <strong>{projectedBalance}</strong>
                </div>
              )}

              <div className="form-field" style={{ marginTop: '12px' }}>
                <label>Reason</label>
                <textarea
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  rows={3}
                  required
                />
              </div>

              {selectedType?.requires_document && (
                <div className="form-field" style={{ marginTop: '12px' }}>
                  <label>Supporting Document (required)</label>
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp"
                    onChange={(e) => handleDocChange(e.target.files?.[0] ?? null)}
                    required
                  />
                  {docPath && <div style={{ fontSize: '12px', color: 'var(--slate)', marginTop: '4px' }}>Document uploaded.</div>}
                </div>
              )}

              <button type="submit" className="btn" disabled={submitting} style={{ marginTop: '16px', width: '100%' }}>
                {submitting ? 'Submitting…' : 'Submit Leave Request'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- My Requests tab ---------------- */}
      {tab === 'requests' && (
        <div className="card">
          <div className="card-header">My Leave Requests</div>
          {requests.length === 0 ? (
            <div className="empty-state"><div className="empty-state-text">No leave requests yet.</div></div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th><th>Submitted</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {requests.map((r) => {
                    const statusLabel = LEAVE_STATUS_LABELS[r.status as LeaveStatus]
                      ?? ROLE_LEAVE_STATUS_LABELS[r.status as LeaveStatus]
                      ?? r.status
                    const canCancel = r.status === 'APPROVED' || r.status === 'PENDING_MANAGER' || r.status === 'PENDING_HR'
                    const canWithdraw = r.status === 'DRAFT' || r.status === 'PENDING_MANAGER'
                    return (
                      <tr key={r.id}>
                        <td>{r.leave_types?.name ?? r.leave_types?.code ?? '—'}</td>
                        <td className="mono">{formatLeaveDate(r.from_date)}</td>
                        <td className="mono">{formatLeaveDate(r.to_date)}</td>
                        <td className="mono">{r.requested_days}</td>
                        <td>
                          <span className={`leave-badge ${r.status.toLowerCase()}`}>{statusLabel}</span>
                        </td>
                        <td className="mono" style={{ whiteSpace: 'nowrap' }}>{formatLeaveDate(r.created_at)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {canCancel && (
                            <button className="btn btn-sm btn-danger" onClick={() => handleCancel(r)} style={{ marginRight: '6px' }}>
                              Cancel
                            </button>
                          )}
                          {canWithdraw && (
                            <button className="btn btn-sm btn-secondary" onClick={() => handleWithdraw(r)}>
                              Withdraw
                            </button>
                          )}
                          {!canCancel && !canWithdraw && <span style={{ color: 'var(--slate)' }}>—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
