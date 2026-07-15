import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import '@/styles/shared.css'

interface Department {
  id: string
  name: string
  branch_id: string | null
  is_active: boolean
}

interface Branch {
  id: string
  name: string
}

export function DepartmentManagementPage() {
  const { profile, permissions } = useAuth()
  const [departments, setDepartments] = useState<Department[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [name, setName] = useState('')
  const [branchId, setBranchId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const canManage = permissions.includes('department.manage')

  useEffect(() => {
    if (!profile?.organization_id) {
      setLoading(false)
      return
    }
    const orgId = profile.organization_id

    Promise.all([
      supabase.from('departments').select('id, name, branch_id, is_active').eq('organization_id', orgId).order('name'),
      supabase.from('branches').select('id, name').eq('organization_id', orgId).order('name'),
    ]).then(([deptRes, branchRes]) => {
      if (deptRes.error) setError(deptRes.error.message)
      else setDepartments((deptRes.data ?? []) as Department[])
      if (!branchRes.error) setBranches((branchRes.data ?? []) as Branch[])
      setLoading(false)
    })
  }, [profile?.organization_id])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!profile?.organization_id) return
    setError(null)

    const { data, error } = await supabase
      .from('departments')
      .insert({
        organization_id: profile.organization_id,
        name,
        branch_id: branchId || null,
      })
      .select('id, name, branch_id, is_active')
      .maybeSingle()

    if (error) {
      setError(error.message)
    } else if (data) {
      setDepartments([...departments, data as Department])
      setShowModal(false)
      setName('')
      setBranchId('')
    }
  }

  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? '—'

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Departments</h2>
        {canManage && (
          <button className="btn btn-sm" onClick={() => setShowModal(true)}>+ Add Department</button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="loading-state">Loading…</div>
        ) : departments.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No departments yet.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Branch</th><th>Status</th></tr></thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.id}>
                    <td><strong>{d.name}</strong></td>
                    <td>{branchName(d.branch_id)}</td>
                    <td><span className={`tag ${d.is_active ? 'tag-teal' : 'tag-gray'}`}>{d.is_active ? 'Active' : 'Inactive'}</span></td>
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
              Add Department
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleCreate}>
                <div className="form-field" style={{ marginBottom: 'var(--space-4)' }}>
                  <label htmlFor="dept-name">Name</label>
                  <input id="dept-name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="form-field" style={{ marginBottom: 'var(--space-4)' }}>
                  <label htmlFor="dept-branch">Branch (optional)</label>
                  <select id="dept-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                    <option value="">— No branch —</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
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
