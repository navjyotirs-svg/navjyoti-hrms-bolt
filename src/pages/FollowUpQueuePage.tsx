import { useEffect, useState } from 'react'
import { fetchFollowUps, resolveFollowUp, closeFollowUp, type FollowUpRow } from '@/lib/dailyReports'
import '@/styles/shared.css'

export function FollowUpQueuePage() {
  const [followUps, setFollowUps] = useState<FollowUpRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [resolution, setResolution] = useState<Record<string, string>>({})

  useEffect(() => { loadFollowUps() }, [statusFilter])

  async function loadFollowUps() {
    setLoading(true); setError(null)
    try {
      const data = await fetchFollowUps(statusFilter !== 'all' ? { status: statusFilter } : undefined)
      setFollowUps(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  async function handleResolve(id: string) {
    if (!resolution[id]?.trim()) { setError('Resolution text required'); return }
    setActionLoading(id)
    try {
      await resolveFollowUp(id, resolution[id])
      setResolution({ ...resolution, [id]: '' })
      await loadFollowUps()
    } catch (e) { setError((e as Error).message) }
    setActionLoading(null)
  }

  async function handleClose(id: string) {
    setActionLoading(id)
    try {
      await closeFollowUp(id, resolution[id])
      setResolution({ ...resolution, [id]: '' })
      await loadFollowUps()
    } catch (e) { setError((e as Error).message) }
    setActionLoading(null)
  }

  const priorityColors: Record<string, string> = { low: 'tag-low', medium: 'tag-medium', high: 'tag-high', critical: 'tag-critical' }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Follow-up Queue</h2>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      <div className="card">
        <div className="form-field" style={{ marginBottom: 'var(--space-4)', maxWidth: '200px' }}>
          <label htmlFor="fu-status">Status Filter</label>
          <select id="fu-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="assigned">Assigned</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {loading ? (
          <div className="loading-state">Loading follow-ups…</div>
        ) : followUps.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No follow-ups found.</div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {followUps.map((fu) => (
              <div key={fu.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 'var(--space-3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                  <div>
                    <strong>{fu.subject}</strong>
                    <span className={`tag ${priorityColors[fu.priority] || 'tag-medium'}`} style={{ marginLeft: '8px' }}>{fu.priority}</span>
                  </div>
                  <span className={`attendance-badge ${fu.status}`}>{fu.status}</span>
                </div>
                <div style={{ marginBottom: 'var(--space-2)', fontSize: '0.875rem' }}>
                  <strong>Employee:</strong> {(fu as any).employees?.first_name} {(fu as any).employees?.last_name} ({(fu as any).employees?.employee_code})
                </div>
                {fu.description && <div style={{ marginBottom: 'var(--space-2)', fontSize: '0.875rem' }}>{fu.description}</div>}
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
                  Type: {fu.follow_up_type.replace(/_/g, ' ')} | Due: {fu.due_at ? new Date(fu.due_at).toLocaleDateString() : '—'}
                </div>

                {['open', 'assigned', 'in_progress'].includes(fu.status) && (
                  <>
                    <div className="form-field" style={{ marginTop: 'var(--space-2)' }}>
                      <input type="text" value={resolution[fu.id] || ''} onChange={(e) => setResolution({ ...resolution, [fu.id]: e.target.value })} placeholder="Resolution notes…" />
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                      <button className="btn btn-primary" onClick={() => handleResolve(fu.id)} disabled={actionLoading === fu.id}>Resolve</button>
                      <button className="btn btn-secondary" onClick={() => handleClose(fu.id)} disabled={actionLoading === fu.id}>Close</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
