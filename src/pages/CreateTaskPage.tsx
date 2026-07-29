import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import { TASK_PRIORITY_LABELS, TASK_TYPE_LABELS, type TaskPriority, type TaskType } from '@/types/roles'
import { createTask, formatTaskCost, saveTaskDraft, loadTaskDraft, discardTaskDraft } from '@/lib/tasks'
import { fetchProjects, createProject, type ProjectRow } from '@/lib/projects'
import { FormSkeleton } from '@/components/Skeleton'
import '@/styles/shared.css'

const PROJECT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
type ProjectPriority = (typeof PROJECT_PRIORITIES)[number]

interface EmployeeOption {
  id: string
  employee_code: string
  full_name: string
  user_id: string
  designation: string | null
  branch_id: string | null
  department_id: string | null
}

interface DraftData {
  draft_id?: string
  project_id?: string
  title?: string
  description?: string
  priority?: string
  expected_result?: string
  target_quantity?: number | null
  target_unit?: string | null
  estimated_hours?: number | null
  task_cost?: number | null
  deadline_at?: string
  start_date?: string
  task_type?: string
  acceptance_required?: boolean
  branch_id?: string | null
  department_id?: string | null
  assignee_employee_ids?: string[]
  last_saved_at?: string
}

type DraftStatus = 'idle' | 'saving' | 'saved' | 'error' | 'restored'

