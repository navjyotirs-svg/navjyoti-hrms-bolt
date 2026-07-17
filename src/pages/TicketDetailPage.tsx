import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { TICKET_CATEGORY_LABELS, TICKET_STATUS_LABELS, TASK_PRIORITY_LABELS, type TicketCategory, type TicketStatus, type TaskPriority } from '@/types/roles'
import { fetchTicketById, addTicketComment, resolveTicket, closeTicket, reopenTicket, escalateTicket, uploadTicketAttachment, createTicketAttachmentSignedUrl, formatTicketDate, formatTicketDateTime } from '@/lib/tickets'
import '@/styles/shared.css'

export function TicketDetailPage() {
  const { id: ticketId } = useParams<{ id: string }>()
  const { permissions, session } = useAuth()
  const navigate = useNavigate()
  const [ticket, setTicket] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'conversation' | 'attachments' | 'history' | 'escalations'>('overview')
  const [actionLoading, setActionLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [resolutionSummary, setResolutionSummary] = useState('')
  const [escalateReason, setEscalateReason] = useState('')
  const [reopenReason, setReopenReason] = useState('')

  const canComment = permissions.includes('ticket.comment')
  const canResolve = permissions.includes('ticket.resolve')
  const canClose = permissions.includes('ticket.close')
  const canReopen = permissions.includes('ticket.reopen')
  const canEscalate = permissions.includes('ticket.escalate')
  const canUpload = permissions.includes('ticket.attachment_upload')
  const canReadAttachments = permissions.includes('ticket.attachment_read')

  useEffect(() => { if (ticketId) loadTicket() }, [ticketId])

  async function loadTicket() {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchTicketById(ticketId!)
      setTicket(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  async function handleAddComment() {
    if (!commentText.trim()) return
    setActionLoading(true)
    try {
      await addTicketComment({ ticket_id: ticketId!, comment_text: commentText })
      setCommentText('')
      await loadTicket()
    } catch (e) { setError((e as Error).message) }
    setActionLoading(false)
  }

  async function handleResolve() {
    if (!resolutionSummary.trim()) { setError('Resolution summary is required'); return }
    setActionLoading(true)
    try {
      await resolveTicket({ ticket_id: ticketId!, resolution_summary: resolutionSummary })
      setResolutionSummary('')
      await loadTicket()
    } catch (e) { setError((e as Error).message) }
    setActionLoading(false)
  }

  async function handleClose() {
    setActionLoading(true)
    try {
      await closeTicket({ ticket_id: ticketId! })
      await loadTicket()
    } catch (e) { setError((e as Error).message) }
    setActionLoading(false)
  }

  async function handleReopen() {
    if (!reopenReason.trim()) { setError('Reason is required to reopen'); return }
    setActionLoading(true)
    try {
      await reopenTicket({ ticket_id: ticketId!, reason: reopenReason })
      setReopenReason('')
      await loadTicket()
    } catch (e) { setError((e as Error).message) }
    setActionLoading(false)
  }

  async function handleEscalate() {
    if (!escalateReason.trim()) { setError('Reason is required for escalation'); return }
    setActionLoading(true)
    try {
      await escalateTicket({ ticket_id: ticketId!, reason: escalateReason })
      setEscalateReason('')
      await loadTicket()
    } catch (e) { setError((e as Error).message) }
    setActionLoading(false)
  }

  async function handleUploadAttachment(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !session) return
    setActionLoading(true)
    try {
      await uploadTicketAttachment(ticketId!, file, session!.user.id)
      await loadTicket()
    } catch (e) { setError((e as Error).message) }
    setActionLoading(false)
  }

  async function handleViewAttachment(storagePath: string) {
    try {
      const url = await createTicketAttachmentSignedUrl(storagePath)
      window.open(url, '_blank')
    } catch (e) { setError((e as Error).message) }
  }

  if (loading) return <div className="page"><div className="loading-state">Loading ticket…</div></div>
  if (error) return <div className="page"><div className="form-error">{error}</div></div>
  if (!ticket) return <div className="page"><div className="empty-state"><div className="empty-state-text">Ticket not found.</div></div></div>

  const tabs = ['overview', 'conversation', 'attachments', 'history', 'escalations'] as const

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-title">{ticket.subject}</h2>
          <span className="mono" style={{ fontSize: '13px', color: 'var(--slate)' }}>{ticket.ticket_code}</span>
        </div>
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>Back</button>
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
          {tabs.map((t) => (
            <button key={t} className={`btn btn-sm ${activeTab === t ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Status</span>
              <span className={`attendance-badge ${ticket.status.toLowerCase()}`}>{TICKET_STATUS_LABELS[ticket.status as TicketStatus]}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Category</span>
              <span style={{ fontSize: '13px' }}>{TICKET_CATEGORY_LABELS[ticket.category as TicketCategory]}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Priority</span>
              <span className={`tag tag-${ticket.priority.toLowerCase()}`}>{TASK_PRIORITY_LABELS[ticket.priority as TaskPriority]}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--slate)', fontSize: '13px' }}>SLA Due</span>
              <span className="mono" style={{ fontSize: '13px' }}>{ticket.sla_due_at ? formatTicketDateTime(ticket.sla_due_at) : '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Created</span>
              <span className="mono" style={{ fontSize: '13px' }}>{formatTicketDate(ticket.created_at)}</span>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' }}>
              <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Description</span>
              <p style={{ fontSize: '14px', marginTop: 'var(--space-2)' }}>{ticket.description}</p>
            </div>
            {ticket.resolution_summary && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' }}>
                <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Resolution</span>
                <p style={{ fontSize: '14px', marginTop: 'var(--space-2)' }}>{ticket.resolution_summary}</p>
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {canResolve && ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <input type="text" placeholder="Resolution summary" value={resolutionSummary} onChange={(e) => setResolutionSummary(e.target.value)} style={{ width: '300px' }} />
                  <button className="btn btn-sm btn-primary" onClick={handleResolve} disabled={actionLoading}>Resolve</button>
                </div>
              )}
              {canClose && ticket.status === 'RESOLVED' && (
                <button className="btn btn-sm btn-secondary" onClick={handleClose} disabled={actionLoading}>Close</button>
              )}
              {canReopen && (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <input type="text" placeholder="Reopen reason" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} style={{ width: '300px' }} />
                  <button className="btn btn-sm btn-secondary" onClick={handleReopen} disabled={actionLoading}>Reopen</button>
                </div>
              )}
              {canEscalate && ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <input type="text" placeholder="Escalation reason" value={escalateReason} onChange={(e) => setEscalateReason(e.target.value)} style={{ width: '300px' }} />
                  <button className="btn btn-sm btn-secondary" onClick={handleEscalate} disabled={actionLoading}>Escalate</button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'conversation' && (
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
            {ticket.ticket_comments && ticket.ticket_comments.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {ticket.ticket_comments.map((c: any) => (
                  <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                      <span className="mono" style={{ fontSize: '12px' }}>{c.author_id.slice(0, 8)}…</span>
                      <span className="mono" style={{ fontSize: '12px', color: 'var(--slate)' }}>{formatTicketDateTime(c.created_at)}</span>
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
            {ticket.ticket_attachments && ticket.ticket_attachments.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>File Name</th><th>Size</th><th>Uploaded</th><th>Action</th></tr></thead>
                  <tbody>
                    {ticket.ticket_attachments.map((a: any) => (
                      <tr key={a.id}>
                        <td>{a.file_name}</td>
                        <td className="mono">{a.file_size_bytes ? `${(a.file_size_bytes / 1024).toFixed(1)}KB` : '—'}</td>
                        <td className="mono">{formatTicketDate(a.created_at)}</td>
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
              <div className="empty-state"><div className="empty-state-text">No attachments.</div></div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {ticket.ticket_history && ticket.ticket_history.length > 0 ? (
              ticket.ticket_history.map((h: any) => (
                <div key={h.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px' }}>
                      <span style={{ color: 'var(--slate)' }}>{h.old_status || '—'}</span>
                      {' → '}
                      <span style={{ fontWeight: 600 }}>{h.new_status}</span>
                    </span>
                    <span className="mono" style={{ fontSize: '12px', color: 'var(--slate)' }}>{formatTicketDateTime(h.created_at)}</span>
                  </div>
                  {h.reason && <p style={{ fontSize: '13px', color: 'var(--slate)', marginTop: 'var(--space-1)' }}>{h.reason}</p>}
                </div>
              ))
            ) : (
              <div className="empty-state"><div className="empty-state-text">No history yet.</div></div>
            )}
          </div>
        )}

        {activeTab === 'escalations' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {ticket.ticket_escalations && ticket.ticket_escalations.length > 0 ? (
              ticket.ticket_escalations.map((e: any) => (
                <div key={e.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>Level {e.escalation_level}</span>
                    <span className="mono" style={{ fontSize: '12px', color: 'var(--slate)' }}>{formatTicketDateTime(e.created_at)}</span>
                  </div>
                  <p style={{ fontSize: '13px', marginTop: 'var(--space-1)' }}>{e.reason}</p>
                </div>
              ))
            ) : (
              <div className="empty-state"><div className="empty-state-text">No escalations.</div></div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
