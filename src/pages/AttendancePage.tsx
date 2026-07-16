import { useEffect, useState, useCallback, useRef } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  checkIn,
  fetchTodayAttendance,
  fetchAttendanceHistory,
  fetchAttendanceEvidence,
  requestCorrection,
  formatTimeRemaining,
  formatTimestamp,
  formatDate,
  type AttendanceRecord,
  type AttendanceEvidence,
  type AttendanceCorrection,
} from '@/lib/attendance'
import { ATTENDANCE_STATUS_LABELS, CORRECTION_TYPE_LABELS, type AttendanceStatus } from '@/types/roles'
import { CheckoutModal } from '@/components/CheckoutModal'
import '@/styles/attendance.css'

type Tab = 'today' | 'history' | 'corrections'

export function AttendancePage() {
  const { profile, permissions } = useAuth()
  const [tab, setTab] = useState<Tab>('today')
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null)
  const [history, setHistory] = useState<AttendanceRecord[]>([])
  const [corrections, setCorrections] = useState<AttendanceCorrection[]>([])
  const [evidence, setEvidence] = useState<AttendanceEvidence[]>([])
  const [loading, setLoading] = useState(true)
  const [checkingIn, setCheckingIn] = useState(false)
  const [showCheckout, setShowCheckout] = useState(false)
  const [showCorrection, setShowCorrection] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [remaining, setRemaining] = useState('00:00:00')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const canCheckIn = permissions.includes('attendance.check_in_self')
  const canCheckOut = permissions.includes('attendance.check_out_self')
  const canCorrect = permissions.includes('attendance.correct_request_self')

  const loadToday = useCallback(async () => {
    if (!profile?.id) return
    try {
      const { data: empData } = await supabase
        .from('employees')
        .select('id')
        .eq('user_id', profile.id)
        .maybeSingle()
      const emp = (empData as { id: string } | null)?.id ?? null
      if (!emp) { setLoading(false); return }
      const rec = await fetchTodayAttendance(emp)
      setTodayRecord(rec)
      if (rec) {
        const ev = await fetchAttendanceEvidence(rec.id)
        setEvidence(ev)
      }
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [profile?.id])

  useEffect(() => {
    loadToday()
  }, [loadToday])

  useEffect(() => {
    if (todayRecord?.final_status === 'PENDING_CHECKOUT' && todayRecord.required_checkout_at) {
      const update = () => setRemaining(formatTimeRemaining(todayRecord.required_checkout_at))
      update()
      timerRef.current = setInterval(update, 1000)
      return () => { if (timerRef.current) clearInterval(timerRef.current) }
    }
  }, [todayRecord])

  async function getEmployeeId(userId: string): Promise<string | null> {
    const { data } = await supabase
      .from('employees')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle()
    return (data as { id: string } | null)?.id ?? null
  }

  async function handleCheckIn() {
    setError(null)
    setSuccess(null)
    setCheckingIn(true)
    try {
      await checkIn()
      setSuccess('Checked in successfully!')
      await loadToday()
    } catch (e) {
      setError((e as Error).message)
    }
    setCheckingIn(false)
  }

  function handleCheckoutSuccess(result: { final_status: string; elapsed_minutes: number }) {
    setShowCheckout(false)
    setSuccess(`Checked out! Status: ${ATTENDANCE_STATUS_LABELS[result.final_status as AttendanceStatus] ?? result.final_status}`)
    loadToday()
  }

  async function loadHistory() {
    if (!profile?.id) return
    try {
      const emp = await getEmployeeId(profile.id)
      if (!emp) return
      const hist = await fetchAttendanceHistory(emp, 30)
      setHistory(hist)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function loadCorrections() {
    if (!profile?.id) return
    try {
      const emp = await getEmployeeId(profile.id)
      if (!emp) return
      const { data } = await supabase
        .from('attendance_corrections')
        .select('*')
        .eq('employee_id', emp)
        .order('created_at', { ascending: false })
      setCorrections((data ?? []) as AttendanceCorrection[])
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    if (tab === 'history' && history.length === 0) loadHistory()
    if (tab === 'corrections' && corrections.length === 0) loadCorrections()
  }, [tab])

  const today = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })

  if (loading) return <div className="page"><div className="loading-state">Loading…</div></div>

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">My Attendance</h2>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}
      {success && <div className="form-success" style={{ marginBottom: '12px' }}>{success}</div>}

      <div className="attendance-tabs">
        <button className={`attendance-tab ${tab === 'today' ? 'active' : ''}`} onClick={() => setTab('today')}>Today</button>
        <button className={`attendance-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>History</button>
        <button className={`attendance-tab ${tab === 'corrections' ? 'active' : ''}`} onClick={() => setTab('corrections')}>Corrections</button>
      </div>

      {tab === 'today' && (
        <div className="attendance-today">
          <div className="attendance-date-card">
            <div className="attendance-date-label">Today</div>
            <div className="attendance-date-value">{today}</div>
          </div>

          {!todayRecord && (
            <div className="attendance-action-card">
              <p className="attendance-no-record">You have not checked in yet.</p>
              {canCheckIn && (
                <button className="btn btn-checkin" onClick={handleCheckIn} disabled={checkingIn}>
                  {checkingIn ? 'Checking in…' : 'Check In'}
                </button>
              )}
            </div>
          )}

          {todayRecord && (
            <>
              <div className="attendance-status-grid">
                <div className="attendance-status-card">
                  <div className="attendance-status-label">Check-In Time</div>
                  <div className="attendance-status-value mono">{formatTimestamp(todayRecord.check_in_at)}</div>
                </div>
                <div className="attendance-status-card">
                  <div className="attendance-status-label">Required Checkout</div>
                  <div className="attendance-status-value mono">{formatTimestamp(todayRecord.required_checkout_at)}</div>
                </div>
                <div className="attendance-status-card">
                  <div className="attendance-status-label">Current Status</div>
                  <div className="attendance-status-value">
                    <span className={`attendance-badge ${todayRecord.final_status.toLowerCase()}`}>
                      {ATTENDANCE_STATUS_LABELS[todayRecord.final_status as AttendanceStatus] ?? todayRecord.final_status}
                    </span>
                  </div>
                </div>
                <div className="attendance-status-card">
                  <div className="attendance-status-label">Evidence</div>
                  <div className="attendance-status-value">
                    {evidence.length > 0
                      ? <span className="attendance-badge evidence-yes">Captured</span>
                      : <span className="attendance-badge evidence-no">Not captured</span>}
                  </div>
                </div>
              </div>

              {todayRecord.final_status === 'PENDING_CHECKOUT' && (
                <div className="attendance-timer-section">
                  <div className="attendance-timer-label">Time Remaining</div>
                  <div className="attendance-timer mono">{remaining}</div>
                  <p className="attendance-timer-note">
                    {remaining === '00:00:00'
                      ? 'You have completed the required attendance duration.'
                      : 'Checkout before the required time will mark attendance as Half Day.'}
                  </p>
                  {canCheckOut && (
                    <button className="btn btn-checkout" onClick={() => setShowCheckout(true)}>
                      Check Out
                    </button>
                  )}
                </div>
              )}

              {todayRecord.final_status !== 'PENDING_CHECKOUT' && (
                <div className="attendance-result-section">
                  <div className="attendance-result-row">
                    <span>Final Duration</span>
                    <span className="mono">{todayRecord.actual_elapsed_minutes ?? '—'} minutes</span>
                  </div>
                  <div className="attendance-result-row">
                    <span>Final Status</span>
                    <span className={`attendance-badge ${todayRecord.final_status.toLowerCase()}`}>
                      {ATTENDANCE_STATUS_LABELS[todayRecord.final_status as AttendanceStatus] ?? todayRecord.final_status}
                    </span>
                  </div>
                  {todayRecord.status_reason && (
                    <div className="attendance-result-row">
                      <span>Reason</span>
                      <span style={{ fontSize: '12px', color: 'var(--slate)' }}>{todayRecord.status_reason}</span>
                    </div>
                  )}
                  {canCorrect && (
                    <button className="btn btn-sm btn-secondary" onClick={() => setShowCorrection(true)} style={{ marginTop: '8px' }}>
                      Request Correction
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="card">
          <div className="card-header">Attendance History (Last 30 Days)</div>
          {history.length === 0 ? (
            <div className="empty-state"><div className="empty-state-text">No attendance records.</div></div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Date</th><th>Check-In</th><th>Required Checkout</th><th>Actual Checkout</th><th>Elapsed</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {history.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{formatDate(r.attendance_date)}</td>
                      <td className="mono">{formatTimestamp(r.check_in_at)}</td>
                      <td className="mono">{formatTimestamp(r.required_checkout_at)}</td>
                      <td className="mono">{r.check_out_at ? formatTimestamp(r.check_out_at) : '—'}</td>
                      <td className="mono">{r.actual_elapsed_minutes ? `${r.actual_elapsed_minutes}m` : '—'}</td>
                      <td><span className={`attendance-badge ${r.final_status.toLowerCase()}`}>{ATTENDANCE_STATUS_LABELS[r.final_status as AttendanceStatus] ?? r.final_status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'corrections' && (
        <div className="card">
          <div className="card-header">Correction Requests</div>
          {corrections.length === 0 ? (
            <div className="empty-state"><div className="empty-state-text">No correction requests.</div></div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Type</th><th>Reason</th><th>Status</th><th>Requested</th><th>Reviewed</th></tr>
                </thead>
                <tbody>
                  {corrections.map((c) => (
                    <tr key={c.id}>
                      <td>{CORRECTION_TYPE_LABELS[c.correction_type as keyof typeof CORRECTION_TYPE_LABELS] ?? c.correction_type}</td>
                      <td style={{ maxWidth: '200px', fontSize: '12px' }}>{c.reason}</td>
                      <td><span className={`attendance-badge ${c.status.toLowerCase()}`}>{c.status}</span></td>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>{formatDate(c.created_at)}</td>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>{c.reviewed_at ? formatDate(c.reviewed_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showCheckout && todayRecord && (
        <CheckoutModal
          userId={profile!.id}
          onClose={() => setShowCheckout(false)}
          onSuccess={handleCheckoutSuccess}
        />
      )}

      {showCorrection && todayRecord && (
        <CorrectionModal
          recordId={todayRecord.id}
          onClose={() => setShowCorrection(false)}
          onSuccess={() => {
            setShowCorrection(false)
            setSuccess('Correction request submitted.')
            loadCorrections()
          }}
        />
      )}
    </div>
  )
}

function CorrectionModal({ recordId, onClose, onSuccess }: {
  recordId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [correctionType, setCorrectionType] = useState('missed_checkout')
  const [reason, setReason] = useState('')
  const [requestedCheckIn, setRequestedCheckIn] = useState('')
  const [requestedCheckOut, setRequestedCheckOut] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!reason.trim()) { setError('Reason is required'); return }
    setSubmitting(true)
    try {
      await requestCorrection({
        attendance_record_id: recordId,
        correction_type: correctionType,
        reason: reason.trim(),
        requested_check_in_at: requestedCheckIn || undefined,
        requested_check_out_at: requestedCheckOut || undefined,
      })
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    }
    setSubmitting(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">Request Correction<button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-field" style={{ marginBottom: '12px' }}>
              <label>Correction Type</label>
              <select value={correctionType} onChange={(e) => setCorrectionType(e.target.value)}>
                {Object.entries(CORRECTION_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ marginBottom: '12px' }}>
              <label>Requested Check-In Time (optional)</label>
              <input type="datetime-local" value={requestedCheckIn} onChange={(e) => setRequestedCheckIn(e.target.value)} />
            </div>
            <div className="form-field" style={{ marginBottom: '12px' }}>
              <label>Requested Check-Out Time (optional)</label>
              <input type="datetime-local" value={requestedCheckOut} onChange={(e) => setRequestedCheckOut(e.target.value)} />
            </div>
            <div className="form-field" style={{ marginBottom: '12px' }}>
              <label>Reason</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} required />
            </div>
            <button type="submit" className="btn" disabled={submitting} style={{ width: '100%' }}>
              {submitting ? 'Submitting…' : 'Submit Request'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
