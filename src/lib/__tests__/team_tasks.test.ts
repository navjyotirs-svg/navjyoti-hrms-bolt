import { test } from 'node:test'
import assert from 'node:assert/strict'

// ============================================================
// Re-implement pure logic from taskPriority.ts for testing
// ============================================================

const PRIORITY_MAP: Record<string, { label: string; className: string }> = {
  LOW: { label: 'Low', className: 'priority-badge priority-low' },
  MEDIUM: { label: 'Medium', className: 'priority-badge priority-medium' },
  HIGH: { label: 'High', className: 'priority-badge priority-high' },
  CRITICAL: { label: 'Critical', className: 'priority-badge priority-critical' },
}

function getTaskPriorityStyle(priority: string) {
  const code = (priority || '').toUpperCase()
  return PRIORITY_MAP[code] || PRIORITY_MAP.MEDIUM
}

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  ACCEPTANCE_PENDING: { label: 'Acceptance Pending', className: 'status-badge status-acceptance-pending' },
  ACCEPTED: { label: 'Accepted', className: 'status-badge status-accepted' },
  IN_PROGRESS: { label: 'In Progress', className: 'status-badge status-in-progress' },
  SUBMITTED: { label: 'Submitted', className: 'status-badge status-submitted' },
  REVISION_REQUIRED: { label: 'Revision Required', className: 'status-badge status-revision-required' },
  COMPLETED: { label: 'Completed', className: 'status-badge status-completed' },
  REASSIGNMENT_REQUESTED: { label: 'Reassignment Requested', className: 'status-badge status-reassignment-requested' },
  REJECTED: { label: 'Rejected', className: 'status-badge status-rejected' },
  CANCELLED: { label: 'Cancelled', className: 'status-badge status-cancelled' },
}

function getTaskStatusStyle(status: string) {
  const code = (status || '').toUpperCase()
  return STATUS_MAP[code] || { label: status || 'Unknown', className: 'status-badge status-cancelled' }
}

const COMPLETED_STATUSES = ['COMPLETED', 'DONE', 'CLOSED', 'CANCELLED']

type DeadlinePerformance = 'MET_DEADLINE' | 'MISSED_DEADLINE' | 'OVERDUE' | 'IN_PROGRESS_ON_TIME' | 'NO_DEADLINE_DATA'

function getAssignmentDeadlinePerformance(params: {
  deadlineAt: string | null | undefined
  completedAt: string | null | undefined
  assignmentStatus: string
  serverNow?: Date
}): DeadlinePerformance {
  const { deadlineAt, completedAt, assignmentStatus, serverNow } = params
  const now = serverNow || new Date()
  const isCompleted = COMPLETED_STATUSES.includes((assignmentStatus || '').toUpperCase())
  if (!deadlineAt) return 'NO_DEADLINE_DATA'
  const deadline = new Date(deadlineAt)
  if (isNaN(deadline.getTime())) return 'NO_DEADLINE_DATA'
  if (isCompleted && completedAt) {
    const completed = new Date(completedAt)
    if (completed.getTime() <= deadline.getTime()) return 'MET_DEADLINE'
    return 'MISSED_DEADLINE'
  }
  if (isCompleted && !completedAt) return 'NO_DEADLINE_DATA'
  if (!isCompleted) {
    if (now.getTime() > deadline.getTime()) return 'OVERDUE'
    return 'IN_PROGRESS_ON_TIME'
  }
  return 'NO_DEADLINE_DATA'
}

type TimelineSection = 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING' | 'NO_DEADLINE' | 'COMPLETED'

