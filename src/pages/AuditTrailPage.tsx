import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'

import '@/styles/shared.css'

interface AuditLog {
  id: string
  actor_id: string
  action: string
  entity_type: string
  entity_id: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  created_at: string
}

interface ActorProfile {
  id: string
  email: string
  full_name: string | null
}

export function AuditTrailPage() {
  const { permissions } = useAuth()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [actors, setActors] = useState<Map<string, ActorProfile>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const canRead = permissions.includes('audit.read')

  useEffect(() => {
    if (!canRead) {
      setLoading(false)
      return
    }

    supabase
      .from('audit_logs')
      .select('id, actor_id, action, entity_type, entity_id, old_values, new_values, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(async ({ data, error }) => {
        if (error) {
          setError(error.message)
          setLoading(false)
          return
        }
        const logList = (data ?? []) as AuditLog[]
        setLogs(logList)

        const actorIds = [...new Set(logList.map((l) => l.actor_id).filter(Boolean))] as string[]
        if (actorIds.length > 0) {
          const { data: actorData } = await supabase
            .from('user_profiles')
            .select('id, email, full_name')
            .in('id', actorIds)
          if (actorData) {
            setActors(new Map((actorData as ActorProfile[]).map((a) => [a.id, a])))
          }
        }
        setLoading(false)
      })
  }, [canRead])

  if (!canRead) return <div className="empty-state"><div className="empty-state-text">You do not have permission to view audit logs.</div></div>
  if (loading) return <div className="loading-state">Loading…</div>
  if (error) return <div className="form-error">{error}</div>

  function actorName(id: string | null): string {
    if (!id) return 'System'
    const a = actors.get(id)
    return a ? (a.full_name ?? a.email) : 'Unknown'
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Audit Trail</h2>
      </div>

      <div className="card">
        {logs.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No audit entries yet.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                      {new Date(l.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </td>
                    <td>{actorName(l.actor_id)}</td>
                    <td><span className="tag tag-ink">{l.action}</span></td>
                    <td className="mono" style={{ fontSize: '11px' }}>{l.entity_type}{l.entity_id ? ` · ${l.entity_id.slice(0, 8)}` : ''}</td>
                    <td style={{ maxWidth: '300px', fontSize: '12px', color: 'var(--slate)' }}>
                      {l.new_values ? JSON.stringify(l.new_values).slice(0, 120) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
