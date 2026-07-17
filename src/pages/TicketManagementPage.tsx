import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TICKET_CATEGORY_LABELS, TICKET_STATUS_LABELS, TASK_PRIORITY_LABELS, type TicketCategory, type TicketStatus, type TaskPriority } from '@/types/roles'
import { fetchTeamTickets, formatTicketDate, type TicketRow } from '@/lib/tickets'
import '@/styles/shared.css'

export function TicketManagementPage() {
  const navigate = useNavigate()
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => { loadTickets() }, [])

  async function loadTickets() {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchTeamTickets()
      setTickets(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  const filtered = tickets.filter((t) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || t.subject.toLowerCase().includes(q) || t.ticket_code.toLowerCase().includes(q)
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Ticket Management</h2>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      <div className="card">
        <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="form-field">
            <label htmlFor="tm-search">Search</label>
            <input id="tm-search" type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ticket code or subject" />
          </div>
          <div className="form-field">
            <label htmlFor="tm-status">Status</label>
            <select id="tm-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              {Object.entries(TICKET_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="loading-state">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No tickets found.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Code</th><th>Subject</th><th>Category</th><th>Priority</th><th>Status</th><th>SLA Due</th><th>Created</th></tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/tickets/${t.id}`)}>
                    <td className="mono">{t.ticket_code}</td>
                    <td>{t.subject}</td>
                    <td>{TICKET_CATEGORY_LABELS[t.category as TicketCategory]}</td>
                    <td><span className={`tag tag-${t.priority.toLowerCase()}`}>{TASK_PRIORITY_LABELS[t.priority as TaskPriority]}</span></td>
                    <td><span className={`attendance-badge ${t.status.toLowerCase()}`}>{TICKET_STATUS_LABELS[t.status as TicketStatus]}</span></td>
                    <td className="mono">{t.sla_due_at ? formatTicketDate(t.sla_due_at) : '—'}</td>
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
