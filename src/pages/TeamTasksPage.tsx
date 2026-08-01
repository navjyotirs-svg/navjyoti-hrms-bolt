import { useEffect, useState, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import { TASK_STATUS_LABELS, type TaskStatus } from '@/types/roles'
import {
  fetchTeamTasks,
  fetchTaskEvidenceCounts,
  fetchTeamEmployeeSummaries,
  formatDeadline,
  formatDeadlineShort,
  getAssigneeInitials,
  formatTaskCost,
  type TaskWithAssignments,
  type TaskAssignmentWithEmployee,
  type TaskEvidenceCount,
  type EmployeeTaskSummary,
} from '@/lib/tasks'
import { getTaskPriorityStyle } from '@/lib/taskPriority'
import { TaskSkeleton, ListSkeleton } from '@/components/Skeleton'
import '@/styles/shared.css'

type Tab = 'by_employee' | 'all_tasks'

interface FilterState {
  search: string
  department: string
  branch: string
  designation: string
  reportingManager: string
  hasOverdue: boolean
  hasPending: boolean
  hasSubmitted: boolean
}

const EMPTY_FILTERS: FilterState = {
  search: '', department: '', branch: '', designation: '', reportingManager: '',
  hasOverdue: false, hasPending: false, hasSubmitted: false,
}

export function TeamTasksPage() {
  const navigate = useNavigate()
  const { permissions, profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>('by_employee')

  // Employee overview state
  const [summaries, setSummaries] = useState<EmployeeTaskSummary[]>([])
  const [empLoading, setEmpLoading] = useState(true)
  const [empError, setEmpError] = useState<string | null>(null)
  const [filters, setFilters] = useState<FilterState>(() => ({
    ...EMPTY_FILTERS,
    search: searchParams.get('q') || '',
    department: searchParams.get('dept') || '',
    branch: searchParams.get('branch') || '',
    designation: searchParams.get('desig') || '',
    reportingManager: searchParams.get('mgr') || '',
    hasOverdue: searchParams.get('overdue') === '1',
    hasPending: searchParams.get('pending') === '1',
    hasSubmitted: searchParams.get('submitted') === '1',
  }))

  // All Tasks tab state
  const [tasks, setTasks] = useState<TaskWithAssignments[]>([])
  const [evidenceCounts, setEvidenceCounts] = useState<Map<string, TaskEvidenceCount>>(new Map())
  const [taskLoading, setTaskLoading] = useState(true)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [taskSearch, setTaskSearch] = useState('')

  const canReadAll = permissions.includes('task.read_all')
  const canReadTeam = permissions.includes('task.read_team')

  useEffect(() => {
    if (profile?.organization_id) loadEmployeeSummaries()
  }, [profile?.organization_id])

  // Realtime: reload employee summaries when tasks change
  useEffect(() => {
    if (!profile?.organization_id) return
    const channel = supabase
      .channel('team-tasks-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => loadEmployeeSummaries())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_progress_updates' }, () => loadEmployeeSummaries())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignments' }, () => loadEmployeeSummaries())
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.organization_id])

  async function loadEmployeeSummaries() {
    setEmpLoading(true)
    setEmpError(null)
    try {
      const data = await fetchTeamEmployeeSummaries(profile!.organization_id!, canReadAll, canReadTeam)
      setSummaries(data)
    } catch (e) {
      setEmpError((e as Error).message)
    }
    setEmpLoading(false)
  }

  useEffect(() => {
    if (tab === 'all_tasks' && tasks.length === 0) loadAllTasks()
  }, [tab])

  async function loadAllTasks() {
    setTaskLoading(true)
    setTaskError(null)
    try {
      const data = await fetchTeamTasks()
      setTasks(data)
      try {
        const counts = await fetchTaskEvidenceCounts(data.map(t => t.id))
        setEvidenceCounts(counts)
      } catch { setEvidenceCounts(new Map()) }
    } catch (e) { setTaskError((e as Error).message) }
    setTaskLoading(false)
  }

  // Sync filters to URL
  useEffect(() => {
    const params: Record<string, string> = {}
    if (filters.search) params.q = filters.search
    if (filters.department) params.dept = filters.department
    if (filters.branch) params.branch = filters.branch
    if (filters.designation) params.desig = filters.designation
    if (filters.reportingManager) params.mgr = filters.reportingManager
    if (filters.hasOverdue) params.overdue = '1'
    if (filters.hasPending) params.pending = '1'
    if (filters.hasSubmitted) params.submitted = '1'
    setSearchParams(params, { replace: true })
  }, [filters])

  // Unique values for filter dropdowns
  const departments = useMemo(() => {
    const set = new Set<string>()
    summaries.forEach(s => { if (s.department_name) set.add(s.department_name) })
    return Array.from(set).sort()
  }, [summaries])
  const branches = useMemo(() => {
    const set = new Set<string>()
    summaries.forEach(s => { if (s.branch_name) set.add(s.branch_name) })
    return Array.from(set).sort()
  }, [summaries])
  const designations = useMemo(() => {
    const set = new Set<string>()
    summaries.forEach(s => { if (s.designation) set.add(s.designation) })
    return Array.from(set).sort()
  }, [summaries])
  const managers = useMemo(() => {
    const set = new Set<string>()
    summaries.forEach(s => { if (s.reporting_manager_name) set.add(s.reporting_manager_name) })
    return Array.from(set).sort()
  }, [summaries])

  const filteredSummaries = useMemo(() => {
    return summaries.filter(s => {
      const q = filters.search.trim().toLowerCase()
      if (q && !s.full_name.toLowerCase().includes(q) && !s.employee_code.toLowerCase().includes(q)) return false
      if (filters.department && s.department_name !== filters.department) return false
      if (filters.branch && s.branch_name !== filters.branch) return false
      if (filters.designation && s.designation !== filters.designation) return false
      if (filters.reportingManager && s.reporting_manager_name !== filters.reportingManager) return false
      if (filters.hasOverdue && s.overdue === 0) return false
      if (filters.hasPending && s.acceptance_pending === 0) return false
      if (filters.hasSubmitted && s.submitted === 0) return false
      return true
    })
  }, [summaries, filters])

  function clearFilters() {
    setFilters(EMPTY_FILTERS)
  }

  const hasActiveFilters = filters.search || filters.department || filters.branch || filters.designation || filters.reportingManager || filters.hasOverdue || filters.hasPending || filters.hasSubmitted

  // All Tasks tab filtering
  const filteredTasks = tasks.filter(t => {
    const q = taskSearch.trim().toLowerCase()
    const matchesSearch = !q || t.title.toLowerCase().includes(q) || t.task_code.toLowerCase().includes(q)
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter
    return matchesSearch && matchesStatus
  })

  function AssigneeBadges({ assignments }: { assignments: TaskAssignmentWithEmployee[] }) {
    const current = assignments.filter(a => a.is_current && a.assignment_type === 'PRIMARY')
    if (current.length === 0) return <span style={{ color: 'var(--slate)' }}>—</span>
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
        {current.slice(0, 3).map(a => {
          const name = a.assigned_employee?.full_name || '?'
          const code = a.assigned_employee?.employee_code || ''
          return (
            <span key={a.id} title={`${name} (${code})`} style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              padding: '2px 8px', borderRadius: '12px', background: 'var(--paper)',
              border: '1px solid var(--border)', fontSize: '12px', whiteSpace: 'nowrap',
            }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '20px', height: '20px', borderRadius: '50%',
                background: 'var(--teal)', color: 'white', fontSize: '10px', fontWeight: 600,
              }}>{getAssigneeInitials(name)}</span>
              {name}
            </span>
          )
        })}
        {current.length > 3 && <span style={{ fontSize: '12px', color: 'var(--slate)' }}>+{current.length - 3}</span>}
      </div>
    )
  }

  function EvidenceBadge({ taskId }: { taskId: string }) {
    const ev = evidenceCounts.get(taskId)
    if (!ev || ev.photo_count === 0) return <span style={{ fontSize: '12px', color: 'var(--slate)' }}>No Report Evidence</span>
    return (
      <button className="btn btn-sm btn-secondary" style={{ fontSize: '11px', padding: '3px 8px' }}
        onClick={e => { e.stopPropagation(); navigate(`/tasks/${taskId}/daily-report-evidence`) }}>
        {ev.daily_report_count} {ev.daily_report_count === 1 ? 'Report' : 'Reports'} / {ev.photo_count} Photos
      </button>
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

      {/* Tab bar */}
      <div className="tab-bar">
        <button className={`tab-btn ${tab === 'by_employee' ? 'active' : ''}`} onClick={() => setTab('by_employee')}>By Employee</button>
        <button className={`tab-btn ${tab === 'all_tasks' ? 'active' : ''}`} onClick={() => setTab('all_tasks')}>All Tasks</button>
      </div>

      {tab === 'by_employee' ? (
        <>
          {/* Employee filters */}
          <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="emp-search">Search</label>
                <input id="emp-search" type="text" value={filters.search}
                  onChange={e => setFilters({ ...filters, search: e.target.value })}
                  placeholder="Name or employee code" />
              </div>
              <div className="form-field">
                <label htmlFor="filter-dept">Department</label>
                <select id="filter-dept" value={filters.department}
                  onChange={e => setFilters({ ...filters, department: e.target.value })}>
                  <option value="">All</option>
                  {departments.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="filter-branch">Branch</label>
                <select id="filter-branch" value={filters.branch}
                  onChange={e => setFilters({ ...filters, branch: e.target.value })}>
                  <option value="">All</option>
                  {branches.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="filter-desig">Designation</label>
                <select id="filter-desig" value={filters.designation}
                  onChange={e => setFilters({ ...filters, designation: e.target.value })}>
                  <option value="">All</option>
                  {designations.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="filter-mgr">Reporting Manager</label>
                <select id="filter-mgr" value={filters.reportingManager}
                  onChange={e => setFilters({ ...filters, reportingManager: e.target.value })}>
                  <option value="">All</option>
                  {managers.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center', marginTop: 'var(--space-3)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={filters.hasOverdue}
                  onChange={e => setFilters({ ...filters, hasOverdue: e.target.checked })} />
                Has Overdue
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={filters.hasPending}
                  onChange={e => setFilters({ ...filters, hasPending: e.target.checked })} />
                Has Pending
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={filters.hasSubmitted}
                  onChange={e => setFilters({ ...filters, hasSubmitted: e.target.checked })} />
                Has Submitted
              </label>
              {hasActiveFilters && (
                <button className="btn btn-sm btn-secondary" onClick={clearFilters}>Clear Filters</button>
              )}
            </div>
          </div>

          {/* Employee overview */}
          {empLoading ? (
            <div className="card"><ListSkeleton rows={5} /></div>
          ) : empError ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-text">Team Tasks could not be loaded.</div>
                <button className="btn btn-secondary" onClick={loadEmployeeSummaries} style={{ marginTop: 'var(--space-3)' }}>Retry</button>
              </div>
            </div>
          ) : filteredSummaries.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-text">No employees with task access were found.</div>
              </div>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="card team-tasks-desktop">
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Code</th>
                        <th>Designation</th>
                        <th>Department</th>
                        <th>Manager</th>
                        <th style={{ textAlign: 'center' }}>Active</th>
                        <th style={{ textAlign: 'center' }}>Pending</th>
                        <th style={{ textAlign: 'center' }}>In Progress</th>
                        <th style={{ textAlign: 'center' }}>Submitted</th>
                        <th style={{ textAlign: 'center' }}>Completed</th>
                        <th style={{ textAlign: 'center' }}>Overdue</th>
                        <th style={{ textAlign: 'center' }}>On-Time %</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSummaries.map(s => (
                        <tr key={s.id}>
                          <td style={{ fontWeight: 600 }}>{s.full_name}</td>
                          <td className="mono">{s.employee_code}</td>
                          <td>{s.designation || '—'}</td>
                          <td>{s.department_name || '—'}</td>
                          <td>{s.reporting_manager_name || '—'}</td>
                          <td style={{ textAlign: 'center' }}>{s.active_tasks}</td>
                          <td style={{ textAlign: 'center' }}>{s.acceptance_pending}</td>
                          <td style={{ textAlign: 'center' }}>{s.in_progress}</td>
                          <td style={{ textAlign: 'center' }}>{s.submitted}</td>
                          <td style={{ textAlign: 'center' }}>{s.completed}</td>
                          <td style={{ textAlign: 'center' }}>
                            {s.overdue > 0
                              ? <span style={{ color: '#7F1D1D', fontWeight: 700 }}>{s.overdue}</span>
                              : <span style={{ color: 'var(--slate)' }}>0</span>}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {s.deadline_success_pct != null
                              ? <span style={{ fontWeight: 600, color: s.deadline_success_pct >= 75 ? '#166534' : s.deadline_success_pct >= 50 ? '#92400E' : '#7F1D1D' }}>{s.deadline_success_pct}%</span>
                              : <span style={{ color: 'var(--slate)' }}>—</span>}
                          </td>
                          <td>
                            <button className="btn btn-sm" onClick={() => navigate(`/team-tasks/employee/${s.id}`)}>View Tasks</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile cards */}
              <div className="team-tasks-mobile">
                <div className="employee-overview-grid">
                  {filteredSummaries.map(s => (
                    <div key={s.id} className="employee-card" onClick={() => navigate(`/team-tasks/employee/${s.id}`)}>
                      <div className="employee-card-header">
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: '36px', height: '36px', borderRadius: '50%',
                          background: 'var(--teal)', color: 'white', fontSize: '14px', fontWeight: 700,
                        }}>{getAssigneeInitials(s.full_name)}</span>
                        <div>
                          <div className="employee-card-name">{s.full_name}</div>
                          <div className="employee-card-meta">{s.employee_code} · {s.designation || '—'}</div>
                        </div>
                      </div>
                      <div className="employee-card-meta">
                        {s.department_name || 'No department'}
                        {s.reporting_manager_name ? ` · ${s.reporting_manager_name}` : ''}
                      </div>
                      <div className="employee-card-stats">
                        <div className="employee-stat">
                          <div className="employee-stat-num">{s.active_tasks}</div>
                          <div className="employee-stat-lbl">Active</div>
                        </div>
                        <div className="employee-stat">
                          <div className="employee-stat-num" style={{ color: s.overdue > 0 ? '#7F1D1D' : undefined }}>{s.overdue}</div>
                          <div className="employee-stat-lbl">Overdue</div>
                        </div>
                        <div className="employee-stat">
                          <div className="employee-stat-num">{s.completed}</div>
                          <div className="employee-stat-lbl">Done</div>
                        </div>
                      </div>
                      {s.deadline_success_pct != null && (
                        <div style={{ fontSize: '12px', color: 'var(--slate)' }}>
                          On-Time: <strong style={{ color: s.deadline_success_pct >= 75 ? '#166534' : s.deadline_success_pct >= 50 ? '#92400E' : '#7F1D1D' }}>{s.deadline_success_pct}%</strong>
                        </div>
                      )}
                      <button className="btn btn-sm" onClick={e => { e.stopPropagation(); navigate(`/team-tasks/employee/${s.id}`) }}>View Tasks</button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        // All Tasks tab (existing mixed table)
        <div className="card">
          {taskError && <div className="form-error" style={{ marginBottom: '12px' }}>{taskError}</div>}
          <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
            <div className="form-field">
              <label htmlFor="tt-search">Search</label>
              <input id="tt-search" type="text" value={taskSearch} onChange={e => setTaskSearch(e.target.value)} placeholder="Task code or title" />
            </div>
            <div className="form-field">
              <label htmlFor="tt-status">Status</label>
              <select id="tt-status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">All Statuses</option>
                {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          {taskLoading ? (
            <TaskSkeleton />
          ) : filteredTasks.length === 0 ? (
            <div className="empty-state"><div className="empty-state-text">No tasks found.</div></div>
          ) : (
            <>
              <div className="table-wrap team-tasks-desktop">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Code</th><th>Title</th><th>Project</th><th>Assignee(s)</th>
                      <th>Priority</th><th>Status</th><th>Deadline</th><th>Cost</th>
                      <th>Outcome</th><th>Evidence</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTasks.map(t => (
                      <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/tasks/${t.id}`)}>
                        <td className="mono" style={{ whiteSpace: 'nowrap' }}>{t.task_code}</td>
                        <td>{t.title}</td>
                        <td>{t.projects?.project_name || '—'}</td>
                        <td><AssigneeBadges assignments={t.task_assignments || []} /></td>
                        <td><span className={getTaskPriorityStyle(t.priority).className} aria-label={getTaskPriorityStyle(t.priority).ariaLabel}>{getTaskPriorityStyle(t.priority).label}</span></td>
                        <td><span className={`attendance-badge ${t.status.toLowerCase()}`}>{TASK_STATUS_LABELS[t.status as TaskStatus]}</span></td>
                        <td className="mono" style={{ whiteSpace: 'nowrap' }}>{formatDeadlineShort(t.deadline_at, t.current_deadline)}</td>
                        <td className="mono">{formatTaskCost(t.task_cost, t.task_cost_currency)}</td>
                        <td>{t.completion_outcome || '—'}</td>
                        <td><EvidenceBadge taskId={t.id} /></td>
                        <td><button className="btn-sm" onClick={e => { e.stopPropagation(); navigate(`/tasks/${t.id}`) }}>View</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="team-tasks-mobile">
                {filteredTasks.map(t => (
                  <div key={t.id} className="task-card-mobile" onClick={() => navigate(`/tasks/${t.id}`)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <span className="mono" style={{ fontSize: '12px', color: 'var(--slate)' }}>{t.task_code}</span>
                      <span className={`attendance-badge ${t.status.toLowerCase()}`} style={{ fontSize: '11px' }}>{TASK_STATUS_LABELS[t.status as TaskStatus]}</span>
                    </div>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>{t.title}</div>
                    {t.projects?.project_name && <div style={{ fontSize: '12px', color: 'var(--slate)', marginBottom: '4px' }}>{t.projects.project_name}</div>}
                    <div style={{ marginBottom: '8px' }}><AssigneeBadges assignments={t.task_assignments || []} /></div>
                    <div className="task-card-badges">
                      <span className={getTaskPriorityStyle(t.priority).className} aria-label={getTaskPriorityStyle(t.priority).ariaLabel}>{getTaskPriorityStyle(t.priority).label}</span>
                      <span className="mono">{formatDeadline(t.deadline_at, t.current_deadline)}</span>
                      {t.task_cost != null && <span className="mono">{formatTaskCost(t.task_cost, t.task_cost_currency)}</span>}
                    </div>
                    <div style={{ marginTop: '8px' }}><EvidenceBadge taskId={t.id} /></div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
