import { useEffect, useState, useMemo } from 'react'
import {
  getKolkataDate, fetchMyReport, saveDraft, submitReport,
  addTaskItem, deleteTaskItem,
  type DailyReportRow, type DailyReportTaskItem,
} from '@/lib/dailyReports'
import { fetchMyTasks, type TaskWithAssignments } from '@/lib/tasks'
import { DailyReportSkeleton } from '@/components/Skeleton'
import { TaskPhotoGrid } from '@/components/TaskPhotoGrid'
import { TASK_STATUS_LABELS } from '@/types/roles'
import '@/styles/shared.css'

const ACTIVE_TASK_STATUSES = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'REVISION_REQUIRED', 'REVIEW_REQUIRED', 'REVISION_REQUESTED', 'ACCEPTANCE_PENDING']

interface TaskItemWithTask extends DailyReportTaskItem {
  task?: TaskWithAssignments
}

export function DailyReportPage() {
  const today = getKolkataDate()
  const [reportDate, setReportDate] = useState(today)
  const [existing, setExisting] = useState<DailyReportRow | null>(null)
  const [taskItems, setTaskItems] = useState<TaskItemWithTask[]>([])
  const [assignedTasks, setAssignedTasks] = useState<TaskWithAssignments[]>([])
  const [loadingTasks, setLoadingTasks] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [taskSearch, setTaskSearch] = useState('')
  const [showTaskSelector, setShowTaskSelector] = useState(false)
  const [preparingTaskId, setPreparingTaskId] = useState<string | null>(null)
  const [noTaskToday, setNoTaskToday] = useState(false)
  const [noTaskExplanation, setNoTaskExplanation] = useState('')

  const [form, setForm] = useState({
    overall_summary: '',
    work_planned: '',
    work_completed: '',
    overall_result: '',
    pending_work: '',
    blockers: '',
    support_required: '',
    follow_up_required: false,
    tomorrow_plan: '',
  })

  useEffect(() => { loadReport() }, [reportDate])
  useEffect(() => { loadAssignedTasks() }, [])

  async function loadReport() {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchMyReport(reportDate)
      if (data) {
        setExisting(data as DailyReportRow)
        setForm({
          overall_summary: data.overall_summary || '',
          work_planned: data.work_planned || '',
          work_completed: data.work_completed || '',
          overall_result: data.overall_result || '',
          pending_work: data.pending_work || '',
          blockers: data.blockers || '',
          support_required: data.support_required || '',
          follow_up_required: data.follow_up_required || false,
          tomorrow_plan: data.tomorrow_plan || '',
        })
        const items = (data.daily_report_task_items || []) as DailyReportTaskItem[]
        setTaskItems(items.map(it => ({ ...it })))
        setNoTaskToday(items.length === 0 && (data.overall_summary || '').length > 0)
      } else {
        setExisting(null)
        setForm({ overall_summary: '', work_planned: '', work_completed: '', overall_result: '', pending_work: '', blockers: '', support_required: '', follow_up_required: false, tomorrow_plan: '' })
        setTaskItems([])
        setNoTaskToday(false)
      }
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  async function loadAssignedTasks() {
    setLoadingTasks(true)
    try {
      const tasks = await fetchMyTasks()
      const active = tasks.filter(t => ACTIVE_TASK_STATUSES.includes(t.status))
      setAssignedTasks(active)
    } catch (e) { setError((e as Error).message) }
    setLoadingTasks(false)
  }

  const isReadOnly = existing && !['draft', 'returned'].includes(existing.status)

  const selectedTaskIds = useMemo(() => new Set(taskItems.map(t => t.task_id)), [taskItems])

  const filteredTasks = useMemo(() => {
    const search = taskSearch.toLowerCase().trim()
    if (!search) return assignedTasks
    return assignedTasks.filter(t =>
      t.task_code.toLowerCase().includes(search) ||
      t.title.toLowerCase().includes(search)
    )
  }, [assignedTasks, taskSearch])

  async function handleAddTask(task: TaskWithAssignments) {
    setPreparingTaskId(task.id)
    setError(null)
    try {
      // Step 1: Ensure a draft report exists (auto-create via saveDraft)
      let reportId = existing?.id
      if (!reportId) {
        const draftResult = await saveDraft({
          report_date: reportDate,
          overall_summary: form.overall_summary,
          work_planned: form.work_planned,
          work_completed: form.work_completed,
          overall_result: form.overall_result,
          pending_work: form.pending_work,
          blockers: form.blockers,
          support_required: form.support_required,
          follow_up_required: form.follow_up_required,
          tomorrow_plan: form.tomorrow_plan,
          task_items: [],
        })
        reportId = draftResult.report_id
        // Reload to get the full report with employee_id
        await loadReport()
      }

      if (!reportId) throw new Error('Failed to create draft report')

      // Step 2: Add the task item via edge function
      const result = await addTaskItem({
        report_id: reportId,
        task_id: task.id,
        progress_before: 0,
        progress_after: 0,
        work_done: '',
        result_achieved: '',
        evidence_required: false,
      })

      // Step 3: Add to local state with the returned item
      const newItem: TaskItemWithTask = {
        id: result.item?.id || crypto.randomUUID(),
        daily_report_id: reportId,
        task_id: task.id,
        progress_before: 0,
        progress_after: 0,
        work_done: '',
        result_achieved: '',
        pending_item: null,
        blocker: null,
        support_required: null,
        follow_up: false,
        hours_spent: 0,
        evidence_required: false,
        task,
      }
      setTaskItems(prev => [...prev, newItem])
      setShowTaskSelector(false)
      setNoTaskToday(false)
    } catch (e) {
      setError(`Failed to add task: ${(e as Error).message}`)
    }
    setPreparingTaskId(null)
  }

  async function handleRemoveTaskItem(itemId: string, idx: number) {
    try {
      await deleteTaskItem(itemId)
      setTaskItems(prev => prev.filter((_, i) => i !== idx))
    } catch (e) {
      setError(`Failed to remove task: ${(e as Error).message}`)
    }
  }

  function updateTaskItem(idx: number, field: string, value: string | number | boolean) {
    setTaskItems(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
  }

  async function handleSaveDraft() {
    setSaving(true); setError(null); setSuccess(null)
    try {
      await saveDraft({
        report_date: reportDate,
        ...form,
        task_items: taskItems.map(t => ({
          task_id: t.task_id,
          progress_before: t.progress_before,
          progress_after: t.progress_after,
          work_done: t.work_done,
          result_achieved: t.result_achieved,
          pending_item: t.pending_item,
          blocker: t.blocker,
          support_required: t.support_required,
          follow_up: t.follow_up,
          hours_spent: t.hours_spent,
          evidence_required: t.evidence_required,
        })),
      })
      setSuccess('Draft saved successfully')
      await loadReport()
    } catch (e) { setError((e as Error).message) }
    setSaving(false)
  }

  async function handleSubmit() {
    if (!form.overall_summary.trim()) { setError('Overall summary is required'); return }

    // Validate task items: each must have work_done and result_achieved
    for (let i = 0; i < taskItems.length; i++) {
      const item = taskItems[i]
      if (!item.work_done?.trim()) {
        setError(`Work Done Today is required for task ${i + 1}`)
        return
      }
      if (!item.result_achieved?.trim()) {
        setError(`Result Achieved is required for task ${i + 1}`)
        return
      }
    }

    setSaving(true); setError(null); setSuccess(null)
    try {
      await submitReport({
        report_date: reportDate,
        ...form,
        task_items: taskItems.map(t => ({
          task_id: t.task_id,
          progress_before: t.progress_before,
          progress_after: t.progress_after,
          work_done: t.work_done,
          result_achieved: t.result_achieved,
          pending_item: t.pending_item,
          blocker: t.blocker,
          support_required: t.support_required,
          follow_up: t.follow_up,
          hours_spent: t.hours_spent,
          evidence_required: t.evidence_required,
        })),
      })
      setSuccess('Report submitted successfully')
      await loadReport()
    } catch (e) { setError((e as Error).message) }
    setSaving(false)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">My Daily Report</h2>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}
      {success && <div className="form-success" style={{ marginBottom: '12px' }}>{success}</div>}

      <div className="card">
        <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="form-field">
            <label htmlFor="report-date">Report Date</label>
            <input id="report-date" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} disabled={!!isReadOnly} />
          </div>
          {existing && (
            <div className="form-field">
              <label>Status</label>
              <div><span className={`attendance-badge ${existing.status}`}>{existing.status}</span></div>
            </div>
          )}
        </div>

        {loading ? (
          <DailyReportSkeleton />
        ) : (
          <>
            {isReadOnly && (
              <div className="form-info" style={{ marginBottom: '12px' }}>
                This report has been {existing?.status}. You can no longer edit it.
              </div>
            )}

            {/* TASKS WORKED ON TODAY SECTION */}
            {!isReadOnly && (
              <div style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3)', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--surface)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Tasks Worked On Today</h3>
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => setShowTaskSelector(!showTaskSelector)}
                      disabled={loadingTasks}
                    >
                      {loadingTasks ? 'Loading tasks…' : 'Select Assigned Tasks'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setNoTaskToday(!noTaskToday)}
                      style={{ background: noTaskToday ? 'var(--teal)' : 'var(--surface-2)', color: noTaskToday ? 'white' : 'var(--ink)' }}
                    >
                      No Assigned Task Today
                    </button>
                  </div>
                </div>

                {showTaskSelector && (
                  <div style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--surface-2)', borderRadius: '6px' }}>
                    <input
                      type="text"
                      placeholder="Search assigned tasks by code or title…"
                      value={taskSearch}
                      onChange={(e) => setTaskSearch(e.target.value)}
                      style={{ width: '100%', marginBottom: 'var(--space-2)', minHeight: '36px' }}
                    />
                    {loadingTasks ? (
                      <div style={{ fontSize: '13px', color: 'var(--slate)' }}>Loading assigned tasks…</div>
                    ) : assignedTasks.length === 0 ? (
                      <div style={{ fontSize: '13px', color: 'var(--slate)', padding: 'var(--space-2)' }}>
                        No active assigned tasks are available for this date.
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: '12px', color: 'var(--slate)', marginBottom: 'var(--space-2)' }}>
                          {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''} available
                        </div>
                        <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                          {filteredTasks.map((task) => {
                            const isSelected = selectedTaskIds.has(task.id)
                            return (
                              <button
                                key={task.id}
                                type="button"
                                onClick={() => !isSelected && handleAddTask(task)}
                                disabled={isSelected || preparingTaskId === task.id}
                                style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                  padding: 'var(--space-2) var(--space-3)',
                                  border: `1px solid ${isSelected ? 'var(--teal)' : 'var(--border)'}`,
                                  borderRadius: '6px',
                                  background: isSelected ? 'var(--surface)' : 'white',
                                  cursor: isSelected ? 'default' : 'pointer',
                                  opacity: isSelected ? 0.6 : 1,
                                  textAlign: 'left',
                                }}
                              >
                                <div>
                                  <span style={{ fontSize: '13px', fontWeight: 600 }}>{task.task_code}</span>
                                  <span style={{ fontSize: '13px', marginLeft: 'var(--space-2)' }}>{task.title}</span>
                                </div>
                                <span style={{ fontSize: '11px', color: 'var(--slate)' }}>
                                  {preparingTaskId === task.id ? 'Preparing…' : isSelected ? 'Added' : 'Add'}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {noTaskToday && (
                  <div style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--surface-2)', borderRadius: '6px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: 'var(--space-2)' }}>No Assigned Task Today</div>
                    <div className="form-field" style={{ marginBottom: 'var(--space-2)' }}>
                      <label>Explanation *</label>
                      <textarea
                        rows={2}
                        placeholder="Explain why no task was assigned today"
                        value={noTaskExplanation}
                        onChange={(e) => setNoTaskExplanation(e.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label>Work Completed</label>
                      <textarea
                        rows={2}
                        placeholder="What did you work on today?"
                        value={form.work_completed}
                        onChange={(e) => setForm({ ...form, work_completed: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TASK ITEM CARDS */}
            {taskItems.length > 0 && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
                  Task Items ({taskItems.length})
                </h3>
                {taskItems.map((item, idx) => {
                  const task = item.task || assignedTasks.find(t => t.id === item.task_id)
                  return (
                    <div key={item.id || idx} className="card" style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-3)', border: '1px solid var(--border)' }}>
                      {/* Task header */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: '14px' }}>
                            {task?.task_code || 'Task'}
                          </span>
                          <span style={{ fontSize: '14px', marginLeft: 'var(--space-2)' }}>
                            {task?.title || ''}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          {task && (
                            <span className={`attendance-badge ${task.status}`} style={{ fontSize: '11px' }}>
                              {TASK_STATUS_LABELS[task.status] || task.status}
                            </span>
                          )}
                          {!isReadOnly && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => handleRemoveTaskItem(item.id, idx)}
                              style={{ fontSize: '11px', color: 'var(--rose)' }}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Task metadata */}
                      {task && (
                        <div style={{ display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-3)', flexWrap: 'wrap', fontSize: '12px', color: 'var(--slate)' }}>
                          <div>Deadline: {task.current_deadline ? new Date(task.current_deadline).toLocaleDateString('en-IN') : '—'}</div>
                          <div>Priority: {task.priority}</div>
                        </div>
                      )}

                      {/* Work done + result */}
                      <div className="form-grid" style={{ marginBottom: 'var(--space-3)' }}>
                        <div className="form-field">
                          <label>Work Done Today *</label>
                          <textarea
                            rows={2}
                            value={item.work_done || ''}
                            onChange={(e) => updateTaskItem(idx, 'work_done', e.target.value)}
                            disabled={!!isReadOnly}
                            placeholder="What work did you do on this task today?"
                          />
                        </div>
                        <div className="form-field">
                          <label>Result Achieved *</label>
                          <textarea
                            rows={2}
                            value={item.result_achieved || ''}
                            onChange={(e) => updateTaskItem(idx, 'result_achieved', e.target.value)}
                            disabled={!!isReadOnly}
                            placeholder="What result did you achieve?"
                          />
                        </div>
                      </div>

                      {/* Progress + hours */}
                      <div className="form-grid" style={{ marginBottom: 'var(--space-3)' }}>
                        <div className="form-field">
                          <label>Progress Before (%)</label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={item.progress_before || 0}
                            onChange={(e) => updateTaskItem(idx, 'progress_before', Number(e.target.value))}
                            disabled={!!isReadOnly}
                          />
                        </div>
                        <div className="form-field">
                          <label>Progress After (%)</label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={item.progress_after || 0}
                            onChange={(e) => updateTaskItem(idx, 'progress_after', Number(e.target.value))}
                            disabled={!!isReadOnly}
                          />
                        </div>
                        <div className="form-field">
                          <label>Hours Spent</label>
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={item.hours_spent || 0}
                            onChange={(e) => updateTaskItem(idx, 'hours_spent', Number(e.target.value))}
                            disabled={!!isReadOnly}
                          />
                        </div>
                      </div>

                      {/* Blocker + support */}
                      <div className="form-grid" style={{ marginBottom: 'var(--space-3)' }}>
                        <div className="form-field">
                          <label>Blocker</label>
                          <textarea
                            rows={2}
                            value={item.blocker || ''}
                            onChange={(e) => updateTaskItem(idx, 'blocker', e.target.value)}
                            disabled={!!isReadOnly}
                            placeholder="Any blockers on this task?"
                          />
                        </div>
                        <div className="form-field">
                          <label>Support Required</label>
                          <textarea
                            rows={2}
                            value={item.support_required || ''}
                            onChange={(e) => updateTaskItem(idx, 'support_required', e.target.value)}
                            disabled={!!isReadOnly}
                            placeholder="Do you need any support?"
                          />
                        </div>
                      </div>

                      {/* Pending + follow-up */}
                      <div className="form-grid" style={{ marginBottom: 'var(--space-3)' }}>
                        <div className="form-field">
                          <label>Pending Item</label>
                          <textarea
                            rows={1}
                            value={item.pending_item || ''}
                            onChange={(e) => updateTaskItem(idx, 'pending_item', e.target.value)}
                            disabled={!!isReadOnly}
                            placeholder="Anything pending?"
                          />
                        </div>
                        <div className="form-field">
                          <label>Follow-up Required</label>
                          <select
                            value={item.follow_up ? 'yes' : 'no'}
                            onChange={(e) => updateTaskItem(idx, 'follow_up', e.target.value === 'yes')}
                            disabled={!!isReadOnly}
                          >
                            <option value="no">No</option>
                            <option value="yes">Yes</option>
                          </select>
                        </div>
                      </div>

                      {/* Photo grid */}
                      {existing?.id && item.id && (
                        <TaskPhotoGrid
                          dailyReportId={existing.id}
                          taskItemId={item.id}
                          taskId={item.task_id}
                          employeeId={existing.employee_id}
                          isReadOnly={!!isReadOnly}
                        />
                      )}

                      {/* Show preparing state for newly added items without IDs yet */}
                      {existing?.id && !item.id && (
                        <div style={{ fontSize: '13px', color: 'var(--slate)', padding: 'var(--space-2)' }}>
                          Preparing task evidence…
                        </div>
                      )}

                      {/* No report yet — show message */}
                      {!existing?.id && !isReadOnly && (
                        <div style={{ fontSize: '13px', color: 'var(--slate)', padding: 'var(--space-2)' }}>
                          Save draft or add a task to enable photo upload.
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Report fields */}
            <div className="form-field" style={{ marginBottom: 'var(--space-4)' }}>
              <label htmlFor="summary">Overall Summary *</label>
              <textarea id="summary" rows={3} value={form.overall_summary} onChange={(e) => setForm({ ...form, overall_summary: e.target.value })} disabled={!!isReadOnly} placeholder="High-level summary of the day's work" />
            </div>

            <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="form-field">
                <label htmlFor="work-planned">Work Planned</label>
                <textarea id="work-planned" rows={3} value={form.work_planned} onChange={(e) => setForm({ ...form, work_planned: e.target.value })} disabled={!!isReadOnly} />
              </div>
              <div className="form-field">
                <label htmlFor="work-completed">Work Completed</label>
                <textarea id="work-completed" rows={3} value={form.work_completed} onChange={(e) => setForm({ ...form, work_completed: e.target.value })} disabled={!!isReadOnly} />
              </div>
            </div>

            <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="form-field">
                <label htmlFor="overall-result">Overall Result</label>
                <textarea id="overall-result" rows={2} value={form.overall_result} onChange={(e) => setForm({ ...form, overall_result: e.target.value })} disabled={!!isReadOnly} />
              </div>
              <div className="form-field">
                <label htmlFor="pending-work">Pending Work</label>
                <textarea id="pending-work" rows={2} value={form.pending_work} onChange={(e) => setForm({ ...form, pending_work: e.target.value })} disabled={!!isReadOnly} />
              </div>
            </div>

            <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="form-field">
                <label htmlFor="blockers">Blockers</label>
                <textarea id="blockers" rows={2} value={form.blockers} onChange={(e) => setForm({ ...form, blockers: e.target.value })} disabled={!!isReadOnly} />
              </div>
              <div className="form-field">
                <label htmlFor="support">Support Required</label>
                <textarea id="support" rows={2} value={form.support_required} onChange={(e) => setForm({ ...form, support_required: e.target.value })} disabled={!!isReadOnly} />
              </div>
            </div>

            <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="form-field">
                <label htmlFor="tomorrow">Tomorrow's Plan</label>
                <textarea id="tomorrow" rows={2} value={form.tomorrow_plan} onChange={(e) => setForm({ ...form, tomorrow_plan: e.target.value })} disabled={!!isReadOnly} />
              </div>
              <div className="form-field">
                <label htmlFor="follow-up">Follow-up Required</label>
                <select id="follow-up" value={form.follow_up_required ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, follow_up_required: e.target.value === 'yes' })} disabled={!!isReadOnly}>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>
            </div>

            {!isReadOnly && (
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={saving}>Save Draft</button>
                <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>Submit Report</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
