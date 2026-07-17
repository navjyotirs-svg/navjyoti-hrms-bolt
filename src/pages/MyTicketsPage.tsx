import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { TICKET_CATEGORY_LABELS, TICKET_STATUS_LABELS, TASK_PRIORITY_LABELS, type TicketCategory, type TicketStatus, type TaskPriority } from '@/types/roles'
import { fetchMyTickets, createTicket, formatTicketDate, type TicketRow } from '@/lib/tickets'
import '@/styles/shared.css'

export function MyTicketsPage() {
  const { permissions } = useAuth()
  const navigate = useNavigate()
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [form, setForm] = useState({
    category: 'OTHER' as TicketCategory,
    subject: '',
    description: '',
    priority: 'MEDIUM' as TaskPriority,
  })

  useEffect(() => { loadTickets() }, [])

  async function loadTickets() {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchMyTickets()
      setTickets(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.subject.trim() || !form.description.trim()) {
      setError('Subject and description are required')
      return
    }
    setCreateLoading(true)
    setError(null)
    try {
      await createTicket({
        category: form.category,
        subject: form.subject.trim(),
        description: form.description.trim(),
        priority: form.priority,
      })
      setForm({ category: 'OTHER', subject: '', description: '', priority: 'MEDIUM' })
      setShowCreate(false)
      await loadTickets()
    } catch (e) { setError((e as Error).message) }
    setCreateLoading(false)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">My Tickets</h2>
        {permissions.includes('ticket.create_self') && (
          <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>Raise Ticket</button>
        )}
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      {showCreate && (
        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <h3 className="card-title" style={{ marginBottom: 'var(--space-4)' }}>Raise New Ticket</h3>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="tk-cat">Category *</label>
                <select id="tk-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as TicketCategory })}>
                  {Object.entries(TICKET_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="tk-pri">Priority</label>
                <select id="tk-pri" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
                  {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="tk-sub">Subject *</label>
              <input id="tk-sub" type="text" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
            </div>
            <div className="form-field">
              <label htmlFor="tk-desc">Description *</label>
              <textarea id="tk-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} required />
            </div>
            <div>
              <button type="submit" className="btn btn-primary" disabled={createLoading}>
                {createLoading ? 'Creating…' : 'Create Ticket'}
              </button>
              <button type="button" className="btn btn-secondary" style={{ marginLeft: 'var(--space-2)' }} onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="loading-state">Loading tickets…</div>
        ) : tickets.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No tickets found.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Code</th><th>Subject</th><th>Category</th><th>Priority</th><th>Status</th><th>Created</th></tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/tickets/${t.id}`)}>
                    <td className="mono">{t.ticket_code}</td>
                    <td>{t.subject}</td>
                    <td>{TICKET_CATEGORY_LABELS[t.category as TicketCategory]}</td>
                    <td><span className={`tag tag-${t.priority.toLowerCase()}`}>{TASK_PRIORITY_LABELS[t.priority as TaskPriority]}</span></td>
                    <td><span className={`attendance-badge ${t.status.toLowerCase()}`}>{TICKET_STATUS_LABELS[t.status as TicketStatus]}</span></td>
                    <td className="mono">{formatTicketDate(t.created_at)}</td>
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
