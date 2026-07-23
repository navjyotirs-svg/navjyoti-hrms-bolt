import { useEffect, useState } from 'react'
import { fetchNotifications, markNotificationRead, markAllNotificationsRead, archiveNotification, type NotificationRow } from '@/lib/notifications'
import '@/styles/shared.css'

export function NotificationInboxPage() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')

  useEffect(() => { loadNotifications() }, [filter, categoryFilter])

  async function loadNotifications() {
    setLoading(true); setError(null)
    try {
      const { data } = await fetchNotifications({
        unreadOnly: filter === 'unread',
        category: categoryFilter !== 'all' ? categoryFilter : undefined,
        pageSize: 50,
      })
      setNotifications(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  async function handleMarkRead(id: string) {
    try {
      await markNotificationRead(id)
      await loadNotifications()
    } catch (e) { setError((e as Error).message) }
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead()
      await loadNotifications()
    } catch (e) { setError((e as Error).message) }
  }

  async function handleArchive(id: string) {
    try {
      await archiveNotification(id)
      await loadNotifications()
    } catch (e) { setError((e as Error).message) }
  }

  const categories = ['attendance', 'leave', 'task', 'ticket', 'daily_report', 'follow_up', 'calendar', 'employee', 'system', 'announcement']
  const priorityColors: Record<string, string> = { low: 'tag-low', normal: 'tag-normal', high: 'tag-high', urgent: 'tag-urgent' }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Notification Inbox</h2>
        <button className="btn btn-secondary" onClick={handleMarkAllRead}>Mark All Read</button>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      <div className="card">
        <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="form-field">
            <label htmlFor="notif-filter">Filter</label>
            <select id="notif-filter" value={filter} onChange={(e) => setFilter(e.target.value as 'all' | 'unread')}>
              <option value="all">All</option><option value="unread">Unread Only</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="notif-cat">Category</label>
            <select id="notif-cat" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="loading-state">Loading notifications…</div>
        ) : notifications.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No notifications.</div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {notifications.map((n) => (
              <div key={n.id} style={{
                border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 'var(--space-3)',
                backgroundColor: n.is_read ? 'transparent' : 'var(--bg-accent)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                      {!n.is_read && <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--primary)', display: 'inline-block' }} />}
                      <strong>{n.title}</strong>
                      <span className={`tag ${priorityColors[n.priority] || 'tag-normal'}`}>{n.priority}</span>
                    </div>
                    <div style={{ marginTop: 'var(--space-1)', fontSize: '0.875rem' }}>{n.message}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
                      {n.category.replace(/_/g, ' ')} | {new Date(n.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    {!n.is_read && <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => handleMarkRead(n.id)}>Mark Read</button>}
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => handleArchive(n.id)}>Archive</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
