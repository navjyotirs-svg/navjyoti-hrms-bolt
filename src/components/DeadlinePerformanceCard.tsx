import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getAssignmentDeadlinePerformance, type DeadlinePerformance } from '@/lib/taskPriority'

interface PerfStats {
  metDeadline: number
  missedDeadline: number
  overdue: number
  onTrack: number
  total: number
}

export function DeadlinePerformanceCard({ employeeId }: { employeeId: string }) {
  const [stats, setStats] = useState<PerfStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!employeeId) { setLoading(false); return }
    let cancelled = false

    async function load() {
      try {
        const { data: assignments } = await supabase
          .from('task_assignments')
          .select(`
            id, assignment_status, ended_at, is_current,
            tasks!inner (id, current_deadline, original_deadline, status)
          `)
          .eq('assigned_employee_id', employeeId)
          .eq('is_current', true)

        if (cancelled || !assignments) { setLoading(false); return }

        const now = new Date()
        const s: PerfStats = { metDeadline: 0, missedDeadline: 0, overdue: 0, onTrack: 0, total: assignments.length }

        for (const a of assignments) {
          const task = a.tasks as any
          const deadline = task?.current_deadline || task?.original_deadline
          const perf: DeadlinePerformance = getAssignmentDeadlinePerformance({
            deadlineAt: deadline,
            completedAt: a.ended_at,
            assignmentStatus: a.assignment_status || task?.status || '',
            serverNow: now,
          })
          if (perf === 'MET_DEADLINE') s.metDeadline++
          else if (perf === 'MISSED_DEADLINE') s.missedDeadline++
          else if (perf === 'OVERDUE') s.overdue++
          else if (perf === 'IN_PROGRESS_ON_TIME') s.onTrack++
        }
        if (!cancelled) setStats(s)
      } catch {
        if (!cancelled) setStats(null)
      }
      if (!cancelled) setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [employeeId])

  if (loading) return null
  if (!stats || stats.total === 0) {
    return (
      <div className="dashboard-section">
        <h3 className="dashboard-section-title">Deadline Performance</h3>
        <div className="card dashboard-status-card">
          <div className="dashboard-status-row">
            <span className="dashboard-status-label">
              <span className="perf-badge perf-nodata">Performance data will appear after task activity is available.</span>
            </span>
          </div>
        </div>
      </div>
    )
  }

  const successPct = stats.total > 0 ? Math.round((stats.metDeadline / stats.total) * 100) : 0
  const hasOverdue = stats.overdue > 0
  const accentClass = hasOverdue ? 'perf-accent-overdue' : (stats.missedDeadline === 0 && stats.overdue === 0 ? 'perf-accent-met' : '')

  let bannerText = ''
  let bannerClass = ''
  if (hasOverdue) {
    bannerText = `Attention Required: You have ${stats.overdue} overdue task${stats.overdue > 1 ? 's' : ''}.`
    bannerClass = 'perf-badge perf-overdue'
  } else if (stats.missedDeadline === 0 && stats.overdue === 0 && stats.metDeadline > 0) {
    bannerText = 'On Track: Your current tasks are meeting their deadlines.'
    bannerClass = 'perf-badge perf-met'
  } else if (stats.missedDeadline > 0) {
    bannerText = `You have ${stats.missedDeadline} task${stats.missedDeadline > 1 ? 's' : ''} completed after the deadline.`
    bannerClass = 'perf-badge perf-missed'
  }

  return (
    <div className="dashboard-section">
      <h3 className="dashboard-section-title">Deadline Performance</h3>
      <div className={`card dashboard-status-card ${accentClass}`} style={{ padding: 'var(--space-4)' }}>
        {bannerText && (
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <span className={bannerClass} aria-label={bannerText}>{bannerText}</span>
          </div>
        )}
        <div className="dashboard-grid">
          <div className="dashboard-card">
            <div className="dashboard-card-num" style={{ color: '#166534' }}>{stats.metDeadline}</div>
            <div className="dashboard-card-lbl">Met Deadline</div>
          </div>
          <div className="dashboard-card">
            <div className="dashboard-card-num" style={{ color: '#7F1D1D' }}>{stats.missedDeadline}</div>
            <div className="dashboard-card-lbl">Missed Deadline</div>
          </div>
          <div className="dashboard-card">
            <div className="dashboard-card-num" style={{ color: '#7F1D1D' }}>{stats.overdue}</div>
            <div className="dashboard-card-lbl">Overdue</div>
          </div>
          <div className="dashboard-card">
            <div className="dashboard-card-num" style={{ color: 'var(--slate-600)' }}>{stats.onTrack}</div>
            <div className="dashboard-card-lbl">On Track</div>
          </div>
          <div className="dashboard-card">
            <div className="dashboard-card-num" style={{ color: successPct >= 75 ? '#166534' : successPct >= 50 ? '#92400E' : '#7F1D1D' }}>{successPct}%</div>
            <div className="dashboard-card-lbl">Deadline Success</div>
          </div>
        </div>
      </div>
    </div>
  )
}
