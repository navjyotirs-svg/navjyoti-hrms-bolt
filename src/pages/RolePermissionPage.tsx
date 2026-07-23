import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Permission } from '@/types/roles'
import '@/styles/shared.css'

interface RoleRow {
  id: string
  code: string
  label: string
  description: string | null
}

interface PermissionRow {
  code: string
  label: string
}

export function RolePermissionPage() {
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [permissions, setPermissions] = useState<PermissionRow[]>([])
  const [matrix, setMatrix] = useState<Map<string, Set<string>>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      supabase.from('roles').select('id, code, label, description').order('code'),
      supabase.from('permissions').select('code, label').order('code'),
      supabase.from('role_permissions').select('role_id, permissions!inner(code, label)'),
    ]).then(([rRes, pRes, rpRes]) => {
      if (rRes.error) setError(rRes.error.message)
      else setRoles(rRes.data as RoleRow[])
      if (pRes.data) setPermissions(pRes.data as PermissionRow[])
      if (rpRes.data) {
        const m = new Map<string, Set<string>>()
        for (const row of rpRes.data as unknown as { role_id: string; permissions: { code: string; label: string } | { code: string; label: string }[] }[]) {
          if (!m.has(row.role_id)) m.set(row.role_id, new Set())
          const perms = Array.isArray(row.permissions) ? row.permissions : [row.permissions]
          for (const p of perms) {
            m.get(row.role_id)!.add(p.code)
          }
        }
        setMatrix(m)
      }
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="loading-state">Loading…</div>
  if (error) return <div className="form-error">{error}</div>

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Roles & Permissions</h2>
      </div>

      <div className="card">
        <div className="card-body">
          <h3 style={{ fontSize: '14px', marginBottom: 'var(--space-4)' }}>System Roles</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Code</th><th>Label</th><th>Description</th></tr></thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.code}</td>
                    <td><strong>{r.label}</strong></td>
                    <td>{r.description ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <h3 style={{ fontSize: '14px', marginBottom: 'var(--space-4)' }}>Permission Matrix</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Permission</th>
                  {roles.map((r) => <th key={r.id} style={{ textAlign: 'center' }}>{r.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {permissions.map((p) => (
                  <tr key={p.code}>
                    <td>
                      <strong>{p.label}</strong>
                      <div className="mono" style={{ fontSize: '10.5px', color: 'var(--slate)' }}>{p.code}</div>
                    </td>
                    {roles.map((r) => {
                      const has = matrix.get(r.id)?.has(p.code as Permission) ?? false
                      return (
                        <td key={r.id} style={{ textAlign: 'center' }}>
                          {has ? <span className="tag tag-teal">✓</span> : <span style={{ color: 'var(--slate-300)' }}>—</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
