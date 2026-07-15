import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import '@/styles/shared.css'

interface Branch {
  id: string
  name: string
  location: string | null
  is_active: boolean
}

export function BranchManagementPage() {
  const { profile, permissions } = useAuth()
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [error, setError] = useState<string | null>(null)

  const canManage = permissions.includes('branch.manage')

  useEffect(() => {
    if (!profile?.organization_id) {
      setLoading(false)
      return
    }
    supabase
      .from('branches')
      .select('id, name, location, is_active')
      .eq('organization_id', profile.organization_id)
      .order('name')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setBranches((data ?? []) as Branch[])
        setLoading(false)
      })
  }, [profile?.organization_id])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!profile?.organization_id) return
    setError(null)

    const { data, error } = await supabase
      .from('branches')
      .insert({ organization_id: profile.organization_id, name, location: location || null })
      .select('id, name, location, is_active')
      .maybeSingle()

    if (error) {
      setError(error.message)
    } else if (data) {
      setBranches([...branches, data as Branch])
      setShowModal(false)
      setName('')
      setLocation('')
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Branches</h2>
        {canManage && (
          <button className="btn btn-sm" onClick={() => setShowModal(true)}>+ Add Branch</button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="loading-state">Loading…</div>
        ) : branches.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No branches yet.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Location</th><th>Status</th></tr></thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.id}>
                    <td><strong>{b.name}</strong></td>
                    <td>{b.location ?? '—'}</td>
                    <td><span className={`tag ${b.is_active ? 'tag-teal' : 'tag-gray'}`}>{b.is_active ? 'Active' : 'Inactive'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="modal">
            <div className="modal-header">
              Add Branch
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleCreate}>
                <div className="form-field" style={{ marginBottom: 'var(--space-4)' }}>
                  <label htmlFor="branch-name">Name</label>
                  <input id="branch-name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="form-field" style={{ marginBottom: 'var(--space-4)' }}>
                  <label htmlFor="branch-location">Location</label>
                  <input id="branch-location" value={location} onChange={(e) => setLocation(e.target.value)} />
                </div>
                {error && <div className="form-error">{error}</div>}
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn">Create</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
