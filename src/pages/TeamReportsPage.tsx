import { useEffect, useState } from 'react'
import {
  getKolkataDate, fetchTeamReports,
  fetchTaskPhotos, createTaskPhotoSignedUrl,
  type DailyReportTaskPhoto,
} from '@/lib/dailyReports'
import { TableSkeleton } from '@/components/Skeleton'
import '@/styles/shared.css'

export function TeamReportsPage() {
  const [reportDate, setReportDate] = useState(getKolkataDate())
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [photoMap, setPhotoMap] = useState<Record<string, DailyReportTaskPhoto[]>>({})
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<string | null>(null)

  useEffect(() => { loadReports() }, [reportDate])

  async function loadReports() {
    setLoading(true); setError(null)
    try {
      const data = await fetchTeamReports(reportDate)
      setReports(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  async function toggleExpand(reportId: string) {
    if (expanded === reportId) { setExpanded(null); return }
    setExpanded(reportId)
    if (photoMap[reportId]) return
    try {
      const list = await fetchTaskPhotos(reportId)
      setPhotoMap(prev => ({ ...prev, [reportId]: list }))
      const urls: Record<string, string> = {}
      await Promise.all(list.map(async p => {
        const url = await createTaskPhotoSignedUrl(p.storage_path)
        if (url) urls[p.id] = url
      }))
      setPhotoUrls(prev => ({ ...prev, ...urls }))
    } catch { /* best-effort */ }
  }

  const stats = {
    total: reports.length,
    submitted: reports.filter(r => r.status === 'SUBMITTED').length,
    approved: reports.filter(r => r.status === 'REVIEWED').length,
    draft: reports.filter(r => r.status === 'DRAFT').length,
    late: reports.filter(r => r.status === 'LATE').length,
    returned: reports.filter(r => r.status === 'RETURNED_FOR_CORRECTION').length,
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Team Reports</h2>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      <div className="card">
        <div className="form-field" style={{ marginBottom: 'var(--space-4)', maxWidth: '200px' }}>
          <label htmlFor="team-date">Date</label>
          <input id="team-date" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
        </div>

        {!loading && reports.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
            <div className="stat-card"><div className="stat-value">{stats.total}</div><div className="stat-label">Total</div></div>
            <div className="stat-card"><div className="stat-value">{stats.submitted}</div><div className="stat-label">Submitted</div></div>
            <div className="stat-card"><div className="stat-value">{stats.approved}</div><div className="stat-label">Approved</div></div>
            <div className="stat-card"><div className="stat-value">{stats.draft}</div><div className="stat-label">Draft</div></div>
            <div className="stat-card"><div className="stat-value">{stats.late}</div><div className="stat-label">Late</div></div>
            <div className="stat-card"><div className="stat-value">{stats.returned}</div><div className="stat-label">Returned</div></div>
          </div>
        )}

        {loading ? (
          <TableSkeleton rows={8} cols={7} />
        ) : reports.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No reports for this date.</div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {reports.map((r) => (
              <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                {/* Row header — click to expand */}
                <div
                  onClick={() => toggleExpand(r.id)}
                  style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto auto auto', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-3)', cursor: 'pointer', background: expanded === r.id ? 'var(--surface)' : 'white' }}
                >
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>
                    {r.employees?.full_name}
                    <span className="mono" style={{ marginLeft: '8px', fontWeight: 400, fontSize: '12px', color: 'var(--slate)' }}>{r.employees?.employee_code}</span>
                  </div>
                  <span className={`attendance-badge ${r.status}`}>{r.status}</span>
                  <span style={{ fontSize: '12px', color: 'var(--slate)' }}>{r.follow_up_required ? 'Follow-up' : ''}</span>
                  <span style={{ fontSize: '12px', color: 'var(--slate)' }}>
                    {r.submitted_at ? new Date(r.submitted_at).toLocaleTimeString() : '—'}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--teal)', minWidth: '60px' }}>
                    {photoMap[r.id] ? `${photoMap[r.id].length} photo${photoMap[r.id].length !== 1 ? 's' : ''}` : 'Photos'}
                  </span>
                  <span style={{ fontSize: '13px', color: 'var(--slate)' }}>{expanded === r.id ? '▲' : '▼'}</span>
                </div>

                {/* Expanded detail */}
                {expanded === r.id && (
                  <div style={{ padding: 'var(--space-3)', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
                    {r.overall_summary && <div style={{ marginBottom: 'var(--space-2)', fontSize: '14px' }}><strong>Summary:</strong> {r.overall_summary}</div>}
                    {r.work_completed && <div style={{ marginBottom: 'var(--space-2)', fontSize: '14px' }}><strong>Work Completed:</strong> {r.work_completed}</div>}

                    {/* Photos */}
                    <div style={{ marginTop: 'var(--space-3)' }}>
                      <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: 'var(--space-2)' }}>
                        Photos {photoMap[r.id] ? `(${photoMap[r.id].length})` : ''}
                      </div>
                      {!photoMap[r.id] ? (
                        <div style={{ fontSize: '13px', color: 'var(--slate)' }}>Loading…</div>
                      ) : photoMap[r.id].length === 0 ? (
                        <div style={{ fontSize: '13px', color: 'var(--slate)' }}>No photos attached.</div>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 'var(--space-2)' }}>
                          {photoMap[r.id].map(p => (
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
                  </div>
                )}
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