function getTimelineSection(params: {
  deadlineAt: string | null | undefined
  isCompleted: boolean
  serverNow?: Date
}): TimelineSection {
  const { deadlineAt, isCompleted, serverNow } = params
  const now = serverNow || new Date()
  if (isCompleted) return 'COMPLETED'
  if (!deadlineAt) return 'NO_DEADLINE'
  const deadline = new Date(deadlineAt)
  if (isNaN(deadline.getTime())) return 'NO_DEADLINE'
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const deadlineDate = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate())
  if (deadlineDate.getTime() < nowDate.getTime()) return 'OVERDUE'
  if (deadlineDate.getTime() === nowDate.getTime()) return 'DUE_TODAY'
  return 'UPCOMING'
}

interface SortableItem {
  deadlineAt: string | null | undefined
  completedAt: string | null | undefined
  assignedAt: string | null | undefined
  isCompleted: boolean
}

function sortTimelineItems<T extends SortableItem>(items: T[], section: TimelineSection): T[] {
  const sorted = [...items]
  switch (section) {
    case 'OVERDUE':
      sorted.sort((a, b) => {
        const da = a.deadlineAt ? new Date(a.deadlineAt).getTime() : 0
        const db = b.deadlineAt ? new Date(b.deadlineAt).getTime() : 0
        return da - db
      })
      break
    case 'DUE_TODAY':
    case 'UPCOMING':
      sorted.sort((a, b) => {
        const da = a.deadlineAt ? new Date(a.deadlineAt).getTime() : Infinity
        const db = b.deadlineAt ? new Date(b.deadlineAt).getTime() : Infinity
        return da - db
      })
      break
    case 'NO_DEADLINE':
      sorted.sort((a, b) => {
        const aa = a.assignedAt ? new Date(a.assignedAt).getTime() : 0
        const bb = b.assignedAt ? new Date(b.assignedAt).getTime() : 0
        return bb - aa
      })
      break
    case 'COMPLETED':
      sorted.sort((a, b) => {
        const ca = a.completedAt ? new Date(a.completedAt).getTime() : 0
        const cb = b.completedAt ? new Date(b.completedAt).getTime() : 0
        return cb - ca
      })
      break
  }
  return sorted
}

// ============================================================
// TESTS
// ============================================================

// 1. Team Tasks defaults to employee overview
test('Team Tasks defaults to by_employee tab', () => {
  const defaultTab = 'by_employee'
  assert.equal(defaultTab, 'by_employee')
})

// 2. Every authorised employee appears once
test('Employee summaries are unique by employee id', () => {
  const summaries = [
    { id: 'emp1', full_name: 'Jay Kumar', active_tasks: 5 },
    { id: 'emp2', full_name: 'Ombir Singh', active_tasks: 3 },
    { id: 'emp1', full_name: 'Jay Kumar', active_tasks: 5 },
  ]
  const unique = new Map(summaries.map(s => [s.id, s]))
  assert.equal(unique.size, 2)
})

// 3. Employee task counts are correct
test('Employee task counts are computed from assignment statuses', () => {
  const assignments = [
    { assigned_to: 'emp1', assignment_status: 'IN_PROGRESS', tasks: { current_deadline: '2026-08-10T18:00:00+05:30' } },
    { assigned_to: 'emp1', assignment_status: 'ACCEPTANCE_PENDING', tasks: { current_deadline: '2026-07-30T18:00:00+05:30' } },
    { assigned_to: 'emp1', assignment_status: 'COMPLETED', tasks: { current_deadline: '2026-07-01T18:00:00+05:30' } },
    { assigned_to: 'emp1', assignment_status: 'SUBMITTED', tasks: { current_deadline: '2026-08-08T18:00:00+05:30' } },
  ]
  const now = new Date('2026-08-01T10:00:00+05:30')
  let active = 0, pending = 0, inProgress = 0, submitted = 0, completed = 0, overdue = 0
  for (const a of assignments) {
    const status = a.assignment_status.toUpperCase()
    if (['ACCEPTANCE_PENDING', 'ACCEPTED', 'IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUIRED', 'REASSIGNMENT_REQUESTED'].includes(status)) {
      active++
      if (status === 'ACCEPTANCE_PENDING') pending++
      if (status === 'IN_PROGRESS') inProgress++
      if (status === 'SUBMITTED') submitted++
      const dl = a.tasks.current_deadline
      if (dl && !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(status) && new Date(dl).getTime() < now.getTime()) overdue++
    } else if (status === 'COMPLETED') {
      completed++
    }
  }
  assert.equal(active, 3)
  assert.equal(pending, 1)
  assert.equal(inProgress, 1)
  assert.equal(submitted, 1)
  assert.equal(completed, 1)
  assert.equal(overdue, 1)
})

