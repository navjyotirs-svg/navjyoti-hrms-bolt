export type TaskPriorityCode = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface TaskPriorityStyle {
  label: string
  className: string
  ariaLabel: string
}

const PRIORITY_MAP: Record<TaskPriorityCode, TaskPriorityStyle> = {
  LOW: {
    label: 'Low',
    className: 'priority-badge priority-low',
    ariaLabel: 'Low priority',
  },
  MEDIUM: {
    label: 'Medium',
    className: 'priority-badge priority-medium',
    ariaLabel: 'Medium priority',
  },
  HIGH: {
    label: 'High',
    className: 'priority-badge priority-high',
    ariaLabel: 'High priority',
  },
  CRITICAL: {
    label: 'Critical',
    className: 'priority-badge priority-critical',
    ariaLabel: 'Critical priority',
  },
}

export function getTaskPriorityStyle(priority: string): TaskPriorityStyle {
  const code = (priority || '').toUpperCase() as TaskPriorityCode
  return PRIORITY_MAP[code] || PRIORITY_MAP.MEDIUM
}

// ============================================================
// ASSIGNMENT STATUS STYLES
// ============================================================

export type AssignmentStatusCode =
  | 'ACCEPTANCE_PENDING'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'REVISION_REQUIRED'
  | 'COMPLETED'
  | 'REASSIGNMENT_REQUESTED'
  | 'REJECTED'
  | 'CANCELLED'

export interface TaskStatusStyle {
  label: string
  className: string
  ariaLabel: string
}

const STATUS_MAP: Record<string, TaskStatusStyle> = {
  ACCEPTANCE_PENDING: {
    label: 'Acceptance Pending',
    className: 'status-badge status-acceptance-pending',
    ariaLabel: 'Acceptance pending',
  },
  ACCEPTED: {
    label: 'Accepted',
    className: 'status-badge status-accepted',
    ariaLabel: 'Accepted',
  },
  IN_PROGRESS: {
    label: 'In Progress',
    className: 'status-badge status-in-progress',
    ariaLabel: 'In progress',
  },
  SUBMITTED: {
    label: 'Submitted',
    className: 'status-badge status-submitted',
    ariaLabel: 'Submitted',
  },
  REVISION_REQUIRED: {
    label: 'Revision Required',
    className: 'status-badge status-revision-required',
    ariaLabel: 'Revision required',
  },
  COMPLETED: {
    label: 'Completed',
    className: 'status-badge status-completed',
    ariaLabel: 'Completed',
  },
  REASSIGNMENT_REQUESTED: {
    label: 'Reassignment Requested',
    className: 'status-badge status-reassignment-requested',
    ariaLabel: 'Reassignment requested',
  },
  REJECTED: {
    label: 'Rejected',
    className: 'status-badge status-rejected',
    ariaLabel: 'Rejected',
  },
  CANCELLED: {
    label: 'Cancelled',
    className: 'status-badge status-cancelled',
    ariaLabel: 'Cancelled',
  },
  // Task-level statuses (mapped to closest assignment equivalent)
  DRAFT: {
    label: 'Draft',
    className: 'status-badge status-cancelled',
    ariaLabel: 'Draft',
  },
  ASSIGNED: {
    label: 'Assigned',
    className: 'status-badge status-acceptance-pending',
    ariaLabel: 'Assigned',
  },
  REVISION_REQUESTED: {
    label: 'Revision Requested',
    className: 'status-badge status-revision-required',
    ariaLabel: 'Revision requested',
  },
  ON_HOLD: {
    label: 'On Hold',
    className: 'status-badge status-cancelled',
    ariaLabel: 'On hold',
  },
  REVIEW_REQUIRED: {
    label: 'Review Required',
    className: 'status-badge status-submitted',
    ariaLabel: 'Review required',
  },
}

export function getTaskStatusStyle(status: string): TaskStatusStyle {
  const code = (status || '').toUpperCase()
  return STATUS_MAP[code] || {
    label: status || 'Unknown',
    className: 'status-badge status-cancelled',
    ariaLabel: status || 'Unknown',
  }
}

// ============================================================
// DEADLINE PERFORMANCE
// ============================================================

