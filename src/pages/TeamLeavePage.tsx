import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  fetchTeamLeaveRequests,
  managerReviewLeave,
  formatLeaveDate,
  type LeaveRequest,
} from '@/lib/leave'
import { LEAVE_STATUS_LABELS, type LeaveStatus } from '@/types/roles'
import '@/styles/shared.css'

type Tab = 'pending' | 'all'

export function TeamLeavePage() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('pending')

  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  // Resolve the signed-in manager's employee id from user_profiles -> employees
  const resolveEmployee = useCallback(async (userId: string) => {
    const { data: empData } = await supabase
      .from('employees')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle()
    const emp = empData as { id: string } | null
    if (emp) setEmployeeId(emp.id)
    return emp?.id ?? null
  }, [])

  const loadRequests = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchTeamLeaveRequests()
      setRequests(data)
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!profile?.id) return
    let active = true
    ;(async () => {
      setLoading(true)
      try {
        const emp = await resolveEmployee(profile.id)
        if (!emp || !active) {
          setLoading(false)
          return
        }
        await loadRequests()
      } catch (e) {
        if (active) {
          setError((e as Error).message)
          setLoading(false)
        }
      }
    })()
    return () => { active = false }
  }, [profile?.id, resolveEmployee, loadRequests])

  const pendingRequests = requests.filter((r) => r.status === 'PENDING_MANAGER')

  async function handleReview(
    req: LeaveRequest,
    decision: 'APPROVED' | 'REJECTED' | 'RETURNED',
  ) {
    const promptLabel =
      decision === 'APPROVED' ? 'Approve' : decision === 'REJECTED' ? 'Reject' : 'Return'
    const remarks = window.prompt(`${promptLabel} this leave request. Remarks (optional):`) ?? ''
    setError(null)
    setSuccess(null)
    setActionLoadingId(req.id)
    try {
      await managerReviewLeave({ leave_request_id: req.id, decision, remarks: remarks.trim() || undefined })
      setSuccess(`Leave request ${decision.toLowerCase()} successfully.`)
      if (employeeId) await loadRequests()
    } catch (e) {
      setError((e as Error).message)
    }
    setActionLoadingId(null)
  }

  function statusLabel(status: LeaveStatus): string {
    return LEAVE_STATUS_LABELS[status] ?? status
  }

  function renderRequestCard(r: LeaveRequest, withActions: boolean) {
    const employeeName = r.employees?.full_name ?? 'Unknown employee'
    const employeeCode = r.employees?.employee_code ?? ''
    return (
      <div className="card" key={r.id} style={{ marginBottom: '12px' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <div style={{ fontWeight: 600 }}>{employeeName}</div>
            {employeeCode && (
              <div style={{ fontSize: '12px', color: 'var(--slate)' }}>{employeeCode}</div>
            )}
          </div>
          <span className={`leave-badge ${r.status.toLowerCase()}`}>{statusLabel(r.status as LeaveStatus)}</span>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
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

          {withActions && r.status === 'PENDING_MANAGER' && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                className="btn btn-sm"
                disabled={actionLoadingId === r.id}
                onClick={() => handleReview(r, 'APPROVED')}
              >
                Approve
              </button>
              <button
                className="btn btn-sm btn-danger"
                disabled={actionLoadingId === r.id}
                onClick={() => handleReview(r, 'REJECTED')}
              >
                Reject
              </button>
              <button
                className="btn btn-sm btn-secondary"
                disabled={actionLoadingId === r.id}
                onClick={() => handleReview(r, 'RETURNED')}
              >
                Return
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
        <h2 className="page-title">Team Leave</h2>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}
      {success && <div className="form-success" style={{ marginBottom: '12px' }}>{success}</div>}

      {!employeeId ? (
        <div className="empty-state">
          <div className="empty-state-text">Your employee profile could not be found.</div>
        </div>
      ) : (
        <>
          <div className="attendance-tabs">
            <button
              className={`attendance-tab ${tab === 'pending' ? 'active' : ''}`}
              onClick={() => setTab('pending')}
            >
              Pending Review{pendingRequests.length > 0 ? ` (${pendingRequests.length})` : ''}
            </button>
            <button
              className={`attendance-tab ${tab === 'all' ? 'active' : ''}`}
              onClick={() => setTab('all')}
            >
              All Team Requests
            </button>
          </div>

          {tab === 'pending' && (
            <>
              {pendingRequests.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-text">No leave requests pending your review.</div>
                </div>
              ) : (
                pendingRequests.map((r) => renderRequestCard(r, true))
              )}
            </>
          )}

          {tab === 'all' && (
            <>
              {requests.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-text">No team leave requests found.</div>
                </div>
              ) : (
                <div className="card">
                  <div className="card-header">All Team Leave Requests</div>
                  {(() => {
                    return (
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
                            </tr>
                          </thead>
                          <tbody>
                            {requests.map((r) => (
                              <tr key={r.id}>
                                <td>
                                  {r.employees?.full_name ?? 'Unknown'}
                                  {r.employees?.employee_code && (
                                    <span style={{ fontSize: '12px', color: 'var(--slate)', marginLeft: '6px' }}>
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
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  })()}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
