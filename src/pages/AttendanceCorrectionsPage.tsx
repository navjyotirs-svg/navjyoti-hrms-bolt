import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import { reviewCorrection, formatDate } from '@/lib/attendance'
import { CORRECTION_TYPE_LABELS, CORRECTION_STATUS_LABELS, type CorrectionType, type CorrectionStatus } from '@/types/roles'
import '@/styles/shared.css'

interface CorrectionRow {
  id: string
  attendance_record_id: string
  employee_id: string
  correction_type: string
  requested_check_in_at: string | null
  requested_check_out_at: string | null
  reason: string
  status: string
  reviewer_remarks: string | null
  reviewed_at: string | null
  created_at: string
  employees: { full_name: string; employee_code: string } | null
}

export function AttendanceCorrectionsPage() {
  const { profile, permissions } = useAuth()
  const [corrections, setCorrections] = useState<CorrectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)

  const canManage = permissions.includes('attendance.correct_manage')
  const canRequest = permissions.includes('attendance.correct_request_self')

  useEffect(() => {
    if (!profile?.id) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    async function load() {
      try {
        if (canManage && profile?.organization_id) {
          // HR/Director: see all org corrections
          const { data, error: qError } = await supabase
            .from('attendance_corrections')
            .select(`
              id, attendance_record_id, employee_id, correction_type,
              requested_check_in_at, requested_check_out_at, reason, status,
              reviewer_remarks, reviewed_at, created_at,
              employees!inner (full_name, employee_code, organization_id)
            `)
            .eq('employees.organization_id', profile.organization_id)
            .order('created_at', { ascending: false })
            .limit(100)

          if (qError) throw new Error(qError.message)
          setCorrections((data ?? []) as unknown as CorrectionRow[])
        } else if (canRequest) {
          // Employee: see own corrections
          const { data: emp } = await supabase
            .from('employees')
            .select('id')
            .eq('user_id', profile!.id)
            .maybeSingle()

          if (!emp) {
            setLoading(false)
            return
          }

          const { data, error: qError } = await supabase
            .from('attendance_corrections')
            .select(`
              id, attendance_record_id, employee_id, correction_type,
              requested_check_in_at, requested_check_out_at, reason, status,
              reviewer_remarks, reviewed_at, created_at,
              employees (full_name, employee_code)
            `)
            .eq('employee_id', (emp as { id: string }).id)
            .order('created_at', { ascending: false })

          if (qError) throw new Error(qError.message)
          setCorrections((data ?? []) as unknown as CorrectionRow[])
        }
      } catch (e) {
        setError((e as Error).message)
      }
      setLoading(false)
    }

    load()
  }, [profile?.id, profile?.organization_id, canManage, canRequest])

  async function handleReview(id: string, decision: 'APPROVED' | 'REJECTED') {
    const remarks = decision === 'APPROVED'
      ? 'Approved by authorized reviewer.'
      : window.prompt('Enter rejection reason:') ?? ''

    if (decision === 'REJECTED' && !remarks.trim()) return

    setReviewing(id)
    setError(null)
    setSuccess(null)
    try {
      await reviewCorrection({ correction_id: id, decision, reviewer_remarks: remarks })
      setSuccess(`Correction ${decision.toLowerCase()}.`)
      // Reload
      setCorrections((prev) => prev.map((c) =>
        c.id === id
          ? { ...c, status: decision, reviewer_remarks: remarks, reviewed_at: new Date().toISOString() }
          : c
      ))
    } catch (e) {
      setError((e as Error).message)
    }
    setReviewing(null)
  }

  if (loading) return <div className="page"><div className="loading-state">Loading…</div></div>
  if (!canManage && !canRequest) {
    return <div className="page"><div className="empty-state"><div className="empty-state-text">You do not have permission to view corrections.</div></div></div>
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Attendance Corrections</h2>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}
      {success && <div className="form-success" style={{ marginBottom: '12px' }}>{success}</div>}

      <div className="card">
        <div className="card-header">
          {canManage ? 'All Correction Requests' : 'My Correction Requests'}
        </div>
        {corrections.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No correction requests.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {canManage && <th>Employee</th>}
                  <th>Type</th><th>Reason</th>
                  <th>Req. Check-In</th><th>Req. Check-Out</th>
                  <th>Status</th><th>Requested</th><th>Reviewed</th>
                  {canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {corrections.map((c) => (
                  <tr key={c.id}>
                    {canManage && <td>{c.employees?.full_name ?? '—'} <span className="mono" style={{ fontSize: '11px', color: 'var(--slate)' }}>({c.employees?.employee_code ?? '—'})</span></td>}
                    <td>{CORRECTION_TYPE_LABELS[c.correction_type as CorrectionType] ?? c.correction_type}</td>
                    <td style={{ maxWidth: '200px', fontSize: '12px' }}>{c.reason}</td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{c.requested_check_in_at ? formatDate(c.requested_check_in_at) : '—'}</td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{c.requested_check_out_at ? formatDate(c.requested_check_out_at) : '—'}</td>
                    <td><span className={`attendance-badge ${c.status.toLowerCase()}`}>{CORRECTION_STATUS_LABELS[c.status as CorrectionStatus] ?? c.status}</span></td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{formatDate(c.created_at)}</td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{c.reviewed_at ? formatDate(c.reviewed_at) : '—'}</td>
                    {canManage && (
                      <td>
                        {c.status === 'PENDING' ? (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button className="btn btn-sm" onClick={() => handleReview(c.id, 'APPROVED')} disabled={reviewing === c.id}>Approve</button>
                            <button className="btn btn-sm btn-danger" onClick={() => handleReview(c.id, 'REJECTED')} disabled={reviewing === c.id}>Reject</button>
                          </div>
                        ) : '—'}
                      </td>
                    )}
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
