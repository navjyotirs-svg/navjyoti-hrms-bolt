import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import {
  fetchEmployeeTaskTimeline,
  fetchTeamEmployeeSummaries,
  validateEmployeeAccess,
  formatDeadline,
  formatTaskCost,
  type EmployeeTaskItem,
} from '@/lib/tasks'
import {
  getTaskPriorityStyle,
  getTaskStatusStyle,
  getAssignmentDeadlinePerformance,
  getDeadlinePerformanceStyle,
  getPerformanceAccentClass,
  getTimelineSection,
  sortTimelineItems,
  TIMELINE_SECTIONS,
  type TimelineSection,
} from '@/lib/taskPriority'
import { supabase } from '@/lib/supabase'
import { ListSkeleton } from '@/components/Skeleton'
import '@/styles/shared.css'

export function EmployeeTaskTimelinePage() {
  const { employeeId } = useParams<{ employeeId: string }>()
  const navigate = useNavigate()
  const { permissions, profile } = useAuth()
  const [searchParams] = useSearchParams()

  const [items, setItems] = useState<EmployeeTaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [employeeInfo, setEmployeeInfo] = useState<{
    full_name: string
    employee_code: string
    designation: string | null
    department_name: string | null
    active_tasks: number
    overdue: number
    completed: number
    met_deadline: number
    missed_deadline: number
    deadline_success_pct: number | null
  } | null>(null)

  const canReadAll = permissions.includes('task.read_all')
  const canReadTeam = permissions.includes('task.read_team')

  useEffect(() => {
    if (!employeeId || !profile?.organization_id) return
    loadData()
  }, [employeeId, profile?.organization_id])

  // Realtime: reload when tasks or progress updates change
  useEffect(() => {
    if (!employeeId) return
    const channel = supabase
      .channel(`emp-timeline:${employeeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_progress_updates' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignments' }, () => loadData())
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId])

  async function loadData() {
    setLoading(true)
    setError(null)
    setAccessDenied(false)
    try {
      const hasAccess = await validateEmployeeAccess(employeeId!, profile!.organization_id!, canReadAll)
      if (!hasAccess) {
        setAccessDenied(true)
        setLoading(false)
        return
      }

      const [taskItems, summaries] = await Promise.all([
        fetchEmployeeTaskTimeline(employeeId!),
        fetchTeamEmployeeSummaries(profile!.organization_id!, canReadAll, canReadTeam),
      ])

      setItems(taskItems)

      const empSummary = summaries.find(s => s.id === employeeId)
      if (empSummary) {
        setEmployeeInfo({
          full_name: empSummary.full_name,
          employee_code: empSummary.employee_code,
          designation: empSummary.designation,
          department_name: empSummary.department_name,
          active_tasks: empSummary.active_tasks,
          overdue: empSummary.overdue,
          completed: empSummary.completed,
          met_deadline: empSummary.met_deadline,
          missed_deadline: empSummary.missed_deadline,
          deadline_success_pct: empSummary.deadline_success_pct,
        })
      }
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }

  const now = useMemo(() => new Date(), [])

  const timelineData = useMemo(() => {
    const sections: Record<TimelineSection, EmployeeTaskItem[]> = {
      OVERDUE: [],
      DUE_TODAY: [],
      UPCOMING: [],
      NO_DEADLINE: [],
      COMPLETED: [],
    }

    for (const item of items) {
      const taskStatus = (item.status || item.assignment_status || '').toUpperCase()
      const isCompleted = ['COMPLETED', 'CANCELLED', 'REJECTED'].includes(taskStatus)
      const section = getTimelineSection({
        deadlineAt: item.current_deadline || item.original_deadline,
        isCompleted,
        serverNow: now,
      })
      sections[section].push(item)
    }

    for (const section of TIMELINE_SECTIONS) {
      sections[section.key] = sortTimelineItems(
        sections[section.key].map(item => {
          const taskStatus = (item.status || item.assignment_status || '').toUpperCase()
          return {
            deadlineAt: item.current_deadline || item.original_deadline,
            completedAt: item.completed_at || item.ended_at,
            assignedAt: item.assigned_at,
            isCompleted: ['COMPLETED', 'CANCELLED', 'REJECTED'].includes(taskStatus),
            original: item,
          }
        }),
        section.key,
      ).map(wrapped => wrapped.original)
    }

    return sections
  }, [items, now])

  const canReadCost = permissions.includes('task.cost_read_all') || permissions.includes('task.cost_read_team')

  function renderTaskRow(item: EmployeeTaskItem) {
    const deadline = item.current_deadline || item.original_deadline
    const taskStatus = (item.status || item.assignment_status || '').toUpperCase()
    const perf = getAssignmentDeadlinePerformance({
      deadlineAt: deadline,
      completedAt: item.completed_at || item.ended_at,
      assignmentStatus: taskStatus,
      serverNow: now,
    })
    const perfStyle = getDeadlinePerformanceStyle(perf)
    const accentClass = getPerformanceAccentClass(perf)
    const priorityStyle = getTaskPriorityStyle(item.priority)
    const statusStyle = getTaskStatusStyle(taskStatus)

    return (
      <tr key={item.assignment_id} className={accentClass} style={{ cursor: 'pointer' }} onClick={() => navigate(`/tasks/${item.task_id}`)}>
        <td className="mono" style={{ whiteSpace: 'nowrap' }}>{item.task_code}</td>
        <td>{item.title}</td>
        <td>{item.project_name || '—'}</td>
        <td><span className={priorityStyle.className} aria-label={priorityStyle.ariaLabel}>{priorityStyle.label}</span></td>
        <td><span className={statusStyle.className} aria-label={statusStyle.ariaLabel}>{statusStyle.label}</span></td>
        <td className="mono" style={{ whiteSpace: 'nowrap' }}>{formatDeadline(item.original_deadline, item.current_deadline)}</td>
        <td style={{ textAlign: 'center' }}>{item.progress_percent}%</td>
        {canReadCost ? <td className="mono">{formatTaskCost(item.task_cost, item.task_cost_currency)}</td> : null}
        <td><span className={perfStyle.className} aria-label={perfStyle.ariaLabel}>{perfStyle.label}</span></td>
        <td style={{ textAlign: 'center' }}>
          {item.evidence_count > 0
            ? <span style={{ fontSize: '12px' }}>{item.evidence_count} {item.evidence_count === 1 ? 'report' : 'reports'} / {item.evidence_photo_count} photos</span>
            : <span style={{ fontSize: '12px', color: 'var(--slate)' }}>—</span>}
        </td>
        <td>
          <button className="btn btn-sm" onClick={e => { e.stopPropagation(); navigate(`/tasks/${item.task_id}`) }}>View Details</button>
        </td>
      </tr>
    )
  }

  function renderTaskCard(item: EmployeeTaskItem) {
    const deadline = item.current_deadline || item.original_deadline
    const taskStatus = (item.status || item.assignment_status || '').toUpperCase()
    const perf = getAssignmentDeadlinePerformance({
      deadlineAt: deadline,
      completedAt: item.completed_at || item.ended_at,
      assignmentStatus: taskStatus,
      serverNow: now,
    })
    const perfStyle = getDeadlinePerformanceStyle(perf)
    const priorityStyle = getTaskPriorityStyle(item.priority)
    const statusStyle = getTaskStatusStyle(taskStatus)

    return (
      <div key={item.assignment_id} className="task-card-mobile" onClick={() => navigate(`/tasks/${item.task_id}`)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
          <span className="mono" style={{ fontSize: '12px', color: 'var(--slate)' }}>{item.task_code}</span>
          <span className={statusStyle.className} aria-label={statusStyle.ariaLabel}>{statusStyle.label}</span>
        </div>
        <div style={{ fontWeight: 600, marginBottom: '4px' }}>{item.title}</div>
        {item.project_name && <div style={{ fontSize: '12px', color: 'var(--slate)', marginBottom: '4px' }}>{item.project_name}</div>}
        <div className="task-card-badges">
          <span className={priorityStyle.className} aria-label={priorityStyle.ariaLabel}>{priorityStyle.label}</span>
          <span className={perfStyle.className} aria-label={perfStyle.ariaLabel}>{perfStyle.label}</span>
          <span className="mono" style={{ fontSize: '11px' }}>{formatDeadline(item.original_deadline, item.current_deadline)}</span>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--slate)', marginTop: '4px' }}>Progress: {item.progress_percent}%</div>
        {item.evidence_count > 0 && (
          <div style={{ fontSize: '11px', color: 'var(--slate)', marginTop: '4px' }}>{item.evidence_count} reports / {item.evidence_photo_count} photos</div>
        )}
        <button className="btn btn-sm" style={{ marginTop: '8px' }} onClick={e => { e.stopPropagation(); navigate(`/tasks/${item.task_id}`) }}>View Details</button>
      </div>
    )
  }

  // Restore filters from URL when going back
  const backUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (searchParams.get('q')) params.set('q', searchParams.get('q')!)
    if (searchParams.get('dept')) params.set('dept', searchParams.get('dept')!)
    if (searchParams.get('branch')) params.set('branch', searchParams.get('branch')!)
    if (searchParams.get('desig')) params.set('desig', searchParams.get('desig')!)
    if (searchParams.get('mgr')) params.set('mgr', searchParams.get('mgr')!)
    if (searchParams.get('overdue')) params.set('overdue', searchParams.get('overdue')!)
    if (searchParams.get('pending')) params.set('pending', searchParams.get('pending')!)
    if (searchParams.get('submitted')) params.set('submitted', searchParams.get('submitted')!)
    const qs = params.toString()
    return `/team-tasks${qs ? `?${qs}` : ''}`
  }, [searchParams])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <button className="btn btn-sm btn-back" onClick={() => navigate(backUrl)} style={{ marginBottom: 'var(--space-2)' }}>← Back to Team Tasks</button>
          <h2 className="page-title">
            {employeeInfo ? `${employeeInfo.full_name}` : 'Employee Tasks'}
          </h2>
          {employeeInfo && (
            <div className="page-summary">
              {employeeInfo.employee_code}
              {employeeInfo.designation ? ` · ${employeeInfo.designation}` : ''}
              {employeeInfo.department_name ? ` · ${employeeInfo.department_name}` : ''}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="card"><ListSkeleton rows={5} /></div>
      ) : accessDenied ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-text">You do not have access to view tasks for this employee.</div>
            <button className="btn btn-secondary" onClick={() => navigate('/team-tasks')} style={{ marginTop: 'var(--space-3)' }}>Back to Team Tasks</button>
          </div>
        </div>
      ) : error ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-text">Team Tasks could not be loaded.</div>
            <button className="btn btn-secondary" onClick={loadData} style={{ marginTop: 'var(--space-3)' }}>Retry</button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-text">No tasks are currently assigned to this employee.</div>
          </div>
        </div>
      ) : (
        <>
          {/* Performance Summary */}
          {employeeInfo && (
            <div className="card" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-4)' }}>
              <div className="employee-card-stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                <div className="employee-stat">
                  <div className="employee-stat-num">{employeeInfo.active_tasks}</div>
                  <div className="employee-stat-lbl">Active Tasks</div>
                </div>
                <div className="employee-stat">
                  <div className="employee-stat-num" style={{ color: employeeInfo.overdue > 0 ? '#7F1D1D' : undefined }}>{employeeInfo.overdue}</div>
                  <div className="employee-stat-lbl">Overdue</div>
                </div>
                <div className="employee-stat">
                  <div className="employee-stat-num" style={{ color: '#166534' }}>{employeeInfo.met_deadline}</div>
                  <div className="employee-stat-lbl">Completed On Time</div>
                </div>
                <div className="employee-stat">
                  <div className="employee-stat-num" style={{ color: employeeInfo.missed_deadline > 0 ? '#7F1D1D' : undefined }}>{employeeInfo.missed_deadline}</div>
                  <div className="employee-stat-lbl">Completed Late</div>
                </div>
                {employeeInfo.deadline_success_pct != null && (
                  <div className="employee-stat">
                    <div className="employee-stat-num" style={{ color: employeeInfo.deadline_success_pct >= 75 ? '#166534' : employeeInfo.deadline_success_pct >= 50 ? '#92400E' : '#7F1D1D' }}>{employeeInfo.deadline_success_pct}%</div>
                    <div className="employee-stat-lbl">Deadline Success</div>
                  </div>
                )}
              </div>
              {employeeInfo.overdue > 0 ? (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <span className="perf-badge perf-overdue" aria-label={`${employeeInfo.overdue} task${employeeInfo.overdue > 1 ? 's' : ''} require${employeeInfo.overdue > 1 ? '' : 's'} immediate attention`}>
                    {employeeInfo.overdue} task{employeeInfo.overdue > 1 ? 's' : ''} require{employeeInfo.overdue > 1 ? '' : 's'} immediate attention.
                  </span>
                </div>
              ) : (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <span className="perf-badge perf-met">Current assignments are on track.</span>
                </div>
              )}
            </div>
          )}

          {/* Timeline sections */}
          {TIMELINE_SECTIONS.map(section => {
            const sectionItems = timelineData[section.key]
            if (sectionItems.length === 0) return null
            return (
              <div key={section.key} className="timeline-section">
                <div className="timeline-section-header">
                  <span className="timeline-section-title">{section.label}</span>
                  <span className="timeline-section-count">{sectionItems.length}</span>
                </div>
                <div className="card">
                  <div className="table-wrap team-tasks-desktop">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Code</th><th>Title</th><th>Project</th><th>Priority</th>
                          <th>Assignment Status</th><th>Deadline</th><th>Progress</th>
                          {canReadCost && <th>Cost</th>}
                          <th>Performance</th><th>Evidence</th><th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sectionItems.map(renderTaskRow)}
                      </tbody>
                    </table>
                  </div>
                  <div className="team-tasks-mobile">
                    {sectionItems.map(renderTaskCard)}
                  </div>
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
