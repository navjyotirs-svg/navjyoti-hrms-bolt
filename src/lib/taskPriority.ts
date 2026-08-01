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
