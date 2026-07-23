import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  fetchUnreadNotifications,
  fetchUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  type Notification,
} from '@/lib/attendance'
import '@/styles/attendance.css'

interface Props {
  userId: string
  soundEnabled: boolean
}

export function NotificationBell({ userId, soundEnabled }: Props) {
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [toast, setToast] = useState<Notification | null>(null)
  const [connected, setConnected] = useState(false)
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default')
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const shownIdsRef = useRef<Set<string>>(new Set())

  const playSound = useCallback(() => {
    if (!soundEnabled) return
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 880
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.5)
    } catch {
      // AudioContext not available
    }
  }, [soundEnabled])

  const sendBrowserNotification = useCallback((notif: Notification) => {
    if (!('Notification' in window)) return
    if (Notification.permission !== 'granted') return

    const priority = notif.priority || 'normal'
    const isHigh = priority === 'high' || priority === 'urgent'

    const title = isHigh ? `\u26A0 ${notif.title}` : notif.title
    const body = notif.message

    try {
      const n = new Notification(title, {
        body,
        tag: notif.id,
        requireInteraction: isHigh,
        silent: false,
      })
      n.onclick = () => {
        window.focus()
        n.close()
      }
    } catch {
      // Notification API may not be available in all contexts
    }
  }, [])

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return
    if (Notification.permission === 'granted') {
      setNotifPermission('granted')
      return
    }
    if (Notification.permission === 'denied') {
      setNotifPermission('denied')
      return
    }
    const result = await Notification.requestPermission()
    setNotifPermission(result)
  }, [])

  const loadUnread = useCallback(async () => {
    const [count, notifs] = await Promise.all([
      fetchUnreadNotificationCount(),
      fetchUnreadNotifications(),
    ])
    setUnreadCount(count)
    setNotifications(notifs)
    notifs.forEach((n) => shownIdsRef.current.add(n.id))
  }, [])

  useEffect(() => {
    requestPermission()
    loadUnread()

    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          const notif = payload.new as Notification
          if (shownIdsRef.current.has(notif.id)) return
          shownIdsRef.current.add(notif.id)
          setUnreadCount((prev) => prev + 1)
          setNotifications((prev) => [notif, ...prev])

          const priority = notif.priority || 'normal'
          const isHigh = priority === 'high' || priority === 'urgent'

          if (isHigh) {
            setToast(notif)
            setTimeout(() => setToast(null), 8000)
            playSound()
          }

          sendBrowserNotification(notif)
        }
      )
      .on('system', { event: 'connected' }, () => {
        setConnected(true)
        loadUnread()
      })
      .on('system', { event: 'disconnected' }, () => {
        setConnected(false)
      })
      .subscribe()

    channelRef.current = channel

    // Re-request permission on window focus (in case user dismissed initially)
    const handleFocus = () => {
      if ('Notification' in window && Notification.permission === 'default') {
        requestPermission()
      }
    }
    window.addEventListener('focus', handleFocus)

    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
      window.removeEventListener('focus', handleFocus)
    }
  }, [userId, loadUnread, playSound, sendBrowserNotification, requestPermission])

  async function handleMarkRead(id: string) {
    await markNotificationRead(id)
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    setUnreadCount((prev) => Math.max(0, prev - 1))
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead()
    setNotifications([])
    setUnreadCount(0)
  }

  return (
    <>
      <div className="notif-bell" onClick={() => setShowDropdown((prev) => !prev)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
        <span className={`notif-dot ${connected ? 'connected' : ''}`} title={connected ? 'Connected' : 'Reconnecting…'} />
      </div>

      {showDropdown && (
        <>
          <div className="notif-overlay" onClick={() => setShowDropdown(false)} />
          <div className="notif-dropdown">
            <div className="notif-dropdown-header">
              <span>Notifications</span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {notifPermission === 'default' && (
                  <button className="notif-mark-all" onClick={(e) => { e.stopPropagation(); requestPermission() }}>
                    Enable alerts
                  </button>
                )}
                {notifPermission === 'denied' && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }} title="Enable notifications in your browser settings to receive desktop alerts">
                    Desktop alerts blocked
                  </span>
                )}
                {notifications.length > 0 && (
                  <button className="notif-mark-all" onClick={handleMarkAllRead}>Mark all read</button>
                )}
              </div>
            </div>
            <div className="notif-list">
              {notifications.length === 0 ? (
                <div className="notif-empty">No new notifications</div>
              ) : (
                notifications.map((n) => (
                  <div key={n.id} className={`notif-item ${n.priority === 'high' ? 'notif-high' : ''}`}>
                    <div className="notif-item-title">{n.title}</div>
                    <div className="notif-item-msg">{n.message}</div>
                    <div className="notif-item-time">
                      {new Date(n.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </div>
                    <button className="notif-dismiss" onClick={() => handleMarkRead(n.id)}>Dismiss</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {toast && (
        <div className="notif-toast" onClick={() => setToast(null)}>
          <div className="notif-toast-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="notif-toast-content">
            <div className="notif-toast-title">{toast.title}</div>
            <div className="notif-toast-msg">{toast.message}</div>
          </div>
        </div>
      )}
    </>
  )
}
