import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import { TASK_PRIORITY_LABELS, TASK_TYPE_LABELS, type TaskPriority, type TaskType } from '@/types/roles'
import { createTask } from '@/lib/tasks'
import '@/styles/shared.css'

export function CreateTaskPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
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
    acceptance_required: true,
    branch_id: '',
    department_id: '',
  })

  useEffect(() => {
    loadEmployees()
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !form.description.trim() || !form.assignee_id || !form.deadline) {
      setError('Title, description, assignee, and deadline are required')
      return
    }
    if (new Date(form.deadline) < new Date(form.start_date)) {
      setError('Deadline cannot be before start date')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const assignee = employees.find((e) => e.id === form.assignee_id)
      await createTask({
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
    </div>
  )
}
