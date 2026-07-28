import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { TASK_PRIORITY_LABELS, type TaskPriority } from '@/types/roles'
import { fetchProjects, type ProjectRow } from '@/lib/projects'
import { selfAssignTask, formatTaskCost } from '@/lib/tasks'
import { FormSkeleton } from '@/components/Skeleton'
import '@/styles/shared.css'

export function SelfAssignTaskPage() {
  const { permissions } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const canSetCost = permissions.includes('task.cost_set')

  const [form, setForm] = useState({
    project_id: '',
    title: '',
    description: '',
    priority: 'MEDIUM' as TaskPriority,
    start_date: new Date().toISOString().slice(0, 10),
    deadline: '',
    expected_result: '',
    target_quantity: '',
    target_unit: '',
    estimated_hours: '',
    task_cost: '',
    reason: '',
  })

  useEffect(() => {
    loadProjects()
  }, [])

  async function loadProjects() {
    setProjectsLoading(true)
    setProjectsError(null)
    try {
      const data = await fetchProjects()
      setProjects(data)
    } catch (e) {
      setProjectsError((e as Error).message)
    }
    setProjectsLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!form.project_id) {
      setError('Project is required')
      return
    }
    if (!form.title.trim()) {
      setError('Task title is required')
      return
    }
    if (!form.start_date) {
      setError('Start date is required')
      return
    }
    if (!form.deadline) {
      setError('Deadline is required')
      return
    }
    if (new Date(form.deadline) < new Date(form.start_date)) {
      setError('Deadline cannot be before start date')
      return
    }
    if (!form.reason.trim()) {
      setError('Reason for self assignment is required')
      return
    }

    let taskCost: number | null = null
    if (canSetCost && form.task_cost.trim()) {
      taskCost = Number(form.task_cost)
      if (isNaN(taskCost) || taskCost < 0) {
        setError('Task cost must be zero or greater')
        return
      }
    }

    setLoading(true)
    try {
      await selfAssignTask({
        project_id: form.project_id,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        priority: form.priority,
        start_date: form.start_date,
        deadline: form.deadline,
        reason: form.reason.trim(),
        expected_result: form.expected_result.trim() || undefined,
        target_quantity: form.target_quantity ? Number(form.target_quantity) : null,
        target_unit: form.target_unit.trim() || null,
        estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : null,
        task_cost: canSetCost ? taskCost : null,
      })
      setSuccess('Task self-assigned successfully.')
      setTimeout(() => navigate('/my-tasks'), 1200)
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }

  if (!permissions.includes('task.self_assign')) {
    return (
      <div className="page">
        <div className="page-header">
          <h2 className="page-title">Self-Assign Task</h2>
          <button className="btn btn-secondary" onClick={() => navigate(-1)}>Back</button>
        </div>
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-text">You do not have permission to self-assign tasks.</div>
          </div>
        </div>
      </div>
    )
  }

  if (projectsLoading) {
    return (
      <div className="page">
        <FormSkeleton rows={10} />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Self-Assign Task</h2>
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>Back</button>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}
      {success && <div className="form-success" style={{ marginBottom: '12px' }}>{success}</div>}
      {projectsError && <div className="form-error" style={{ marginBottom: '12px' }}>Failed to load projects: {projectsError}</div>}

      <div className="card">
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className="form-field">
            <label htmlFor="sat-project">Project *</label>
            <select
              id="sat-project"
              value={form.project_id}
              onChange={(e) => setForm({ ...form, project_id: e.target.value })}
              required
            >
              <option value="">Select project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.project_name} ({p.project_code})</option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label htmlFor="sat-title">Task Title *</label>
            <input
              id="sat-title"
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </div>

          <div className="form-field">
            <label htmlFor="sat-desc">Description</label>
            <textarea
              id="sat-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={4}
            />
          </div>

          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="sat-priority">Priority</label>
              <select
                id="sat-priority"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}
              >
                {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="sat-start">Start Date *</label>
              <input
                id="sat-start"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="sat-deadline">Deadline *</label>
              <input
                id="sat-deadline"
                type="date"
                value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="sat-result">Expected Result</label>
            <textarea
              id="sat-result"
              value={form.expected_result}
              onChange={(e) => setForm({ ...form, expected_result: e.target.value })}
              rows={2}
            />
          </div>

          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="sat-qty">Target Quantity (optional)</label>
              <input
                id="sat-qty"
                type="number"
                value={form.target_quantity}
                onChange={(e) => setForm({ ...form, target_quantity: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label htmlFor="sat-unit">Target Unit (optional)</label>
              <input
                id="sat-unit"
                type="text"
                value={form.target_unit}
                onChange={(e) => setForm({ ...form, target_unit: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label htmlFor="sat-hours">Estimated Hours (optional)</label>
              <input
                id="sat-hours"
                type="number"
                value={form.estimated_hours}
                onChange={(e) => setForm({ ...form, estimated_hours: e.target.value })}
              />
            </div>
          </div>

          {canSetCost && (
            <div className="form-field">
              <label htmlFor="sat-cost">Task Cost (₹) (optional)</label>
              <input
                id="sat-cost"
                type="number"
                min="0"
                step="0.01"
                value={form.task_cost}
                onChange={(e) => {
                  const val = e.target.value
                  if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) {
                    setForm({ ...form, task_cost: val })
                  }
                }}
                placeholder="0.00"
              />
              {form.task_cost && Number(form.task_cost) > 0 && (
                <div style={{ fontSize: '12px', color: 'var(--slate)', marginTop: '4px' }}>
                  Preview: {formatTaskCost(Number(form.task_cost))}
                </div>
              )}
            </div>
          )}

          <div className="form-field">
            <label htmlFor="sat-reason">Reason for Self Assignment *</label>
            <textarea
              id="sat-reason"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              rows={3}
              required
            />
          </div>

          <div>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Assigning…' : 'Self-Assign Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
