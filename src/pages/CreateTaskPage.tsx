import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import { TASK_PRIORITY_LABELS, TASK_TYPE_LABELS, type TaskPriority, type TaskType } from '@/types/roles'
import { createTask, formatTaskCost } from '@/lib/tasks'
import { fetchProjects, createProject, type ProjectRow } from '@/lib/projects'
import { FormSkeleton } from '@/components/Skeleton'
import '@/styles/shared.css'

const PROJECT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
type ProjectPriority = (typeof PROJECT_PRIORITIES)[number]

export function CreateTaskPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [employees, setEmployees] = useState<any[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showProjectModal, setShowProjectModal] = useState(false)
  const [projectSubmitting, setProjectSubmitting] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)

  const [projectForm, setProjectForm] = useState({
    project_name: '',
    description: '',
    priority: 'MEDIUM' as ProjectPriority,
    start_date: new Date().toISOString().slice(0, 10),
    expected_end_date: '',
  })

  const [form, setForm] = useState({
    project_id: '',
    title: '',
    description: '',
    assignee_id: '',
    priority: 'MEDIUM' as TaskPriority,
    task_type: 'GENERAL' as TaskType,
    start_date: new Date().toISOString().slice(0, 10),
    deadline: '',
    expected_result: '',
    target_quantity: '',
    target_unit: '',
    estimated_hours: '',
    task_cost: '',
    acceptance_required: true,
    branch_id: '',
    department_id: '',
  })

  useEffect(() => {
    loadEmployees()
    loadProjects()
  }, [profile?.organization_id])

  async function loadEmployees() {
    if (!profile?.organization_id) return
    const { data } = await supabase
      .from('employees')
      .select('id, employee_code, full_name, user_id, designation')
      .eq('organization_id', profile.organization_id)
      .eq('is_active', true)
      .order('full_name')
    setEmployees(data || [])
  }

  async function loadProjects() {
    setProjectsLoading(true)
    try {
      const data = await fetchProjects()
      setProjects(data)
    } catch (e) {
      // Non-fatal: project dropdown will be empty with an option to create
      console.error('Failed to load projects:', (e as Error).message)
    }
    setProjectsLoading(false)
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault()
    setProjectError(null)
    if (!projectForm.project_name.trim()) {
      setProjectError('Project name is required')
      return
    }
    setProjectSubmitting(true)
    try {
      const result = await createProject({
        project_name: projectForm.project_name.trim(),
        description: projectForm.description.trim() || undefined,
        priority: projectForm.priority,
        start_date: projectForm.start_date || undefined,
        expected_end_date: projectForm.expected_end_date || undefined,
      })
      await loadProjects()
      // Auto-select the newly created project. The edge function returns the new project id.
      const newId = result?.project_id || result?.id
      if (newId) {
        setForm((prev) => ({ ...prev, project_id: newId }))
      }
      setShowProjectModal(false)
      setProjectForm({
        project_name: '',
        description: '',
        priority: 'MEDIUM' as ProjectPriority,
        start_date: new Date().toISOString().slice(0, 10),
        expected_end_date: '',
      })
    } catch (e) {
      setProjectError((e as Error).message)
    }
    setProjectSubmitting(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.project_id) {
      setError('Project is required')
      return
    }
    if (!form.title.trim() || !form.description.trim() || !form.assignee_id || !form.deadline) {
      setError('Project, title, description, assignee, and deadline are required')
      return
    }
    if (new Date(form.deadline) < new Date(form.start_date)) {
      setError('Deadline cannot be before start date')
      return
    }

    let taskCost: number | null = null
    if (form.task_cost.trim()) {
      taskCost = Number(form.task_cost)
      if (isNaN(taskCost) || taskCost < 0) {
        setError('Task cost must be zero or greater')
        return
      }
    }

    setLoading(true)
    setError(null)
    try {
      const assignee = employees.find((e) => e.id === form.assignee_id)
      await createTask({
        project_id: form.project_id,
        title: form.title.trim(),
        description: form.description.trim(),
        assignee_id: assignee.user_id,
        priority: form.priority,
        task_type: form.task_type,
        start_date: form.start_date,
        deadline: form.deadline,
        expected_result: form.expected_result,
        target_quantity: form.target_quantity ? Number(form.target_quantity) : null,
        target_unit: form.target_unit || null,
        estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : null,
        task_cost: taskCost,
        acceptance_required: form.acceptance_required,
        branch_id: form.branch_id || null,
        department_id: form.department_id || null,
      })
      navigate('/team-tasks')
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }

  if (loading) return (
    <div className="page">
      <FormSkeleton rows={10} />
    </div>
  )

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Assign New Task</h2>
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>Back</button>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      <div className="card">
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className="form-field">
            <label htmlFor="t-project">Project *</label>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <select
                id="t-project"
                value={form.project_id}
                onChange={(e) => setForm({ ...form, project_id: e.target.value })}
                required
                style={{ flex: 1 }}
                disabled={projectsLoading}
              >
                <option value="">{projectsLoading ? 'Loading projects…' : 'Select project'}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.project_name} ({p.project_code})</option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowProjectModal(true)}
              >
                + Create New Project
              </button>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="t-title">Title *</label>
            <input id="t-title" type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div className="form-field">
            <label htmlFor="t-desc">Description *</label>
            <textarea id="t-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} required />
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="t-assignee">Assignee *</label>
              <select id="t-assignee" value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })} required>
                <option value="">Select employee</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="t-priority">Priority</label>
              <select id="t-priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
                {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="t-type">Task Type</label>
              <select id="t-type" value={form.task_type} onChange={(e) => setForm({ ...form, task_type: e.target.value as TaskType })}>
                {Object.entries(TASK_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="t-start">Start Date *</label>
              <input id="t-start" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required />
            </div>
            <div className="form-field">
              <label htmlFor="t-deadline">Deadline *</label>
              <input id="t-deadline" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} required />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="t-result">Expected Result</label>
            <textarea id="t-result" value={form.expected_result} onChange={(e) => setForm({ ...form, expected_result: e.target.value })} rows={2} />
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="t-qty">Target Quantity</label>
              <input id="t-qty" type="number" value={form.target_quantity} onChange={(e) => setForm({ ...form, target_quantity: e.target.value })} />
            </div>
            <div className="form-field">
              <label htmlFor="t-unit">Target Unit</label>
              <input id="t-unit" type="text" value={form.target_unit} onChange={(e) => setForm({ ...form, target_unit: e.target.value })} />
            </div>
            <div className="form-field">
              <label htmlFor="t-hours">Estimated Hours</label>
              <input id="t-hours" type="number" value={form.estimated_hours} onChange={(e) => setForm({ ...form, estimated_hours: e.target.value })} />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="t-cost">Task Cost (₹)</label>
            <input
              id="t-cost"
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
          <div className="form-field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.acceptance_required} onChange={(e) => setForm({ ...form, acceptance_required: e.target.checked })} />
              <span>Requires employee acceptance</span>
            </label>
          </div>
          <div>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creating…' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>

      {showProjectModal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowProjectModal(false) }}>
          <div className="modal">
            <div className="modal-header">
              Create New Project
              <button className="modal-close" onClick={() => setShowProjectModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleCreateProject}>
                <div className="form-grid">
                  <div className="form-field form-field-full">
                    <label htmlFor="np-name">Project Name *</label>
                    <input
                      id="np-name"
                      value={projectForm.project_name}
                      onChange={(e) => setProjectForm({ ...projectForm, project_name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-field form-field-full">
                    <label htmlFor="np-desc">Description</label>
                    <textarea
                      id="np-desc"
                      rows={3}
                      value={projectForm.description}
                      onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="np-priority">Priority</label>
                    <select
                      id="np-priority"
                      value={projectForm.priority}
                      onChange={(e) => setProjectForm({ ...projectForm, priority: e.target.value as ProjectPriority })}
                    >
                      {PROJECT_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="np-start">Start Date</label>
                    <input
                      id="np-start"
                      type="date"
                      value={projectForm.start_date}
                      onChange={(e) => setProjectForm({ ...projectForm, start_date: e.target.value })}
                    />
                  </div>
                  <div className="form-field form-field-full">
                    <label htmlFor="np-end">Expected End Date</label>
                    <input
                      id="np-end"
                      type="date"
                      value={projectForm.expected_end_date}
                      onChange={(e) => setProjectForm({ ...projectForm, expected_end_date: e.target.value })}
                    />
                  </div>
                </div>
                {projectError && <div className="form-error" style={{ marginTop: 'var(--space-3)' }}>{projectError}</div>}
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowProjectModal(false)} disabled={projectSubmitting}>Cancel</button>
                  <button type="submit" className="btn" disabled={projectSubmitting}>{projectSubmitting ? 'Creating…' : 'Create'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
