import { supabase } from '@/lib/supabase'

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-note-action`

async function callVoiceNoteAction(action: string, payload: Record<string, unknown>) {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

export interface VoiceNoteRow {
  id: string
  organization_id: string
  sender_user_id: string
  sender_employee_id: string | null
  title: string | null
  message: string | null
  storage_path: string
  mime_type: string
  file_size_bytes: number
  duration_seconds: number | null
  status: string
  created_at: string
  deleted_at: string | null
  sender_employee?: {
    id: string
    full_name: string
    designation: string | null
  } | null
}

export interface VoiceNoteRecipientRow {
  id: string
  voice_note_id: string
  recipient_user_id: string
  recipient_employee_id: string | null
  delivered_at: string | null
  first_played_at: string | null
  last_played_at: string | null
  play_count: number
  acknowledged_at: string | null
  created_at: string
  recipient_employee?: {
    id: string
    full_name: string
    employee_code: string | null
    designation: string | null
  } | null
}

export type ReceivedNote = VoiceNoteRow & { voice_note_recipients: VoiceNoteRecipientRow[] }
export type SentNote = VoiceNoteRow & { voice_note_recipients: VoiceNoteRecipientRow[] }

export async function fetchReceivedVoiceNotes(): Promise<ReceivedNote[]> {
  const { data, error } = await supabase
    .from('voice_note_recipients')
    .select(`
      *,
      voice_notes (
        *,
        sender_employee:employees!voice_notes_sender_employee_id_fkey (
          id, full_name, designation
        )
      )
    `)
    .order('created_at', { ascending: false })
  if (error) throw new Error('DATABASE_POLICY_ERROR')
  return (data ?? []).map((r: any) => ({
    ...r.voice_notes,
    voice_note_recipients: [r],
  })) as ReceivedNote[]
}

export async function fetchSentVoiceNotes(): Promise<SentNote[]> {
  const { data, error } = await supabase
    .from('voice_notes')
    .select(`
      *,
      voice_note_recipients (
        *,
        recipient_employee:employees!voice_note_recipients_recipient_employee_id_fkey (
          id, full_name, employee_code, designation
        )
      )
    `)
    .eq('status', 'SENT')
    .order('created_at', { ascending: false })
  if (error) throw new Error('DATABASE_POLICY_ERROR')
  return (data ?? []) as SentNote[]
}

export async function fetchVoiceNoteById(voiceNoteId: string): Promise<ReceivedNote | null> {
  const { data, error } = await supabase
    .from('voice_notes')
    .select(`
      *,
      voice_note_recipients (
        *,
        recipient_employee:employees!voice_note_recipients_recipient_employee_id_fkey (
          id, full_name, employee_code, designation
        )
      ),
      sender_employee:employees!voice_notes_sender_employee_id_fkey (
        id, full_name, designation
      )
    `)
    .eq('id', voiceNoteId)
    .maybeSingle()
  if (error) throw new Error('DATABASE_POLICY_ERROR')
  return data as ReceivedNote | null
}

export async function uploadVoiceNote(userId: string, blob: Blob, mimeType: string): Promise<string> {
  const ext = mimeType.split('/')[1] ?? 'webm'
  const path = `${userId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from('voice-notes')
    .upload(path, blob, { contentType: mimeType })

  if (error) throw new Error('AUDIO_UPLOAD_FAILED')
  return path
}

export async function createVoiceNoteSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('voice-notes')
    .createSignedUrl(path, 120)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

export async function sendVoiceNote(payload: {
  recipient_employee_id: string
  title?: string
  message?: string
  storage_path: string
  mime_type: string
  file_size_bytes: number
  duration_seconds?: number
  request_id?: string
}) {
  return callVoiceNoteAction('send', payload)
}

export async function recordVoiceNotePlay(voice_note_id: string) {
  return callVoiceNoteAction('record_play', { voice_note_id })
}

export async function acknowledgeVoiceNote(voice_note_id: string) {
  return callVoiceNoteAction('acknowledge', { voice_note_id })
}

export async function deleteVoiceNote(voice_note_id: string) {
  return callVoiceNoteAction('delete', { voice_note_id })
}

export function getSupportedAudioMimeType(): string | null {
  const types = ['audio/webm', 'audio/ogg', 'audio/mp4']
  if (typeof MediaRecorder === 'undefined') return null
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return null
}
