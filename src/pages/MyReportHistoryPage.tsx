import { useEffect, useState } from 'react'
import { fetchMyReportHistory, type DailyReportRow } from '@/lib/dailyReports'
import '@/styles/shared.css'

export function MyReportHistoryPage() {
  const [reports, setReports] = useState<DailyReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(0)
  const pageSize = 20

  useEffect(() => { loadHistory() }, [page])

  async function loadHistory() {
    setLoading(true); setError(null)
    try {
      const { data, count: total } = await fetchMyReportHistory(page, pageSize)
      setReports(data); setCount(total)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  const totalPages = Math.ceil(count / pageSize)

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Report History</h2>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      <div className="card">
        {loading ? (
          <div className="loading-state">Loading history…</div>
        ) : reports.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No reports submitted yet.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th><th>Status</th><th>Summary</th><th>Blockers</th><th>Submitted At</th><th>Reviewed At</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.report_date}</td>
                    <td><span className={`attendance-badge ${r.status}`}>{r.status}</span></td>
                    <td>{r.overall_summary?.slice(0, 80) || '—'}{r.overall_summary?.length > 80 ? '…' : ''}</td>
                    <td>{r.blockers ? 'Yes' : '—'}</td>
                    <td className="mono">{r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '—'}</td>
                    <td className="mono">{r.reviewed_at ? new Date(r.reviewed_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)', alignItems: 'center' }}>
            <button className="btn btn-secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</button>
            <span>Page {page} of {totalPages}</span>
            <button className="btn btn-secondary" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</button>
          </div>
        )}
      </div>
    </div>
  )
}
