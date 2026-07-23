import { useEffect, useState } from 'react'
import { getKolkataDate, fetchOrgSummary } from '@/lib/dailyReports'
import '@/styles/shared.css'

export function OrgDailySummaryPage() {
  const [reportDate, setReportDate] = useState(getKolkataDate())
  const [snapshots, setSnapshots] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { loadSummary() }, [reportDate])

  async function loadSummary() {
    setLoading(true); setError(null)
    try {
      const data = await fetchOrgSummary(reportDate)
      setSnapshots(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  const latest = snapshots[0]

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Org Daily Summary</h2>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      <div className="card">
        <div className="form-field" style={{ marginBottom: 'var(--space-4)', maxWidth: '200px' }}>
          <label htmlFor="summary-date">Date</label>
          <input id="summary-date" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
        </div>

        {loading ? (
          <div className="loading-state">Loading summary…</div>
        ) : !latest ? (
          <div className="empty-state"><div className="empty-state-text">No summary available for this date.</div></div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
              <div className="stat-card"><div className="stat-value">{latest.data_snapshot?.total_reports || 0}</div><div className="stat-label">Total Reports</div></div>
              <div className="stat-card"><div className="stat-value">{latest.data_snapshot?.submitted || 0}</div><div className="stat-label">Submitted</div></div>
              <div className="stat-card"><div className="stat-value">{latest.data_snapshot?.approved || 0}</div><div className="stat-label">Approved</div></div>
              <div className="stat-card"><div className="stat-value">{latest.data_snapshot?.late || 0}</div><div className="stat-label">Late</div></div>
              <div className="stat-card"><div className="stat-value">{latest.data_snapshot?.missing || 0}</div><div className="stat-label">Missing</div></div>
              <div className="stat-card"><div className="stat-value">{latest.data_snapshot?.with_blockers || 0}</div><div className="stat-label">With Blockers</div></div>
              <div className="stat-card"><div className="stat-value">{latest.data_snapshot?.follow_ups_required || 0}</div><div className="stat-label">Follow-ups Required</div></div>
            </div>

            <div style={{ marginBottom: 'var(--space-3)' }}>
              <strong>Generated at:</strong> <span className="mono">{new Date(latest.generated_at).toLocaleString()}</span>
            </div>
            <div>
              <strong>Checksum:</strong> <span className="mono" style={{ fontSize: '0.75rem' }}>{latest.checksum}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