export function CreateTaskPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
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
    selectedEmployeeIds: [] as string[],
    priority: 'MEDIUM' as TaskPriority,
    task_type: 'GENERAL' as TaskType,
    start_date: new Date().toISOString().slice(0, 10),
    deadline_date: '',
    deadline_time: '18:00',
    expected_result: '',
    target_quantity: '',
    target_unit: '',
    estimated_hours: '',
    task_cost: '',
    acceptance_required: true,
    branch_id: '',
    department_id: '',
  })

  const [assigneeSearch, setAssigneeSearch] = useState('')
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false)

  const [draftStatus, setDraftStatus] = useState<DraftStatus>('idle')
  const [draftId, setDraftId] = useState<string | undefined>(undefined)
  const [draftLastSaved, setDraftLastSaved] = useState<string | null>(null)
  const [showDraftRestore, setShowDraftRestore] = useState(false)

  const draftLoadedRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    loadEmployees()
    loadProjects()
    if (!draftLoadedRef.current) {
      draftLoadedRef.current = true
      checkForDraft()
    }
  }, [profile?.organization_id])

  async function loadEmployees() {
    if (!profile?.organization_id) return
    const { data } = await supabase
      .from('employees')
      .select('id, employee_code, full_name, user_id, designation, branch_id, department_id')
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
      console.error('Failed to load projects:', (e as Error).message)
    }
    setProjectsLoading(false)
  }

  async function checkForDraft() {
    try {
      const result = await loadTaskDraft()
      if (result.draft) {
        setShowDraftRestore(true)
      }
    } catch {
      // No draft found — normal
    }
  }

  function restoreDraft(draft: DraftData) {
    if (draft.draft_id) setDraftId(draft.draft_id)
    setForm((prev) => ({
      ...prev,
      project_id: draft.project_id || '',
      title: draft.title || '',
      description: draft.description || '',
      selectedEmployeeIds: draft.assignee_employee_ids || [],
      priority: (draft.priority as TaskPriority) || 'MEDIUM',
      task_type: (draft.task_type as TaskType) || 'GENERAL',
      start_date: draft.start_date || new Date().toISOString().slice(0, 10),
      deadline_date: draft.deadline_at ? draft.deadline_at.slice(0, 10) : '',
      deadline_time: draft.deadline_at
        ? new Date(draft.deadline_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
        : '18:00',
      expected_result: draft.expected_result || '',
      target_quantity: draft.target_quantity?.toString() || '',
      target_unit: draft.target_unit || '',
      estimated_hours: draft.estimated_hours?.toString() || '',
      task_cost: draft.task_cost?.toString() || '',
      acceptance_required: draft.acceptance_required ?? true,
      branch_id: draft.branch_id || '',
      department_id: draft.department_id || '',
    }))
    setDraftStatus('restored')
    setDraftLastSaved(draft.last_saved_at || null)
  }

  const doSaveDraft = useCallback(async () => {
    if (!form.title && !form.description && form.selectedEmployeeIds.length === 0 && !form.project_id) {
      return
    }
    setDraftStatus('saving')
    try {
      const deadlineAt = form.deadline_date
        ? new Date(`${form.deadline_date}T${form.deadline_time}:00`).toISOString()
        : undefined
      const result = await saveTaskDraft({
        draft_id: draftId,
        project_id: form.project_id || undefined,
        title: form.title,
        description: form.description,
        priority: form.priority,
        expected_result: form.expected_result,
        target_quantity: form.target_quantity ? Number(form.target_quantity) : null,
        target_unit: form.target_unit || null,
        estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : null,
        task_cost: form.task_cost ? Number(form.task_cost) : null,
        deadline_at: deadlineAt,
        start_date: form.start_date,
        task_type: form.task_type,
        acceptance_required: form.acceptance_required,
        branch_id: form.branch_id || null,
        department_id: form.department_id || null,
        assignee_employee_ids: form.selectedEmployeeIds,
      })
      if (result.draft_id) setDraftId(result.draft_id)
      setDraftStatus('saved')
      setDraftLastSaved(result.last_saved_at || new Date().toISOString())
    } catch {
      setDraftStatus('error')
    }
  }, [form, draftId])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!draftLoadedRef.current) return
    if (showDraftRestore) return
    debounceRef.current = setTimeout(() => {
      doSaveDraft()
    }, 1200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [form, doSaveDraft, showDraftRestore])

  const selectedEmployees = employees.filter((e) => form.selectedEmployeeIds.includes(e.id))
  const filteredEmployees = employees.filter((e) => {
    if (form.selectedEmployeeIds.includes(e.id)) return false
    const q = assigneeSearch.trim().toLowerCase()
    if (!q) return true
    return e.full_name.toLowerCase().includes(q) || e.employee_code.toLowerCase().includes(q)
  })

  function toggleEmployee(empId: string) {
    setForm((prev) => ({
      ...prev,
      selectedEmployeeIds: prev.selectedEmployeeIds.includes(empId)
        ? prev.selectedEmployeeIds.filter((id) => id !== empId)
        : [...prev.selectedEmployeeIds, empId],
    }))
  }

  function clearAllAssignees() {
    setForm((prev) => ({ ...prev, selectedEmployeeIds: [] }))
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
    if (!form.title.trim() || !form.description.trim()) {
      setError('Title and description are required')
      return
    }
    if (form.selectedEmployeeIds.length === 0) {
      setError('At least one assignee is required')
      return
    }
    if (!form.deadline_date || !form.deadline_time) {
      setError('Deadline date and time are required')
      return
    }

    const deadlineAt = new Date(`${form.deadline_date}T${form.deadline_time}:00`).toISOString()
    if (new Date(deadlineAt) < new Date()) {
      setError('Deadline must be in the future')
      return
    }
    if (new Date(form.deadline_date) < new Date(form.start_date)) {
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

    const assigneeUserIds = selectedEmployees.map((e) => e.user_id).filter(Boolean)
    if (assigneeUserIds.length !== form.selectedEmployeeIds.length) {
      setError('One or more selected employees have no user account')
      return
    }

    setLoading(true)
    setError(null)
    try {
      await createTask({
        project_id: form.project_id,
        title: form.title.trim(),
        description: form.description.trim(),
        assignee_ids: assigneeUserIds,
        priority: form.priority,
        task_type: form.task_type,
        start_date: form.start_date,
        deadline_at: deadlineAt,
        expected_result: form.expected_result,
        target_quantity: form.target_quantity ? Number(form.target_quantity) : null,
        target_unit: form.target_unit || null,
        estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : null,
        task_cost: taskCost,
        acceptance_required: form.acceptance_required,
        branch_id: form.branch_id || null,
        department_id: form.department_id || null,
        draft_id: draftId,
      })
      setDraftId(undefined)
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

  const draftStatusLabel = {
    idle: '',
    saving: 'Saving draft…',
    saved: 'Draft saved',
    error: 'Save failed — Retry',
    restored: 'Restored from draft',
  }[draftStatus]

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Assign New Task</h2>
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>Back</button>
      </div>

      {showDraftRestore && (
        <div className="card" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-4)', borderLeft: '4px solid var(--teal)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <div>
              <strong>An unfinished task draft was found.</strong>
              {draftLastSaved && (
                <div style={{ fontSize: '13px', color: 'var(--slate)', marginTop: '4px' }}>
                  Last saved {new Date(draftLastSaved).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button className="btn btn-primary" onClick={async () => {
                try {
                  const result = await loadTaskDraft()
                  if (result.draft) restoreDraft(result.draft)
                } catch { /* ignore */ }
                setShowDraftRestore(false)
              }}>Continue Draft</button>
              <button className="btn btn-secondary" onClick={async () => {
                try { await discardTaskDraft(draftId) } catch { /* ignore */ }
                setDraftId(undefined)
                setShowDraftRestore(false)
              }}>Discard Draft</button>
              <button className="btn btn-secondary" onClick={() => setShowDraftRestore(false)}>Start New Task</button>
            </div>
          </div>
        </div>
      )}

      {draftStatus !== 'idle' && (
        <div style={{ fontSize: '13px', color: 'var(--slate)', marginBottom: 'var(--space-2)' }}>
          {draftStatusLabel}
        </div>
      )}

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

          {/* Multi-select Assignee */}
          <div className="form-field" style={{ position: 'relative' }}>
            <label htmlFor="t-assignee-search">Assign To * <span style={{ fontSize: '12px', color: 'var(--slate)' }}>({form.selectedEmployeeIds.length} selected)</span></label>

            {/* Selected chips */}
            {selectedEmployees.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                {selectedEmployees.map((emp) => (
                  <span key={emp.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    padding: '4px 10px', borderRadius: '20px',
                    background: 'var(--teal)', color: 'white', fontSize: '13px',
                  }}>
                    {emp.full_name} ({emp.employee_code})
                    <button type="button" onClick={() => toggleEmployee(emp.id)} style={{
                      background: 'none', border: 'none', color: 'white', cursor: 'pointer',
                      fontSize: '16px', lineHeight: '1', padding: '0',
                    }}>×</button>
                  </span>
                ))}
                <button type="button" onClick={clearAllAssignees} style={{
                  background: 'none', border: 'none', color: 'var(--rose)', cursor: 'pointer',
                  fontSize: '13px', textDecoration: 'underline',
                }}>Clear All</button>
              </div>
            )}

            <input
              id="t-assignee-search"
              type="text"
              value={assigneeSearch}
              onChange={(e) => setAssigneeSearch(e.target.value)}
              onFocus={() => setShowAssigneeDropdown(true)}
              onBlur={() => setTimeout(() => setShowAssigneeDropdown(false), 200)}
              placeholder="Search by name or employee code…"
            />

            {showAssigneeDropdown && filteredEmployees.length > 0 && (
              <div style={{
                position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0,
                maxHeight: '260px', overflowY: 'auto',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)',
              }}>
                {filteredEmployees.map((emp) => (
                  <div
                    key={emp.id}
                    onClick={() => { toggleEmployee(emp.id); setAssigneeSearch('') }}
                    style={{
                      padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <span>{emp.full_name} <span style={{ color: 'var(--slate)', fontSize: '12px' }}>({emp.employee_code})</span></span>
                    {emp.designation && <span style={{ fontSize: '12px', color: 'var(--slate)' }}>{emp.designation}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="form-grid">
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
              <label htmlFor="t-deadline-date">Deadline Date *</label>
              <input id="t-deadline-date" type="date" value={form.deadline_date} onChange={(e) => setForm({ ...form, deadline_date: e.target.value })} required />
            </div>
            <div className="form-field">
              <label htmlFor="t-deadline-time">Deadline Time *</label>
              <input id="t-deadline-time" type="time" value={form.deadline_time} onChange={(e) => setForm({ ...form, deadline_time: e.target.value })} required />
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
