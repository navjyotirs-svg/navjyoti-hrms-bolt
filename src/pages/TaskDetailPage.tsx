import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import {
  TASK_STATUS_LABELS, TASK_PRIORITY_LABELS, TASK_TYPE_LABELS,
  COMPLETION_OUTCOME_LABELS, ASSIGNMENT_TYPE_LABELS,
  TASK_REQUEST_TYPE_LABELS, TASK_REQUEST_STATUS_LABELS,
  SUBMISSION_REVIEW_LABELS, ATTACHMENT_CATEGORY_LABELS,
  DEPENDENCY_TYPE_LABELS,
  type TaskStatus, type TaskPriority, type TaskType, type CompletionOutcome,
  type AssignmentType, type TaskRequestType, type TaskRequestStatus,
  type SubmissionReviewStatus, type AttachmentCategory, type DependencyType,
} from '@/types/roles'
import {
  fetchTaskById, fetchTaskActionRequests, acceptTask,
  addProgressUpdate, submitTask, addTaskComment, uploadTaskAttachment,
  createTaskAttachmentSignedUrl, formatDate, formatDateTime,
} from '@/lib/tasks'
import '@/styles/shared.css'

export function TaskDetailPage() {
  const { id: taskId } = useParams<{ id: string }>()
  const { permissions, session } = useAuth()
  const navigate = useNavigate()
  const [task, setTask] = useState<any>(null)
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'progress' | 'submissions' | 'comments' | 'attachments' | 'history' | 'requests'>('overview')
  const [actionLoading, setActionLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [progressPercent, setProgressPercent] = useState(0)
  const [workCompleted, setWorkCompleted] = useState('')
  const [blocker, setBlocker] = useState('')
  const [resultSummary, setResultSummary] = useState('')
  const [submissionNote, setSubmissionNote] = useState('')

  const canAccept = permissions.includes('task.accept_self')
  const canRequestChange = permissions.includes('task.request_change_self')
  const canProgress = permissions.includes('task.progress_update_self')
  const canSubmit = permissions.includes('task.submit_self')
  const canComment = permissions.includes('task.comment')
  const canUpload = permissions.includes('task.attachment_upload')
  const canReadAttachments = permissions.includes('task.attachment_read')

  useEffect(() => {
    if (taskId) loadTask()
  }, [taskId])

  async function loadTask() {
    setLoading(true)
    setError(null)
    try {
      const [data, reqData] = await Promise.all([
        fetchTaskById(taskId!),
        fetchTaskActionRequests(taskId!),
      ])
      setTask(data)
      setRequests(reqData)
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }

  async function handleAccept() {
    setActionLoading(true)
    try {
      await acceptTask(taskId!)
      await loadTask()
    } catch (e) {
      setError((e as Error).message)
    }
    setActionLoading(false)
  }

  async function handleAddProgress() {
    if (!workCompleted.trim()) { setError('Work completed is required'); return }
    setActionLoading(true)
    try {
      await addProgressUpdate({
        task_id: taskId!,
        progress_percent: progressPercent,
        work_completed: workCompleted,
        blocker: blocker || undefined,
      })
      setProgressPercent(0)
      setWorkCompleted('')
      setBlocker('')
      await loadTask()
    } catch (e) {
      setError((e as Error).message)
    }
    setActionLoading(false)
  }

  async function handleSubmit() {
    if (!resultSummary.trim()) { setError('Result summary is required'); return }
    setActionLoading(true)
    try {
      await submitTask({
        task_id: taskId!,
        result_summary: resultSummary,
        submission_note: submissionNote || undefined,
      })
      setResultSummary('')
      setSubmissionNote('')
      await loadTask()
    } catch (e) {
      setError((e as Error).message)
    }
    setActionLoading(false)
  }

  async function handleAddComment() {
    if (!commentText.trim()) return
    setActionLoading(true)
    try {
      await addTaskComment({ task_id: taskId!, comment_text: commentText })
      setCommentText('')
      await loadTask()
    } catch (e) {
      setError((e as Error).message)
    }
    setActionLoading(false)
  }

  async function handleUploadAttachment(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !session) return
    setActionLoading(true)
    try {
      await uploadTaskAttachment(taskId!, file, 'PROGRESS_EVIDENCE' as AttachmentCategory, session!.user.id)
      await loadTask()
    } catch (e) {
      setError((e as Error).message)
    }
    setActionLoading(false)
  }

  async function handleViewAttachment(storagePath: string) {
    try {
      const url = await createTaskAttachmentSignedUrl(storagePath)
      window.open(url, '_blank')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (loading) return <div className="page"><div className="loading-state">Loading task…</div></div>
  if (error) return <div className="page"><div className="form-error">{error}</div></div>
  if (!task) return <div className="page"><div className="empty-state"><div className="empty-state-text">Task not found.</div></div></div>

  const tabs = ['overview', 'progress', 'submissions', 'comments', 'attachments', 'history', 'requests'] as const

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-title">{task.title}</h2>
          <span className="mono" style={{ fontSize: '13px', color: 'var(--slate)' }}>{task.task_code}</span>
        </div>
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>Back</button>
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
          {tabs.map((tab) => (
            <button
              key={tab}
              className={`btn btn-sm ${activeTab === tab ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Status</span>
              <span className={`attendance-badge ${task.status.toLowerCase()}`}>{TASK_STATUS_LABELS[task.status as TaskStatus]}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Priority</span>
              <span className={`tag tag-${task.priority.toLowerCase()}`}>{TASK_PRIORITY_LABELS[task.priority as TaskPriority]}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Type</span>
              <span style={{ fontSize: '13px' }}>{TASK_TYPE_LABELS[task.task_type as TaskType]}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Start Date</span>
              <span className="mono" style={{ fontSize: '13px' }}>{formatDate(task.start_date)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Original Deadline</span>
              <span className="mono" style={{ fontSize: '13px' }}>{formatDate(task.original_deadline)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Current Deadline</span>
              <span className="mono" style={{ fontSize: '13px' }}>{formatDate(task.current_deadline)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Expected Result</span>
              <span style={{ fontSize: '13px', textAlign: 'right', maxWidth: '60%' }}>{task.expected_result || '—'}</span>
            </div>
            {task.target_quantity != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Target</span>
                <span className="mono" style={{ fontSize: '13px' }}>{task.target_quantity} {task.target_unit || ''}</span>
              </div>
            )}
            {task.completion_outcome && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Outcome</span>
                <span className={`tag tag-${task.completion_outcome.toLowerCase()}`}>{COMPLETION_OUTCOME_LABELS[task.completion_outcome as CompletionOutcome]}</span>
              </div>
            )}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
              <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Description</span>
              <p style={{ fontSize: '14px', marginTop: 'var(--space-2)' }}>{task.description}</p>
            </div>

            {task.task_assignments && task.task_assignments.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' }}>
                <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Assignments</span>
                <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  {task.task_assignments.map((a: any) => (
                    <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                      <span className="mono">{a.assigned_to.slice(0, 8)}…</span>
                      <span>{ASSIGNMENT_TYPE_LABELS[a.assignment_type as AssignmentType]} {a.is_current ? '(Current)' : ''}</span>
                      {a.accepted_at && <span style={{ color: 'var(--teal)' }}>Accepted</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {task.task_dependencies && task.task_dependencies.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' }}>
                <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Dependencies</span>
                <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  {task.task_dependencies.map((d: any) => (
                    <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                      <span className="mono">{d.depends_on_task_id.slice(0, 8)}…</span>
                      <span>{DEPENDENCY_TYPE_LABELS[d.dependency_type as DependencyType]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {['ACCEPTANCE_PENDING', 'ASSIGNED'].includes(task.status) && canAccept && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' }}>
                <button className="btn btn-primary" onClick={handleAccept} disabled={actionLoading}>
                  {actionLoading ? 'Accepting…' : 'Accept Task'}
                </button>
                {canRequestChange && (
                  <button className="btn btn-secondary" style={{ marginLeft: 'var(--space-2)' }} onClick={() => navigate(`/tasks/${taskId}/reject`)}>
                    Reject / Request Change
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'progress' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {canProgress && ['ACCEPTED', 'IN_PROGRESS', 'REVISION_REQUIRED'].includes(task.status) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <h3 className="card-title">Add Progress Update</h3>
                <div className="form-field">
                  <label>Progress %</label>
                  <input type="number" min={0} max={100} value={progressPercent} onChange={(e) => setProgressPercent(Number(e.target.value))} />
                </div>
                <div className="form-field">
                  <label>Work Completed</label>
                  <textarea value={workCompleted} onChange={(e) => setWorkCompleted(e.target.value)} rows={3} />
                </div>
                <div className="form-field">
                  <label>Blocker (optional)</label>
                  <input type="text" value={blocker} onChange={(e) => setBlocker(e.target.value)} />
                </div>
                <button className="btn btn-primary" onClick={handleAddProgress} disabled={actionLoading}>
                  {actionLoading ? 'Adding…' : 'Add Progress'}
                </button>
              </div>
            )}
            {task.task_progress_updates && task.task_progress_updates.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {task.task_progress_updates.map((p: any) => (
                  <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                      <span style={{ fontWeight: 600, fontSize: '13px' }}>{p.progress_percent}%</span>
                      <span className="mono" style={{ fontSize: '12px', color: 'var(--slate)' }}>{formatDateTime(p.created_at)}</span>
                    </div>
                    <p style={{ fontSize: '13px' }}>{p.work_completed}</p>
                    {p.blocker && <p style={{ fontSize: '13px', color: 'var(--rose)', marginTop: 'var(--space-1)' }}>Blocker: {p.blocker}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state"><div className="empty-state-text">No progress updates yet.</div></div>
            )}
          </div>
        )}

        {activeTab === 'submissions' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {canSubmit && ['IN_PROGRESS', 'ACCEPTED', 'REVISION_REQUIRED'].includes(task.status) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <h3 className="card-title">Submit Task</h3>
                <div className="form-field">
                  <label>Result Summary</label>
                  <textarea value={resultSummary} onChange={(e) => setResultSummary(e.target.value)} rows={3} />
                </div>
                <div className="form-field">
                  <label>Submission Note (optional)</label>
                  <textarea value={submissionNote} onChange={(e) => setSubmissionNote(e.target.value)} rows={2} />
                </div>
                <button className="btn btn-primary" onClick={handleSubmit} disabled={actionLoading}>
                  {actionLoading ? 'Submitting…' : 'Submit for Review'}
                </button>
              </div>
            )}
            {task.task_submissions && task.task_submissions.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {task.task_submissions.map((s: any) => (
                  <div key={s.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                      <span className={`attendance-badge ${s.review_status.toLowerCase()}`}>{SUBMISSION_REVIEW_LABELS[s.review_status as SubmissionReviewStatus]}</span>
                      <span className="mono" style={{ fontSize: '12px', color: 'var(--slate)' }}>{formatDateTime(s.submitted_at)}</span>
                    </div>
                    <p style={{ fontSize: '13px', fontWeight: 600 }}>{s.result_summary}</p>
                    {s.submission_note && <p style={{ fontSize: '13px', color: 'var(--slate)', marginTop: 'var(--space-1)' }}>{s.submission_note}</p>}
                    {s.reviewer_feedback && <p style={{ fontSize: '13px', marginTop: 'var(--space-1)' }}>Feedback: {s.reviewer_feedback}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state"><div className="empty-state-text">No submissions yet.</div></div>
            )}
          </div>
        )}

        {activeTab === 'comments' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {canComment && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div className="form-field">
                  <label>Add Comment</label>
                  <textarea value={commentText} onChange={(e) => setCommentText(e.target.value)} rows={2} />
                </div>
                <button className="btn btn-primary" onClick={handleAddComment} disabled={actionLoading || !commentText.trim()}>
                  {actionLoading ? 'Adding…' : 'Add Comment'}
                </button>
              </div>
            )}
            {task.task_comments && task.task_comments.filter((c: any) => !c.deleted_at).length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {task.task_comments.filter((c: any) => !c.deleted_at).map((c: any) => (
                  <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                      <span className="mono" style={{ fontSize: '12px' }}>{c.author_id.slice(0, 8)}…</span>
                      <span className="mono" style={{ fontSize: '12px', color: 'var(--slate)' }}>{formatDateTime(c.created_at)}</span>
                    </div>
                    <p style={{ fontSize: '13px' }}>{c.comment_text}</p>
                    {c.is_internal && <span className="tag tag-amber" style={{ marginTop: 'var(--space-1)' }}>Internal</span>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state"><div className="empty-state-text">No comments yet.</div></div>
            )}
          </div>
        )}

        {activeTab === 'attachments' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {canUpload && (
              <div>
                <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                  Upload Attachment
                  <input type="file" style={{ display: 'none' }} onChange={handleUploadAttachment} accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,.csv" />
                </label>
              </div>
            )}
            {task.task_attachments && task.task_attachments.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>File Name</th><th>Category</th><th>Size</th><th>Uploaded</th><th>Action</th></tr></thead>
                  <tbody>
                    {task.task_attachments.map((a: any) => (
                      <tr key={a.id}>
                        <td>{a.file_name}</td>
                        <td>{ATTACHMENT_CATEGORY_LABELS[a.attachment_category as AttachmentCategory]}</td>
                        <td className="mono">{a.file_size_bytes ? `${(a.file_size_bytes / 1024).toFixed(1)}KB` : '—'}</td>
                        <td className="mono">{formatDate(a.created_at)}</td>
                        <td>
                          {canReadAttachments && (
                            <button className="btn btn-sm btn-secondary" onClick={() => handleViewAttachment(a.storage_path)}>View</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state"><div className="empty-state-text">No attachments yet.</div></div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {task.task_status_history && task.task_status_history.length > 0 ? (
              task.task_status_history.map((h: any) => (
                <div key={h.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px' }}>
                      <span style={{ color: 'var(--slate)' }}>{h.old_status || '—'}</span>
                      {' → '}
                      <span style={{ fontWeight: 600 }}>{h.new_status}</span>
                    </span>
                    <span className="mono" style={{ fontSize: '12px', color: 'var(--slate)' }}>{formatDateTime(h.created_at)}</span>
                  </div>
                  {h.reason && <p style={{ fontSize: '13px', color: 'var(--slate)', marginTop: 'var(--space-1)' }}>{h.reason}</p>}
                </div>
              ))
            ) : (
              <div className="empty-state"><div className="empty-state-text">No status history yet.</div></div>
            )}
            {task.task_deadline_history && task.task_deadline_history.length > 0 && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <h3 className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Deadline History</h3>
                {task.task_deadline_history.map((d: any) => (
                  <div key={d.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="mono" style={{ fontSize: '13px' }}>{d.old_deadline || '—'} → {d.new_deadline}</span>
                      <span className="mono" style={{ fontSize: '12px', color: 'var(--slate)' }}>{formatDate(d.created_at)}</span>
                    </div>
                    <p style={{ fontSize: '13px', color: 'var(--slate)', marginTop: 'var(--space-1)' }}>{d.change_reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'requests' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {requests.length > 0 ? (
              requests.map((r: any) => (
                <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                    <span className={`tag tag-${r.status.toLowerCase()}`}>{TASK_REQUEST_STATUS_LABELS[r.status as TaskRequestStatus]}</span>
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>{TASK_REQUEST_TYPE_LABELS[r.request_type as TaskRequestType]}</span>
                    <span className="mono" style={{ fontSize: '12px', color: 'var(--slate)' }}>{formatDate(r.created_at)}</span>
                  </div>
                  <p style={{ fontSize: '13px' }}>{r.reason}</p>
                  {r.proposed_target && <p style={{ fontSize: '13px', color: 'var(--slate)' }}>Proposed: {r.proposed_target} by {r.proposed_deadline}</p>}
                  {r.reviewer_remarks && <p style={{ fontSize: '13px', marginTop: 'var(--space-1)' }}>Reviewer: {r.reviewer_remarks}</p>}
                </div>
              ))
            ) : (
              <div className="empty-state"><div className="empty-state-text">No action requests.</div></div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
