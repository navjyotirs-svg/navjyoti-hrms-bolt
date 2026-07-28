import { useEffect, useState } from 'react'
import {
  fetchReceivedVoiceNotes,
  createVoiceNoteSignedUrl,
  recordVoiceNotePlay,
  acknowledgeVoiceNote,
  type VoiceNoteRow,
  type VoiceNoteRecipientRow,
} from '@/lib/voiceNotes'
import { ListSkeleton } from '@/components/Skeleton'
import '@/styles/shared.css'

type ReceivedNote = VoiceNoteRow & { voice_note_recipients: VoiceNoteRecipientRow[] }

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

export function MyVoiceNotesPage() {
  const [notes, setNotes] = useState<ReceivedNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [urlLoading, setUrlLoading] = useState<string | null>(null)
  const [playedSet, setPlayedSet] = useState<Set<string>>(new Set())
  const [acknowledging, setAcknowledging] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchReceivedVoiceNotes()
      setNotes(data)
      const played = new Set<string>()
      data.forEach((n) => {
        if (n.voice_note_recipients?.[0]?.first_played_at) played.add(n.id)
      })
      setPlayedSet(played)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voice notes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handlePlay(note: ReceivedNote) {
    if (!signedUrls[note.id]) {
      setUrlLoading(note.id)
      try {
        const url = await createVoiceNoteSignedUrl(note.storage_path)
        if (url) {
          setSignedUrls((prev) => ({ ...prev, [note.id]: url }))
        } else {
          setError('Failed to load audio for playback.')
        }
      } catch {
        setError('Failed to load audio for playback.')
      } finally {
        setUrlLoading(null)
      }
    }

    if (!playedSet.has(note.id)) {
      setPlayedSet((prev) => new Set(prev).add(note.id))
      try {
        await recordVoiceNotePlay(note.id)
      } catch {
        // Non-blocking — playback should continue
      }
    }
  }

  async function handleAcknowledge(noteId: string) {
    setAcknowledging(noteId)
    try {
      await acknowledgeVoiceNote(noteId)
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId
            ? {
                ...n,
                voice_note_recipients: n.voice_note_recipients.map((r) => ({
                  ...r,
                  acknowledged_at: r.acknowledged_at ?? new Date().toISOString(),
                })),
              }
            : n
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to acknowledge voice note')
    } finally {
      setAcknowledging(null)
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <h2 className="page-title">My Voice Notes</h2>
        </div>
        <div className="card">
          <ListSkeleton rows={4} />
        </div>
      </div>
    )
  }

  if (error && notes.length === 0) {
    return (
      <div className="page">
        <div className="page-header">
          <h2 className="page-title">My Voice Notes</h2>
        </div>
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-text">{error}</div>
            <button className="btn btn-secondary" onClick={load} style={{ marginTop: 'var(--space-4)' }}>Retry</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">My Voice Notes</h2>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="card">
        {notes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">No voice notes received yet.</div>
          </div>
        ) : (
          <div className="info-list">
            {notes.map((note) => {
              const recipient = note.voice_note_recipients?.[0]
              const isAcknowledged = !!recipient?.acknowledged_at
              const isPlayed = playedSet.has(note.id) || !!recipient?.first_played_at
              const isSelected = selectedId === note.id

              return (
                <div
                  key={note.id}
                  style={{
                    padding: 'var(--space-4) var(--card-pad)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-3)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '14px' }}>{note.title ?? '(Untitled)'}</strong>
                        {!isPlayed && <span className="tag tag-rose">New</span>}
                        {isPlayed && !isAcknowledged && <span className="tag tag-amber">Listened</span>}
                        {isAcknowledged && <span className="tag tag-teal">Acknowledged</span>}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--slate)' }}>
                        From {note.sender_employee_id ?? 'Unknown'} · {formatRelativeTime(note.created_at)} · {formatDuration(note.duration_seconds)}
                      </div>
                      {note.message && (
                        <div style={{ fontSize: '13px', color: 'var(--ink-text)', marginTop: '4px', wordBreak: 'break-word' }}>
                          {note.message}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => setSelectedId(isSelected ? null : note.id)}
                    >
                      {isSelected ? 'Hide Player' : 'Play'}
                    </button>
                    {!isAcknowledged && (
                      <button
                        className="btn btn-sm"
                        onClick={() => handleAcknowledge(note.id)}
                        disabled={acknowledging === note.id}
                      >
                        {acknowledging === note.id ? 'Acknowledging…' : 'Acknowledge'}
                      </button>
                    )}
                  </div>

                  {isSelected && (
                    <div style={{ marginTop: 'var(--space-1)' }}>
                      {urlLoading === note.id ? (
                        <div style={{ fontSize: '13px', color: 'var(--slate)' }}>Loading audio…</div>
                      ) : signedUrls[note.id] ? (
                        <audio
                          src={signedUrls[note.id]}
                          controls
                          onPlay={() => handlePlay(note)}
                          style={{ width: '100%' }}
                        />
                      ) : (
                        <audio
                          controls
                          onPlay={() => handlePlay(note)}
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
    </div>
  )
}