export type DeadlinePerformance =
  | 'MET_DEADLINE'
  | 'MISSED_DEADLINE'
  | 'OVERDUE'
  | 'IN_PROGRESS_ON_TIME'
  | 'NO_DEADLINE_DATA'

export interface DeadlinePerformanceStyle {
  label: string
  className: string
  ariaLabel: string
}

const PERFORMANCE_MAP: Record<DeadlinePerformance, DeadlinePerformanceStyle> = {
  MET_DEADLINE: {
    label: 'Met Deadline',
    className: 'perf-badge perf-met',
    ariaLabel: 'Task completed within the deadline',
  },
  MISSED_DEADLINE: {
    label: 'Missed Deadline',
    className: 'perf-badge perf-missed',
    ariaLabel: 'Task completed after the deadline',
  },
  OVERDUE: {
    label: 'Overdue',
    className: 'perf-badge perf-overdue',
    ariaLabel: 'Task deadline has passed',
  },
  IN_PROGRESS_ON_TIME: {
    label: 'On Track',
    className: 'perf-badge perf-ontrack',
    ariaLabel: 'Task is on track',
  },
  NO_DEADLINE_DATA: {
    label: 'Deadline Not Available',
    className: 'perf-badge perf-nodata',
    ariaLabel: 'No deadline data available',
  },
}

const COMPLETED_STATUSES = ['COMPLETED', 'DONE', 'CLOSED', 'CANCELLED']

export function getAssignmentDeadlinePerformance(params: {
  deadlineAt: string | null | undefined
  completedAt: string | null | undefined
  assignmentStatus: string
  serverNow?: Date
}): DeadlinePerformance {
  const { deadlineAt, completedAt, assignmentStatus, serverNow } = params
  const now = serverNow || new Date()

  const isCompleted = COMPLETED_STATUSES.includes((assignmentStatus || '').toUpperCase())

  if (!deadlineAt) {
    return 'NO_DEADLINE_DATA'
  }

  const deadline = new Date(deadlineAt)
  if (isNaN(deadline.getTime())) {
    return 'NO_DEADLINE_DATA'
  }

  if (isCompleted && completedAt) {
    const completed = new Date(completedAt)
    if (completed.getTime() <= deadline.getTime()) {
      return 'MET_DEADLINE'
    }
    return 'MISSED_DEADLINE'
  }

  if (isCompleted && !completedAt) {
    return 'NO_DEADLINE_DATA'
  }

  if (!isCompleted) {
    if (now.getTime() > deadline.getTime()) {
      return 'OVERDUE'
    }
    return 'IN_PROGRESS_ON_TIME'
  }

  return 'NO_DEADLINE_DATA'
}

export function getDeadlinePerformanceStyle(perf: DeadlinePerformance): DeadlinePerformanceStyle {
  return PERFORMANCE_MAP[perf] || PERFORMANCE_MAP.NO_DEADLINE_DATA
}

export function getPerformanceAccentClass(perf: DeadlinePerformance): string {
  switch (perf) {
    case 'MET_DEADLINE':
      return 'perf-accent-met'
    case 'MISSED_DEADLINE':
    case 'OVERDUE':
      return 'perf-accent-overdue'
    default:
      return ''
  }
}

// ============================================================
// TIMELINE CATEGORISATION
// ============================================================

export type TimelineSection = 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING' | 'NO_DEADLINE' | 'COMPLETED'

export interface TimelineSectionInfo {
  key: TimelineSection
  label: string
}

export const TIMELINE_SECTIONS: TimelineSectionInfo[] = [
  { key: 'OVERDUE', label: 'Overdue' },
  { key: 'DUE_TODAY', label: 'Due Today' },
  { key: 'UPCOMING', label: 'Upcoming' },
  { key: 'NO_DEADLINE', label: 'No Deadline' },
  { key: 'COMPLETED', label: 'Completed History' },
]

export function getTimelineSection(params: {
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

export function sortTimelineItems<T extends {
  deadlineAt: string | null | undefined
  completedAt: string | null | undefined
  assignedAt: string | null | undefined
  isCompleted: boolean
}>(items: T[], section: TimelineSection, _serverNow?: Date): T[] {
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