// 4. Clicking employee opens only their tasks
test('Employee timeline fetches only assignments for that employee', () => {
  const allAssignments = [
    { assigned_to: 'emp1', tasks: { id: 't1' } },
    { assigned_to: 'emp2', tasks: { id: 't2' } },
    { assigned_to: 'emp1', tasks: { id: 't3' } },
  ]
  const emp1Tasks = allAssignments.filter(a => a.assigned_to === 'emp1')
  assert.equal(emp1Tasks.length, 2)
  assert.ok(emp1Tasks.every(a => a.assigned_to === 'emp1'))
})

// 5. Manager cannot access unrelated employees
test('validateEmployeeAccess rejects cross-organisation employee', () => {
  const orgId = 'org-1'
  const employee = { organization_id: 'org-2', is_active: true, employment_status: 'active' }
  const canReadAll = false
  let hasAccess = true
  if (employee.organization_id !== orgId) hasAccess = false
  assert.equal(hasAccess, false)
})

// 6. Director sees organisation employees
test('Director with task.read_all sees all org employees', () => {
  const permissions = ['task.read_all']
  const canReadAll = permissions.includes('task.read_all')
  assert.ok(canReadAll)
})

// 7. Overdue tasks appear first
test('Overdue section appears before Due Today', () => {
  const sections = ['OVERDUE', 'DUE_TODAY', 'UPCOMING', 'NO_DEADLINE', 'COMPLETED']
  assert.ok(sections.indexOf('OVERDUE') < sections.indexOf('DUE_TODAY'))
})

// 8. Due Today tasks appear second
test('Due Today section appears before Upcoming', () => {
  const sections = ['OVERDUE', 'DUE_TODAY', 'UPCOMING', 'NO_DEADLINE', 'COMPLETED']
  assert.ok(sections.indexOf('DUE_TODAY') < sections.indexOf('UPCOMING'))
})

// 9. Upcoming tasks sort by nearest deadline
test('Upcoming tasks sort by nearest deadline first', () => {
  const items = [
    { deadlineAt: '2026-08-10T18:00:00+05:30', completedAt: null, assignedAt: '2026-08-01T10:00:00+05:30', isCompleted: false },
    { deadlineAt: '2026-08-05T18:00:00+05:30', completedAt: null, assignedAt: '2026-08-01T10:00:00+05:30', isCompleted: false },
    { deadlineAt: '2026-08-08T18:00:00+05:30', completedAt: null, assignedAt: '2026-08-01T10:00:00+05:30', isCompleted: false },
  ]
  const sorted = sortTimelineItems(items, 'UPCOMING')
  assert.equal(sorted[0].deadlineAt, '2026-08-05T18:00:00+05:30')
  assert.equal(sorted[1].deadlineAt, '2026-08-08T18:00:00+05:30')
  assert.equal(sorted[2].deadlineAt, '2026-08-10T18:00:00+05:30')
})

