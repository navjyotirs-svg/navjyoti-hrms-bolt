import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { TASK_STATUS_LABELS, TASK_PRIORITY_LABELS, type TaskStatus, type TaskPriority } from '@/types/roles'
import {
  fetchTeamTasks,
  formatDeadline,
  formatDeadlineShort,
  getAssigneeInitials,
  formatTaskCost,
  type TaskWithAssignments,
  type TaskAssignmentWithEmployee,
} from '@/lib/tasks'
import { TaskSkeleton } from '@/components/Skeleton'
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

  function AssigneeBadges({ assignments }: { assignments: TaskAssignmentWithEmployee[] }) {
    const current = assignments.filter((a) => a.is_current && a.assignment_type === 'PRIMARY')
    if (current.length === 0) return <span style={{ color: 'var(--slate)' }}>—</span>
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
        {current.slice(0, 3).map((a) => {
          const name = a.employees?.full_name || '?'
          const code = a.employees?.employee_code || ''
          return (
            <span
              key={a.id}
              title={`${name} (${code})${a.employees?.designation ? ' — ' + a.employees.designation : ''}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                padding: '2px 8px', borderRadius: '12px',
                background: 'var(--paper)', border: '1px solid var(--border)',
                fontSize: '12px', whiteSpace: 'nowrap',
              }}
            >
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '20px', height: '20px', borderRadius: '50%',
                background: 'var(--teal)', color: 'white', fontSize: '10px', fontWeight: 600,
              }}>{getAssigneeInitials(name)}</span>
              {name}
            </span>
          )
        })}
        {current.length > 3 && (
          <span style={{ fontSize: '12px', color: 'var(--slate)' }}>+{current.length - 3}</span>
        )}
      </div>
    )
  }

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
          <TaskSkeleton />
        ) : filtered.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No tasks found.</div></div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="table-wrap team-tasks-desktop">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Title</th>
                    <th>Project</th>
                    <th>Assignee(s)</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Deadline</th>
                    <th>Cost</th>
                    <th>Outcome</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/tasks/${t.id}`)}>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>{t.task_code}</td>
                      <td>{t.title}</td>
                      <td>{t.projects?.project_name || '—'}</td>
                      <td><AssigneeBadges assignments={t.task_assignments || []} /></td>
                      <td><span className={`tag tag-${t.priority.toLowerCase()}`}>{TASK_PRIORITY_LABELS[t.priority as TaskPriority]}</span></td>
                      <td><span className={`attendance-badge ${t.status.toLowerCase()}`}>{TASK_STATUS_LABELS[t.status as TaskStatus]}</span></td>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>{formatDeadlineShort(t.deadline_at, t.current_deadline)}</td>
                      <td className="mono">{formatTaskCost(t.task_cost, t.task_cost_currency)}</td>
                      <td>{t.completion_outcome || '—'}</td>
                      <td>
                        <button className="btn-sm" onClick={(e) => { e.stopPropagation(); navigate(`/tasks/${t.id}`) }}>View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="team-tasks-mobile">
              {filtered.map((t) => (
                <div key={t.id} className="task-card-mobile" onClick={() => navigate(`/tasks/${t.id}`)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <span className="mono" style={{ fontSize: '12px', color: 'var(--slate)' }}>{t.task_code}</span>
                    <span className={`attendance-badge ${t.status.toLowerCase()}`} style={{ fontSize: '11px' }}>
                      {TASK_STATUS_LABELS[t.status as TaskStatus]}
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, marginBottom: '4px' }}>{t.title}</div>
                  {t.projects?.project_name && (
                    <div style={{ fontSize: '12px', color: 'var(--slate)', marginBottom: '4px' }}>{t.projects.project_name}</div>
                  )}
                  <div style={{ marginBottom: '8px' }}>
                    <AssigneeBadges assignments={t.task_assignments || []} />
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-3)', fontSize: '12px', flexWrap: 'wrap' }}>
                    <span><span className={`tag tag-${t.priority.toLowerCase()}`}>{TASK_PRIORITY_LABELS[t.priority as TaskPriority]}</span></span>
                    <span className="mono">{formatDeadline(t.deadline_at, t.current_deadline)}</span>
                    {t.task_cost != null && <span className="mono">{formatTaskCost(t.task_cost, t.task_cost_currency)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
