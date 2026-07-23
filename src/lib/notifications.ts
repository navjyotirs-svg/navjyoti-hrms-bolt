import { supabase } from '@/lib/supabase'

export interface NotificationRow {
  id: string
  recipient_id: string
  notification_type: string
  title: string
  message: string
  priority: string
  dedup_key: string | null
  metadata: Record<string, unknown> | null
  is_read: boolean
  read_at: string | null
  category: string
  action_url: string | null
  expires_at: string | null
  archived: boolean
  delivery_status: string
  created_at: string
}

export interface NotificationPreferences {
  id: string
  user_id: string
  in_app_enabled: boolean
  email_enabled: boolean
  sound_enabled: boolean
  attendance_notifications: boolean
  leave_notifications: boolean
  task_notifications: boolean
  ticket_notifications: boolean
  daily_report_notifications: boolean
  calendar_notifications: boolean
  announcement_notifications: boolean
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  timezone: string
}

export async function fetchNotifications(params?: {
  unreadOnly?: boolean
  category?: string
  page?: number
  pageSize?: number
}) {
  const page = params?.page || 1
  const pageSize = params?.pageSize || 20
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('archived', false)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (params?.unreadOnly) query = query.eq('is_read', false)
  if (params?.category) query = query.eq('category', params.category)

  const { data, error, count } = await query
  if (error) throw error
  return { data: (data || []) as NotificationRow[], count: count || 0 }
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function markAllNotificationsRead() {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('is_read', false)
  if (error) throw error
}

export async function archiveNotification(id: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ archived: true })
    .eq('id', id)
  if (error) throw error
}

export async function deleteNotification(id: string) {
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function fetchUnreadCount() {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false)
    .eq('archived', false)
  if (error) throw error
  return count || 0
}

export async function fetchPreferences() {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .maybeSingle()
  if (error) throw error
  return data as NotificationPreferences | null
}

export async function updatePreferences(prefs: Partial<NotificationPreferences>) {
  const { data: existing } = await supabase
    .from('notification_preferences')
    .select('id')
    .maybeSingle()

  if (existing) {
    const { data, error } = await supabase
      .from('notification_preferences')
      .update(prefs)
      .eq('id', existing.id)
      .select()
      .single()
    if (error) throw error
    return data
  } else {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) throw new Error('Not authenticated')
    const { data, error } = await supabase
      .from('notification_preferences')
      .insert({ ...prefs, user_id: userData.user.id })
      .select()
      .single()
    if (error) throw error
    return data
  }
}

export async function fetchDeliveryLogs(page = 1, pageSize = 20) {
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const { data, error, count } = await supabase
    .from('notification_deliveries')
    .select(`
      *,
      notifications!inner (id, title, message, priority, category)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)
  if (error) throw error
  return { data: data || [], count: count || 0 }
}

export function subscribeToNotifications(callback: (notification: NotificationRow) => void) {
  return supabase
    .channel('notifications')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications' },
      (payload) => callback(payload.new as NotificationRow)
    )
    .subscribe()
}