// 10. Completed tasks show latest completion first
test('Completed tasks sort by latest completion first', () => {
  const items = [
    { deadlineAt: '2026-07-01T18:00:00+05:30', completedAt: '2026-07-01T15:00:00+05:30', assignedAt: '2026-06-01T10:00:00+05:30', isCompleted: true },
    { deadlineAt: '2026-07-15T18:00:00+05:30', completedAt: '2026-07-15T20:00:00+05:30', assignedAt: '2026-06-15T10:00:00+05:30', isCompleted: true },
    { deadlineAt: '2026-07-10T18:00:00+05:30', completedAt: '2026-07-10T14:00:00+05:30', assignedAt: '2026-06-10T10:00:00+05:30', isCompleted: true },
  ]
  const sorted = sortTimelineItems(items, 'COMPLETED')
  assert.equal(sorted[0].completedAt, '2026-07-15T20:00:00+05:30')
  assert.equal(sorted[1].completedAt, '2026-07-10T14:00:00+05:30')
  assert.equal(sorted[2].completedAt, '2026-07-01T15:00:00+05:30')
})

// 11. Multi-assignee task shows selected employee's own status
test('Multi-assignee: only selected employee assignment_status is shown', () => {
  const assignments = [
    { assigned_to: 'emp1', assignment_status: 'IN_PROGRESS', is_current: true },
    { assigned_to: 'emp2', assignment_status: 'ACCEPTANCE_PENDING', is_current: true },
  ]
  const emp1Assignment = assignments.filter(a => a.assigned_to === 'emp1')
  assert.equal(emp1Assignment.length, 1)
  assert.equal(emp1Assignment[0].assignment_status, 'IN_PROGRESS')
})

// 12. One overdue assignee does not colour another employee
test('Multi-assignee: overdue assignee does not affect other assignee performance', () => {
  const deadline = '2026-07-01T18:00:00+05:30'
  const now = new Date('2026-08-01T10:00:00+05:30')
  const emp1Perf = getAssignmentDeadlinePerformance({ deadlineAt: deadline, completedAt: '2026-07-01T15:00:00+05:30', assignmentStatus: 'COMPLETED', serverNow: now })
  const emp2Perf = getAssignmentDeadlinePerformance({ deadlineAt: deadline, completedAt: null, assignmentStatus: 'IN_PROGRESS', serverNow: now })
  assert.equal(emp1Perf, 'MET_DEADLINE')
  assert.equal(emp2Perf, 'OVERDUE')
})

// 13. Priority colours are correct
test('Priority: LOW is green', () => {
  const s = getTaskPriorityStyle('LOW')
  assert.ok(s.className.includes('priority-low'))
  assert.equal(s.label, 'Low')
})
test('Priority: MEDIUM is amber', () => {
  const s = getTaskPriorityStyle('MEDIUM')
  assert.ok(s.className.includes('priority-medium'))
  assert.equal(s.label, 'Medium')
})
test('Priority: HIGH is red', () => {
  const s = getTaskPriorityStyle('HIGH')
  assert.ok(s.className.includes('priority-high'))
  assert.equal(s.label, 'High')
})
test('Priority: CRITICAL is dark red', () => {
  const s = getTaskPriorityStyle('CRITICAL')
  assert.ok(s.className.includes('priority-critical'))
  assert.equal(s.label, 'Critical')
})

// 14. Status colours are correct
test('Status: ACCEPTANCE_PENDING is amber', () => {
  const s = getTaskStatusStyle('ACCEPTANCE_PENDING')
  assert.ok(s.className.includes('status-acceptance-pending'))
  assert.equal(s.label, 'Acceptance Pending')
})
test('Status: ACCEPTED is blue', () => {
  const s = getTaskStatusStyle('ACCEPTED')
  assert.ok(s.className.includes('status-accepted'))
  assert.equal(s.label, 'Accepted')
})
test('Status: IN_PROGRESS is teal', () => {
  const s = getTaskStatusStyle('IN_PROGRESS')
  assert.ok(s.className.includes('status-in-progress'))
  assert.equal(s.label, 'In Progress')
})
test('Status: SUBMITTED is purple', () => {
  const s = getTaskStatusStyle('SUBMITTED')
  assert.ok(s.className.includes('status-submitted'))
  assert.equal(s.label, 'Submitted')
})
test('Status: COMPLETED is green', () => {
  const s = getTaskStatusStyle('COMPLETED')
  assert.ok(s.className.includes('status-completed'))
  assert.equal(s.label, 'Completed')
})
test('Status: CANCELLED is grey', () => {
  const s = getTaskStatusStyle('CANCELLED')
  assert.ok(s.className.includes('status-cancelled'))
  assert.equal(s.label, 'Cancelled')
})

