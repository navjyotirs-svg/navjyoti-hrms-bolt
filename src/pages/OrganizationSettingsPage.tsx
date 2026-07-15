import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import '@/styles/shared.css'

interface Organization {
  id: string
  name: string
  slug: string
  is_active: boolean
}

export function OrganizationSettingsPage() {
  const { profile, permissions } = useAuth()
  const [org, setOrg] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const canManage = permissions.includes('organization.manage')

  useEffect(() => {
    if (!profile?.organization_id) {
      setLoading(false)
      return
    }
    supabase
      .from('organizations')
      .select('id, name, slug, is_active')
      .eq('id', profile.organization_id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else if (data) {
          setOrg(data as Organization)
          setName(data.name)
        }
        setLoading(false)
      })
  }, [profile?.organization_id])

  async function handleSave() {
    if (!org) return
    setError(null)
    setSuccess(false)
    const { error } = await supabase
      .from('organizations')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', org.id)
    if (error) setError(error.message)
    else {
      setOrg({ ...org, name })
      setSuccess(true)
      setEditing(false)
    }
  }

  if (loading) return <div className="loading-state">Loading…</div>
  if (!org) return <div className="empty-state"><div className="empty-state-text">No organization assigned.</div></div>

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Organization Settings</h2>
        {canManage && !editing && (
          <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}
      {success && <div className="form-success">Organization updated successfully.</div>}

      <div className="card">
        <div className="info-list">
          <div className="info-row">
            <span className="info-label">Name</span>
            {editing ? (
              <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '300px' }} />
            ) : (
              <span className="info-value">{org.name}</span>
            )}
          </div>
          <div className="info-row">
            <span className="info-label">Slug</span>
            <span className="info-value mono">{org.slug}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Status</span>
            <span className={`tag ${org.is_active ? 'tag-teal' : 'tag-rose'}`}>
              {org.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </div>

      {editing && (
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={() => { setEditing(false); setName(org.name); }}>Cancel</button>
          <button className="btn" onClick={handleSave}>Save</button>
        </div>
      )}
    </div>
  )
}
