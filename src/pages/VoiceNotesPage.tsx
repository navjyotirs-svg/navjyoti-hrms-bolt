import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  fetchSentVoiceNotes,
  fetchReceivedVoiceNotes,
  uploadVoiceNote,
  sendVoiceNote,
  getPlaybackUrl,
  recordVoiceNotePlay,
  acknowledgeVoiceNote,
  getSupportedAudioMimeType,
  type VoiceNoteRow,
  type VoiceNoteRecipientRow,
  type ReceivedNote,
} from '@/lib/voiceNotes'
import { ListSkeleton } from '@/components/Skeleton'
import '@/styles/shared.css'

const MAX_DURATION_SECONDS = 300
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024

type Tab = 'record' | 'sent' | 'received'

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
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function VoiceNotesPage() {
  const { profile, permissions } = useAuth()
  const navigate = useNavigate()
  const params = useParams<{ voiceNoteId?: string }>()

  const canSend = permissions.includes('voice_note.send') || permissions.includes('voice_note.send_team') || permissions.includes('voice_note.send_all')
  const canReadSent = permissions.includes('voice_note.read_sent')
  const canReadOwn = permissions.includes('voice_note.read_own') || permissions.includes('voice_note.read_self')
  const canPlayOwn = permissions.includes('voice_note.play_own') || permissions.includes('voice_note.read_self') || permissions.includes('voice_note.read_own')
  const canAckOwn = permissions.includes('voice_note.acknowledge_own')

  const initialTab: Tab = params.voiceNoteId ? 'received' : canSend ? 'record' : 'received'
  const [tab, setTab] = useState<Tab>(initialTab)

  if (!canSend && !canReadSent && !canReadOwn) {
    return (
      <div className="page">
        <div className="page-header"><h2 className="page-title">Voice Notes</h2></div>
        <div className="card"><div className="empty-state"><div className="empty-state-text">You do not have permission to access voice notes.</div></div></div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header"><h2 className="page-title">Voice Notes</h2></div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
        {canSend && (
          <button className={`btn btn-sm ${tab === 'record' ? '' : 'btn-secondary'}`} onClick={() => setTab('record')}>Record &amp; Send</button>
        )}
        {canReadSent && (
          <button className={`btn btn-sm ${tab === 'sent' ? '' : 'btn-secondary'}`} onClick={() => setTab('sent')}>Sent Voice Notes</button>
        )}
        {canReadOwn && (
          <button className={`btn btn-sm ${tab === 'received' ? '' : 'btn-secondary'}`} onClick={() => setTab('received')}>Received Voice Notes</button>
        )}
      </div>

      {tab === 'record' && canSend && <RecordTab profileId={profile?.id} />}
      {tab === 'sent' && canReadSent && <SentTab />}
      {tab === 'received' && canReadOwn && <ReceivedTab voiceNoteId={params.voiceNoteId} canPlay={canPlayOwn} canAck={canAckOwn} onClearId={() => navigate('/voice-notes')} />}
    </div>
  )
}

function RecordTab({ profileId }: { profileId?: string }) {
  const [employees, setEmployees] = useState<{ id: string; full_name: string; employee_code: string | null; designation: string | null }[]>([])
  const [empLoading, setEmpLoading] = useState(true)
  const [recipientId, setRecipientId] = useState('')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')

  const [micStatus, setMicStatus] = useState<'idle' | 'denied' | 'granted'>('idle')
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendSuccess, setSendSuccess] = useState<string | null>(null)
  const [previewValid, setPreviewValid] = useState(false)
  const [previewDuration, setPreviewDuration] = useState<number | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const mimeTypeRef = useRef<string | null>(null)
  const requestIdRef = useRef<string>('')

  useEffect(() => {
    async function loadEmployees() {
      setEmpLoading(true)
      const { data, error } = await supabase
        .from('employees')
        .select('id, full_name, employee_code, designation')
        .eq('is_active', true)
        .order('full_name')
      if (error) setSendError('Could not load employee list.')
      else setEmployees(data ?? [])
      setEmpLoading(false)
    }
    loadEmployees()
  }, [])

  useEffect(() => { mimeTypeRef.current = getSupportedAudioMimeType() }, [])

  async function startRecording() {
    setSendError(null); setSendSuccess(null)
    setRecordedBlob(null); setRecordedUrl(null); setElapsed(0)
    setPreviewValid(false); setPreviewDuration(null)

    if (typeof MediaRecorder === 'undefined' || !mimeTypeRef.current) {
      setSendError('RECORDING_NOT_SUPPORTED')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      setMicStatus('granted')

      const recorder = new MediaRecorder(stream, { mimeType: mimeTypeRef.current })
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const finalBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current! })
        if (finalBlob.size === 0) {
          setSendError('EMPTY_RECORDING')
          cleanupStream()
          return
        }
        if (finalBlob.size > MAX_FILE_SIZE_BYTES) {
          setSendError('AUDIO_TOO_LARGE')
          cleanupStream()
          return
        }
        const url = URL.createObjectURL(finalBlob)
        setRecordedBlob(finalBlob)
        setRecordedUrl(url)
        cleanupStream()
      }

      recorder.start(1000)
      setRecording(true); setPaused(false)
      timerRef.current = setInterval(() => {
        setElapsed((prev) => {
          if (prev + 1 >= MAX_DURATION_SECONDS) { stopRecording(); return MAX_DURATION_SECONDS }
          return prev + 1
        })
      }, 1000)
    } catch {
      setMicStatus('denied')
      setSendError('MICROPHONE_PERMISSION_DENIED')
    }
  }

  function pauseRecording() {
    const r = mediaRecorderRef.current
    if (r && r.state === 'recording') { r.pause(); setPaused(true) }
  }

  function resumeRecording() {
    const r = mediaRecorderRef.current
    if (r && r.state === 'paused') { r.resume(); setPaused(false) }
  }

  function stopRecording() {
    const r = mediaRecorderRef.current
    if (r && r.state !== 'inactive') r.stop()
    setRecording(false); setPaused(false)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  function cleanupStream() {
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null }
  }

  function resetRecording() {
    setRecordedBlob(null)
    if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    setRecordedUrl(null); setElapsed(0); setSendError(null); setSendSuccess(null)
    setPreviewValid(false); setPreviewDuration(null)
  }

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); cleanupStream(); if (recordedUrl) URL.revokeObjectURL(recordedUrl) }
  }, [])

  function handlePreviewLoadedMetadata() {
    const audio = previewAudioRef.current
    if (!audio) return
    const dur = audio.duration
    if (dur === Infinity || isNaN(dur)) {
      audio.currentTime = 1e101
      audio.ontimeupdate = () => {
        audio.ontimeupdate = null
        const realDur = audio.duration
        if (realDur !== Infinity && !isNaN(realDur) && realDur > 0) {
          setPreviewDuration(realDur)
          setPreviewValid(true)
        } else {
          setPreviewDuration(elapsed)
          setPreviewValid(true)
        }
        audio.currentTime = 0
      }
    } else if (dur > 0) {
      setPreviewDuration(dur)
      setPreviewValid(true)
    } else {
      setPreviewDuration(elapsed)
      setPreviewValid(true)
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    if (!profileId) return
    if (!recipientId) { setSendError('Please select a recipient.'); return }
    if (!recordedBlob) { setSendError('EMPTY_RECORDING'); return }
    if (!previewValid) { setSendError('Please wait for the preview to load before sending.'); return }

    setSendError(null); setSendSuccess(null); setUploadProgress(0)
    requestIdRef.current = crypto.randomUUID()

    try {
      const storagePath = await uploadVoiceNote(profileId, recordedBlob, recordedBlob.type)
      setUploadProgress(50)

      await sendVoiceNote({
        recipient_employee_id: recipientId,
        title: title.trim() || undefined,
        message: message.trim() || undefined,
        storage_path: storagePath,
        mime_type: recordedBlob.type,
        file_size_bytes: recordedBlob.size,
        duration_seconds: elapsed,
        request_id: requestIdRef.current,
      })

      setUploadProgress(100)
      setSendSuccess('Voice note sent successfully!')
      resetRecording(); setTitle(''); setMessage(''); setRecipientId('')
      setTimeout(() => setUploadProgress(null), 1500)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'VOICE_NOTE_SEND_FAILED')
      setUploadProgress(null)
    }
  }

  return (
    <div className="card"><div className="card-body">
      {sendError && <div className="form-error" style={{ marginBottom: 'var(--space-3)' }}>{sendError}</div>}
      {sendSuccess && <div className="form-success" style={{ marginBottom: 'var(--space-3)' }}>{sendSuccess}</div>}

      <form onSubmit={handleSend}>
        <div className="form-grid">
          <div className="form-field form-field-full">
            <label htmlFor="vn-recipient">Recipient Employee *</label>
            <select id="vn-recipient" value={recipientId} onChange={(e) => setRecipientId(e.target.value)} required disabled={empLoading}>
              <option value="">{empLoading ? 'Loading employees…' : 'Select recipient'}</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.full_name}{emp.employee_code ? ` (${emp.employee_code})` : ''}{emp.designation ? ` — ${emp.designation}` : ''}</option>
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
            <button type="button" className="btn" onClick={startRecording} disabled={micStatus === 'denied'}>● Start Recording</button>
          )}

          {recording && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <span className="tag tag-rose" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--rose-500)', display: 'inline-block' }} />
                {paused ? 'PAUSED' : 'REC'} {formatDuration(elapsed)}
              </span>
              {!paused && <button type="button" className="btn btn-secondary" onClick={pauseRecording}>⏸ Pause</button>}
              {paused && <button type="button" className="btn btn-secondary" onClick={resumeRecording}>▶ Resume</button>}
              <button type="button" className="btn btn-secondary" onClick={stopRecording}>■ Stop</button>
            </div>
          )}

          {recordedBlob && !recording && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{ fontSize: '13px', color: 'var(--slate)' }}>
                Recorded: {formatDuration(previewDuration ?? elapsed)} · {(recordedBlob.size / (1024 * 1024)).toFixed(2)} MB · {recordedBlob.type}
                {!previewValid && <span style={{ marginLeft: 'var(--space-2)' }}>(loading preview…)</span>}
              </div>
              <audio
                ref={previewAudioRef}
                src={recordedUrl ?? undefined}
                controls
                preload="metadata"
                onLoadedMetadata={handlePreviewLoadedMetadata}
                style={{ width: '100%' }}
              />
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" onClick={resetRecording}>↺ Re-record</button>
                <button type="submit" className="btn" disabled={!previewValid || (uploadProgress !== null && uploadProgress < 100)}>
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
    </div></div>
  )
}

