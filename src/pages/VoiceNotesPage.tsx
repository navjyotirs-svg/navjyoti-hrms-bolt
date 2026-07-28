import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  fetchSentVoiceNotes,
  uploadVoiceNote,
  sendVoiceNote,
  getSupportedAudioMimeType,
  type VoiceNoteRow,
  type VoiceNoteRecipientRow,
} from '@/lib/voiceNotes'
import { ListSkeleton } from '@/components/Skeleton'
import '@/styles/shared.css'

const MAX_DURATION_SECONDS = 300 // 5 minutes
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024 // 15MB

interface Employee {
  id: string
  full_name: string
  employee_code: string | null
}

type Tab = 'record' | 'sent'

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const now = Date.now()
  const diff = now - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export function VoiceNotesPage() {
  const { profile, permissions } = useAuth()
  const [tab, setTab] = useState<Tab>('record')

  const canSend = permissions.includes('voice_note.send')
  const canReadSent = permissions.includes('voice_note.read_sent')

  // ---- Record tab state ----
  const [employees, setEmployees] = useState<Employee[]>([])
  const [empLoading, setEmpLoading] = useState(true)
  const [recipientId, setRecipientId] = useState('')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')

  const [micStatus, setMicStatus] = useState<'idle' | 'denied' | 'granted'>('idle')
  const [recording, setRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendSuccess, setSendSuccess] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mimeTypeRef = useRef<string | null>(null)

  // ---- Sent tab state ----
  const [sentNotes, setSentNotes] = useState<(VoiceNoteRow & { voice_note_recipients: VoiceNoteRecipientRow[] })[]>([])
  const [sentLoading, setSentLoading] = useState(true)
  const [sentError, setSentError] = useState<string | null>(null)

  useEffect(() => {
    async function loadEmployees() {
      setEmpLoading(true)
      const { data, error } = await supabase
        .from('employees')
        .select('id, full_name, employee_code')
        .eq('is_active', true)
        .order('full_name')
      if (error) setSendError(error.message)
      else setEmployees((data ?? []) as Employee[])
      setEmpLoading(false)
    }
    loadEmployees()
  }, [])

  useEffect(() => {
    mimeTypeRef.current = getSupportedAudioMimeType()
  }, [])

  async function startRecording() {
    setSendError(null)
    setSendSuccess(null)
    setRecordedBlob(null)
    setRecordedUrl(null)
    setElapsed(0)

    if (typeof MediaRecorder === 'undefined' || !mimeTypeRef.current) {
      setSendError('Audio recording is not supported in this browser.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      setMicStatus('granted')

      const recorder = new MediaRecorder(stream, { mimeType: mimeTypeRef.current })
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current! })
        if (blob.size > MAX_FILE_SIZE_BYTES) {
          setSendError('Recording exceeds 15MB limit. Try a shorter recording.')
          cleanupStream()
          return
        }
        setRecordedBlob(blob)
        setRecordedUrl(URL.createObjectURL(blob))
        cleanupStream()
      }

      recorder.start()
      setRecording(true)
      timerRef.current = setInterval(() => {
        setElapsed((prev) => {
          if (prev + 1 >= MAX_DURATION_SECONDS) {
            stopRecording()
            return MAX_DURATION_SECONDS
          }
          return prev + 1
        })
      }, 1000)
    } catch (err) {
      setMicStatus('denied')
      setSendError(err instanceof Error ? `Microphone access denied: ${err.message}` : 'Microphone access denied')
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
    setRecording(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  function cleanupStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }

  function resetRecording() {
    setRecordedBlob(null)
    if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    setRecordedUrl(null)
    setElapsed(0)
    setSendError(null)
    setSendSuccess(null)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      cleanupStream()
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    if (!profile?.id) return
    if (!recipientId) {
      setSendError('Please select a recipient.')
      return
    }
    if (!recordedBlob) {
      setSendError('Please record a voice note first.')
      return
    }

    setSendError(null)
    setSendSuccess(null)
    setUploadProgress(0)

    try {
      const storagePath = await uploadVoiceNote(profile.id, recordedBlob, recordedBlob.type)
      setUploadProgress(50)

      await sendVoiceNote({
        recipient_employee_id: recipientId,
        title: title.trim() || undefined,
        message: message.trim() || undefined,
        storage_path: storagePath,
        mime_type: recordedBlob.type,
        file_size_bytes: recordedBlob.size,
        duration_seconds: elapsed,
      })

      setUploadProgress(100)
      setSendSuccess('Voice note sent successfully!')
      resetRecording()
      setTitle('')
      setMessage('')
      setRecipientId('')
      setTimeout(() => setUploadProgress(null), 1500)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send voice note')
      setUploadProgress(null)
    }
  }

  async function loadSent() {
    setSentLoading(true)
    setSentError(null)
    try {
      const data = await fetchSentVoiceNotes()
      setSentNotes(data)
    } catch (err) {
      setSentError(err instanceof Error ? err.message : 'Failed to load sent voice notes')
    } finally {
      setSentLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'sent' && canReadSent) {
      loadSent()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  if (!canSend && !canReadSent) {
    return (
      <div className="page">
        <div className="page-header">
          <h2 className="page-title">Voice Notes</h2>
        </div>
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-text">You do not have permission to access voice notes.</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Voice Notes</h2>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        {canSend && (
          <button className={`btn btn-sm ${tab === 'record' ? '' : 'btn-secondary'}`} onClick={() => setTab('record')}>Record &amp; Send</button>
        )}
        {canReadSent && (
          <button className={`btn btn-sm ${tab === 'sent' ? '' : 'btn-secondary'}`} onClick={() => setTab('sent')}>Sent Voice Notes</button>
        )}
      </div>

      {tab === 'record' && canSend && (
        <div className="card">
          <div className="card-body">
            {sendError && <div className="form-error" style={{ marginBottom: 'var(--space-3)' }}>{sendError}</div>}
            {sendSuccess && <div className="form-success" style={{ marginBottom: 'var(--space-3)' }}>{sendSuccess}</div>}

            <form onSubmit={handleSend}>
              <div className="form-grid">
                <div className="form-field form-field-full">
                  <label htmlFor="vn-recipient">Recipient Employee *</label>
                  <select id="vn-recipient" value={recipientId} onChange={(e) => setRecipientId(e.target.value)} required disabled={empLoading}>
                    <option value="">{empLoading ? 'Loading employees…' : 'Select recipient'}</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.full_name}{emp.employee_code ? ` (${emp.employee_code})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="form-field form-field-full">
                  <label htmlFor="vn-title">Title (optional)</label>
                  <input id="vn-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Brief title" />
                </div>
                <div className="form-field form-field-full">
                  <label htmlFor="vn-message">Message (optional)</label>
                  <textarea id="vn-message" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional text message" />
                </div>
              </div>

              <div style={{ marginTop: 'var(--space-4)' }}>
                {micStatus === 'denied' && (
                  <div className="form-error" style={{ marginBottom: 'var(--space-3)' }}>
                    Microphone permission denied. Please allow microphone access in your browser settings.
                  </div>
                )}

                {!recording && !recordedBlob && (
                  <button type="button" className="btn" onClick={startRecording} disabled={micStatus === 'denied'}>
                    ● Start Recording
                  </button>
                )}

                {recording && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                    <span className="tag tag-rose" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--rose-500)', display: 'inline-block' }} />
                      REC {formatDuration(elapsed)}
                    </span>
                    <button type="button" className="btn btn-secondary" onClick={stopRecording}>■ Stop</button>
                  </div>
                )}

                {recordedBlob && !recording && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <div style={{ fontSize: '13px', color: 'var(--slate)' }}>
                      Recorded: {formatDuration(elapsed)} · {(recordedBlob.size / (1024 * 1024)).toFixed(2)} MB
                    </div>
                    <audio ref={audioRef} src={recordedUrl ?? undefined} controls style={{ width: '100%' }} />
                    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn-secondary" onClick={resetRecording}>↺ Re-record</button>
                      <button type="submit" className="btn" disabled={uploadProgress !== null && uploadProgress < 100}>
                        {uploadProgress !== null && uploadProgress < 100 ? `Sending… ${uploadProgress}%` : 'Send Voice Note'}
                      </button>
                    </div>
                  </div>
                )}

                {uploadProgress !== null && uploadProgress > 0 && uploadProgress < 100 && (
                  <div style={{ marginTop: 'var(--space-2)', height: 4, background: 'var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                    <div style={{ width: `${uploadProgress}%`, height: '100%', background: 'var(--teal)', transition: 'width 0.3s' }} />
                  </div>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {tab === 'sent' && canReadSent && (
        <div className="card">
          {sentLoading ? (
            <ListSkeleton rows={5} />
          ) : sentError ? (
            <div className="empty-state">
              <div className="empty-state-text">{sentError}</div>
              <button className="btn btn-secondary" onClick={loadSent} style={{ marginTop: 'var(--space-4)' }}>Retry</button>
            </div>
          ) : sentNotes.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-text">No sent voice notes yet.</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Title</th>
                    <th>Duration</th>
                    <th>Sent</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sentNotes.map((note) => {
                    const recipient = note.voice_note_recipients?.[0]
                    return (
                      <tr key={note.id}>
                        <td>{recipient?.recipient_employee_id ?? '—'}</td>
                        <td>{note.title ?? '—'}</td>
                        <td>{formatDuration(note.duration_seconds)}</td>
                        <td>{formatRelativeTime(note.created_at)}</td>
                        <td><span className="tag tag-teal">{note.status}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