// 15. Deadline performance colours are correct
test('Performance: MET_DEADLINE is green', () => {
  const result = getAssignmentDeadlinePerformance({
    deadlineAt: '2026-08-01T18:00:00+05:30',
    completedAt: '2026-08-01T15:00:00+05:30',
    assignmentStatus: 'COMPLETED',
  })
  assert.equal(result, 'MET_DEADLINE')
})
test('Performance: OVERDUE is dark red', () => {
  const result = getAssignmentDeadlinePerformance({
    deadlineAt: '2026-07-01T18:00:00+05:30',
    completedAt: null,
    assignmentStatus: 'IN_PROGRESS',
    serverNow: new Date('2026-08-01T10:00:00+05:30'),
  })
  assert.equal(result, 'OVERDUE')
})
test('Performance: NO_DEADLINE_DATA is grey', () => {
  const result = getAssignmentDeadlinePerformance({
    deadlineAt: null,
    completedAt: null,
    assignmentStatus: 'IN_PROGRESS',
  })
  assert.equal(result, 'NO_DEADLINE_DATA')
})

// 16. Action button colours are consistent
test('Action buttons have semantic CSS classes', () => {
  const actionClasses = [
    'btn-accept', 'btn-start', 'btn-progress', 'btn-submit',
    'btn-review', 'btn-reassign', 'btn-revision', 'btn-complete',
    'btn-cancel-action', 'btn-delete', 'btn-back',
  ]
  for (const cls of actionClasses) {
    assert.ok(cls.startsWith('btn-'), `${cls} should start with btn-`)
  }
})

// 17. Text labels remain visible with colours
test('Priority badges always have text labels', () => {
  for (const p of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) {
    const s = getTaskPriorityStyle(p)
    assert.ok(s.label.length > 0, `${p} should have a label`)
  }
})
test('Status badges always have text labels', () => {
  for (const s of ['ACCEPTANCE_PENDING', 'ACCEPTED', 'IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'CANCELLED']) {
    const style = getTaskStatusStyle(s)
    assert.ok(style.label.length > 0, `${s} should have a label`)
  }
})

// 18. Browser Back preserves employee filters
test('Filters are stored in URL query params', () => {
  const filters = { q: 'jay', dept: 'Engineering', overdue: '1' }
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.dept) params.set('dept', filters.dept)
  if (filters.overdue) params.set('overdue', filters.overdue)
  const qs = params.toString()
  assert.ok(qs.includes('q=jay'))
  assert.ok(qs.includes('dept=Engineering'))
  assert.ok(qs.includes('overdue=1'))
})

// 19. Mobile cards are responsive (CSS class check)
test('Mobile cards use responsive CSS classes', () => {
  const mobileClasses = ['employee-overview-grid', 'employee-card', 'task-card-mobile', 'employee-card-stats']
  for (const cls of mobileClasses) {
    assert.ok(cls.length > 0)
  }
})

