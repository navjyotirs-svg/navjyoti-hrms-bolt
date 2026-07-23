import { useEffect, useState } from 'react'
import { fetchExportJobs, requestExport, getDownloadUrl, cancelExport, EXPORT_TYPES, type ExportJobRow } from '@/lib/exports'
import '@/styles/shared.css'

export function ExportCenterPage() {
  const [jobs, setJobs] = useState<ExportJobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [form, setForm] = useState({ export_type: 'daily_reports', format: 'csv', from_date: '', to_date: '' })

  useEffect(() => { loadJobs() }, [])

  async function loadJobs() {
    setLoading(true); setError(null)
    try {
      const { data } = await fetchExportJobs()
      setJobs(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  async function handleExport() {
    setActionLoading('new')
    try {
      const filters: Record<string, string> = {}
      if (form.from_date) filters.from_date = form.from_date
      if (form.to_date) filters.to_date = form.to_date
      await requestExport({ export_type: form.export_type, format: form.format, filters })
      await loadJobs()
    } catch (e) { setError((e as Error).message) }
    setActionLoading(null)
  }

  async function handleDownload(jobId: string) {
    try {
      const url = await getDownloadUrl(jobId)
      window.open(url, '_blank')
    } catch (e) { setError((e as Error).message) }
  }

  async function handleCancel(jobId: string) {
    try {
      await cancelExport(jobId)
      await loadJobs()
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Export Center</h2>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <h3 style={{ marginBottom: 'var(--space-3)' }}>Request New Export</h3>
        <div className="form-grid" style={{ marginBottom: 'var(--space-3)' }}>
          <div className="form-field">
            <label htmlFor="export-type">Export Type</label>
            <select id="export-type" value={form.export_type} onChange={(e) => setForm({ ...form, export_type: e.target.value })}>
              {EXPORT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="export-format">Format</label>
            <select id="export-format" value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
              <option value="csv">CSV</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="export-from">From Date</label>
            <input id="export-from" type="date" value={form.from_date} onChange={(e) => setForm({ ...form, from_date: e.target.value })} />
          </div>
          <div className="form-field">
            <label htmlFor="export-to">To Date</label>
            <input id="export-to" type="date" value={form.to_date} onChange={(e) => setForm({ ...form, to_date: e.target.value })} />
          </div>
        </div>
        <button className="btn btn-primary" onClick={handleExport} disabled={actionLoading === 'new'}>
          {actionLoading === 'new' ? 'Generating…' : 'Generate Export'}
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 'var(--space-3)' }}>Export History</h3>
        {loading ? (
          <div className="loading-state">Loading exports…</div>
        ) : jobs.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No exports yet.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Type</th><th>Format</th><th>Status</th><th>Requested</th><th>Completed</th><th>Expires</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{j.export_type.replace(/_/g, ' ')}</td>
                    <td className="mono">{j.format.toUpperCase()}</td>
                    <td><span className={`attendance-badge ${j.status}`}>{j.status}</span></td>
                    <td className="mono">{new Date(j.requested_at).toLocaleString()}</td>
                    <td className="mono">{j.completed_at ? new Date(j.completed_at).toLocaleString() : '—'}</td>
                    <td className="mono">{j.expires_at ? new Date(j.expires_at).toLocaleString() : '—'}</td>
                    <td>
                      {j.status === 'completed' && (
                        <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => handleDownload(j.id)}>Download</button>
                      )}
                      {['queued', 'processing'].includes(j.status) && (
                        <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => handleCancel(j.id)}>Cancel</button>
                      )}
                    </td>
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
