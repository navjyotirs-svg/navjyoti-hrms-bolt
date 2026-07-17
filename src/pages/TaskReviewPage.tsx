import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type TaskRequestStatus, type SubmissionReviewStatus } from '@/types/roles'
import { TASK_REQUEST_TYPE_LABELS } from '@/types/roles'
import { fetchPendingActionRequests, fetchPendingSubmissions, reviewTaskRequest, reviewSubmission, formatDate, formatDateTime } from '@/lib/tasks'
import '@/styles/shared.css'

export function TaskReviewPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'requests' | 'submissions'>('requests')
  const [requests, setRequests] = useState<any[]>([])
  const [submissions, setSubmissions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [reviewRemarks, setReviewRemarks] = useState<Record<string, string>>({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [reqData, subData] = await Promise.all([
        fetchPendingActionRequests(),
        fetchPendingSubmissions(),
      ])
      setRequests(reqData)
      setSubmissions(subData)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  async function handleReviewRequest(requestId: string, decision: TaskRequestStatus) {
    setActionLoading(true)
    try {
      await reviewTaskRequest({
        request_id: requestId,
        decision,
        reviewer_remarks: reviewRemarks[requestId] || undefined,
      })
      setReviewRemarks({})
      await load()
    } catch (e) { setError((e as Error).message) }
    setActionLoading(false)
  }

  async function handleReviewSubmission(submissionId: string, decision: SubmissionReviewStatus) {
    setActionLoading(true)
    try {
      await reviewSubmission({
        submission_id: submissionId,
        decision,
        reviewer_feedback: reviewRemarks[submissionId] || undefined,
      })
      setReviewRemarks({})
      await load()
    } catch (e) { setError((e as Error).message) }
    setActionLoading(false)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Task Review</h2>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      <div className="card">
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
          <button className={`btn btn-sm ${tab === 'requests' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('requests')}>
            Change Requests ({requests.length})
          </button>
          <button className={`btn btn-sm ${tab === 'submissions' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('submissions')}>
            Submissions ({submissions.length})
          </button>
        </div>

        {loading ? (
          <div className="loading-state">Loading…</div>
        ) : tab === 'requests' ? (
          requests.length === 0 ? (
            <div className="empty-state"><div className="empty-state-text">No pending change requests.</div></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {requests.map((r) => (
                <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>{TASK_REQUEST_TYPE_LABELS[r.request_type as keyof typeof TASK_REQUEST_TYPE_LABELS]}</span>
                    <span className="mono" style={{ fontSize: '12px', color: 'var(--slate)' }}>{formatDate(r.created_at)}</span>
                  </div>
                  <p style={{ fontSize: '13px' }}>{r.tasks?.task_code}: {r.tasks?.title}</p>
                  <p style={{ fontSize: '13px', marginTop: 'var(--space-1)' }}>Reason: {r.reason}</p>
                  {r.proposed_target && <p style={{ fontSize: '13px', color: 'var(--slate)' }}>Proposed: {r.proposed_target} by {r.proposed_deadline}</p>}
                  <div className="form-field" style={{ marginTop: 'var(--space-2)' }}>
                    <label>Reviewer Remarks</label>
                    <textarea rows={2} value={reviewRemarks[r.id] || ''} onChange={(e) => setReviewRemarks({ ...reviewRemarks, [r.id]: e.target.value })} />
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                    <button className="btn btn-sm btn-primary" onClick={() => handleReviewRequest(r.id, 'APPROVED')} disabled={actionLoading}>Approve</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => handleReviewRequest(r.id, 'REJECTED')} disabled={actionLoading}>Reject</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => handleReviewRequest(r.id, 'RETURNED_FOR_DETAILS')} disabled={actionLoading}>Return</button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          submissions.length === 0 ? (
            <div className="empty-state"><div className="empty-state-text">No pending submissions.</div></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {submissions.map((s) => (
                <div key={s.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>{s.tasks?.task_code}: {s.tasks?.title}</span>
                    <span className="mono" style={{ fontSize: '12px', color: 'var(--slate)' }}>{formatDateTime(s.submitted_at)}</span>
                  </div>
                  <p style={{ fontSize: '13px' }}>{s.result_summary}</p>
                  {s.submission_note && <p style={{ fontSize: '13px', color: 'var(--slate)', marginTop: 'var(--space-1)' }}>{s.submission_note}</p>}
                  <div className="form-field" style={{ marginTop: 'var(--space-2)' }}>
                    <label>Reviewer Feedback</label>
                    <textarea rows={2} value={reviewRemarks[s.id] || ''} onChange={(e) => setReviewRemarks({ ...reviewRemarks, [s.id]: e.target.value })} />
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                    <button className="btn btn-sm btn-primary" onClick={() => handleReviewSubmission(s.id, 'APPROVED')} disabled={actionLoading}>Approve</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => handleReviewSubmission(s.id, 'REVISION_REQUIRED')} disabled={actionLoading}>Revision</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => handleReviewSubmission(s.id, 'REJECTED')} disabled={actionLoading}>Reject</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => navigate(`/tasks/${s.task_id}`)}>View Task</button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
