import { useEffect, useState } from 'react'
import { fetchPendingReviews, reviewReport, reopenReport } from '@/lib/dailyReports'
import '@/styles/shared.css'

export function ReportReviewPage() {
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [comments, setComments] = useState<Record<string, string>>({})

  useEffect(() => { loadReports() }, [])

  async function loadReports() {
    setLoading(true); setError(null)
    try {
      const data = await fetchPendingReviews()
      setReports(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  async function handleReview(reportId: string, decision: 'approved' | 'returned') {
    setActionLoading(reportId)
    try {
      await reviewReport({ report_id: reportId, decision, manager_comments: comments[reportId] })
      await loadReports()
    } catch (e) { setError((e as Error).message) }
    setActionLoading(null)
  }

  async function handleReopen(reportId: string) {
    setActionLoading(reportId)
    try {
      await reopenReport({ report_id: reportId, reason: comments[reportId] || 'Reopened for review' })
      await loadReports()
    } catch (e) { setError((e as Error).message) }
    setActionLoading(null)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Report Review</h2>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      <div className="card">
        {loading ? (
          <div className="loading-state">Loading pending reviews…</div>
        ) : reports.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No reports pending review.</div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {reports.map((r) => (
              <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 'var(--space-4)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                  <div>
                    <strong>{r.employees?.first_name} {r.employees?.last_name}</strong>
                    <span className="mono" style={{ marginLeft: '8px' }}>({r.employees?.employee_code})</span>
                  </div>
                  <span className="mono">{r.report_date}</span>
                </div>
                <div style={{ marginBottom: 'var(--space-2)' }}><strong>Summary:</strong> {r.overall_summary}</div>
                {r.work_completed && <div style={{ marginBottom: 'var(--space-2)' }}><strong>Work Completed:</strong> {r.work_completed}</div>}
                {r.blockers && <div style={{ marginBottom: 'var(--space-2)' }}><strong>Blockers:</strong> {r.blockers}</div>}
                {r.pending_work && <div style={{ marginBottom: 'var(--space-2)' }}><strong>Pending:</strong> {r.pending_work}</div>}
                {r.tomorrow_plan && <div style={{ marginBottom: 'var(--space-2)' }}><strong>Tomorrow:</strong> {r.tomorrow_plan}</div>}

                <div className="form-field" style={{ marginTop: 'var(--space-3)' }}>
                  <label htmlFor={`comment-${r.id}`}>Manager Comments</label>
                  <textarea id={`comment-${r.id}`} rows={2} value={comments[r.id] || ''} onChange={(e) => setComments({ ...comments, [r.id]: e.target.value })} placeholder="Feedback for the employee" />
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                  <button className="btn btn-primary" onClick={() => handleReview(r.id, 'approved')} disabled={actionLoading === r.id}>Approve</button>
                  <button className="btn btn-secondary" onClick={() => handleReview(r.id, 'returned')} disabled={actionLoading === r.id}>Return</button>
                  <button className="btn btn-secondary" onClick={() => handleReopen(r.id)} disabled={actionLoading === r.id}>Reopen</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
