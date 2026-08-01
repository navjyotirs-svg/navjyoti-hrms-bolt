import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  fetchRecurringTemplates,
  createRecurringTemplate,
  pauseRecurringTemplate,
  resumeRecurringTemplate,
  deactivateRecurringTemplate,
  type RecurringTaskTemplateRow,
} from '@/lib/recurringTasks'
import { fetchProjects, type ProjectRow } from '@/lib/projects'
import { TableSkeleton } from '@/components/Skeleton'
import { RECURRENCE_TYPE_LABELS, type RecurrenceType } from '@/types/roles'
import { getTaskPriorityStyle } from '@/lib/taskPriority'
import '@/styles/shared.css'

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
type Priority = (typeof PRIORITIES)[number]

interface Employee {
  id: string
  full_name: string
  employee_code: string | null
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function templateStatus(t: RecurringTaskTemplateRow): 'Active' | 'Paused' | 'Inactive' {
  if (!t.is_active) return 'Inactive'
  if (t.is_paused) return 'Paused'
  return 'Active'
}

function statusTagClass(status: 'Active' | 'Paused' | 'Inactive'): string {
  if (status === 'Active') return 'tag-teal'
  if (status === 'Paused') return 'tag-amber'
  return 'tag-gray'
}

interface CreateForm {
  project_id: string
  title: string
  description: string
  expected_result: string
  priority: Priority
  assigned_employee_id: string
  start_date: string
  end_date: string
}

const EMPTY_FORM: CreateForm = {
  project_id: '',
  title: '',
  description: '',
  expected_result: '',
  priority: 'MEDIUM',
  assigned_employee_id: '',
  start_date: '',
  end_date: '',
}

export function RecurringTasksPage() {
  const { permissions } = useAuth()
  const [templates, setTemplates] = useState<RecurringTaskTemplateRow[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const canCreate = permissions.includes('recurring_task.create')
  const canRead = permissions.includes('recurring_task.read_all') || permissions.includes('recurring_task.read_team')
  const canPause = permissions.includes('recurring_task.pause')
  const canDeactivate = permissions.includes('recurring_task.deactivate')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [tmplData, projData, empData] = await Promise.all([
        fetchRecurringTemplates(),
        fetchProjects(),
        supabase
          .from('employees')
          .select('id, full_name, employee_code')
          .eq('is_active', true)
          .order('full_name'),
      ])
      setTemplates(tmplData)
      setProjects(projData)
      if (empData.error) throw new Error(empData.error.message)
      setEmployees((empData.data ?? []) as Employee[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recurring tasks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!form.project_id.trim() || !form.title.trim() || !form.assigned_employee_id || !form.start_date) return
    setSubmitting(true)
    setActionError(null)
    try {
      await createRecurringTemplate({
        project_id: form.project_id,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        expected_result: form.expected_result.trim() || undefined,
        priority: form.priority,
        assigned_employee_id: form.assigned_employee_id,
        start_date: form.start_date,
        end_date: form.end_date || undefined,
      })
      setShowModal(false)
      setForm(EMPTY_FORM)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create recurring task')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleTogglePause(tmpl: RecurringTaskTemplateRow) {
    setActionError(null)
    try {
      if (tmpl.is_paused) {
        await resumeRecurringTemplate(tmpl.id)
      } else {
        await pauseRecurringTemplate(tmpl.id)
      }
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update template')
    }
  }

  async function handleDeactivate(tmpl: RecurringTaskTemplateRow) {
    if (!confirm('Deactivate this recurring task template? New tasks will no longer be generated.')) return
    setActionError(null)
    try {
      await deactivateRecurringTemplate(tmpl.id)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to deactivate template')
    }
  }

  const projectName = (id: string) => projects.find((p) => p.id === id)?.project_name ?? '—'
  const employeeName = (id: string) => {
    const emp = employees.find((e) => e.id === id)
    return emp ? `${emp.full_name}${emp.employee_code ? ` (${emp.employee_code})` : ''}` : '—'
  }

  if (!canRead && !canCreate) {
    return (
      <div className="page">
        <div className="page-header">
          <h2 className="page-title">Recurring Tasks</h2>
        </div>
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-text">You do not have permission to access recurring tasks.</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Recurring Tasks</h2>
        {canCreate && (
          <button className="btn btn-sm" onClick={() => setShowModal(true)}>+ Create Recurring Task</button>
        )}
      </div>

      {actionError && <div className="form-error">{actionError}</div>}

      <div className="card">
        {loading ? (
          <TableSkeleton rows={6} cols={8} />
        ) : error ? (
          <div className="empty-state">
            <div className="empty-state-text">{error}</div>
            <button className="btn btn-secondary" onClick={load} style={{ marginTop: 'var(--space-4)' }}>Retry</button>
          </div>
        ) : templates.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">No recurring task templates yet. {canCreate && 'Create one to get started.'}</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Title</th>
                  <th>Project</th>
                  <th>Assigned To</th>
                  <th>Priority</th>
                  <th>Recurrence</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Status</th>
                  {(canPause || canDeactivate) && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => {
                  const status = templateStatus(t)
                  return (
                    <tr key={t.id}>
                      <td><strong>{t.template_code}</strong></td>
                      <td>{t.title}</td>
                      <td>{projectName(t.project_id)}</td>
                      <td>{employeeName(t.assigned_employee_id)}</td>
                      <td><span className={getTaskPriorityStyle(t.priority).className} aria-label={getTaskPriorityStyle(t.priority).ariaLabel}>{getTaskPriorityStyle(t.priority).label}</span></td>
                      <td>{RECURRENCE_TYPE_LABELS[t.recurrence_type as RecurrenceType] ?? t.recurrence_type}</td>
                      <td>{formatDate(t.start_date)}</td>
                      <td>{formatDate(t.end_date)}</td>
                      <td><span className={`tag ${statusTagClass(status)}`}>{status}</span></td>
                      {(canPause || canDeactivate) && (
                        <td>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {canPause && t.is_active && (
                              <button className="btn btn-sm btn-secondary" onClick={() => handleTogglePause(t)}>
                                {t.is_paused ? 'Resume' : 'Pause'}
                              </button>
                            )}
                            {canDeactivate && t.is_active && (
                              <button className="btn btn-sm btn-secondary" onClick={() => handleDeactivate(t)}>Deactivate</button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="modal">
            <div className="modal-header">
              Create Recurring Task
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleCreate}>
                <div className="form-grid">
                  <div className="form-field form-field-full">
                    <label htmlFor="rt-project">Project *</label>
                    <select id="rt-project" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} required>
                      <option value="">Select project</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code} — {p.project_name}</option>)}
                    </select>
                  </div>
                  <div className="form-field form-field-full">
                    <label htmlFor="rt-title">Title *</label>
                    <input id="rt-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
                  </div>
                  <div className="form-field form-field-full">
                    <label htmlFor="rt-desc">Description</label>
                    <textarea id="rt-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  </div>
                  <div className="form-field form-field-full">
                    <label htmlFor="rt-result">Expected Result</label>
                    <textarea id="rt-result" rows={2} value={form.expected_result} onChange={(e) => setForm({ ...form, expected_result: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label htmlFor="rt-priority">Priority</label>
                    <select id="rt-priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="rt-assignee">Assigned Employee *</label>
                    <select id="rt-assignee" value={form.assigned_employee_id} onChange={(e) => setForm({ ...form, assigned_employee_id: e.target.value })} required>
                      <option value="">Select employee</option>
                      {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.full_name}{emp.employee_code ? ` (${emp.employee_code})` : ''}</option>)}
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="rt-start">Start Date *</label>
                    <input id="rt-start" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required />
                  </div>
                  <div className="form-field">
                    <label htmlFor="rt-end">End Date</label>
                    <input id="rt-end" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
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