function SentTab() {
  const [notes, setNotes] = useState<(VoiceNoteRow & { voice_note_recipients: VoiceNoteRecipientRow[] })[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const data = await fetchSentVoiceNotes()
      setNotes(data)
    } catch {
      setError('Voice notes could not be loaded.')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="card"><ListSkeleton rows={5} /></div>
  if (error) return (
    <div className="card"><div className="empty-state">
      <div className="empty-state-text">{error}</div>
      <button className="btn btn-secondary" onClick={load} style={{ marginTop: 'var(--space-4)' }}>Retry</button>
    </div></div>
  )
  if (notes.length === 0) return <div className="card"><div className="empty-state"><div className="empty-state-text">No sent voice notes yet.</div></div></div>

  return (
    <div className="card">
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Recipient</th>
              <th>Title</th>
              <th>Duration</th>
              <th>Sent</th>
              <th>Played</th>
              <th>Plays</th>
              <th>Acknowledged</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((note) => {
              const r = note.voice_note_recipients?.[0]
              return (
                <tr key={note.id}>
                  <td>{r?.recipient_employee?.full_name ?? '—'}</td>
                  <td>{note.title ?? '—'}</td>
                  <td>{formatDuration(note.duration_seconds)}</td>
                  <td>{formatRelativeTime(note.created_at)}</td>
                  <td>{r?.first_played_at ? formatRelativeTime(r.first_played_at) : '—'}</td>
                  <td>{r?.play_count ?? 0}</td>
                  <td>{r?.acknowledged_at ? formatRelativeTime(r.acknowledged_at) : '—'}</td>
                  <td><span className="tag tag-teal">{note.status}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type PlayerState = 'idle' | 'loading' | 'ready' | 'error'

function ReceivedTab({ voiceNoteId, canPlay, canAck, onClearId }: { voiceNoteId?: string; canPlay: boolean; canAck: boolean; onClearId: () => void }) {
  const [notes, setNotes] = useState<ReceivedNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unheard' | 'heard' | 'acknowledged'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [playerStates, setPlayerStates] = useState<Record<string, PlayerState>>({})
  const [playerUrls, setPlayerUrls] = useState<Record<string, string>>({})
  const [playerErrors, setPlayerErrors] = useState<Record<string, string>>({})
  const [playedSet, setPlayedSet] = useState<Set<string>>(new Set())
  const [acknowledging, setAcknowledging] = useState<string | null>(null)
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})

  async function load() {
    setLoading(true); setError(null)
    try {
      const data = await fetchReceivedVoiceNotes()
      setNotes(data)
      const played = new Set<string>()
      data.forEach((n) => { if (n.voice_note_recipients?.[0]?.first_played_at) played.add(n.id) })
      setPlayedSet(played)
      if (voiceNoteId) {
        setSelectedId(voiceNoteId)
        setTimeout(() => handleShowPlayer(voiceNoteId), 300)
      }
    } catch {
      setError('Voice notes could not be loaded.')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleShowPlayer(noteId: string) {
    setSelectedId(noteId)
    if (playerUrls[noteId]) {
      setPlayerStates((prev) => ({ ...prev, [noteId]: 'ready' }))
      return
    }

    setPlayerStates((prev) => ({ ...prev, [noteId]: 'loading' }))
    setPlayerErrors((prev) => { const { [noteId]: _, ...rest } = prev; return rest })

    try {
      const result = await getPlaybackUrl(noteId)
      setPlayerUrls((prev) => ({ ...prev, [noteId]: result.signedUrl }))
      setPlayerStates((prev) => ({ ...prev, [noteId]: 'ready' }))
    } catch {
      setPlayerStates((prev) => ({ ...prev, [noteId]: 'error' }))
      setPlayerErrors((prev) => ({ ...prev, [noteId]: 'Voice note could not be loaded. Please try again.' }))
    }
  }

  function handleHidePlayer(noteId: string) {
    setSelectedId(null)
    const audio = audioRefs.current[noteId]
    if (audio) { audio.pause(); audio.src = '' }
    setPlayerStates((prev) => ({ ...prev, [noteId]: 'idle' }))
  }

  function handleAudioError(noteId: string) {
    setPlayerStates((prev) => ({ ...prev, [noteId]: 'error' }))
    setPlayerErrors((prev) => ({ ...prev, [noteId]: 'The secure playback link expired. Click Play to retry.' }))
    setPlayerUrls((prev) => { const { [noteId]: _, ...rest } = prev; return rest })
  }

  function handleAudioPlaying(noteId: string) {
    if (!playedSet.has(noteId)) {
      setPlayedSet((prev) => new Set(prev).add(noteId))
      recordVoiceNotePlay(noteId).catch(() => {})
    }
  }

  async function handleAcknowledge(noteId: string) {
    setAcknowledging(noteId)
    try {
      await acknowledgeVoiceNote(noteId)
      setNotes((prev) => prev.map((n) => n.id === noteId ? {
        ...n,
        voice_note_recipients: n.voice_note_recipients.map((r) => ({ ...r, acknowledged_at: r.acknowledged_at ?? new Date().toISOString() })),
      } : n))
    } catch { setError('Failed to acknowledge voice note.') }
    finally { setAcknowledging(null) }
  }

  const filtered = notes.filter((n) => {
    const r = n.voice_note_recipients?.[0]
    if (filter === 'unheard') return !r?.first_played_at
    if (filter === 'heard') return r?.first_played_at && !r?.acknowledged_at
    if (filter === 'acknowledged') return !!r?.acknowledged_at
    return true
  })

  if (loading) return <div className="card"><ListSkeleton rows={4} /></div>
  if (error && notes.length === 0) return (
    <div className="card"><div className="empty-state">
      <div className="empty-state-text">{error}</div>
      <button className="btn btn-secondary" onClick={load} style={{ marginTop: 'var(--space-4)' }}>Retry</button>
    </div></div>
  )

  return (
    <div className="card">
      {error && <div className="form-error" style={{ marginBottom: 'var(--space-3)' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
        {(['all', 'unheard', 'heard', 'acknowledged'] as const).map((f) => (
          <button key={f} className={`btn btn-sm ${filter === f ? '' : 'btn-secondary'}`} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-state-text">No voice notes received.</div></div>
      ) : (
        <div className="info-list">
          {filtered.map((note) => {
            const r = note.voice_note_recipients?.[0]
            const isAck = !!r?.acknowledged_at
            const isPlayed = playedSet.has(note.id) || !!r?.first_played_at
            const isSelected = selectedId === note.id
            const senderName = note.sender_employee?.full_name ?? 'Management'
            const playerState = playerStates[note.id] ?? 'idle'
            const playerError = playerErrors[note.id]
            const playbackStatus = note.playback_status

            const showUnavailable = playbackStatus === 'CORRUPT' || playbackStatus === 'MISSING'
            const playerUrl = playerUrls[note.id]

            return (
              <div key={note.id} style={{ padding: 'var(--space-4) var(--card-pad)', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '14px' }}>{note.title ?? '(Untitled)'}</strong>
                      {!isPlayed && !showUnavailable && <span className="tag tag-rose">New</span>}
                      {isPlayed && !isAck && <span className="tag tag-amber">Heard</span>}
                      {isAck && <span className="tag tag-teal">Acknowledged</span>}
                      {showUnavailable && <span className="tag" style={{ background: 'var(--rose-100)', color: 'var(--rose-700)' }}>Unavailable</span>}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--slate)' }}>
                      From {senderName} · {formatRelativeTime(note.created_at)} · {formatDuration(note.duration_seconds)}
                    </div>
                    {note.message && <div style={{ fontSize: '13px', color: 'var(--ink-text)', marginTop: '4px', wordBreak: 'break-word' }}>{note.message}</div>}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                  {canPlay && !showUnavailable && (
                    <button className="btn btn-sm btn-secondary" onClick={() => {
                      if (isSelected) handleHidePlayer(note.id)
                      else handleShowPlayer(note.id)
                      onClearId()
                    }}>
                      {isSelected ? 'Hide Player' : 'Play'}
                    </button>
                  )}
                  {showUnavailable && (
                    <span style={{ fontSize: '13px', color: 'var(--rose-600)' }}>
                      {playbackStatus === 'MISSING' ? 'The voice note file could not be found.' : 'Audio recording is unavailable.'}
                    </span>
                  )}
                  {canAck && !isAck && !showUnavailable && (
                    <button className="btn btn-sm" onClick={() => handleAcknowledge(note.id)} disabled={acknowledging === note.id}>
                      {acknowledging === note.id ? 'Acknowledging…' : 'Acknowledge'}
                    </button>
                  )}
                </div>

                {isSelected && (
                  <div style={{ marginTop: 'var(--space-1)' }}>
                    {playerState === 'loading' && (
                      <div style={{ fontSize: '13px', color: 'var(--slate)' }}>Loading voice note…</div>
                    )}
                    {playerState === 'error' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        <div style={{ fontSize: '13px', color: 'var(--rose-600)' }}>{playerError ?? 'Voice note could not be loaded.'}</div>
                        <button className="btn btn-sm btn-secondary" onClick={() => handleShowPlayer(note.id)}>Retry Playback</button>
                      </div>
                    )}
                    {playerState === 'ready' && playerUrl && (
                      <audio
                        ref={(el) => { audioRefs.current[note.id] = el }}
                        src={playerUrl}
                        controls
                        preload="metadata"
                        onPlaying={() => handleAudioPlaying(note.id)}
                        onError={() => handleAudioError(note.id)}
                        style={{ width: '100%' }}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
