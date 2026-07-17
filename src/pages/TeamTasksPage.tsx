import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { TASK_STATUS_LABELS, TASK_PRIORITY_LABELS, type TaskStatus, type TaskPriority } from '@/types/roles'
import { fetchTeamTasks, formatDate, type TaskWithAssignments } from '@/lib/tasks'
import '@/styles/shared.css'

export function TeamTasksPage() {
  const navigate = useNavigate()
  const { permissions } = useAuth()
  const [tasks, setTasks] = useState<TaskWithAssignments[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => { loadTasks() }, [])

  async function loadTasks() {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchTeamTasks()
      setTasks(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  const filtered = tasks.filter((t) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || t.title.toLowerCase().includes(q) || t.task_code.toLowerCase().includes(q)
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Team Tasks</h2>
        {permissions.includes('task.create') && (
          <button className="btn btn-primary" onClick={() => navigate('/tasks/create')}>Assign New Task</button>
        )}
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      <div className="card">
        <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="form-field">
            <label htmlFor="tt-search">Search</label>
            <input id="tt-search" type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Task code or title" />
          </div>
          <div className="form-field">
            <label htmlFor="tt-status">Status</label>
            <select id="tt-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="loading-state">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No tasks found.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Code</th><th>Title</th><th>Priority</th><th>Status</th><th>Deadline</th><th>Outcome</th></tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/tasks/${t.id}`)}>
                    <td className="mono">{t.task_code}</td>
                    <td>{t.title}</td>
                    <td><span className={`tag tag-${t.priority.toLowerCase()}`}>{TASK_PRIORITY_LABELS[t.priority as TaskPriority]}</span></td>
                    <td><span className={`attendance-badge ${t.status.toLowerCase()}`}>{TASK_STATUS_LABELS[t.status as TaskStatus]}</span></td>
                    <td className="mono">{formatDate(t.current_deadline)}</td>
                    <td>{t.completion_outcome || '—'}</td>
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
