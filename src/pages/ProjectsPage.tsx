import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { fetchProjects, createProject, changeProjectStatus, archiveProject, type ProjectRow } from '@/lib/projects'
import { TableSkeleton, MetricCardSkeleton } from '@/components/Skeleton'
import { PROJECT_STATUS_LABELS, type ProjectStatus } from '@/types/roles'
import '@/styles/shared.css'

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
type Priority = (typeof PRIORITIES)[number]

const STATUS_TAG_CLASS: Record<ProjectStatus, string> = {
  DRAFT: 'tag-gray',
  ACTIVE: 'tag-teal',
  ON_HOLD: 'tag-amber',
  COMPLETED: 'tag-ink',
  CANCELLED: 'tag-rose',
  ARCHIVED: 'tag-gray',
}

const PRIORITY_TAG_CLASS: Record<Priority, string> = {
  LOW: 'tag-gray',
  MEDIUM: 'tag-teal',
  HIGH: 'tag-amber',
  CRITICAL: 'tag-rose',
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface CreateForm {
  project_name: string
  description: string
  priority: Priority
  start_date: string
  expected_end_date: string
}

const EMPTY_FORM: CreateForm = {
  project_name: '',
  description: '',
  priority: 'MEDIUM',
  start_date: '',
  expected_end_date: '',
}

export function ProjectsPage() {
  const { permissions } = useAuth()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const canCreate = permissions.includes('project.create')
  const canUpdate = permissions.includes('project.update_team') || permissions.includes('project.update_all')
  const canArchive = permissions.includes('project.archive')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchProjects()
      setProjects(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!form.project_name.trim()) return
    setSubmitting(true)
    setActionError(null)
    try {
      await createProject({
        project_name: form.project_name.trim(),
        description: form.description.trim() || undefined,
        priority: form.priority,
        start_date: form.start_date || undefined,
        expected_end_date: form.expected_end_date || undefined,
      })
      setShowModal(false)
      setForm(EMPTY_FORM)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create project')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleStatusChange(projectId: string, newStatus: string) {
    setActionError(null)
    try {
      await changeProjectStatus({ project_id: projectId, new_status: newStatus })
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  async function handleArchive(projectId: string) {
    if (!confirm('Archive this project? It will be hidden from active lists.')) return
    setActionError(null)
    try {
      await archiveProject(projectId)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to archive project')
    }
  }

  const stats = {
    active: projects.filter((p) => p.status === 'ACTIVE').length,
    onHold: projects.filter((p) => p.status === 'ON_HOLD').length,
    completed: projects.filter((p) => p.status === 'COMPLETED').length,
    total: projects.length,
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Projects</h2>
        {canCreate && (
          <button className="btn btn-sm" onClick={() => setShowModal(true)}>+ Create Project</button>
        )}
      </div>

      {actionError && <div className="form-error">{actionError}</div>}

      <div className="kpi-grid">
        {loading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <div className="kpi-card">
              <div className="kpi-num">{stats.active}</div>
              <div className="kpi-lbl">Active Projects</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-num">{stats.onHold}</div>
              <div className="kpi-lbl">On Hold</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-num">{stats.completed}</div>
              <div className="kpi-lbl">Completed</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-num">{stats.total}</div>
              <div className="kpi-lbl">Total</div>
            </div>
          </>
        )}
      </div>

      <div className="card">
        {loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : error ? (
          <div className="empty-state">
            <div className="empty-state-text">{error}</div>
            <button className="btn btn-secondary" onClick={load} style={{ marginTop: 'var(--space-4)' }}>Retry</button>
          </div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">No projects yet. {canCreate && 'Create one to get started.'}</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Priority</th>
                  <th>Start Date</th>
                  <th>Expected End</th>
                  <th>Status</th>
                  {canUpdate && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.project_code}</strong></td>
                    <td>{p.project_name}</td>
                    <td><span className={`tag ${PRIORITY_TAG_CLASS[p.priority as Priority] ?? 'tag-gray'}`}>{p.priority}</span></td>
                    <td>{formatDate(p.start_date)}</td>
                    <td>{formatDate(p.expected_end_date)}</td>
                    <td><span className={`tag ${STATUS_TAG_CLASS[p.status]}`}>{PROJECT_STATUS_LABELS[p.status]}</span></td>
                    {canUpdate && (
                      <td>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {p.status !== 'ACTIVE' && (
                            <button className="btn btn-sm btn-secondary" onClick={() => handleStatusChange(p.id, 'ACTIVE')}>Activate</button>
                          )}
                          {p.status !== 'ON_HOLD' && (
                            <button className="btn btn-sm btn-secondary" onClick={() => handleStatusChange(p.id, 'ON_HOLD')}>On Hold</button>
                          )}
                          {p.status !== 'COMPLETED' && (
                            <button className="btn btn-sm btn-secondary" onClick={() => handleStatusChange(p.id, 'COMPLETED')}>Complete</button>
                          )}
                          {canArchive && p.status !== 'ARCHIVED' && (
                            <button className="btn btn-sm btn-secondary" onClick={() => handleArchive(p.id)}>Archive</button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="modal">
            <div className="modal-header">
              Create Project
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleCreate}>
                <div className="form-grid">
                  <div className="form-field form-field-full">
                    <label htmlFor="proj-name">Project Name *</label>
                    <input id="proj-name" value={form.project_name} onChange={(e) => setForm({ ...form, project_name: e.target.value })} required />
                  </div>
                  <div className="form-field form-field-full">
                    <label htmlFor="proj-desc">Description</label>
                    <textarea id="proj-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label htmlFor="proj-priority">Priority</label>
                    <select id="proj-priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="proj-start">Start Date</label>
                    <input id="proj-start" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                  </div>
                  <div className="form-field form-field-full">
                    <label htmlFor="proj-end">Expected End Date</label>
                    <input id="proj-end" type="date" value={form.expected_end_date} onChange={(e) => setForm({ ...form, expected_end_date: e.target.value })} />
                  </div>
                </div>
                {actionError && <div className="form-error" style={{ marginTop: 'var(--space-3)' }}>{actionError}</div>}
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={submitting}>Cancel</button>
                  <button type="submit" className="btn" disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
