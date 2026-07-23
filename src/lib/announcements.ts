import { supabase } from '@/lib/supabase'

export interface AnnouncementRow {
  id: string
  organization_id: string
  title: string
  message: string
  priority: string
  target_scope: string
  branch_id: string | null
  department_id: string | null
  role_code: string | null
  employee_id: string | null
  publish_at: string
  expires_at: string | null
  acknowledgement_required: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export async function fetchAnnouncements() {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('announcements')
    .select(`
      *,
      announcement_acknowledgements (id, user_id, acknowledged_at)
    `)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('publish_at', { ascending: false })
  if (error) throw error
  return (data || []) as unknown as (AnnouncementRow & {
    announcement_acknowledgements: Array<{ id: string; user_id: string; acknowledged_at: string }>
  })[]
}

export async function fetchAllAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as AnnouncementRow[]
}

export async function createAnnouncement(payload: {
  title: string
  message: string
  priority?: string
  target_scope: string
  branch_id?: string | null
  department_id?: string | null
  role_code?: string | null
  employee_id?: string | null
  expires_at?: string | null
  acknowledgement_required?: boolean
}) {
  const { data, error } = await supabase
    .from('announcements')
    .insert({
      ...payload,
      publish_at: new Date().toISOString(),
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateAnnouncement(id: string, payload: Partial<AnnouncementRow>) {
  const { data, error } = await supabase
    .from('announcements')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteAnnouncement(id: string) {
  const { error } = await supabase
    .from('announcements')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function acknowledgeAnnouncement(announcementId: string) {
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('announcement_acknowledgements')
    .insert({
      announcement_id: announcementId,
      user_id: userData.user.id,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function fetchAcknowledgements(announcementId: string) {
  const { data, error } = await supabase
    .from('announcement_acknowledgements')
    .select(`
      *,
      user_profiles!inner (id, email, role)
    `)
    .eq('announcement_id', announcementId)
    .order('acknowledged_at', { ascending: false })
  if (error) throw error
  return data || []
}