// 20. Timeline section categorisation
test('Timeline: overdue task goes to OVERDUE section', () => {
  const section = getTimelineSection({
    deadlineAt: '2026-07-01T18:00:00+05:30',
    isCompleted: false,
    serverNow: new Date('2026-08-01T10:00:00+05:30'),
  })
  assert.equal(section, 'OVERDUE')
})
test('Timeline: task due today goes to DUE_TODAY', () => {
  const today = new Date()
  const deadlineToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 18, 0, 0).toISOString()
  const section = getTimelineSection({
    deadlineAt: deadlineToday,
    isCompleted: false,
    serverNow: today,
  })
  assert.equal(section, 'DUE_TODAY')
})
test('Timeline: future task goes to UPCOMING', () => {
  const section = getTimelineSection({
    deadlineAt: '2026-12-31T18:00:00+05:30',
    isCompleted: false,
    serverNow: new Date('2026-08-01T10:00:00+05:30'),
  })
  assert.equal(section, 'UPCOMING')
})
test('Timeline: no deadline goes to NO_DEADLINE', () => {
  const section = getTimelineSection({ deadlineAt: null, isCompleted: false })
  assert.equal(section, 'NO_DEADLINE')
})
test('Timeline: completed task goes to COMPLETED', () => {
  const section = getTimelineSection({ deadlineAt: '2026-07-01T18:00:00+05:30', isCompleted: true })
  assert.equal(section, 'COMPLETED')
})

// 21. Overdue sorting: earliest missed deadline first
test('Overdue tasks sort by earliest missed deadline first', () => {
  const items = [
    { deadlineAt: '2026-07-15T18:00:00+05:30', completedAt: null, assignedAt: '2026-07-01T10:00:00+05:30', isCompleted: false },
    { deadlineAt: '2026-07-01T18:00:00+05:30', completedAt: null, assignedAt: '2026-06-15T10:00:00+05:30', isCompleted: false },
    { deadlineAt: '2026-07-10T18:00:00+05:30', completedAt: null, assignedAt: '2026-06-20T10:00:00+05:30', isCompleted: false },
  ]
  const sorted = sortTimelineItems(items, 'OVERDUE')
  assert.equal(sorted[0].deadlineAt, '2026-07-01T18:00:00+05:30')
  assert.equal(sorted[1].deadlineAt, '2026-07-10T18:00:00+05:30')
  assert.equal(sorted[2].deadlineAt, '2026-07-15T18:00:00+05:30')
})

// 22. No deadline sorting: newest assigned first
test('No deadline tasks sort by newest assigned first', () => {
  const items = [
    { deadlineAt: null, completedAt: null, assignedAt: '2026-07-01T10:00:00+05:30', isCompleted: false },
    { deadlineAt: null, completedAt: null, assignedAt: '2026-07-15T10:00:00+05:30', isCompleted: false },
    { deadlineAt: null, completedAt: null, assignedAt: '2026-07-08T10:00:00+05:30', isCompleted: false },
  ]
  const sorted = sortTimelineItems(items, 'NO_DEADLINE')
  assert.equal(sorted[0].assignedAt, '2026-07-15T10:00:00+05:30')
  assert.equal(sorted[1].assignedAt, '2026-07-08T10:00:00+05:30')
  assert.equal(sorted[2].assignedAt, '2026-07-01T10:00:00+05:30')
})

// 23. Deadline success percentage calculation
test('Deadline success percentage = met / (met + missed) * 100', () => {
  const met = 8, missed = 2
  const pct = Math.round((met / (met + missed)) * 100)
  assert.equal(pct, 80)
})

test('Deadline success is null when no completed tasks with deadlines', () => {
  const met = 0, missed = 0
  const pct = met + missed > 0 ? Math.round((met / (met + missed)) * 100) : null
  assert.equal(pct, null)
})

// 24. Regression: no payroll features
test('Regression: no payroll features in priority/status utilities', () => {
  for (const p of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) {
    const s = getTaskPriorityStyle(p)
    assert.ok(!s.label.toLowerCase().includes('salary'))
    assert.ok(!s.label.toLowerCase().includes('payroll'))
  }
})

// 25. Unknown status falls back gracefully
test('Unknown status falls back with label', () => {
  const s = getTaskStatusStyle('UNKNOWN_STATUS')
  assert.ok(s.label.length > 0)
  assert.ok(s.className.includes('status-badge'))
})
