import { useEffect, useState } from 'react'
import { getKolkataDate, fetchTeamReports } from '@/lib/dailyReports'
import '@/styles/shared.css'

export function TeamReportsPage() {
  const [reportDate, setReportDate] = useState(getKolkataDate())
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { loadReports() }, [reportDate])

  async function loadReports() {
    setLoading(true); setError(null)
    try {
      const data = await fetchTeamReports(reportDate)
      setReports(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  const stats = {
    total: reports.length,
    submitted: reports.filter(r => r.status === 'submitted').length,
    approved: reports.filter(r => r.status === 'approved').length,
    draft: reports.filter(r => r.status === 'draft').length,
    late: reports.filter(r => r.status === 'late').length,
    returned: reports.filter(r => r.status === 'returned').length,
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
          <div className="loading-state">Loading team reports…</div>
        ) : reports.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No reports for this date.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th><th>Code</th><th>Status</th><th>Summary</th><th>Blockers</th><th>Follow-up</th><th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td>{r.employees?.first_name} {r.employees?.last_name}</td>
                    <td className="mono">{r.employees?.employee_code}</td>
                    <td><span className={`attendance-badge ${r.status}`}>{r.status}</span></td>
                    <td>{r.overall_summary?.slice(0, 60) || '—'}{r.overall_summary?.length > 60 ? '…' : ''}</td>
                    <td>{r.blockers ? 'Yes' : '—'}</td>
                    <td>{r.follow_up_required ? 'Yes' : '—'}</td>
                    <td className="mono">{r.submitted_at ? new Date(r.submitted_at).toLocaleTimeString() : '—'}</td>
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
