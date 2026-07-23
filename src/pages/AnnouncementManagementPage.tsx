import { useEffect, useState } from 'react'
import { fetchAllAnnouncements, createAnnouncement, deleteAnnouncement, type AnnouncementRow } from '@/lib/announcements'
import '@/styles/shared.css'

export function AnnouncementManagementPage() {
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    title: '', message: '', priority: 'normal', target_scope: 'all',
    acknowledgement_required: false, expires_at: '',
  })

  useEffect(() => { loadAnnouncements() }, [])

  async function loadAnnouncements() {
    setLoading(true); setError(null)
    try {
      const data = await fetchAllAnnouncements()
      setAnnouncements(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  async function handleCreate() {
    if (!form.title.trim() || !form.message.trim()) { setError('Title and message required'); return }
    try {
      await createAnnouncement({
        title: form.title.trim(), message: form.message.trim(),
        priority: form.priority, target_scope: form.target_scope,
        acknowledgement_required: form.acknowledgement_required,
        expires_at: form.expires_at || null,
      })
      setForm({ title: '', message: '', priority: 'normal', target_scope: 'all', acknowledgement_required: false, expires_at: '' })
      setShowForm(false)
      await loadAnnouncements()
    } catch (e) { setError((e as Error).message) }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this announcement?')) return
    try {
      await deleteAnnouncement(id)
      await loadAnnouncements()
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Announcements</h2>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : 'New Announcement'}</button>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      {showForm && (
        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="form-field" style={{ marginBottom: 'var(--space-3)' }}>
            <label htmlFor="ann-title">Title</label>
            <input id="ann-title" type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="form-field" style={{ marginBottom: 'var(--space-3)' }}>
            <label htmlFor="ann-msg">Message</label>
            <textarea id="ann-msg" rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </div>
          <div className="form-grid" style={{ marginBottom: 'var(--space-3)' }}>
            <div className="form-field">
              <label htmlFor="ann-priority">Priority</label>
              <select id="ann-priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low</option><option value="normal">Normal</option>
                <option value="high">High</option><option value="urgent">Urgent</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="ann-scope">Target Scope</label>
              <select id="ann-scope" value={form.target_scope} onChange={(e) => setForm({ ...form, target_scope: e.target.value })}>
                <option value="all">All</option><option value="branch">Branch</option>
                <option value="department">Department</option><option value="role">Role</option>
                <option value="employee">Employee</option>
              </select>
            </div>
          </div>
          <div className="form-grid" style={{ marginBottom: 'var(--space-3)' }}>
            <div className="form-field">
              <label htmlFor="ann-ack">Acknowledgement Required</label>
              <select id="ann-ack" value={form.acknowledgement_required ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, acknowledgement_required: e.target.value === 'yes' })}>
                <option value="no">No</option><option value="yes">Yes</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="ann-exp">Expires At (optional)</label>
              <input id="ann-exp" type="datetime-local" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleCreate}>Publish</button>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="loading-state">Loading announcements…</div>
        ) : announcements.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No announcements yet.</div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {announcements.map((a) => (
              <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 'var(--space-3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{a.title}</strong>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <span className={`tag tag-${a.priority}`}>{a.priority}</span>
                    <span className="mono" style={{ fontSize: '0.75rem' }}>{new Date(a.publish_at).toLocaleDateString()}</span>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => handleDelete(a.id)}>Delete</button>
                  </div>
                </div>
                <div style={{ marginTop: 'var(--space-2)' }}>{a.message}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 'var(--space-2)' }}>
                  Scope: {a.target_scope} | Ack required: {a.acknowledgement_required ? 'Yes' : 'No'}
                  {a.expires_at && ` | Expires: ${new Date(a.expires_at).toLocaleDateString()}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
