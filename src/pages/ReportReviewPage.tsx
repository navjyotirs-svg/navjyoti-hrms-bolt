import { useEffect, useState } from 'react'
import { fetchPendingReviews, reviewReport, reopenReport, fetchTaskPhotos, createTaskPhotoSignedUrl, type DailyReportTaskPhoto } from '@/lib/dailyReports'
import { ListSkeleton } from '@/components/Skeleton'
import '@/styles/shared.css'

export function ReportReviewPage() {
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [comments, setComments] = useState<Record<string, string>>({})
  const [photoMap, setPhotoMap] = useState<Record<string, DailyReportTaskPhoto[]>>({})
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<string | null>(null)

  useEffect(() => { loadReports() }, [])

  async function loadReports() {
    setLoading(true); setError(null)
    try {
      const data = await fetchPendingReviews()
      setReports(data)
      const pMap: Record<string, DailyReportTaskPhoto[]> = {}
      const uMap: Record<string, string> = {}
      await Promise.all(data.map(async (r: any) => {
        const list = await fetchTaskPhotos(r.id)
        pMap[r.id] = list
        await Promise.all(list.map(async p => {
          const url = await createTaskPhotoSignedUrl(p.storage_path)
          if (url) uMap[p.id] = url
        }))
      }))
      setPhotoMap(pMap)
      setPhotoUrls(uMap)
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
          <ListSkeleton rows={6} avatar />
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

                {/* Photos */}
                <div style={{ marginTop: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                  <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                    Photos {(photoMap[r.id] || []).length > 0 && `(${photoMap[r.id].length})`}
                  </h4>
                  {(photoMap[r.id] || []).length === 0 ? (
                    <div style={{ fontSize: '13px', color: 'var(--slate)' }}>No photos attached to this report.</div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 'var(--space-2)' }}>
                      {(photoMap[r.id] || []).map(p => (
                        <div
                          key={p.id}
                          onClick={() => photoUrls[p.id] && setLightbox(photoUrls[p.id])}
                          style={{ aspectRatio: '1', borderRadius: '6px', overflow: 'hidden', background: '#f0f0f0', cursor: photoUrls[p.id] ? 'zoom-in' : 'default' }}
                        >
                          {photoUrls[p.id] ? (
                            <img src={photoUrls[p.id]} alt={p.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'var(--slate)' }}>…</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

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

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, cursor: 'zoom-out' }}
        >
          <img src={lightbox} alt="Preview" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: '8px', objectFit: 'contain' }} />
        </div>
      )}
    </div>
  )
}
